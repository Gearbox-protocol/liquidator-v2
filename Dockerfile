FROM node:16.17.0 as dev

WORKDIR /app

COPY . .

RUN yarn install --frozen-lockfile \
 && yarn build

# Production npm modules

FROM node:16.17.0 as prod

WORKDIR /app

COPY --from=dev /app/package.json /app
COPY --from=dev /app/build/ /app/build

RUN yarn install --production --frozen-lockfile

# Final image

FROM gcr.io/distroless/nodejs:16
WORKDIR /app
COPY --from=prod /app /app
CMD ["/app/build/index.js"]
