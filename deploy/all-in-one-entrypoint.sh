#!/usr/bin/env bash
set -Eeuo pipefail

export PGDATA=/data/postgres
export PGHOST=/run/postgresql
export PGPORT=5432
export DATABASE_URL='postgresql://tgvault@localhost/tgvault?host=/run/postgresql'
export PORT=51947

# A single Clash/Mihomo mixed-port address can proxy both HTTPS Bot API calls
# and GramJS MTProto connections. Explicit variables still take precedence.
if [[ -n "${PROXY_HOST:-}" ]]; then
    proxy_endpoint="${PROXY_HOST#*://}"
    export HTTP_PROXY="${HTTP_PROXY:-http://$proxy_endpoint}"
    export HTTPS_PROXY="${HTTPS_PROXY:-http://$proxy_endpoint}"
    export http_proxy="${http_proxy:-$HTTP_PROXY}"
    export https_proxy="${https_proxy:-$HTTPS_PROXY}"
    export TELEGRAM_PROXY_URL="${TELEGRAM_PROXY_URL:-socks5://$proxy_endpoint}"
    export NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}"
    export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
    export no_proxy="${no_proxy:-$NO_PROXY}"
fi

mkdir -p "$PGDATA" "$PGHOST" /data/{uploads,thumbnails,previews,chunks,secrets,logs}
# Only fix directory ownership; avoid scanning potentially terabytes of uploads.
chown node:node /data /data/{uploads,thumbnails,previews,chunks,secrets,logs}
chown postgres:postgres "$PGDATA" "$PGHOST"
chmod 700 "$PGDATA"
chmod 755 "$PGHOST"

if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
    su-exec postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C
fi
if [[ "$(cat "$PGDATA/PG_VERSION")" != 17 ]]; then
    echo 'PostgreSQL major version mismatch: back up and migrate the database before upgrading.' >&2
    exit 1
fi

pg_pid=''
app_pid=''
shutdown() {
    trap '' TERM INT
    if [[ -n "$app_pid" ]]; then
        kill -TERM "$app_pid" 2>/dev/null || true
        wait "$app_pid" 2>/dev/null || true
    fi
    if [[ -n "$pg_pid" ]]; then
        kill -INT "$pg_pid" 2>/dev/null || true
        wait "$pg_pid" 2>/dev/null || true
    fi
}
trap 'exit 0' TERM INT
trap shutdown EXIT

# PostgreSQL accepts Unix socket connections only, with no TCP listener.
su-exec postgres postgres -D "$PGDATA" -k "$PGHOST" -c listen_addresses='' &
pg_pid=$!
for ((i=0; i<60; i++)); do
    if su-exec postgres pg_isready -q; then break; fi
    kill -0 "$pg_pid" 2>/dev/null || exit 1
    sleep 1
done
su-exec postgres pg_isready -q || exit 1
if [[ "$(su-exec postgres psql -d postgres -Atc "SELECT 1 FROM pg_roles WHERE rolname='tgvault'")" != 1 ]]; then
    su-exec postgres createuser tgvault
fi
if [[ "$(su-exec postgres psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='tgvault'")" != 1 ]]; then
    su-exec postgres createdb -O tgvault tgvault
fi

# su-exec resets supplementary groups, so use the socket's numeric group as
# the app's primary group. UID stays node; data files remain owned by node.
resolve_app_user() {
    if [[ "${DOCKER_UPDATE_ENABLED:-false}" == true && -S /var/run/docker.sock ]]; then
        printf 'node:%s\n' "$(stat -c '%g' /var/run/docker.sock)"
    else
        printf 'node\n'
    fi
}
app_user="$(resolve_app_user)"
su-exec "$app_user" node /app/dist/index.js &
app_pid=$!
# Failure of either service stops the container so restart policies can recover it.
set +e
wait -n "$pg_pid" "$app_pid"
status=$?
set -e
if [[ "$status" == 0 ]]; then status=1; fi
exit "$status"
