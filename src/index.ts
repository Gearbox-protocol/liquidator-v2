#!/usr/bin/env node

import "reflect-metadata";

import { launchApp } from "./app";

Error.stackTraceLimit = Infinity;

process.on("uncaughtException", e => {
  console.log(e);
  process.exit(1);
});

process.on("unhandledRejection", e => {
  console.log(e);
  process.exit(1);
});

launchApp().catch(e => {
  console.log("Cant start liquidator", e);
  process.exit(1); // exit code is easily visible for killled docker containers and ecs services
});
