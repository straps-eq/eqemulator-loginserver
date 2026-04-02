# EQEmu Loginserver — Federation Fork

This is a fork of the [EQEmu Server](https://github.com/EQEmu/Server) loginserver with federation support, LSPX proxy, and cross-node authentication forwarding.

**Fork:** [straps-eq/EQEmu](https://github.com/straps-eq/EQEmu) branch `federation-server-list`

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Docker Compose Stack                                             │
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐   │
│  │  EQ Client   │───▶│  Loginserver  │◀───│  World Server(s)  │   │
│  │  (UDP)       │    │  (C++ binary) │    │  (TCP 5998)       │   │
│  └─────────────┘    └──────┬───────┘    └───────────────────┘   │
│                            │                                     │
│                     ┌──────┴───────┐                             │
│                     │  Web API     │                             │
│                     │  (port 6000) │                             │
│                     └──────┬───────┘                             │
│                            │                                     │
│                     ┌──────┴───────┐    ┌───────────────────┐   │
│                     │  Next.js Web  │───▶│  MariaDB          │   │
│                     │  (port 3000)  │    │  (eqemu_login)    │   │
│                     └──────────────┘    └───────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Role |
|-----------|------|
| **Loginserver** (C++) | Handles EQ client UDP connections, authenticates players, serves the server list, forwards play requests |
| **Web API** (port 6000) | HTTP API on a detached thread — serves server list data, account management, federation auth forwarding |
| **Next.js Web App** (port 3000) | Website, admin panel, federation sync engine, internal API for cross-node auth |
| **MariaDB** | `login_accounts`, `login_world_servers`, `federation_nodes`, `federation_server_status` |

### Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 5998 | TCP+UDP | Titanium client connections |
| 5999 | TCP+UDP | SoD/RoF2 client connections |
| 15900 | TCP+UDP | Larion (live) client connections |
| 6000 | TCP | Internal HTTP API (world server data, federation) |

## Packet Flow

### 1. Client Login (Local)

Standard EQ client login against accounts in the local `login_accounts` table.

```
EQ Client                  Loginserver                    MariaDB
   │                          │                              │
   │──OP_SessionReady────────▶│                              │
   │◀─OP_ChatMessage (ack)───│                              │
   │                          │                              │
   │──OP_Login (encrypted)──▶│                              │
   │                          │──SELECT login_accounts──────▶│
   │                          │◀─account row────────────────│
   │                          │  verify hash (scrypt/argon2) │
   │                          │  generate 10-char login key  │
   │◀─OP_LoginAccepted──────│                              │
   │  (encrypted: account_id, │                              │
   │   login_key, expansions)  │                              │
```

**Key details:**
- Login packets are encrypted with `eqcrypt_block` (DES-based block cipher)
- Password hashes support MD5 → SHA → SHA512 → scrypt → argon2id (auto-upgrades weak hashes on successful login)
- The `login_key` is a random 10-character alphanumeric string used for world server authentication
- Client credentials format: `loginserver:username` (e.g., `eqemu:PlayerName` or just `PlayerName` for local)

### 2. LSPX Proxy Login

When the `LSPX=1` environment variable is set, the loginserver transparently proxies authentication to `login.eqemulator.net:5999` for accounts that don't exist locally.

```
EQ Client          Loginserver (LSPX)        eqemulator.net          MariaDB
   │                    │                        │                      │
   │──OP_Login─────────▶│                        │                      │
   │                    │──SELECT account────────┼─────────────────────▶│
   │                    │◀─not found─────────────┼─────────────────────│
   │                    │                        │                      │
   │                    │──validate credentials─▶│                      │
   │                    │◀─account_id────────────│                      │
   │                    │                        │                      │
   │                    │──INSERT login_accounts─┼─────────────────────▶│
   │                    │  (source='eqemu')       │                      │
   │◀─OP_LoginAccepted─│                        │                      │
```

**How it works:**
1. Client sends login with `eqemu:username` prefix (default when `LSPX=1`)
2. Loginserver checks local DB — if account exists, verify locally
3. If not found, calls `CheckExternalLoginserverUserCredentials()` which connects to `login.eqemulator.net:5999` via TCP and validates credentials
4. On success, creates a local account with `source_loginserver = 'eqemu'` and the external `account_id`
5. On subsequent logins with a password change upstream, the local hash is updated automatically

### 3. Server List

When the client requests the server list, the loginserver builds a packet containing both locally connected world servers and federated servers from the database.

```
EQ Client          Loginserver                     MariaDB
   │                    │                              │
   │──OP_ServerList────▶│                              │
   │   Request          │                              │
   │                    │──RefreshFederatedServers()───▶│
   │                    │  (cached 30s TTL)             │
   │                    │  SELECT login_world_servers   │
   │                    │  WHERE federation_source_     │
   │                    │  node_id > 0                  │
   │                    │◀─federated server rows───────│
   │                    │                              │
   │                    │  [Build packet]              │
   │                    │  1. Live connected servers   │
   │                    │  2. Federated servers (dedup │
   │                    │     by short_name)           │
   │                    │                              │
   │◀─OP_ServerList────│                              │
   │   Response         │                              │
   │   (all servers)    │                              │
```

**Federated server injection:**
- `RefreshFederatedServers()` queries `login_world_servers WHERE federation_source_node_id > 0`
- Joins with `federation_server_status` for live player counts and status
- Deduplicates: skips any federated server whose `short_name` matches a live connected server
- Result is cached for 30 seconds (`FEDERATED_CACHE_TTL`)
- Each federated entry includes: IP, server type (Legends/Preferred/Standard), name, status, player count

### 4. Play Request — Local Server

When a player selects a server that's directly connected to this loginserver.

```
EQ Client          Loginserver                   World Server
   │                    │                              │
   │──OP_PlayEverquest─▶│                              │
   │   Request           │                              │
   │   (server_number)   │                              │
   │                    │  is_local? ✓                 │
   │                    │──ServerOP_LSClientAuth───────▶│
   │                    │  (account_id, login_key,      │
   │                    │   account_name, client_ip)    │
   │                    │                              │
   │                    │◀─ServerOP_UsertoWorldResp────│
   │◀─OP_PlayEverquest─│                              │
   │   Response (ok)    │                              │
```

### 5. Play Request — Federated Server (Cross-Node Auth)

When a player on a **mesh node** selects a server that lives on the **master node** (or another peer). This is the most complex flow.

```
 Mesh Node                                          Master Node
┌─────────────────────────────────────┐  ┌──────────────────────────────────┐
│                                     │  │                                  │
│ EQ Client ──▶ Loginserver (C++)     │  │  Web App ──▶ Loginserver (C++)  │
│               │                     │  │  │                    │          │
│               │ is_local? ✗         │  │  │                    ▼          │
│               │                     │  │  │              World Server     │
│               ▼                     │  │  │                              │
│          HandleFederatedPlay()      │  │  │                              │
│               │                     │  │  │                              │
│               │ HTTP POST           │  │  │                              │
│               ▼                     │  │  │                              │
│          Web App (internal)         │  │  │                              │
│          /api/internal/             │  │  │                              │
│           federation-play           │  │  │                              │
│               │                     │  │  │                              │
│               │ Signed federation   │  │  │                              │
│               │ POST (Ed25519)      │  │  │                              │
│               ▼                     │  │  ▼                              │
│               ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─▶│  /api/federation/play_request  │
│                                     │  │  │                              │
│                                     │  │  │ Verify signature, lookup     │
│                                     │  │  │ local server by short_name   │
│                                     │  │  │                              │
│                                     │  │  │ HTTP POST to loginserver     │
│                                     │  │  ▼ :6000/v1/federation/         │
│                                     │  │     auth_client                 │
│                                     │  │  │                              │
│                                     │  │  │ QueueFederatedClientAuth()   │
│                                     │  │  │ (mutex-protected queue)      │
│                                     │  │  │                              │
│                                     │  │  ▼ Main event loop (32ms tick)  │
│                                     │  │  ProcessPendingFederatedAuths() │
│                                     │  │  │                              │
│                                     │  │  │ SendFederatedClientAuth()    │
│                                     │  │  ▼                              │
│                                     │  │  ServerOP_LSClientAuth ──────▶  │
│                                     │  │                   World Server  │
└─────────────────────────────────────┘  └──────────────────────────────────┘
```

**Step by step:**

1. **EQ Client** sends `OP_PlayEverquestRequest` with the server ID
2. **Mesh Loginserver** (`SendPlayToWorld`) checks if `server_id` is in the live `m_world_servers` list
3. **Not local** → calls `HandleFederatedPlay(server_id)`
4. **HandleFederatedPlay** queries DB for `federation_source_node_id` and `endpoint_url`, then sends HTTP POST to the local **Web App** at `/api/internal/federation-play`
5. **Mesh Web App** looks up which federation node owns the server, signs the request with Ed25519, and POSTs to the master's `/api/federation/play_request`
6. **Master Web App** verifies the signature (replay protection, rate limiting, nonce tracking), finds the local `login_world_servers.id` by `short_name`, and calls the master loginserver's API at `/v1/federation/auth_client`
7. **Master Loginserver** receives the HTTP request on the **httplib thread** and calls `QueueFederatedClientAuth()` — this adds to a mutex-protected queue (does NOT send directly)
8. **Main event loop** (32ms tick) calls `ProcessPendingFederatedAuths()` which drains the queue and calls `SendFederatedClientAuth()` to send `ServerOP_LSClientAuth` to the world server
9. **World Server** receives the ClientAuth packet and allows the player to enter the world

### Why the Queue Pattern?

The httplib web server runs on a **detached thread**. The `WorldServer::GetConnection()->Send()` method is **not thread-safe** — calling it from the HTTP thread would silently drop packets or corrupt state.

**Root cause of the original auth failure:** The HTTP handler called `Send()` directly on the world server connection. Packets were silently dropped because the send buffer was being mutated from two threads simultaneously.

**Fix:** Queue from HTTP thread → send from main event loop.

```cpp
// HTTP thread (safe: only touches the mutex-protected queue)
bool QueueFederatedClientAuth(...) {
    std::lock_guard<std::mutex> lock(m_federated_auth_mutex);
    m_pending_federated_auths.push({...});
    return true;
}

// Main event loop, every 32ms (safe: same thread as all other Send() calls)
void ProcessPendingFederatedAuths() {
    std::queue<PendingFederatedAuth> pending;
    {
        std::lock_guard<std::mutex> lock(m_federated_auth_mutex);
        std::swap(pending, m_pending_federated_auths);
    }
    while (!pending.empty()) {
        SendFederatedClientAuth(pending.front());
        pending.pop();
    }
}
```

## Federation Authentication

All cross-node communication is signed with **Ed25519** keypairs.

```
Request Headers:
  X-Federation-PublicKey:  <hex-encoded public key>
  X-Federation-Timestamp:  <unix ms>
  X-Federation-Signature:  <hex-encoded Ed25519 signature>

Signature payload = timestamp + method + path + body
```

**Protections:**
- 5-minute timestamp drift window (replay protection)
- Redis-backed nonce tracking (prevents signature reuse)
- 120 requests/minute rate limit per node
- Node must be `approved` and `active` in `federation_nodes`

## Web API Endpoints (port 6000)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/v1/servers/list` | Read token | List all connected world servers (JSON) |
| POST | `/v1/account/create` | Write token | Create a local loginserver account |
| POST | `/v1/account/create/external` | Write token | Create an LSPX account with external ID |
| POST | `/v1/account/credentials/validate/local` | Read token | Validate local account credentials |
| POST | `/v1/account/credentials/validate/external` | Read token | Validate credentials against eqemulator.net |
| POST | `/v1/account/credentials/update/local` | Write token | Update local account password hash |
| POST | `/v1/account/credentials/update/external` | Write token | Update LSPX account password hash |
| POST | `/v1/federation/auth_client` | Write token | Queue a ClientAuth packet for a world server |
| GET | `/probes/healthcheck` | None | Health check (exits process if DB is unreachable) |

**Authentication:** Bearer token in `Authorization` header, loaded from `login_api_tokens` table at startup.

## Configuration

`login.json`:

```json
{
  "database": {
    "host": "mariadb",
    "port": "3306",
    "db": "eqemu_login",
    "user": "eqemu_ls",
    "password": "<from .env>"
  },
  "general": {
    "default_loginserver_name": "local",
    "eqemu_loginserver_address": "login.eqemulator.net:5999"
  },
  "federation": {
    "web_host": "web",
    "web_port": 3000
  },
  "security": {
    "mode": 14
  }
}
```

| Key | Default | Purpose |
|-----|---------|---------|
| `federation.web_host` | `web` | Docker hostname of the Next.js web app |
| `federation.web_port` | `3000` | Port of the Next.js web app |
| `general.eqemu_loginserver_address` | `login.eqemulator.net:5999` | LSPX upstream server |
| `security.mode` | `14` (argon2id) | Password hash algorithm for new accounts |
| `account.auto_create_accounts` | `false` | Auto-create on first login (disabled — LSPX handles this) |

## Building

The Docker image is built from the `federation-server-list` branch of the EQEmu fork:

```bash
docker compose build loginserver
```

The Dockerfile:
1. Clones `straps-eq/EQEmu` branch `federation-server-list`
2. Applies the `login_world_servers_repository.h` patch (adds `federation_source_node_id` column)
3. Patches `world_server.cpp` to persist `login_server_admin_id` on world server registration
4. Builds only the loginserver binary (`-DEQEMU_BUILD_LOGIN=ON`)
5. Produces a minimal runtime image with the binary and opcode config files

Pre-built images are available on GHCR:
```
ghcr.io/straps-eq/eqemu-loginserver:latest
ghcr.io/straps-eq/eqemu-loginserver:v1.3.1
```

## C++ Changes from Upstream

All changes are in the `loginserver/` directory:

| File | Changes |
|------|---------|
| `world_server_manager.h` | `FederatedServer` struct, `PendingFederatedAuth` struct, `QueueFederatedClientAuth()`, `ProcessPendingFederatedAuths()`, `SendFederatedClientAuth()`, `RefreshFederatedServers()`, mutex + queue members |
| `world_server_manager.cpp` | `CreateServerListPacket` injects federated servers from DB, `RefreshFederatedServers` with 30s cache TTL and dedup, queue/send pattern for cross-node auth |
| `loginserver_webserver.cpp` | `POST /v1/federation/auth_client` endpoint |
| `main.cpp` | `ProcessPendingFederatedAuths()` added to main event loop (32ms tick) |
| `client.cpp` | `SendPlayToWorld` checks local vs federated, `HandleFederatedPlay` forwards via HTTP, `SendPlaySuccess`/`SendPlayFailed` |
| `client.h` | New method declarations |

### Patched files (applied at build time)

| File | Patch |
|------|-------|
| `login_world_servers_repository.h` | Adds `federation_source_node_id` column to the ORM |
| `world_server.cpp` | Persists `login_server_admin_id` from world server registration packet |
