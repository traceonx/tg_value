#!/usr/bin/env bash
set -Eeuo pipefail
image="${TG_VAULT_TEST_IMAGE:-tg-vault:test}"
container="tg-vault-smoke-$RANDOM"
volume="$container-data"
cleanup() {
    docker logs "$container" || true
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Exercise the production user resolver against a synthetic socket, without
# mounting the host Docker socket or granting the test access to the daemon.
docker run --rm --entrypoint bash "$image" -Eeuo pipefail -c '
    eval "$(sed -n "/^resolve_app_user()/,/^}/p" /usr/local/bin/tg-vault-entrypoint)"
    export DOCKER_UPDATE_ENABLED=false
    [[ "$(resolve_app_user)" == node ]]
    export DOCKER_UPDATE_ENABLED=true
    [[ "$(resolve_app_user)" == node ]]
    node -e '\''
        const fs = require("fs");
        require("net").createServer().listen("/var/run/docker.sock", () => {
            fs.chmodSync("/var/run/docker.sock", 0o660);
        });
    '\'' &
    socket_pid=$!
    trap "kill $socket_pid" EXIT
    for ((i=0; i<50; i++)); do
        if [[ -S /var/run/docker.sock ]]; then break; fi
        sleep 0.1
    done
    [[ -S /var/run/docker.sock ]]
    for gid in 0 42424; do
        chown "0:$gid" /var/run/docker.sock
        chmod 660 /var/run/docker.sock
        if su-exec node node -e '\''require("fs").accessSync("/var/run/docker.sock", 6)'\'' 2>/dev/null; then
            echo "Expected plain node user to lack socket access" >&2
            exit 1
        fi
        [[ "$(resolve_app_user)" == "node:$gid" ]]
        su-exec "$(resolve_app_user)" node -e '\''
            if (process.getuid() !== 1000) throw new Error("App must retain node UID");
            require("fs").accessSync("/var/run/docker.sock", 6);
        '\''
    done
    export DOCKER_UPDATE_ENABLED=false
    [[ "$(resolve_app_user)" == node ]]
'
docker volume create "$volume" >/dev/null
docker run -d --name "$container" -p 127.0.0.1:18080:51947 \
    -e UPDATE_CHECK_ENABLED=false -v "$volume:/data" "$image"
wait_ready() {
    for ((i=0; i<90; i++)); do
        [[ "$(docker inspect -f '{{.State.Running}}' "$container")" == true ]] || return 1
        if curl -fsS http://127.0.0.1:18080/readyz >/dev/null; then return; fi
        sleep 2
    done
    return 1
}
wait_ready
# Exercise the prebuilt image library after removing the duplicate system libvips.
docker exec -w /app "$container" node --input-type=module -e '
    import sharp from "sharp";
    import { google } from "googleapis";
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
    const result = await sharp(image).resize(4, 4).webp().toBuffer();
    const metadata = await sharp(result).metadata();
    if (metadata.width !== 4 || metadata.format !== "webp") throw new Error("Image processing failed");
    google.drive({ version: "v3", auth: new google.auth.OAuth2() });
'
# Settings refresh must work without configuring optional cloud OAuth providers.
docker exec "$container" node --input-type=module -e '
    const base = "http://127.0.0.1:51947/api";
    const setup = await fetch(base + "/auth/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webPassword: "Smoke-test-password-392!" }),
    });
    if (!setup.ok) throw new Error("Admin setup failed");
    const cookie = setup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const saved = await fetch(base + "/storage/config/telegram-allowed-users", {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ userIds: [123456789] }),
    });
    if (!saved.ok) throw new Error("Allowlist save failed");
    const response = await fetch(base + "/storage/config", { headers: { Cookie: cookie } });
    if (!response.ok) throw new Error("Settings refresh failed: " + response.status);
    const config = await response.json();
    if (!config.telegramAllowedUserIds.includes(123456789)) throw new Error("Saved allowlist missing");
'
curl -fsS http://127.0.0.1:18080/ | grep -q '<html'
curl -fsS http://127.0.0.1:18080/settings | grep -q '<html'
[[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/api/not-a-route)" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://untrusted.example' -X POST http://127.0.0.1:18080/api/auth/login)" == 403 ]]
docker exec -u postgres "$container" psql -h /run/postgresql -d tgvault -c 'CREATE TABLE nas_smoke (value text); INSERT INTO nas_smoke VALUES ('"'persisted'"');'
docker exec -u node "$container" node -e "require('fs').writeFileSync('/data/uploads/smoke.txt', 'persisted')"
docker stop -t 60 "$container"
[[ "$(docker inspect -f '{{.State.ExitCode}}' "$container")" == 0 ]]
docker rm "$container"
docker run -d --name "$container" -p 127.0.0.1:18080:51947 \
    -e UPDATE_CHECK_ENABLED=false -v "$volume:/data" "$image"
wait_ready
[[ "$(docker exec -u postgres "$container" psql -h /run/postgresql -d tgvault -Atc 'SELECT value FROM nas_smoke')" == persisted ]]
[[ "$(docker exec "$container" cat /data/uploads/smoke.txt)" == persisted ]]
# The supervisor may stop PID 1 before docker exec returns; 137 is expected in that race.
set +e
docker exec -u postgres "$container" pg_ctl -D /data/postgres -m fast -W stop
stop_status=$?
set -e
[[ "$stop_status" == 0 || "$stop_status" == 137 ]]
for ((i=0; i<45; i++)); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$container")" == false ]]; then
        [[ "$(docker inspect -f '{{.State.ExitCode}}' "$container")" != 0 ]]
        exit 0
    fi
    sleep 1
done
echo 'Container failed to exit after PostgreSQL stopped' >&2
exit 1
