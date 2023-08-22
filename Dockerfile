FROM node:18.17.1 as dev

WORKDIR /app

COPY . .

RUN yarn install --frozen-lockfile \
 && yarn build

# Production npm modules

FROM node:18.17.1 as prod

WORKDIR /app

COPY --from=dev /app/package.json /app
COPY --from=dev /app/build/ /app/build

RUN yarn install --production --frozen-lockfile

# Final image

FROM gcr.io/distroless/nodejs:18
WORKDIR /app
COPY --from=prod /app /app
CMD ["/app/build/index.js"]
