#!/usr/bin/env python3
"""Hide real player counts from the client server list.

The website only shows Idle / Low / Medium / High. The in-game server list
showed the real number, because the login reply turned on the client's player
count column and every list entry carried the count.

What this patch does, when worldservers.population_bands is true (the default):
  * The login reply always says "don't show player counts", whatever
    show_player_count says. Titanium and RoF2 then show UP / DOWN / LOCKED.
  * ToB / live list entries carry the band in the status flags (field 11).
    Their eqmain.dll picks the Status word from those flags, never from the
    count: Locked (4) first, then Down (1), then the raw count if the reply
    turned it on, then 0x10 -> "Low", 0x20 -> "High", anything else -> "Med".
    So a world that is up gets 0x10 for Idle and Low, 0 for Medium and 0x20
    for High. Down and Locked are sent exactly as before. Older clients keep
    plain Up (0).
  * Every server list entry (local and federated, every client) carries the
    lowest count of its band instead of the real number, so a patched client
    or a packet capture can't read the real count either: Idle 0, Low 1,
    Medium 75, High 251.

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


def insert_after(s, anchor, text, what):
    assert s.count(anchor) == 1, f"{what}: anchor not found exactly once: {anchor!r}"
    i = s.find(anchor) + len(anchor)
    return s[:i] + text + s[i:]


def replace_between(s, start, end, old, new, what):
    """Replace old exactly once, inside the section from start (unique) to the next end."""
    assert s.count(start) == 1, f"{what}: start anchor not found exactly once: {start!r}"
    a = s.find(start)
    b = s.find(end, a)
    assert b != -1, f"{what}: end anchor {end!r} not found after {start!r}"
    section = s[a:b]
    assert section.count(old) == 1, f"{what}: expected 1 of {old!r} in section, found {section.count(old)}"
    return s[:a] + section.replace(old, new) + s[b:]


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

// Count sent to the client: the lowest count of the world's band, never the real number.
inline uint32_t ListCount(uint32_t players)
{
	if (!Enabled() || players == 0) {
		return players;
	}
	if (players < Get().medium_at) {
		return 1;
	}
	if (players < Get().high_at) {
		return Get().medium_at;
	}
	return Get().high_at;
}

// Status flags for a ToB / live list entry. The client's own label comes from
// these bits: 0x10 "Low", 0x20 "High", neither "Med". Down / Locked pass through.
constexpr int32_t kStatusLow  = 0x10;
constexpr int32_t kStatusHigh = 0x20;

inline int32_t ListStatus(int32_t status, uint32_t players)
{
	if (!Enabled() || status != 0) {
		return status;
	}
	if (players < Get().medium_at) {
		return kStatusLow; // Idle and Low: the client has no Idle word
	}
	if (players < Get().high_at) {
		return 0;
	}
	return kStatusHigh;
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
s = replace_between(
    s,
    "out.WriteInt32(289);",
    "out.WriteInt32(31);",
    "out.WriteInt32(LS::ServerStatusFlags::Up);",
    "out.WriteInt32(PopulationBands::ListStatus(LS::ServerStatusFlags::Up, GetPlayersOnline()));",
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
s = replace_between(
    s,
    "buf.WriteInt32(289);",
    "buf.WriteInt32(31);",
    "buf.WriteInt32(LS::ServerStatusFlags::Up);",
    "buf.WriteInt32(PopulationBands::ListStatus(LS::ServerStatusFlags::Up, fs.players_online));",
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
