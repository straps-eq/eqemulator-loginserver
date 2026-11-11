# EverQuest Legends (EQL) client

The loginserver can accept the EverQuest Legends client (eqgame.exe built Oct 12 2026, the same code line as the ToB #630 client) on its own port, **15902** (UDP, TCP also published). It is off by default. Titanium (5998), SoD/UF/RoF/RoF2 (5999), ToB (15900) and the live client (15901) are not affected.

## Login protocol

EQL added one login message type at 0x18, so every server-to-client login opcode from 0x18 up is ToB's value + 1. Client-to-server opcodes are unchanged, and the bodies of LoginAccepted, ServerListResponse, PlayEverquestResponse and ExpansionList keep ToB's layouts. The EQL listener therefore runs the ToB protocol with its own opcode file, `loginserver/opcodes/login_opcodes_legends.conf`, which ships in the image.

EQL's first packets are identical to ToB's, so it can't share 15900 with ToB: it needs its own port. Players point `eqhost.txt` at it:

```
[LoginServer]
Host=login.eqemulator.dev:15902
```

- Client-to-server 0x18 (a 4-15 character string from a login text field) maps to no opcode, so the loginserver drops it without a reply and keeps the connection.
- Server-to-client 0x35 (u32 + string for the login UI) is never sent.

## Which worlds an EQL client sees

Only worlds that can actually serve EQL: the world has the EQL patch loaded (`Registered patch [EQL]` in its log) and `EQL` in its `World:SupportedClients` rule. The client probe ([docs/client-probe.md](docs/client-probe.md)) tests this every 6 hours by logging in to character select with the EQL world opcodes. A world counts as EQL-capable while its latest EQL result is **supported**, or it was supported within the last 24 hours and the latest check only failed to reach it. Worlds that answer **unsupported** (no EQL patch) or **blocked** (`EQL` not in `World:SupportedClients`) are never listed, and the loginserver refuses a play request from an EQL client for any world outside that set. The loginserver reads the probe results from `world_client_support` (migration 015 grants it read access) and refreshes them every minute.

ToB, RoF2, Titanium and live clients see the server list exactly as before.

The probe needs the world side's EQL opcodes, set in `.env` as `CLIENT_PROBE_EQL_OPCODES` (names as in the world's `patch_EQL.conf`, see docs/client-probe.md). While it is empty, no world is EQL-capable and EQL clients get an empty list.

On the website, the server list filter has an **EQL** chip with a star. It lists the same worlds the EQL client sees.

## Turning it on

1. Open 15902 TCP and UDP in the host firewall (`ufw allow 15902/tcp && ufw allow 15902/udp`).
2. In `loginserver/login.json`, `client_configuration`:
   ```json
   "eql_port": 15902,
   "eql_opcodes": "opcodes/login_opcodes_legends.conf"
   ```
3. Set `CLIENT_PROBE_EQL_OPCODES` in `.env` and recreate the web container, then run the probe from Admin (or wait for the next run).
4. Restart the loginserver (`docker compose up -d --no-deps --force-recreate loginserver`, about 10 s of login downtime for all clients).
5. Check the log shows `EQL client listener on port [15902] using [opcodes/login_opcodes_legends.conf]` and `EQL: [n] EQL-capable worlds` after the first EQL server list request.

## Test

Point an EQL client at port 15902. Login should succeed, the server list should show only EQL-capable worlds, and selecting one should hand off to world through PlayEverquestResponse (0x24). The log shows `New EQL client connection`. With ToB's opcode file instead, the client stalls after the password because it reads LoginAccepted as a chat message.

World and zone protocol are out of scope here: each world server handles those itself.
