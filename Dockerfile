# syntax=docker/dockerfile:1
FROM node:22-alpine3.22 AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_URL=""
RUN npm run build

FROM node:22-alpine3.22 AS backend-toolchain
# ARM64 native dependencies such as utf-8-validate need a source-build fallback.
RUN apk add --no-cache python3 make g++

FROM backend-toolchain AS backend-build
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM backend-toolchain AS backend-deps
WORKDIR /app
COPY backend/package*.json ./
# Keep target-platform native addons; only discard Google SDK compile-time declarations.
RUN npm ci --omit=dev --include=optional \
    && find node_modules/googleapis -type f -name '*.d.ts' -delete \
    && node -e "require('sharp'); const {google}=require('googleapis'); google.drive({version:'v3'}); new google.auth.OAuth2()"

FROM node:22-alpine3.22
ARG SOURCE_REVISION=unknown
ARG SOURCE_VERSION=worktree
ARG SOURCE_URL=https://github.com/hicocos/tg-vault
LABEL org.opencontainers.image.revision=$SOURCE_REVISION \
      org.opencontainers.image.version=$SOURCE_VERSION \
      org.opencontainers.image.source=$SOURCE_URL
RUN apk add --no-cache postgresql17 postgresql17-contrib ffmpeg ca-certificates su-exec tini bash font-noto-cjk
WORKDIR /app
COPY backend/package*.json ./
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-build /build/backend/dist ./dist
COPY --from=frontend-build /build/frontend/dist ./public
COPY deploy/all-in-one-entrypoint.sh /usr/local/bin/tg-vault-entrypoint
RUN chmod +x /usr/local/bin/tg-vault-entrypoint
# Legacy temporary paths are relative to cwd; keep all runtime writes on the volume.
WORKDIR /data
ENV NODE_ENV=production PORT=51947 FRONTEND_DIR=/app/public \
    COOKIE_SECURE=false TRUST_PROXY=loopback \
    UPLOAD_DIR=/data/uploads THUMBNAIL_DIR=/data/thumbnails \
    PREVIEW_DIR=/data/previews CHUNK_DIR=/data/chunks \
    TG_VAULT_SECRET_DIR=/data/secrets \
    TELEGRAM_SESSION_FILE=/data/telegram_session.txt \
    TELEGRAM_USER_SESSION_FILE=/data/telegram_user_session.txt
VOLUME ["/data"]
EXPOSE 51947
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:51947/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/tg-vault-entrypoint"]
