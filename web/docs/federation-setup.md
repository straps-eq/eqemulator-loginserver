# Federation Setup Guide

Distributed loginserver federation lets multiple nodes sync account data using Ed25519 signed requests, origin authority rules, and master-driven config cascading.

---

## Architecture at a Glance

```
┌───────────────────────┐         ┌───────────────────────┐
│   MASTER NODE         │◄───────►│   PEER NODE           │
│   (eqemulator.dev)    │  signed │   (eu.eqemulator.dev) │
│                       │  HTTPS  │                       │
│  ┌─────────────────┐  │         │  ┌─────────────────┐  │
│  │ loginserver     │  │         │  │ loginserver     │  │
│  │ web app         │  │         │  │ web app         │  │
│  │ mariadb         │  │         │  │ mariadb         │  │
│  └─────────────────┘  │         │  └─────────────────┘  │
└───────────────────────┘         └───────────────────────┘
```

- **Master** — authoritative source for federation config; can add/suspend/revoke peers
- **Peers** — pull config and changes from master and other peers; push local changes
- **Origin authority** — only the node that created a record can update/delete it across the network
- **Ed25519 signatures** — every inter-node request is signed and verified; replay protection via timestamps

---

## Part 1 — Spinning Up a New Node

### 1.1 Provision the Server

Any Linux VPS/dedicated server with:
- Docker & Docker Compose
- A public domain or subdomain (e.g. `eu.eqemulator.dev`)
- HTTPS via Let's Encrypt or Cloudflare (required for inter-node communication)
- Ports open: **80/443** (web), **5998-5999/udp** and **15900/tcp+udp** (loginserver client logins; 15900 is the ToB client port), **5998/tcp** (world server registration)

### 1.2 Clone the Stack

```bash
# On the new server
mkdir -p /opt/eqemu && cd /opt/eqemu
# Copy or clone the same repo/files used on the master
git clone <your-repo-url> .
```

### 1.3 Configure Environment

Create `/opt/eqemu/.env` with values for this node:

```env
# Database
DB_ROOT_PASSWORD=<strong-random>
DB_NAME=eqemu_login
DB_USER=eqemu_ls
DB_PASSWORD=<strong-random>
DB_WEB_USER=eqemu_web
DB_WEB_PASSWORD=<strong-random>

# Loginserver
LOGINSERVER_API_TOKEN=<strong-random>

# Web
SESSION_SECRET=<strong-random>
DOMAIN=eu.eqemulator.dev
NEXT_PUBLIC_APP_URL=https://eu.eqemulator.dev

# Turnstile (same keys as master, or generate new ones)
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...

# Email (Resend)
RESEND_API_KEY=...
RESEND_FROM_EMAIL=noreply@eqemulator.dev

# Federation sync (optional — for cron-triggered sync)
FEDERATION_SYNC_SECRET=<strong-random>
```

### 1.4 Configure the Loginserver

Edit `/opt/eqemu/loginserver/login.json` — use the same structure as the master, adjusting the database credentials to match this node's `.env`:

```json
{
  "database": {
    "host": "mariadb",
    "port": "3306",
    "db": "eqemu_login",
    "user": "eqemu_ls",
    "password": "<DB_PASSWORD from .env>"
  },
  "general": {
    "default_loginserver_name": "local",
    "eqemu_loginserver_address": "login.eqemulator.net:5999"
  },
  "account": { "auto_create_accounts": false },
  "worldservers": {
    "unregistered_allowed": true,
    "show_player_count": true,
    "dev_test_servers_list_bottom": true,
    "special_character_start_list_bottom": true,
    "reject_duplicate_servers": true
  },
  "web_api": { "enabled": true, "port": 6000 },
  "security": { "mode": 14, "allow_password_login": true, "allow_token_login": false },
  "client_configuration": {
    "titanium_port": 5998,
    "titanium_opcodes": "login_opcodes.conf",
    "sod_port": 5999,
    "sod_opcodes": "login_opcodes_sod.conf",
    "tob_port": 15900,
    "tob_opcodes": "login_opcodes_tob.conf",
    "display_expansions": true,
    "max_expansions_mask": 524287
  }
}
```

> **ToB clients:** keep `tob_port` and `tob_opcodes` in `client_configuration` and open port 15900 for both TCP and UDP (the compose file publishes both). Without them, ToB (The Outer Brood) players cannot log in through your node.

### 1.5 Start the Stack

```bash
cd /opt/eqemu
docker compose up -d
```

Wait for MariaDB to be healthy, then the web and loginserver containers will start.

### 1.6 Create Federation Tables

```bash
docker exec -i eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login \
  < /opt/eqemu/web/migrations/001_federation_tables.sql
```

### 1.7 Grant Web User Permissions

```bash
docker exec -i eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" -e "
  GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_nodes TO 'eqemu_web'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_config TO 'eqemu_web'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_changelog TO 'eqemu_web'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_audit_log TO 'eqemu_web'@'%';
  FLUSH PRIVILEGES;
"
```

### 1.8 Set Up HTTPS

Configure nginx and Let's Encrypt for your domain, or use Cloudflare proxying. The node's public endpoint **must be reachable via HTTPS** by the master and other peers.

### 1.9 Create an Admin Account

You need an admin account on this node to access the Federation tab. Ensure at least one user in `platform_accounts` has `is_admin = 1`, or use the same admin creation process as the master.

At this point the new node is running but **not yet part of the federation**. Continue to Part 2.

---

## Part 2 — Authorizing the New Node

This is a two-step handshake between the master and the new peer.

### Step A: Generate a Bootstrap Token (on Master)

1. Log into the **master node's** admin panel
2. Go to **Admin → Federation** tab
3. Click **Add Peer**
4. Fill in:
   - **Name**: A label for the new node (e.g. `EQEmulator EU`)
   - **Endpoint URL**: The new node's public URL (e.g. `https://eu.eqemulator.dev`)
5. Click **Add Peer** — a bootstrap token is generated
6. **Copy the token** (it expires in 1 hour)

**CLI alternative:**

```bash
curl -X POST https://eqemulator.dev/api/admin/federation \
  -H "Cookie: <admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "add_peer",
    "name": "EQEmulator EU",
    "endpoint_url": "https://eu.eqemulator.dev"
  }'
```

Response:
```json
{
  "success": true,
  "node_id": 2,
  "bootstrap_token": "<GENERATED_TOKEN_HERE>"
}
```

### Step B: Join the Federation (on New Node)

1. Log into the **new node's** admin panel
2. Go to **Admin → Federation** tab
3. Click **Join Existing Federation**
4. Fill in:
   - **Node Name**: Same label (e.g. `EQEmulator EU`)
   - **This Node's Endpoint URL**: `https://eu.eqemulator.dev`
   - **Master Node URL**: `https://eqemulator.dev`
   - **Bootstrap Token**: Paste the token from Step A
5. Click **Join Federation**

**CLI alternative:**

```bash
curl -X POST https://eu.eqemulator.dev/api/admin/federation \
  -H "Cookie: <admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "join_federation",
    "name": "EQEmulator EU",
    "endpoint_url": "https://eu.eqemulator.dev",
    "master_url": "https://eqemulator.dev",
    "bootstrap_token": "<GENERATED_TOKEN_HERE>"
  }'
```

**What happens behind the scenes:**
1. The new node generates an Ed25519 keypair locally
2. It sends its public key + the bootstrap token to the master's `/api/federation/register`
3. The master verifies the token, marks the peer as approved, and returns:
   - The master's public key (so the peer can verify future signed requests)
   - The full federation config
   - The list of all other active peers
4. The new node stores all of this in its local `federation_nodes` and `federation_config` tables
5. Both nodes log the event to `federation_audit_log`

The new node is now a full federation member.

---

## Part 3 — Configure Sync

### Automatic Sync (Recommended)

Set `FEDERATION_SYNC_SECRET` in your `.env`, then add a cron job on each node:

```bash
# Every 30 seconds (two cron entries since cron minimum is 1 minute)
* * * * * curl -s -X POST http://localhost:3000/api/federation/sync -H "x-sync-secret: YOUR_SECRET" > /dev/null 2>&1
* * * * * sleep 30 && curl -s -X POST http://localhost:3000/api/federation/sync -H "x-sync-secret: YOUR_SECRET" > /dev/null 2>&1
```

### Manual Sync

Use the **Sync Now** button in the Federation tab, or:

```bash
curl -X POST https://your-node/api/admin/federation \
  -H "Cookie: <admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"action": "sync"}'
```

### Verify Sync

Check the Federation tab on both nodes — you should see:
- Both nodes listed with `active` status and `approved`
- Heartbeat timestamps updating
- Changelog sequence numbers advancing

Test connectivity manually:
```bash
curl -s https://eu.eqemulator.dev/api/federation/heartbeat
# Should return: {"error":"Federation not initialized"} before join, or node info after
```

---

## Part 4 — Node Management

All management actions are performed from the **master node's** admin panel.

### Suspend a Node
Temporarily stops a node from participating in sync. The node is not deleted and can be reactivated.
```json
{"action": "suspend_node", "node_id": 2}
```

### Revoke a Node
Permanently removes a node from the federation. Its public key is invalidated and all signed requests will be rejected.
```json
{"action": "revoke_node", "node_id": 2}
```

### Reactivate a Node
Brings a suspended node back online.
```json
{"action": "reactivate_node", "node_id": 2}
```

### Update Federation Config
Change sync settings from the master (propagates to all peers on next sync):
```json
{"action": "update_config", "key": "sync_interval_seconds", "value": 60}
```

---

## Part 5 — Versions, Status and Updates (1.7.0+)

From 1.7.0 the master no longer drives upgrades on peers. Each node updates
itself (see the updater / `deploy.sh` docs); the master only **publishes a
desired version** and **shows what every node reports**.

### What a node reports

Every sync cycle (60 s, first run ~15 s after start) a node sends its peers a
signed `POST /api/federation/heartbeat` with:

```json
{ "software_version": "1.7.0", "federation_protocol": 2, "updater_status": { ... } }
```

- `software_version` comes from the `APP_VERSION` build arg (the release tag),
  falling back to `web/package.json`.
- `updater_status` is the host updater's `/host-state/updater-status.json`
  (mounted read-only into the web container; `null` if absent). Unknown keys
  are dropped. Override the path with `UPDATER_STATUS_PATH`.
- Peers on 1.5.x/1.6.x still get the legacy `GET` heartbeat.

The receiver stores it in `federation_nodes` (`software_version`,
`updater_status`, `federation_protocol`, `last_status_at`; migration
`012_federation_node_status.sql`). Each node also keeps its own `is_self` row
current. **Admin → System → Federation Nodes** shows the table, including a
"behind desired" badge.

### Desired versions

| Key (`federation_config`) | Where | Meaning |
|---|---|---|
| `desired_version_stable`, `desired_version_canary` | master | Published to every node in the heartbeat response. Set in Admin → System (admin only, audit logged). |
| `desired_version_stable`, `desired_version_canary` | peer | Optional local override; empty = follow the master. |
| `master_desired_version_stable`, `master_desired_version_canary`, `master_desired_updated_at` | peer | Last values received from the master. |
| `update_check_requested_at` | peer | Set when the master sends "Notify to check". |

The host updater reads the effective values from inside the Docker network:

```bash
docker compose exec web wget -qO- http://localhost:3000/api/updater/desired
# {"desired_version_stable":"1.7.0","desired_version_canary":null,"source":"master",
#  "updated_at":"2026-10-19T12:00:00.000Z","check_requested_at":null}
```

Requests that come through nginx (they carry `X-Real-IP`) get a 404. The
desired version is advisory: the node's own updater policy decides whether and
when to apply it.

### "Notify to check"

The per-node action in the dashboard sends a signed `notify_check`. The peer
only records `update_check_requested_at` and an audit entry. It executes
nothing. Peers older than 1.7.0 answer 404; their operators must update by hand.

### Legacy remote commands (opt-in)

`remote_upgrade`, `remote_upgrade_status`, `remote_restart` and
`force_pull_restart` still exist for peers on 1.5.x/1.6.x, behind the
dashboard's **Legacy** disclosure. A 1.7.0+ node refuses them with
`403 remote commands disabled on this node` unless its operator opts in on
that node:

```sql
INSERT INTO federation_config (config_key, config_value, version, updated_at)
VALUES ('allow_remote_commands', '"true"', 1, NOW())
ON DUPLICATE KEY UPDATE config_value = '"true"', version = version + 1, updated_at = NOW();
```

Node-local keys (`allow_remote_commands`, the desired/master-desired keys,
`update_check_requested_at`) are never exported to peers, so a master cannot
switch them on. Every remote command is audit logged on both sides
(`remote_command_sent` on the master, `remote_command_received` with
`accepted: true|false` on the peer).

### Recipient-bound signatures

A 1.7.0+ node signs requests to peers that report 1.7.0+ with the recipient's
public key appended to the signed message, and sends it in
`X-Federation-Recipient`. A verifier rejects a request whose recipient is not
itself. Requests without the header are accepted only from peers whose
recorded version is below 1.7.0 or unknown (a warning is logged). If a node
recorded as 1.7.0+ sends a legacy heartbeat, it is treated as a rollback and
its recorded version is cleared. Nonces are claimed atomically (`SET NX EX`).

### Sync hashing

`sync_data` receivers hash only identity/credential columns (not
`last_login_date`, `updated_at`, `last_ip_address`) and keep the last-applied
hash per peer in Redis, so an idle federation reports 0 changes and a restart
no longer re-applies every row. Login timestamps are refreshed every 10
minutes without being counted as changes.

---

## Synced Tables

By default, the following tables are synced across all nodes:

| Table | Contents |
|-------|----------|
| `login_accounts` | Player login credentials |
| `login_world_servers` | Registered world servers |
| `login_server_admins` | Server operator admin accounts |
| `server_profiles` | Server listing profiles (descriptions, banners) |

Additional tables can be added via the `sync_tables` federation config key.

---

## Security Model

- **Ed25519 signatures** — every inter-node HTTP request includes signed headers (`X-Federation-PublicKey`, `X-Federation-Timestamp`, `X-Federation-Signature`)
- **Replay protection** — requests older than 5 minutes are rejected
- **Origin authority** — only the originating node's changes propagate for updates/deletes
- **Bootstrap tokens** — one-time use, expire in 1 hour, generated by master only
- **Admin-only management** — all federation admin actions require an authenticated admin session

---

## Cloudflare Load Balancing (Optional)

For automatic failover and geo-routing:

1. Create a Cloudflare Load Balancer pool with each node as an origin
2. Add TCP health checks on port 5998 (world server registration)
3. Point your login DNS record to the load balancer
4. World servers connect to the LB hostname; Cloudflare routes to the nearest healthy node

---

## Troubleshooting

### "Federation not initialized"
The node hasn't been set up yet. Go to Admin → Federation and either initialize as master or join an existing federation.

### "Master registration failed: Invalid token"
The bootstrap token was already used, expired (1 hour lifetime), or was pasted incorrectly. Generate a new one from the master's admin panel.

### "Master registration failed: Token expired"
Tokens are valid for 1 hour. Generate a new one and try again.

### Sync not pulling changes
- Verify both nodes show `active` + `approved` in the Federation tab
- Check `federation_audit_log` for error entries
- Test connectivity: `curl https://peer-url/api/federation/heartbeat`
- Ensure both nodes' clocks are synchronized (Ed25519 signatures include timestamps)

### Webpack chunk errors in dev mode
The federation routes use dynamic imports to work around a Next.js 14 dev server bug. Clear the cache and restart:
```bash
rm -rf .next && npm run dev
```
