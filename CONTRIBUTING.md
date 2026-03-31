# Contributing to EQEmulator.dev

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

### Prerequisites

- Docker & Docker Compose v2
- Node.js 20+ (for IDE tooling only — the app runs in Docker)
- Git

### 1. Clone and set up

```bash
git clone https://github.com/straps-eq/eqemulator-loginserver.git
cd eqemulator-loginserver
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### 2. Start the dev environment

```bash
docker compose up -d
```

This builds images locally and starts all services. The web app runs at `http://localhost:3000` (behind nginx at `https://localhost`).

### 3. Rebuild after code changes

```bash
docker compose build web
docker compose up -d web
```

### 4. View logs

```bash
docker logs -f eqemu-web          # Web app logs
docker logs -f eqemu-loginserver   # Loginserver logs
docker logs -f eqemu-mariadb       # Database logs
```

## Project Structure

```
web/src/
├── app/              # Next.js App Router pages and API routes
│   ├── api/          # Backend API endpoints
│   ├── admin/        # Admin panel components
│   └── servers/      # Server listing pages
├── components/       # Shared React components
├── db/               # Drizzle ORM schema
└── lib/              # Utilities
    ├── federation/   # Federation protocol (crypto, sync, changelog)
    ├── session.ts    # iron-session management
    ├── password.ts   # scrypt password hashing
    └── db.ts         # Database connection pool
```

## Code Style

- **TypeScript** — strict mode, no `any` unless unavoidable
- **Tailwind CSS** — utility classes, no custom CSS unless necessary
- **Next.js App Router** — server components by default, `"use client"` only when needed
- **No comments unless they explain _why_** — code should be self-documenting
- **Imports** — always at the top of the file, never inline

## Making Changes

1. **Fork** the repo and create a feature branch from `main`
2. **Make your changes** — keep PRs focused on a single concern
3. **Test locally** — `docker compose build web` must succeed
4. **Commit** with clear messages (e.g. `Fix: rate limit bypass on verify-email endpoint`)
5. **Open a PR** — fill out the template, reference any related issues

### Commit Messages

Use short, descriptive commit messages:
- `Fix: description` — bug fixes
- `Add: description` — new features
- `Security: description` — security improvements
- `Refactor: description` — code cleanup with no behavior change
- `Docs: description` — documentation only

## Security-Sensitive Changes

If your PR touches any of the following, flag it in the PR description:

- Authentication or session management
- Password hashing or verification
- Federation sync or crypto
- API authorization checks
- Rate limiting
- Input validation or sanitization
- Security headers (CSP, HSTS, etc.)

## Database Migrations

New migrations go in `web/migrations/` as numbered SQL files:

```
web/migrations/
├── 001_federation_tables.sql
├── 002_your_migration.sql
```

## Questions?

- Open a [Discussion](https://github.com/straps-eq/eqemulator-loginserver/discussions) on GitHub
- Ask on [Discord](https://discord.gg/6T4n3DdPVB)
