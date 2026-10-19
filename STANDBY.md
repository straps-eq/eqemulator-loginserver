# Standby loginserver node

A standby is a second full node on a different provider from the master. It
joins the federation, receives every account and world listing, and keeps
taking logins if the master (or the master's hosting account) goes away.
World servers list it as `loginserver2`, so players on those worlds can log in
through either node.

Example values below: hostname `login-node2.eqemulator.dev`, operator user
`straps`, checkout in `/opt/eqemu`.

---

## 1. The server

- 2 vCPU x86_64 (the images are amd64 only), 2-4 GB RAM, 40 GB SSD
- Ubuntu 24.04 LTS on a real VM (KVM), not an OpenVZ/LXC container
- Static public IPv4, inbound UDP allowed
- A different provider, card and email from the master

Firewall (provider firewall, or `ufw`):

| Port | Protocol | Purpose |
|---|---|---|
| 22 | TCP | SSH, your own IP only |
| 80, 443 | TCP | Website, Let's Encrypt |
| 5998 | TCP + UDP | Titanium logins, world server registration |
| 5999 | TCP + UDP | SoD/UF/RoF/RoF2 logins |
| 15900 | TCP + UDP | ToB logins |
| 15901 | TCP + UDP | Live client logins |

DNS: an A record for the hostname pointing at the server. If the domain is on
Cloudflare, set the record to **DNS only**. Logins are UDP and do not pass
through Cloudflare's proxy.

## 2. Operator user and Docker

As root, once:

```bash
adduser --disabled-password --gecos "" straps
mkdir -p /home/straps/.ssh
cp /root/.ssh/authorized_keys /home/straps/.ssh/
chown -R straps: /home/straps/.ssh && chmod 700 /home/straps/.ssh
echo "straps ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/straps

curl -fsSL https://get.docker.com | sh
usermod -aG docker straps

mkdir -p /opt/eqemu && chown straps: /opt/eqemu
```

Log in again as `straps` for the rest.

## 3. Install the stack

```bash
cd /opt/eqemu
git clone https://github.com/straps-eq/eqemulator-loginserver.git .
docker logout ghcr.io            # images are public; never log in on a node
scripts/setup.sh login-node2.eqemulator.dev you@example.com
```

`setup.sh` generates `.env` and `login.json`, gets the certificate, pulls the
images, starts everything and runs the migrations. For email, reuse the
master's Resend key and `noreply@eqemulator.dev`, or skip it.

Create the admin account: register on `https://login-node2.eqemulator.dev`, then

```bash
set -a; . ./.env; set +a
docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" eqemu-mariadb mariadb -uroot eqemu_login \
  -e "INSERT INTO platform_admins (login_account_id, role)
      SELECT id, 'admin' FROM platform_accounts WHERE username = 'YOUR_USERNAME';"
```

## 4. Pin the release and turn on updates

`setup.sh` starts the `:latest` images. Hand the node to the updater so it runs
a signed, pinned release from now on:

```bash
cd /opt/eqemu
mkdir -p state
cp scripts/deploy/updater.conf.example updater.conf && chmod 600 updater.conf
scripts/deploy.sh 1.7.2 --dry-run
scripts/deploy.sh 1.7.2
scripts/deploy/install-timer.sh
```

Use the current release instead of 1.7.2 if a newer one exists. Leave
`auto=false` for a few days, then decide (see [UPGRADING.md](UPGRADING.md)).

## 5. Join the federation

1. On the master (`https://eqemulator.dev`): **Admin → Federation → Add Peer**,
   name `EQEmulator Login2`, endpoint `https://login-node2.eqemulator.dev`. Copy
   the bootstrap token (valid for 1 hour).
2. On the standby: **Admin → Federation → Join Existing Federation**, same
   name and endpoint, master URL `https://eqemulator.dev`, paste the token.

Sync runs inside the web app every 60 seconds; there is no cron to add. The
first pull brings over all accounts and world listings.

Check it:

```bash
docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" eqemu-mariadb mariadb -uroot -N -e "
  SELECT COUNT(*) FROM eqemu_login.login_accounts;
  SELECT COUNT(*) FROM eqemu_login.login_world_servers;"
```

The account count should match the master's within a minute or two.

## 6. Backups

Copy the nightly backup setup from the master (`scripts/backup/`, see
[scripts/backup/RESTORE.md](scripts/backup/RESTORE.md)) with its own Dropbox
folder, so each node's dumps stay separate.

## 7. Point worlds at it

World servers can hold several loginserver connections at once. Big worlds add
the standby next to the master in their `eqemu_config.json`:

```json
"loginserver1": { "host": "eqemulator.dev", "port": "5998", "account": "", "password": "", "legacy": "0" },
"loginserver2": { "host": "login-node2.eqemulator.dev", "port": "5998", "account": "", "password": "", "legacy": "0" }
```

Players keep `eqemulator.dev` in `eqhost.txt`. If the master is down, they
switch the host line to `login-node2.eqemulator.dev` (port 5998, 5999, 15900 or
15901 as usual) and log in with the same account.
