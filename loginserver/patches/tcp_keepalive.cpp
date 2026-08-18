		// Enable TCP keepalive on every accepted connection.
		//
		// A world server whose link dies without a clean shutdown (an ISP outage,
		// a killed process, a hypervisor pause) leaves this side of the socket
		// wedged in ESTABLISHED forever: the peer never sends FIN or RST, and the
		// loginserver only ever reads from world server connections, so it never
		// writes anything that would provoke a RST. Nothing in the stack detects
		// the loss and the world server is never removed from the list.
		//
		// Keepalive makes the kernel probe idle connections so those half-open
		// sockets are eventually torn down, which fires OnConnectionRemoved and
		// drops the stale world server. The idle delay is set here; the probe
		// interval and retry count come from the host's tcp_keepalive_intvl and
		// tcp_keepalive_probes sysctls.
		uv_tcp_keepalive(client, 1, 60);

