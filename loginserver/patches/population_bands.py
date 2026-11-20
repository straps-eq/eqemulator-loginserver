#!/usr/bin/env python3
"""Hide real player counts from the client server list.

The website only shows Idle / Low / Medium / High. The in-game server list
showed the real number, because the login reply turned on the client's player
count column and every list entry carried the count.

What this patch does, when worldservers.population_bands is true (the default):
  * The login reply always says "don't show player counts", whatever
    show_player_count says. Titanium and RoF2 show UP / DOWN / LOCKED.
  * Every server list entry (local and federated, every client) carries 0 as
    its player count, so a patched client or a packet capture can't read the
    real number.
  * For ToB / live / EQL clients, a world that is up gets the population bits
    in its status flags, which is what the client's server select reads for
    the Status word (eqmain.dll, read in Ghidra; the count is never used for
    it): 0x10 Low, 0 Med, 0x20 High. Idle and Low send Low. Down (1) and
    Locked (4) are unchanged. Older clients get no new bits.

Bands match the website: Idle 0, Low 1-74, Medium 75-250, High 251+. The two
cut-offs can be changed with worldservers.population_medium_at (75) and
worldservers.population_high_at (251). population_bands: false brings back the
old behaviour (real counts, controlled by show_player_count).

Server names, the ToB list order, the web API and Prometheus are untouched.

Every edit asserts its anchor, so a source change upstream fails the build
instead of silently skipping a step. Run it after eql_client.py.

Usage: population_bands.py <EQEmu source root>
"""
import sys

root = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "/build/source"


def read(rel):
    with open(f"{root}/{rel}") as f:
        return f.read()


def write(rel, s):
    with open(f"{root}/{rel}", "w") as f:
        f.write(s)


def replace_n(s, old, new, n, what):
    assert s.count(old) == n, f"{what}: expected {n} of {old!r}, found {s.count(old)}"
    return s.replace(old, new)


def replace_first(s, old, new, n, what):
    assert s.count(old) == n, f"{what}: expected {n} of {old!r}, found {s.count(old)}"
    return s.replace(old, new, 1)


def insert_after(s, anchor, text, what):
    assert s.count(anchor) == 1, f"{what}: anchor not found exactly once: {anchor!r}"
    i = s.find(anchor) + len(anchor)
    return s[:i] + text + s[i:]


HEADER = r'''#pragma once

// Population bands for the client server list (patches/population_bands.py).

#include <algorithm>
#include <cstdint>

namespace PopulationBands {

struct Settings {
	bool     enabled   = true;
	uint32_t medium_at = 75;
	uint32_t high_at   = 251;
};

inline Settings &Get()
{
	static Settings s;
	return s;
}

inline bool Enabled() { return Get().enabled; }

// Count sent to the client. Never the real number while bands are on.
inline uint32_t ListCount(uint32_t players) { return Enabled() ? 0 : players; }

// Status flags for a ToB/live world that is up: the client shows Low for
// 0x10, High for 0x20 and Med for neither.
inline int32_t TobUpFlags(uint32_t players)
{
	if (!Enabled()) {
		return 0;
	}
	if (players < Get().medium_at) {
		return 0x10;
	}
	if (players < Get().high_at) {
		return 0;
	}
	return 0x20;
}

}
'''

assert "PopulationBands" not in read("loginserver/world_server.cpp"), "already patched"

write("loginserver/population_bands.h", HEADER)

INCLUDE = '\n#include "loginserver/population_bands.h"'

# ── world_server.cpp: directly connected worlds, ToB and older clients ──
f = "loginserver/world_server.cpp"
s = read(f)
s = insert_after(s, '#include "world_server.h"', INCLUDE, f"{f} include")
s = replace_n(
    s,
    "out.WriteUInt32(GetPlayersOnline());",
    "out.WriteUInt32(PopulationBands::ListCount(GetPlayersOnline()));",
    2,
    f"{f} count",
)
# The ToB branch comes first in SerializeForClientServerList.
assert s.find("version == cv_tob") < s.find("out.WriteInt32(LS::ServerStatusFlags::Up);"), f"{f}: ToB branch not first"
s = replace_first(
    s,
    "out.WriteInt32(LS::ServerStatusFlags::Up);",
    "out.WriteInt32(LS::ServerStatusFlags::Up | PopulationBands::TobUpFlags(GetPlayersOnline()));",
    2,
    f"{f} ToB status",
)
write(f, s)

# ── world_server_manager.cpp: federated worlds, ToB and older clients ──
f = "loginserver/world_server_manager.cpp"
s = read(f)
s = insert_after(s, '#include "world_server_manager.h"', INCLUDE, f"{f} include")
s = replace_n(
    s,
    "buf.WriteUInt32(fs.players_online);",
    "buf.WriteUInt32(PopulationBands::ListCount(fs.players_online));",
    2,
    f"{f} count",
)
# The ToB branch comes first for federated entries too.
i_tob = s.find("if (client->GetClientVersion() == cv_tob) {\n\t\t\tbuf.WriteString(fs.remote_ip);")
assert i_tob > 0, f"{f}: federated ToB branch not found"
assert i_tob < s.find("buf.WriteInt32(LS::ServerStatusFlags::Up);"), f"{f}: federated ToB branch not first"
s = replace_first(
    s,
    "buf.WriteInt32(LS::ServerStatusFlags::Up);",
    "buf.WriteInt32(LS::ServerStatusFlags::Up | PopulationBands::TobUpFlags(fs.players_online));",
    2,
    f"{f} ToB status",
)
write(f, s)

# ── client.cpp: the login reply never turns on the count column ──
f = "loginserver/client.cpp"
s = read(f)
s = insert_after(s, '#include "client.h"', INCLUDE, f"{f} include")
s = replace_n(
    s,
    "r.set_show_player_count(server.options.IsShowPlayerCountEnabled());",
    "r.set_show_player_count(server.options.IsShowPlayerCountEnabled() && !PopulationBands::Enabled());",
    1,
    f"{f} show_player_count",
)
write(f, s)

# ── main.cpp: settings ──
f = "loginserver/main.cpp"
s = read(f)
anchor = 'server.options.SetShowPlayerCount(server.config.GetVariableBool("worldservers", "show_player_count", false));'
s = insert_after(
    s,
    anchor,
    '\n\tPopulationBands::Get().enabled   = server.config.GetVariableBool("worldservers", "population_bands", true);'
    '\n\tPopulationBands::Get().medium_at = (uint32_t) std::max(1, server.config.GetVariableInt("worldservers", "population_medium_at", 75));'
    '\n\tPopulationBands::Get().high_at   = (uint32_t) std::max(2, server.config.GetVariableInt("worldservers", "population_high_at", 251));',
    f"{f} settings",
)
s = insert_after(s, '#include "loginserver/login_server.h"', INCLUDE, f"{f} include")
write(f, s)

print("population bands patch applied")
