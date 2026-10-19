# Client probe: which clients a world supports

The server directory shows which EverQuest clients each world accepts:
Titanium, SoF, SoD, UF, RoF, RoF2 and ToB. The live client uses the same world
protocol as ToB, so a ToB badge also means the live client can get in.

Worlds do not report this themselves. The site finds out by trying: a small
probe logs in to the world once per client version, the same way a real
client does, and records what the world does with it.

## How it works

For every world connected to this node's loginserver, one client version at a
time:

1. The loginserver tells the world that the probe account is about to log in
   and gives it a one-time session key. This is the same message the world
   gets when a player picks it from the server list.
2. The probe connects to the world's UDP port 9000, the port every EQ client
   uses for world.
3. It sends the login packet in that client version's format.
4. It waits up to 10 seconds, records the result and disconnects.

The world's answer gives the result:

| Result | What the world did |
|---|---|
| **supported** | Accepted the login and sent the character select screen. |
| **blocked** | Recognized the client but turned it away by its own rules: the `World:SupportedClients` rule leaves it out, or `World:CustomFilesKey` requires custom client files. |
| **unsupported** | Did not recognize the client at all. The world has no support built in for that version. |
| **error** | Something else went wrong, for example the world did not accept the session key. |
| **unreachable** | No answer on UDP port 9000. |

The public pages show only the supported clients (and the blocked ones on the
server's own page). A client that worked within the last 24 hours stays listed
through a single failed check, so a world restart does not make badges
disappear. Worlds that have not been checked yet show "Not checked yet".

## What it does on your world

- **One probe account.** The probe always logs in as the loginserver account
  `eqemudev-probe`. The first time it logs in, your world creates a normal
  account for it in its `account` table, as it does for any new player, at
  the default status from your world config. The hyphen in the name keeps it
  apart from player accounts, which cannot contain one when created on this
  site.
  Nobody can log in to this account from a real client. Its password is
  random and is never stored anywhere readable.
- **It never enters the game.** The probe stops at character select. It does
  not create characters, does not pick one and never reaches a zone.
- **One short login per client per cycle.** That is at most 7 logins per
  world every 6 hours, a few seconds each, one after another, never two at
  once. If the world does not answer the first one, the rest are skipped for
  that cycle. Only one world is probed at a time.
- **What shows up in your logs.** A connection from the eqemulator.dev server's
  address, "Account (eqemudev-probe) Logging (in) to character select", and a
  disconnect right after. Your world also records the login IP for the
  account, as it does for every login. For clients your world does not
  support you may see "Unable to identify stream" in the netcode log.

## Opting out

Ask the eqemulator.dev admins to opt your world out. They can do it from the
admin System page (Client Probe, "opt out") without a restart. Your world is
then skipped by every probe cycle and keeps the badges it last had.

Node operators can switch the probe off for their whole node with
`CLIENT_PROBE_ENABLED=false`.

## Settings (node operators)

| Setting | Default | Meaning |
|---|---|---|
| `CLIENT_PROBE_ENABLED` | empty | Empty: probe only on the federation master. `true` or `false` forces it on or off. |
| `CLIENT_PROBE_INTERVAL_HOURS` | `6` | Hours between cycles (minimum 1). |
| `CLIENT_PROBE_CLIENTS` | all | Comma-separated subset of `titanium,sof,sod,uf,rof,rof2,tob`. |

The schedule checks every 10 minutes whether a cycle is due, measured from the
last stored result, so restarting the web container does not cause extra
probing. The first check runs 5 to 15 minutes after startup.

The admin System page has a Client Probe panel with the last results per
world (hover a cell for the reason), a **Probe now** button for all worlds
or for one world, and the opt-out switch. The same actions are available on
`POST /api/admin/system` as `client_probe_status`, `client_probe_run`
(optional `world_server_id`) and `client_probe_optout` (`world_server_id`,
`opt_out`).

Results are stored in the `world_client_support` table (migration 013),
opt-outs in `world_client_probe_optout`. Both are new tables; nothing else
in the database is changed.

## Limitations

- Only worlds connected to this node's loginserver are probed. Worlds that
  are only listed through a federation peer show "Not checked yet" here
  unless that peer runs the probe itself (its results stay on that peer).
- The probe uses the address the loginserver gives players for the world. A
  world that players reach through a different address or port, or that
  filters UDP by source address, shows as unreachable.
- "unsupported" means the world did not recognize that client's login
  packet. A heavily modified server with its own opcodes may show
  unsupported for a client its players can still use with matching
  modified files.
- "blocked" is detected from the messages stock EQEmu sends
  ("Client Not In Supported List", "Missing Files") and from the missing
  expansion packet that goes with them. Custom rejection code may show up as
  error instead.
- ToB support follows the EQEmu `develop` branch (`patch_TOB.conf`); a world
  built from an older ToB branch with different opcodes would show ToB as
  unsupported.
