FROM node:24.11 AS dev

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    corepack enable \
    && pnpm install --frozen-lockfile \
    && pnpm build

# Production npm modules

FROM node:24.11 AS prod

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

COPY --from=dev /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/
COPY --from=dev /app/build/ /app/build

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    corepack enable \
    && npm pkg delete scripts.prepare \
    && pnpm install --prod --frozen-lockfile

# Install foundy
ENV FOUNDRY_DIR=/root/.foundry
RUN mkdir ${FOUNDRY_DIR} && \
    curl -L https://foundry.paradigm.xyz | bash && \
    ${FOUNDRY_DIR}/bin/foundryup

# Final image

FROM gcr.io/distroless/nodejs24-debian12
ARG PACKAGE_VERSION
ENV PACKAGE_VERSION=${PACKAGE_VERSION:-dev}
LABEL org.opencontainers.image.version="${PACKAGE_VERSION}"

WORKDIR /app
COPY --from=prod /app /app
COPY --from=prod /root/.foundry/bin/cast /app
CMD ["--enable-source-maps", "/app/build/index.mjs"]
