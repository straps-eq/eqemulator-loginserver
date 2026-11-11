#!/usr/bin/env python3
"""Give an auto-registered world its server id on the same connection.

Upstream inserts the new login_world_servers row for an unregistered world but
never copies the new id onto the connection, so the world runs as id 0 until
it reconnects: the client probe can't send it a session key, the EQL list can't
match it to its probe results, and the last-login update is written for id 0.

This sets m_server_id (and the list type) from the inserted row, and points the
last-login update at that row.

Usage: auto_register_id.py <EQEmu source root>
"""
import sys

root = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "/build/source"
path = f"{root}/loginserver/world_server.cpp"
s = open(path).read()

anchor = '''		LogInfo(
			"Auto-registered world server [{}] with ID [{}]",
			m_server_long_name,
			created.id
		);
'''
assert s.count(anchor) == 1, "auto-register log line not found exactly once"
assert "m_server_id                    = created.id;" not in s, "already patched"
s = s.replace(anchor, anchor + '''
		m_server_id                    = created.id;
		m_server_list_type_id          = created.login_server_list_type_id;
		world                          = created;
''')
open(path, "w").write(s)
print("auto-register id patch applied")
