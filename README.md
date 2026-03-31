# EQEmulator.dev

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
| **Next.js 14** | Web application (App Router, server components) |
| **MariaDB** | Account data, server profiles, federation state |
| **EQEmu Loginserver** | Handles EQ client connections (Titanium/SoD+/Larion) |
| **Redis** | Rate limiting, MFA code storage (optional) |
| **nginx** | Reverse proxy with Let's Encrypt SSL |
| **Prometheus** | Metrics collection (optional) |
| **Docker Compose** | Orchestration |

## Quick Start

### Prerequisites

- Linux server (Ubuntu 22.04+ recommended)
- Docker & Docker Compose v2
- A domain name with DNS pointing to your server
- (Optional) Cloudflare for DNS load balancing

### 1. Clone and run setup

```bash
git clone https://github.com/straps-eq/eqemulator-loginserver.git
cd eqemulator-loginserver
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The setup script auto-generates all secrets (DB passwords, session key, API tokens, federation secrets) — every installation gets unique values.

### 2. Configure your domain

```bash
nano .env                           # Set DOMAIN to your hostname
nano nginx/conf.d/default.conf      # Replace YOURDOMAIN.COM
```

### 3. Start everything

```bash
docker compose -f docker-compose.release.yml up -d
```

This pulls pre-built images and starts MariaDB, loginserver, web app, nginx, Redis, and Prometheus. No local compilation needed.

### 4. Run database migrations

```bash
source .env
for f in web/migrations/*.sql; do
  docker exec eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login < "$f"
done
```

### 5. Set up SSL

```bash
docker run --rm -v ./certbot/conf:/etc/letsencrypt \
  -v ./certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot \
  -w /var/www/certbot -d YOUR_DOMAIN
docker restart eqemu-nginx
```

### 6. Create your first admin account

1. Register through the web UI at `https://your-domain.com`
2. Verify your email
3. Promote to admin:

```bash
source .env
docker exec eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login \
  -e "INSERT INTO platform_admins (login_account_id, role)
      SELECT id, 'admin' FROM platform_accounts
      WHERE username = 'YOUR_USERNAME';"
```

### 7. Configure EQ clients

Players update their `eqhost.txt`:

```ini
[LoginServer]
Host=login.yourdomain.com:5999
```

> **Developer mode:** To build images locally instead of pulling pre-built ones, use `docker compose up -d` with the default `docker-compose.yml`.

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

See `web/docs/security-audit-federation.md` for the full security audit.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Submit a pull request

Please open an issue first for large changes.

## License

[MIT](LICENSE) — Copyright (c) 2026 Straps
