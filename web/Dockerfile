# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
# Tolerate slow / flaky registry connections on build servers (retry instead of failing the deploy).
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json ./
# Cache mounts are shared by *id* across every build on the Docker host, so give ours its own id (a corrupted or
# incompatible npm cache left by another app on the same server cannot break this build). If npm fails, print
# the architecture, disk, memory and npm's error lines so the real reason shows up in the deploy log.
RUN --mount=type=cache,id=data-stream_pipeline-npm,target=/root/.npm,sharing=locked \
    npm ci --no-fund --no-audit \
 || { echo "=== npm ci FAILED ==="; echo "arch: $(uname -m)"; df -h / /root/.npm; free -m; \
      grep -hE " (error|verbose stack) | http fetch " /root/.npm/_logs/*-debug-*.log | tail -n 40; exit 1; }
COPY . .
RUN npm run build

FROM nginx:1.30-alpine AS runtime
COPY --link security-headers.conf proxy-api.conf /etc/nginx/snippets/
COPY --link nginx.conf /etc/nginx/conf.d/default.conf
COPY --link --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --start-interval=2s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
