# syntax=docker/dockerfile:1
FROM alpine:3.23 AS cloudflared
ARG TARGETARCH
RUN apk add --no-cache curl \
    && case "$TARGETARCH" in \
       amd64) checksum=1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872 ;; \
       arm64) checksum=3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775 ;; \
       *) echo "このCPUアーキテクチャのcloudflaredには対応していません" >&2; exit 1 ;; esac \
    && curl -fL --retry 3 "https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-${TARGETARCH}" -o /cloudflared \
    && echo "$checksum  /cloudflared" | sha256sum -c - \
    && chmod 755 /cloudflared

FROM node:24-alpine3.23 AS builder
ARG KENER_COMMIT=a03b0c308b3b54ae4e59793ae51e81c17ea407ec
RUN apk add --no-cache curl tar build-base python3 sqlite-dev
WORKDIR /app
RUN curl -fL --retry 3 "https://codeload.github.com/rajnandan1/kener/tar.gz/${KENER_COMMIT}" \
    | tar -xz --strip-components=1
RUN npm ci --no-fund
COPY patch-kener.mjs /tmp/patch-kener.mjs
RUN node /tmp/patch-kener.mjs
# Match the upstream production build, without the documentation site.
RUN rm -rf 'src/routes/(docs)' .svelte-kit && npm run build && npm prune --omit=dev

FROM node:24-alpine3.23
ARG KENER_COMMIT=a03b0c308b3b54ae4e59793ae51e81c17ea407ec
LABEL org.opencontainers.image.title="Kener for Pterodactyl" \
      org.opencontainers.image.source="https://github.com/NCCGr/kener-pterodactyl" \
      org.opencontainers.image.version="4.2.0-egg.3" \
      org.opencontainers.image.description="Pterodactyl用の非公式Kenerイメージ（Valkey・Cloudflare Tunnel対応）" \
      io.kener.upstream.commit="${KENER_COMMIT}"
RUN apk add --no-cache valkey valkey-cli sqlite tzdata iputils curl \
    && ln -s /usr/bin/valkey-server /usr/local/bin/redis-server \
    && ln -s /usr/bin/valkey-cli /usr/local/bin/redis-cli \
    && addgroup -g 1001 container \
    && adduser -D -h /home/container -u 1001 -G container container
COPY --from=builder /app/build /opt/kener/build
COPY --from=builder /app/node_modules /opt/kener/node_modules
COPY --from=builder /app/migrations /opt/kener/migrations
COPY --from=builder /app/seeds /opt/kener/seeds
COPY --from=builder /app/src /opt/kener/src
COPY --from=builder /app/package.json /app/LICENSE /opt/kener/
COPY LICENSE.valkey /opt/kener/LICENSE.valkey
COPY --from=cloudflared /cloudflared /usr/local/bin/cloudflared
COPY LICENSE.cloudflared /opt/kener/LICENSE.cloudflared
COPY supervisor.mjs /usr/local/lib/kener/supervisor.mjs
COPY kener-start /usr/local/bin/kener-start
RUN chmod 755 /usr/local/bin/kener-start
ENV USER=container HOME=/home/container NODE_ENV=production NO_AUTOUPDATE=true \
    NODE_OPTIONS=--experimental-strip-types BODY_SIZE_LIMIT=3M TZ=UTC
WORKDIR /home/container
USER container
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/kener-start"]
CMD []
