	// Handle Duplicate Servers
	//
	// A world server that loses connectivity briefly (an ISP hiccup is enough)
	// reconnects on a fresh socket while its previous connection is still
	// half-open and still registered here. The name therefore collides with what
	// is effectively its own corpse.
	//
	// Rejecting the new connection outright leaves the stale entry as the one
	// authorized to appear in the client server list, while the new connection
	// receives the real status updates. Players then pick a listed server whose
	// underlying socket is dead, and the stale player counts never change again.
	//
	// Evict the previous entry only when the new connection has proven it is the
	// same server:
	//
	//   1. it authenticated against this server's registered admin credentials, or
	//   2. it originates from the same socket peer IP as the existing entry.
	//
	// Both tests are evaluated only among connections already claiming the same
	// long and short name, so distinct world servers that happen to share a public
	// IP are never compared against each other. The peer IP is read from the
	// socket rather than the self-reported remote_ip_address field, so it cannot
	// be forged by the connecting party.
	//
	// If neither holds, the collision is treated as a name conflict and rejected
	// exactly as before, so an unauthenticated host cannot disconnect somebody
	// else's world server by claiming its name.
	if (server.server_manager->DoesServerExist(m_server_long_name, m_server_short_name, this)) {
		const bool        is_authenticated = (c.admin_id != 0);
		const std::string new_peer_ip     = m_connection->Handle()->RemoteIP();

		std::string existing_peer_ip = "unknown";
		bool        is_same_peer     = false;

		for (const auto &s: server.server_manager->GetWorldServers()) {
			if (s.get() == this) {
				continue;
			}

			if (s->GetServerLongName() == m_server_long_name &&
				s->GetServerShortName() == m_server_short_name) {
				existing_peer_ip = s->GetConnection()->Handle()->RemoteIP();

				if (existing_peer_ip == new_peer_ip) {
					is_same_peer = true;
					break;
				}
			}
		}

		// A deployment that has explicitly disabled duplicate rejection keeps its
		// previous, more permissive behaviour.
		const bool may_replace =
				 !server.options.IsRejectingDuplicateServers() || is_authenticated || is_same_peer;

		if (!may_replace) {
			LogError(
				"World server [{}] short_name [{}] tried to login but that name is already in use by "
				"peer_ip [{}], and the new connection from peer_ip [{}] provided no valid credentials. "
				"Rejecting to avoid displacing a live server.",
				m_server_long_name,
				m_server_short_name,
				existing_peer_ip,
				new_peer_ip
			);

			return;
		}

		LogInfo(
			"World server [{}] short_name [{}] reconnected from peer_ip [{}] | authenticated [{}] "
			"same_peer [{}] | replacing previous connection from peer_ip [{}]",
			m_server_long_name,
			m_server_short_name,
			new_peer_ip,
			is_authenticated,
			is_same_peer,
			existing_peer_ip
		);

		server.server_manager->DestroyServerByName(m_server_long_name, m_server_short_name, this);
	}

