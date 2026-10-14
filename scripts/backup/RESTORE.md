# Restoring the EQEmulator.dev loginserver from a backup

This archive was made by `scripts/backup-offsite.sh`. It holds everything needed to rebuild the service on a new host:

| File | What it is |
|---|---|
| `eqemu_login.sql.gz` | Full dump of the login database (accounts, world servers, federation, site data) |
| `env` | The server's `.env`: database passwords, session secret, OAuth and federation secrets. **Treat as secret.** |
| `login.json` | Loginserver configuration, including its database password |
| `nginx-default.conf` | The live nginx site config (domain, TLS paths, Cloudflare real-IP ranges) |
| `VERSION` | Release tag and image digests that were running when the backup was taken |
| `restore.sh` | Automates the steps below |

You need the backup passphrase (kept in the operators' password manager) to open the archive.

## Quick restore on a fresh Linux host

1. Install Docker with the compose plugin, and open ports 80, 443, TCP 5998, and UDP 5998, 5999 and 15900 (TCP 15900 too).
2. Point DNS for the site domain, `login.` and `worldserver.` at the new host.
3. Copy this extracted folder to the host, then run, as a user in the `docker` group:

   ```bash
   sudo mkdir -p /opt/eqemu && sudo chown "$USER" /opt/eqemu
   bash restore.sh /opt/eqemu
   ```

   The script clones the release listed in `VERSION`, puts `env`, `login.json` and the nginx config in place, starts MariaDB, loads the dump, then starts the rest of the stack.
4. Get TLS certificates: certbot runs in the stack, but a brand-new host has no `certbot/conf` yet. Follow the "TLS" section of the repository README, or restore `certbot/conf` from the old host if you have it.
5. Check: the website loads, `docker logs eqemu-loginserver` shows world servers connecting, and a RoF2 client can log in on port 5999.

## Manual restore of just the database

```bash
gunzip -c eqemu_login.sql.gz | docker exec -i eqemu-mariadb sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot'
```

The dump contains `CREATE DATABASE` / `USE`, so it restores into the database name it came from. It replaces the tables it contains.
