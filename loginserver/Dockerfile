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

# Clone EQEmu source
RUN git clone --depth 1 https://github.com/EQEmu/Server.git /build/source
WORKDIR /build/source
RUN git submodule update --init --recursive

# Patch: persist login_server_admin_id when world server authenticates with admin credentials
COPY patches/login_world_servers_repository.h /build/source/common/repositories/login_world_servers_repository.h
RUN sed -i '/w\.short_name.*=.*m_server_short_name;/a\\t\tw.login_server_admin_id     = c.admin_id;' \
        /build/source/loginserver/world_server.cpp \
 && sed -i '/world\.last_ip_address.*=.*m_remote_ip_address;/a\\tworld.login_server_admin_id = c.admin_id;' \
        /build/source/loginserver/world_server.cpp \
 && echo "=== Verify patches ===" \
 && grep -n 'login_server_admin_id' /build/source/loginserver/world_server.cpp \
 && grep -n 'admin_id' /build/source/common/repositories/login_world_servers_repository.h || true

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
