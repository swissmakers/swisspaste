# Copyright (C) 2025-2026 Swissmakers GmbH
# Author: Michael André Reber
# License: AGPL-3.0-or-later
# https://github.com/swissmakers/swisspaste

# Build browser assets and embed them in an unprivileged runtime

FROM docker.io/library/node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS assets
WORKDIR /src
COPY package.json package-lock.json VERSION ./
RUN npm ci
COPY scripts ./scripts
COPY web/editor.js web/preview.js web/pdf.js ./web/
COPY web/static/img/bg_source ./web/static/img/bg_source
COPY web/static/img/logo/logo.png ./web/static/img/logo/logo.png
RUN npm run build

FROM docker.io/library/golang:1.27.1-bookworm@sha256:648f440f42a0958804efb24df176f806f9d353b41f1c0627f666428e40310f6b AS build
WORKDIR /src
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ENV CGO_ENABLED=0 \
    GOFLAGS=-trimpath \
    GOPROXY=${GOPROXY} \
    GOSUMDB=${GOSUMDB}
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN rm -rf web/static/img
COPY --from=assets /src/web/static/editor.bundle.js /src/web/static/editor.LICENSE.txt ./web/static/
COPY --from=assets /src/web/static/preview.bundle.js /src/web/static/pdf.bundle.js /src/web/static/pdf.worker.js ./web/static/
COPY --from=assets /src/web/static/pdf ./web/static/pdf
COPY --from=assets /src/web/static/img/bg_live ./web/static/img/bg_live
COPY --from=assets /src/web/static/img/logo ./web/static/img/logo
COPY web/static/img/previews ./web/static/img/previews
RUN rm web/static/img/logo/logo.png
RUN go build -ldflags="-s -w" -o /out/swisspaste . && mkdir -p /out/spool

FROM gcr.io/distroless/static-debian13:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3
LABEL org.opencontainers.image.title="swissPaste" \
      org.opencontainers.image.description="Ephemeral shared clipboard and file exchange" \
      org.opencontainers.image.source="https://github.com/swissmakers/swisspaste" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=build /out/swisspaste /usr/local/bin/swisspaste
COPY --from=build --chown=65532:65532 /out/spool /var/lib/swisspaste/spool
ENV SWISSPASTE_LISTEN=:8080 \
    SWISSPASTE_DATA_DIR=/var/lib/swisspaste/spool
EXPOSE 8080
VOLUME ["/var/lib/swisspaste/spool"]
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/swisspaste"]
