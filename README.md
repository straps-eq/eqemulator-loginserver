# EQEmulator.dev

[![Build](https://github.com/straps-eq/eqemulator-loginserver/actions/workflows/release.yml/badge.svg)](https://github.com/straps-eq/eqemulator-loginserver/actions/workflows/release.yml)

A federated login infrastructure for EverQuest private servers — built for reliability, transparency, and the long-term health of the emulation community.

## What is this?

EQEmulator.dev replaces the single-point-of-failure model of centralized login servers with a **federated mesh** of nodes that sync account data, server listings, and operator profiles in real time.

- **Authoritative nodes** form the trusted backbone, operated by vetted community members behind load-balanced IPs
- **Mesh nodes** can be stood up by anyone — they receive the full dataset read-only
- **LSPX proxy** transparently migrates existing eqemulator.net accounts on first login
- **Ed25519 cryptography** authenticates all node-to-node communication

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Official    │◄───►│  Official    │◄───►│  Official    │
│  Node A      │     │  Node B      │     │  Node C      │
│  (master)    │     │  (peer)      │     │  (peer)      │
└──────┬───────┘     └──────┬───────┘     └──────────────┘
       │                    │
       ▼                    ▼
┌─────────────┐     ┌─────────────┐
│  Mesh Node   │     │  Mesh Node   │
│  (read-only) │     │  (read-only) │
└─────────────┘     └─────────────┘
```

## Stack

| Component | Purpose |
|-----------|---------|
| **Next.js 15** | Web application (App Router, server components) |
| **MariaDB** | Account data, server profiles, federation state |
| **EQEmu Loginserver** | Handles EQ client connections (Titanium/SoD+/Larion) — [packet flow & architecture](LOGINSERVER.md) · [C++ fork](https://github.com/straps-eq/EQEmu/tree/federation-server-list) |
| **Redis** | Rate limiting, MFA code storage (optional) |
| **nginx** | Reverse proxy with Let's Encrypt SSL |
| **Prometheus** | Metrics collection (optional) |
| **Docker Compose** | Orchestration |

## Quick Start

### Prerequisites

- **Linux server** (Ubuntu 22.04+ recommended, 1 vCPU / 1 GB RAM minimum)
- **Domain name** with an A record pointing to your server's IP
- **Firewall/security group** allowing these ports:

| Port | Protocol | Purpose |
|------|----------|---------|
| 80 | TCP | SSL certificate issuance |
| 443 | TCP | HTTPS web UI |
| 5998 | TCP+UDP | Titanium client login |
| 5999 | TCP+UDP | SoD+/RoF2 client login |
| 15900 | TCP+UDP | Larion client login |

### Step 1 — Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

**Log out and back in** for the group change to take effect.

### Step 2 — Clone and run setup

```bash
git clone https://github.com/straps-eq/eqemulator-loginserver.git
cd eqemulator-loginserver
chmod +x scripts/setup.sh
./scripts/setup.sh login.yourdomain.com you@email.com
```

The script handles everything:
- Generates all secrets (DB passwords, session key, API tokens, federation keys)
- Configures `.env`, `login.json`, and nginx with your domain
- Obtains a **Let's Encrypt SSL certificate** (port 80 must be open)
- Generates DH parameters for TLS
- Pulls and starts all Docker containers
- Runs all database migrations
- Verifies all services are running

If you omit the arguments, the script will prompt interactively.

### Email Configuration (required for MFA & verification)

Email-based MFA and account verification require a **Resend** account with a **verified sending domain**.

1. Create a free account at [resend.com](https://resend.com)
2. Add and verify your sending domain (or use `eqemulator.dev` — ask **straps** in [Discord](https://discord.gg/6T4n3DdPVB) for a shared API key)
3. Generate an API key and enter it during `setup.sh`, or add to `.env` later:

```env
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@eqemulator.dev
```

> **Note:** The from-email domain must match a verified domain in your Resend account. If you don't have your own, use `noreply@eqemulator.dev` with the shared key from straps.

### Step 3 — Create your admin account

1. Register at `https://your-domain.com`
2. Promote to admin:

```bash
source .env
docker exec eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login \
  -e "INSERT INTO platform_admins (login_account_id, role)
      SELECT id, 'admin' FROM platform_accounts
      WHERE username = 'YOUR_USERNAME';"
```

### Step 4 — Join the federation

1. Go to **Admin → Federation → Join Existing Federation**
2. Enter the master URL: `https://eqemulator.dev`
3. Get a bootstrap token from [Discord](https://discord.gg/6T4n3DdPVB)
4. Your node will begin syncing accounts, servers, and profiles automatically

### Step 5 — Configure EQ clients

Players update their `eqhost.txt`:

```ini
[LoginServer]
Host=login.yourdomain.com:5999
```

> **Developer mode:** To build images locally instead of pulling pre-built ones, use `docker compose up -d --build`.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| SSL cert fails | Check DNS is pointing to this server, port 80 is open, re-run `setup.sh` |
| nginx restart-looping | SSL cert missing — run setup.sh again or check `certbot/conf/live/` |
| MariaDB not ready | Wait 60s on first boot (init scripts run once), check `docker logs eqemu-mariadb` |
| 500 errors in admin | Run migrations: `source .env && for f in web/migrations/*.sql; do docker exec -i eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login < "$f" 2>/dev/null; done` |
| Bad gateway (502) after upgrade | Restart nginx to pick up new container IPs: `docker restart eqemu-nginx` |
| Web app shows "No RESEND_API_KEY" | Email features are optional; set `RESEND_API_KEY` in `.env` then `docker compose up -d web` |

## Upgrading

**Option A — Admin Dashboard (recommended):**

Go to **Admin → System** and click **Upgrade**. The upgrade agent handles everything automatically: backup → pull → migrate → restart → nginx reload.

**Option B — Manual:**

```bash
cd eqemulator-loginserver

# Pull latest code and images
git pull origin main
docker compose pull

# Restart services
docker compose up -d

# Restart nginx to pick up new container IPs
docker restart eqemu-nginx

# Run any new database migrations
source .env
for f in web/migrations/*.sql; do
  docker exec -i eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login < "$f" 2>/dev/null
done
```

> **Note:** The `-i` flag on `docker exec` is required for piping SQL files. Migrations are idempotent — re-running all of them is safe.

The federation dashboard shows each node's software version. Outdated nodes display an amber **"update available"** indicator.

> **Auto-updates:** Add [Watchtower](https://containrrr.dev/watchtower/) to auto-pull new images hourly. You'll still need to run migrations manually for schema changes.

## Server Operators

World server operators connect by adding your loginserver to `eqemu_config.json`:

```json
"loginserver2": {
  "host": "login.yourdomain.com",
  "port": "5998",
  "account": "your_ws_admin",
  "password": "your_ws_password"
}
```

Once connected, operators can claim their server through the web UI to manage profiles, banners, and visibility settings.

## Federation

### Join the official federation

Once your node is running, join the EQEmulator.dev federation to sync accounts and server listings across all nodes:

1. **Contact Straps** on [Discord](https://discord.gg/6T4n3DdPVB) or open a [GitHub Issue](https://github.com/straps-eq/eqemulator-loginserver/issues) to request a bootstrap token
2. Provide your node's public URL (e.g. `https://eqloginserver.com`)
3. Once approved, you'll receive a one-time bootstrap token
4. Go to **Admin Panel → Federation → Join Existing Federation**
5. Enter the master URL (`https://eqemulator.dev`) and your bootstrap token
6. Your node will begin syncing accounts, servers, and profiles automatically

### Run your own independent federation

If you want to run a separate federation (not connected to EQEmulator.dev), you can initialize your own master node. Only the `admin` role can do this. See `docs/federation-setup.md` for the full guide.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | HTTPS (web UI) |
| 80 | TCP | HTTP → HTTPS redirect |
| 5998 | TCP/UDP | Titanium client login |
| 5999 | TCP/UDP | SoD+/RoF2 client login |
| 15900 | TCP/UDP | Larion client login |
| 6000 | TCP | Loginserver internal API |

## Project Structure

```
├── docker-compose.yml      # Service orchestration
├── .env.example            # Environment template
├── loginserver/            # Loginserver binary + config
│   ├── Dockerfile
│   └── login.json          # (generated, not committed)
├── mariadb/
│   └── init/               # DB schema init scripts
├── nginx/
│   └── conf.d/             # Reverse proxy config
├── web/                    # Next.js web application
│   ├── src/
│   │   ├── app/            # Pages and API routes
│   │   ├── components/     # Shared UI components
│   │   ├── db/             # Drizzle ORM schema
│   │   └── lib/            # Utilities, session, federation logic
│   ├── migrations/         # SQL migration files
│   ├── docs/               # Security audits, federation setup guide
│   └── public/             # Static assets
├── prometheus/             # Monitoring config (optional)
└── scripts/                # Maintenance scripts
```

## Security

- **MFA** enforced for all admin and server operator accounts
- **Ed25519 signatures** on all federation sync payloads
- **Private keys encrypted at rest** with XSalsa20-Poly1305
- **Rate limiting** on all auth endpoints
- **PII stripped** from public API responses (no IPs, registration data)
- **Only scrypt/argon2id** password hashes accepted across federation
- **Nonce-based CSP** — no unsafe-inline or unsafe-eval

See `web/docs/security-audit-federation.md` for the full security audit.

**Report a vulnerability:** Use [GitHub Private Vulnerability Reporting](https://github.com/straps-eq/eqemulator-loginserver/security/advisories/new) or contact Straps on [Discord](https://discord.gg/6T4n3DdPVB). See [SECURITY.md](SECURITY.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

1. Fork the repo
2. Create a feature branch from `main`
3. Test locally with `docker compose build web`
4. Submit a pull request

Please open an issue first for large changes.

## License

[GPL-3.0](LICENSE) — matching the upstream [EQEmu Server](https://github.com/EQEmu/Server) license
