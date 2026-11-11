#!/usr/bin/env python3
"""EverQuest Legends (EQL) client login support.

The EQL client is the ToB code line with one new login message type at 0x18,
so every server-to-client login opcode from 0x18 up is ToB's value + 1. Packet
bodies are ToB's, so an EQL connection is a ToB client (cv_tob) with its own
opcode file on its own port, plus a flag that limits its server list.

What this patch does:
  * client.h: Client gets an EQL flag (SetEQL / IsEQL).
  * client_manager: optional listener on client_configuration.eql_port using
    eql_opcodes. Off unless both are set and the file loads, like the live
    listener. Its first packets match ToB's, so it can't share 15900.
  * world_server_manager: EQL clients only see worlds the client probe found
    EQL-capable (world_client_support, client 'eql'). Everyone else is
    unchanged.
  * client.cpp: an EQL client can't play a world outside that set.

Client-to-server type 0x18 (a text field from the login screen) maps to no
opcode in the EQL file, arrives as OP_Unknown and is dropped by Client::Process
without a reply, which is what the client expects. Server-to-client 0x35 is
never sent.

Every edit asserts its anchor, so a source change upstream fails the build
instead of silently skipping a step.

Usage: eql_client.py <EQEmu source root>
"""
import re
import sys

root = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "/build/source"


def read(rel):
    with open(f"{root}/{rel}") as f:
        return f.read()


def write(rel, s):
    with open(f"{root}/{rel}", "w") as f:
        f.write(s)


def insert_after(s, anchor, text, what):
    assert s.count(anchor) == 1, f"{what}: anchor not found exactly once: {anchor!r}"
    i = s.find(anchor) + len(anchor)
    return s[:i] + text + s[i:]


def insert_before(s, anchor, text, what):
    assert s.count(anchor) == 1, f"{what}: anchor not found exactly once: {anchor!r}"
    i = s.find(anchor)
    return s[:i] + text + s[i:]


def sub_once(s, pattern, repl, what):
    s2, n = re.subn(pattern, repl, s, count=1)
    assert n == 1, f"{what}: pattern not found: {pattern!r}"
    return s2


# ── client.h ──
f = "loginserver/client.h"
s = read(f)
assert "IsEQL" not in s, "client.h already patched"
s = insert_after(
    s,
    "LSClientVersion GetClientVersion() const { return m_client_version; }",
    "\n\t// EverQuest Legends: ToB protocol on its own port, server list limited to EQL worlds\n"
    "\tvoid SetEQL(bool v) { m_eql = v; }\n"
    "\tbool IsEQL() const { return m_eql; }",
    "client.h accessors",
)
s = sub_once(s, r"(\n\tLSClientStatus\s+m_client_status;)", r"\1\n\tbool m_eql = false;", "client.h member")
write(f, s)

# ── client_manager.h ──
f = "loginserver/client_manager.h"
s = read(f)
s = sub_once(
    s,
    r"(\n\tEQ::Net::EQStreamManager \*m_live_stream\s*= nullptr;)",
    r"\1\n\tOpcodeManager            *m_eql_ops     = nullptr;\n\tEQ::Net::EQStreamManager *m_eql_stream  = nullptr;",
    "client_manager.h members",
)
write(f, s)

# ── client_manager.cpp ──
f = "loginserver/client_manager.cpp"
s = read(f)
eql_listener = r'''
	// Optional listener for the EverQuest Legends client. Its first packets are
	// identical to ToB's, so it needs its own port; its server-to-client login
	// opcodes are ToB's + 1 from 0x18 up, so it has its own opcode file. Packet
	// bodies are ToB's. Off until eql_port and eql_opcodes are set and the file
	// loads, so a missing file never stops the other listeners.
	int         eql_port    = server.config.GetVariableInt("client_configuration", "eql_port", 0);
	std::string eql_opcodes = server.config.GetVariableString("client_configuration", "eql_opcodes", "");

	if (eql_port > 0 && !eql_opcodes.empty()) {
		std::string eql_path = eql_opcodes.find('/') != std::string::npos
			? eql_opcodes
			: fmt::format("{}/{}", PathManager::Instance()->GetOpcodePath(), eql_opcodes);
		auto       *eql_ops  = new RegularOpcodeManager;

		if (!File::Exists(eql_path) || !eql_ops->LoadOpcodes(eql_path.c_str())) {
			LogError("ClientManager EQL client listener disabled: couldn't load opcodes [{}]", eql_path);
			delete eql_ops;
		}
		else {
			m_eql_ops = eql_ops;

			EQStreamManagerInterfaceOptions eql_opts(eql_port, false, false);
			m_eql_stream = new EQ::Net::EQStreamManager(eql_opts);

			LogInfo("ClientManager EQL client listener on port [{}] using [{}]", eql_port, eql_opcodes);

			m_eql_stream->OnNewConnection(
				[this](std::shared_ptr<EQ::Net::EQStream> stream) {
					LogInfo(
						"New EQL client connection from [{}:{}]",
						long2ip(stream->GetRemoteIP()),
						stream->GetRemotePort()
					);

					stream->SetOpcodeManager(&m_eql_ops);
					Client *c = new Client(stream, cv_tob);
					c->SetEQL(true);
					m_clients.push_back(c);
				}
			);
		}
	}
'''
assert "eql_port" not in s, "client_manager.cpp already patched"
s = sub_once(
    s,
    r"(\n\t\}\n\}\n)(\nClientManager::~ClientManager\(\))",
    lambda m: m.group(1)[:-2] + eql_listener + "}\n" + m.group(2),
    "client_manager.cpp listener",
)
s = insert_after(s, "\tdelete m_live_ops;", "\n\tdelete m_eql_stream;\n\tdelete m_eql_ops;", "client_manager.cpp destructor")
# The listener must sit inside the constructor, after the live listener.
assert s.find("eql_port") > s.find("live_port") and s.find("eql_port") < s.find("ClientManager::~ClientManager()"), \
    "EQL listener not placed in the constructor"
write(f, s)

# ── world_server_manager.h ──
f = "loginserver/world_server_manager.h"
s = read(f)
s = insert_after(s, "#include <list>", "\n#include <set>", "world_server_manager.h include")
s = insert_after(
    s,
    "std::unique_ptr<EQApplicationPacket> CreateServerListPacket(Client *client, uint32 sequence);",
    "\n\n\t// Worlds the client probe found EQL-capable (world_client_support), cached.\n"
    "\tvoid RefreshEQLWorlds();\n"
    "\tbool IsEQLWorld(uint32_t server_id) const { return m_eql_world_ids.count(server_id) > 0; }\n"
    "\tstd::set<uint32_t>                    m_eql_world_ids;\n"
    "\tstd::chrono::steady_clock::time_point m_eql_worlds_last_refresh{};\n"
    "\tbool                                  m_eql_worlds_loaded = false;",
    "world_server_manager.h EQL set",
)
write(f, s)

# ── world_server_manager.cpp ──
f = "loginserver/world_server_manager.cpp"
s = read(f)
assert "IsEQLWorld" not in s, "world_server_manager.cpp already patched"

# 1. Recount for EQL clients. The count is written before the entries, so it
#    must match the filter below exactly.
s = insert_after(
    s,
    "server_count += static_cast<unsigned int>(m_federated_servers.size());",
    r'''

	// EverQuest Legends clients only see worlds that can serve them.
	const bool eql_client = client->IsEQL();
	if (eql_client) {
		RefreshEQLWorlds();
		server_count = 0;
		for (const auto &world_server: m_world_servers) {
			if (world_server->IsAuthorizedToList() && IsEQLWorld(world_server->GetServerId())) {
				++server_count;
			}
		}
		for (const auto &fs: m_federated_servers) {
			if (IsEQLWorld(fs.id)) {
				++server_count;
			}
		}
	}''',
    "server count",
)

# 2. Skip non-EQL connected worlds (after the IsAuthorizedToList check).
s = insert_before(
    s,
    "\t\tbool use_local_ip = false;\n",
    "\t\tif (eql_client && !IsEQLWorld(s->GetServerId())) {\n\t\t\tcontinue;\n\t\t}\n\n",
    "connected world filter",
)
assert s.find("eql_client && !IsEQLWorld(s->GetServerId())") > s.find("if (!s->IsAuthorizedToList())"), \
    "EQL filter must follow the authorization check"

# 3. Skip non-EQL federated worlds.
s = insert_before(
    s,
    "\t\tentries.push_back({fs.players_online, nullptr, false, &fs});",
    "\t\tif (eql_client && !IsEQLWorld(fs.id)) {\n\t\t\tcontinue;\n\t\t}\n",
    "federated world filter",
)

# 4. The cache refresh.
s = s.rstrip("\n") + r'''

// Same rule as the website's client badges (web/src/lib/client-probe/store.ts):
// supported now, or supported within the last 24 hours and only failing to
// answer (restart, packet loss). 'unsupported' (no EQL patch loaded) and
// 'blocked' (EQL not in World:SupportedClients) are never listed.
void WorldServerManager::RefreshEQLWorlds()
{
	auto now = std::chrono::steady_clock::now();
	if (m_eql_worlds_loaded && now - m_eql_worlds_last_refresh < std::chrono::seconds(60)) {
		return;
	}
	m_eql_worlds_loaded       = true;
	m_eql_worlds_last_refresh = now;

	try {
		auto results = database.QueryDatabase(
			"SELECT world_server_id FROM world_client_support "
			"WHERE client = 'eql' AND (status = 'supported' OR "
			"(status IN ('error', 'unreachable') AND last_supported_at > NOW() - INTERVAL 24 HOUR))"
		);
		if (!results.Success()) {
			LogError("EQL: couldn't read world_client_support, keeping [{}] worlds: {}", m_eql_world_ids.size(), results.ErrorMessage());
			return;
		}

		std::set<uint32_t> ids;
		for (auto row = results.begin(); row != results.end(); ++row) {
			if (row[0]) {
				ids.insert(static_cast<uint32_t>(std::stoul(row[0])));
			}
		}
		if (ids != m_eql_world_ids) {
			LogInfo("EQL: [{}] EQL-capable worlds", ids.size());
		}
		m_eql_world_ids = std::move(ids);
	} catch (const std::exception &e) {
		LogError("EQL: exception reading world_client_support: {}", e.what());
	}
}
'''
write(f, s)

# ── client.cpp: no play handoff to a world the EQL list doesn't offer ──
f = "loginserver/client.cpp"
s = read(f)
s = insert_after(
    s,
    "\tm_selected_play_server_id = server_id_in;\n",
    r'''
	if (m_eql && !server.server_manager->IsEQLWorld(server_id_in)) {
		LogWarning("[SendPlayToWorld] EQL client [{}] asked for non-EQL server [{}], refusing", GetAccountName(), server_id_in);
		SendPlayFailed();
		return;
	}
''',
    "play guard",
)
assert s.find("m_eql && !server.server_manager->IsEQLWorld") < s.find("bool is_local = std::any_of"), \
    "play guard must come before the handoff"
write(f, s)

print("EQL client patch applied")
