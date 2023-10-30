FROM node:18.17.1 as dev

ENV YARN_CACHE_FOLDER=/root/.yarn

WORKDIR /app

COPY . .

RUN --mount=type=cache,id=yarn,target=/root/.yarn \
 yarn install --frozen-lockfile \
 && yarn build

# Production npm modules

FROM node:18.17.1 as prod

ENV YARN_CACHE_FOLDER=/root/.yarn

WORKDIR /app

COPY --from=dev /app/package.json /app
COPY --from=dev /app/build/ /app/build

RUN --mount=type=cache,id=yarn,target=/root/.yarn \
    yarn install --production --frozen-lockfile

# Final image

FROM gcr.io/distroless/nodejs:18
WORKDIR /app
COPY --from=prod /app /app
CMD ["/app/build/index.js"]
