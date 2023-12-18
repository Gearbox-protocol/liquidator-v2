#!/usr/bin/env node

import "reflect-metadata";

import { launchApp } from "./app";
import config from "./config";

process.on("uncaughtException", e => {
  console.log(e);
  process.exit(1);
});

process.on("unhandledRejection", e => {
  console.log(e);
  process.exit(1);
});

config
  .validate()
  .then(() => launchApp())
  .catch(e => {
    console.log("Cant start bot", e);
    process.exit(1); // exit code is easily visible for killled docker containers and ecs services
  });
