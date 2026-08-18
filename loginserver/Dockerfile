FROM ubuntu:22.04 AS builder

RUN apt-get update && apt-get install -y \
    build-essential cmake git pkg-config curl zip unzip tar \
    libssl-dev zlib1g-dev libmariadb-dev-compat uuid-dev \
    libperl-dev liblua5.1-0-dev autoconf automake libtool python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone and build vcpkg
RUN git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg \
    && /opt/vcpkg/bootstrap-vcpkg.sh

# Clone EQEmu source (fork with federation server list + auth forwarding)
RUN git clone --branch federation-server-list --depth 1 https://github.com/straps-eq/EQEmu.git /build/source
WORKDIR /build/source
RUN git submodule update --init --recursive

# Apply the login_world_servers_repository.h patch (adds federation_source_node_id column support)
COPY patches/login_world_servers_repository.h /build/source/common/repositories/login_world_servers_repository.h
RUN sed -i '/w\.short_name.*=.*m_server_short_name;/a\\t\tw.login_server_admin_id     = c.admin_id;' \
        /build/source/loginserver/world_server.cpp \
 && sed -i '/world\.last_ip_address.*=.*m_remote_ip_address;/a\\tworld.login_server_admin_id = c.admin_id;' \
        /build/source/loginserver/world_server.cpp \
 && echo "=== Verify patches ===" \
 && grep -n 'login_server_admin_id' /build/source/loginserver/world_server.cpp \
 && grep -n 'Federation' /build/source/loginserver/world_server_manager.cpp || true

# Patch: add missing SetServerListTypeId definition
RUN echo '' >> /build/source/loginserver/world_server.cpp \
 && echo 'WorldServer *WorldServer::SetServerListTypeId(unsigned int in_server_list_id) {' >> /build/source/loginserver/world_server.cpp \
 && echo '	m_server_list_type_id = in_server_list_id;' >> /build/source/loginserver/world_server.cpp \
 && echo '	return this;' >> /build/source/loginserver/world_server.cpp \
 && echo '}' >> /build/source/loginserver/world_server.cpp

# Patch: refresh live server list types from DB (web auto-tier sync writes login_server_list_type_id)
COPY patches/refresh_live_list_types.cpp /tmp/refresh_live_list_types.cpp
RUN python3 -c "\
import re; \
f='/build/source/loginserver/world_server_manager.cpp'; \
p=open('/tmp/refresh_live_list_types.cpp').read(); \
s=open(f).read(); \
anchor='Federation: loaded [{}] federated servers from DB'; \
i=s.find(anchor); \
assert i>0, 'anchor not found'; \
j=s.find('} catch', i); \
assert j>0, 'catch not found after anchor'; \
s=s[:j]+p+'\n\t'+s[j:]; \
open(f,'w').write(s)" \
 && echo "=== Verify list type refresh patch ===" \
 && grep -n 'RefreshLiveServerListTypes\|login_server_list_type_id.*federation_source_node_id IS NULL' /build/source/loginserver/world_server_manager.cpp

# Patch: replace blanket duplicate-name rejection with identity-proven eviction.
#
# Upstream compares remote IP *and* remote port when deciding whether an incoming
# world server connection replaces an existing one. A reconnecting server always
# has a new ephemeral port, so that check never matches and the stale half-open
# connection is kept. With reject_duplicate_servers enabled the new connection is
# then rejected behind the corpse, leaving the dead entry authorized to appear in
# the client server list while the live connection carries the real player counts.
#
# This relocates the duplicate handling to after admin authentication (so
# c.admin_id is populated) and only evicts when the new connection proves it is
# the same server: valid admin credentials, or the same socket peer IP as the
# existing same-named entry.
COPY patches/duplicate_world_server_eviction.cpp /tmp/duplicate_world_server_eviction.cpp
RUN python3 -c "\
f='/build/source/loginserver/world_server.cpp'; \
p=open('/tmp/duplicate_world_server_eviction.cpp').read().rstrip('\n')+'\n\n'; \
s=open(f).read(); \
i=s.find('// Handle Duplicate Servers'); \
assert i>0, 'duplicate-server block not found'; \
j=s.find('LoginWorldContext c;', i); \
assert j>i, 'LoginWorldContext anchor not found after duplicate block'; \
s=s[:i]+s[j:]; \
a='auto world = LoginWorldServersRepository::GetFromWorldContext(database, c);'; \
k=s.find(a); \
assert k>0, 'GetFromWorldContext anchor not found'; \
k=s.rfind('\n', 0, k)+1; \
s=s[:k]+p+s[k:]; \
assert s.count('// Handle Duplicate Servers')==1, 'duplicate block not relocated exactly once'; \
assert s.find('// Handle Duplicate Servers')>s.find('// Handle Admin Authentication'), 'duplicate block must follow admin authentication'; \
open(f,'w').write(s)" \
 && echo "=== Verify duplicate eviction patch ===" \
 && grep -n 'is_same_peer\|may_replace\|replacing previous connection' /build/source/loginserver/world_server.cpp

# Patch: enable TCP keepalive on accepted world server connections.
#
# Eviction (above) only self-heals when a world server reconnects. A server that
# dies and never comes back leaves a half-open socket that nothing detects, so it
# stays in the server list until the loginserver is restarted. Keepalive gives the
# kernel a way to notice.
#
# Only the loginserver target is built here (EQEMU_BUILD_SERVER=OFF), so this
# touches no world or zone binary. It applies to inbound accepted sockets only;
# outbound connections (LSPX upstream) go through TCPConnection::Connect and are
# unaffected.
COPY patches/tcp_keepalive.cpp /tmp/tcp_keepalive.cpp
RUN python3 -c "\
f='/build/source/common/net/tcp_server.cpp'; \
p=open('/tmp/tcp_keepalive.cpp').read().rstrip('\n')+'\n\n'; \
s=open(f).read(); \
a='EQ::Net::TCPServer *s = (EQ::Net::TCPServer*)server->data;'; \
k=s.find(a); \
assert k>0, 'TCPServer accept anchor not found'; \
k=s.rfind('\n', 0, k)+1; \
s=s[:k]+p+s[k:]; \
assert s.count('uv_tcp_keepalive')==1, 'keepalive not inserted exactly once'; \
open(f,'w').write(s)" \
 && echo "=== Verify tcp keepalive patch ===" \
 && grep -n 'uv_tcp_keepalive' /build/source/common/net/tcp_server.cpp

# Patch: stop logging world server account passwords in plaintext.
#
# ProcessNewLSInfo logs the credentials a world server presents, so every
# connection writes an operator's password into the container log. Drop the value
# from the format string and remove the matching argument so the fmt argument
# count stays consistent.
RUN python3 -c "\
f='/build/source/loginserver/world_server.cpp'; \
s=open(f).read(); \
old='account [{}] password [{}] server_type [{}]'; \
new='account [{}] password [<redacted>] server_type [{}]'; \
assert s.count(old)==1, 'password log format not found exactly once'; \
s=s.replace(old, new); \
assert s.count('r->account_password,')==1, 'account_password argument not unique'; \
i=s.find('r->account_password,'); \
ls=s.rfind('\n', 0, i)+1; \
le=s.find('\n', i)+1; \
s=s[:ls]+s[le:]; \
assert 'password [<redacted>]' in s, 'redaction not applied'; \
assert 'r->account_password,' not in s, 'password log argument still present'; \
assert s.count('strlen(r->account_password)')==1, 'length validation must remain intact'; \
open(f,'w').write(s)" \
 && echo "=== Verify password redaction patch ===" \
 && grep -n 'password \[<redacted>\]' /build/source/loginserver/world_server.cpp

# Build loginserver only
RUN mkdir build && cd build \
    && cmake .. \
        -DCMAKE_TOOLCHAIN_FILE=/opt/vcpkg/scripts/buildsystems/vcpkg.cmake \
        -DEQEMU_BUILD_SERVER=OFF \
        -DEQEMU_BUILD_LOGIN=ON \
        -DEQEMU_BUILD_TESTS=OFF \
        -DEQEMU_BUILD_CLIENT_FILES=OFF \
        -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    && make -j$(nproc) loginserver

# Runtime image
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    libmariadb3 libssl3 libperl5.34 liblua5.1-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/loginserver

COPY --from=builder /build/source/build/bin/loginserver .
COPY --from=builder /build/source/loginserver/login_util/ ./data/

# Note: The EQEmu loginserver binary requires root at runtime (signal handling,
# shared memory). Container hardening is applied via docker-compose security_opt.

EXPOSE 5998/udp 5999/udp 15900/udp 5998/tcp 5999/tcp 15900/tcp 6000/tcp

CMD ["./loginserver"]
