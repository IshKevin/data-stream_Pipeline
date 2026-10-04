# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-fund --no-audit
COPY . .
RUN npm run build

FROM nginx:1.30-alpine AS runtime
COPY --link security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --link nginx.conf /etc/nginx/conf.d/default.conf
COPY --link --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --start-interval=2s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
