# ---- shared: install the whole workspace once ----
# Built on the native build platform: the workspace install and esbuild bundle
# are arch-independent, so we avoid emulating this heavy step under QEMU.
FROM --platform=$BUILDPLATFORM node:24.15.0-trixie AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"
ENV HUSKY=0

WORKDIR /app

# Copy only manifests + lockfile first so the install layer stays cached across
# source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/liquidator/package.json apps/liquidator/
COPY apps/optimist/package.json apps/optimist/
COPY packages/liquidator-v2-config/package.json packages/liquidator-v2-config/
COPY packages/cli-utils/package.json packages/cli-utils/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    wget -qO- https://get.pnpm.io/install.sh | env ENV="$HOME/.shrc" SHELL="$(which sh)" sh - \
    && pnpm install --frozen-lockfile

COPY . .

# ---- shared: build every app (esbuild bundles) ----
FROM deps AS build

RUN pnpm -r build

# ---- liquidator: production node_modules (flat) ----
FROM node:24.15.0-trixie AS liquidator-prod

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"

WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/
COPY --from=build /app/apps/liquidator/package.json /app/apps/liquidator/package.json
COPY --from=build /app/apps/optimist/package.json /app/apps/optimist/package.json
COPY --from=build /app/packages/liquidator-v2-config/package.json /app/packages/liquidator-v2-config/package.json
COPY --from=build /app/packages/cli-utils/package.json /app/packages/cli-utils/package.json
COPY --from=build /app/apps/liquidator/build/ /app/apps/liquidator/build

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    wget -qO- https://get.pnpm.io/install.sh | env ENV="$HOME/.shrc" SHELL="$(which sh)" sh - \
    && pnpm pkg delete scripts.prepare \
    && pnpm install --prod --frozen-lockfile

# The bundled entry runs from /app/index.mjs and imports the only external
# runtime dependency (@homebridge/node-pty-prebuilt-multiarch, native bindings)
# via ESM, which resolves only through node_modules. pnpm hoists it privately
# under .pnpm, so expose it at the top level.
RUN mkdir -p /app/node_modules/@homebridge \
    && ln -s /app/node_modules/.pnpm/node_modules/@homebridge/node-pty-prebuilt-multiarch \
       /app/node_modules/@homebridge/node-pty-prebuilt-multiarch

# ---- liquidator: final image ----
FROM gcr.io/distroless/nodejs24-debian13 AS liquidator
ARG PACKAGE_VERSION
ENV PACKAGE_VERSION=${PACKAGE_VERSION:-dev}
LABEL org.opencontainers.image.version="${PACKAGE_VERSION}"
LABEL org.opencontainers.image.source=https://github.com/Gearbox-protocol/liquidator-v2

WORKDIR /app
COPY --from=liquidator-prod /app/node_modules /app/node_modules
COPY --from=liquidator-prod /app/apps/liquidator/build/ /app/
# `cast` (optimistic trace generation) pulled from the official multi-arch
# foundry image; COPY --from resolves to the target platform automatically.
COPY --from=ghcr.io/foundry-rs/foundry:v1.7.1 /usr/local/bin/cast /app/cast
COPY --from=liquidator-prod /usr/bin/timeout /app/timeout
ENV PATH="/app:${PATH}"

ENTRYPOINT ["/nodejs/bin/node", "--enable-source-maps", "/app/index.mjs"]

# ---- optimist: final image (esbuild output is fully bundled) ----
FROM gcr.io/distroless/nodejs24-debian13 AS optimist
ARG OPTIMIST_VERSION
ARG OPTIMIST_TAG
ENV NODE_ENV=production
ENV OPTIMIST_VERSION=${OPTIMIST_VERSION:-dev}
ENV OPTIMIST_TAG=${OPTIMIST_TAG:-dev}
LABEL org.opencontainers.image.version="${OPTIMIST_VERSION}"
LABEL org.opencontainers.image.source=https://github.com/Gearbox-protocol/liquidator-v2

USER 1000:1000
WORKDIR /app
COPY --from=build /app/apps/optimist/build/ /app/

ENTRYPOINT ["/nodejs/bin/node", "--enable-source-maps", "/app/index.mjs"]
