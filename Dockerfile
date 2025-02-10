FROM node:22.13 AS dev

ENV YARN_CACHE_FOLDER=/root/.yarn

WORKDIR /app

COPY . .

RUN --mount=type=cache,id=yarn,target=/root/.yarn \
    corepack enable \
    && yarn install --immutable \
    && yarn build

# Production npm modules

FROM node:22.13 AS prod

ENV YARN_CACHE_FOLDER=/root/.yarn

WORKDIR /app

COPY --from=dev /app/package.json /app
COPY --from=dev /app/build/ /app/build

RUN --mount=type=cache,id=yarn,target=/root/.yarn \
    corepack enable \
    && yarn workspaces focus --all --production

# Install foundy
ENV FOUNDRY_DIR=/root/.foundry
RUN mkdir ${FOUNDRY_DIR} && \
    curl -L https://foundry.paradigm.xyz | bash && \
    ${FOUNDRY_DIR}/bin/foundryup

# Final image

FROM gcr.io/distroless/nodejs22-debian12
ARG PACKAGE_VERSION
ENV PACKAGE_VERSION=${PACKAGE_VERSION:-dev}
LABEL org.opencontainers.image.version="${PACKAGE_VERSION}"

WORKDIR /app
COPY --from=prod /app /app
COPY --from=prod /root/.foundry/bin/cast /app
CMD ["--enable-source-maps", "/app/build/index.mjs"]
