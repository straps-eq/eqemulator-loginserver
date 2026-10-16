# Live client support

The loginserver accepts one live EverQuest client build at a time, always on **port 15901** (UDP, TCP also published). Titanium (5998), SoD/UF/RoF/RoF2 (5999) and ToB (15900) are separate listeners and are never touched by a live update.

Live builds reshuffle the login opcodes with each Daybreak patch but have kept ToB's login packet layouts, so the live listener runs the ToB protocol with its own opcode file. Players are held on the supported build by the Ascendant patcher (`clients.yml`), which launches `eqgame.exe patchme` with `eqhost.txt` set to:

```
[LoginServer]
Host=login.eqemulator.dev:15901
```

## Configuration

In `loginserver/login.json`, `client_configuration`:

```json
"live_port": 15901,
"live_opcodes": "data/login_opcodes_live_2026_09_17.conf"
```

Give `live_opcodes` as a `data/...` path so the file lives on the persistent loginserver data volume (`/opt/loginserver/data` in the container). A bare file name resolves against the opcode directory, which in this image is the container root and is rebuilt on every recreate. The listener stays off while `live_opcodes` is empty or the file is missing or unreadable. That only disables live logins; the other listeners keep running.

## Per-build process

**Inputs from the client mapper, for build N+1**
1. `login_opcodes_live_<YYYY_MM_DD>.conf` with the 13 login opcodes, same names as `login_opcodes_tob.conf`: `OP_SessionReady, OP_Login, OP_ServerListRequest, OP_PlayEverquestRequest, OP_PlayEverquestResponse, OP_ChatMessage, OP_LoginAccepted, OP_ServerListResponse, OP_Poll, OP_PollResponse, OP_EnterChat, OP_SystemFingerprint, OP_ExpansionList`.
2. Whether these still match ToB: the login request (encrypted credentials block), the login reply (38 bytes in ToB), the server-list entry, play request/response, and the expansion list. If any changed, list the field deltas. That needs a loginserver code change and release before go-live.
3. The build date and eqgame.exe MD5 (as in `clients.yml`).

**Test (no impact on production)**
1. Start a test loginserver container on a spare port (e.g. 15911) with the new opcode file and packet logging on.
2. Log in with a client on build N+1 pointed at that port. Confirm login, server list and play request in the log.
3. Remove the test container and its packet log.

**Go-live (coordinated window)**
1. World servers that will accept live players update for build N+1 (world/zone patch file and `World:SupportedClients`).
2. Copy the new opcode file into the loginserver data volume and point `live_opcodes` at it in `login.json`:
   `docker cp login_opcodes_live_<date>.conf eqemu-loginserver:/opt/loginserver/data/` then `"live_opcodes": "data/login_opcodes_live_<date>.conf"`.
3. Restart the loginserver (`docker compose up -d --no-deps --force-recreate loginserver`, about 10 s of login downtime for all clients).
4. Check the log shows `live client listener on port [15901] using [<file>]`, and that world servers reconnected.
5. Flip `supported` in the patcher's `clients.yml` to build N+1 and upload it.
6. Confirm a live login (`New live client connection`) and update the live build line on the website.

Between step 3 and step 5, players still on build N cannot log in on 15901 until their patcher moves them to N+1. Keep that window short.

**Rollback:** set `live_opcodes` back to the previous build's file and restart the loginserver.
