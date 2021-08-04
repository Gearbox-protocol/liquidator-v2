import config from "./config";
import { ConnectionOptions } from "typeorm/connection/ConnectionOptions";
import * as path from "path";

export const dbConfig: ConnectionOptions = {
  type: "postgres",
  url: config.databaseUrl,
  extra: {
    ssl: { rejectUnauthorized: false },
  },
  entities: [path.join(__dirname, "core/*.{ts,js}")],
  migrations: [path.join(__dirname, "migrations/*.{ts,js}")],
  subscribers: [path.join(__dirname, "subscribers/*.{ts,js}")],
  cli: {
    entitiesDir: "src/core",
    migrationsDir: "src/migrations",
    subscribersDir: "src/subscriber",
  },
};

module.exports = dbConfig;
