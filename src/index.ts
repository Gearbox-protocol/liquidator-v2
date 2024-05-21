#!/usr/bin/env node

import "reflect-metadata";

import v8 from "node:v8";

import { launchApp } from "./app";

Error.stackTraceLimit = Infinity;
// Promise.all on credit managers causes this error "Maximum call stack size exceeded"
v8.setFlagsFromString("--stack-size=1024");

process.on("uncaughtException", e => {
  console.error(e);
  process.exit(1);
});

process.on("unhandledRejection", e => {
  console.error(e);
  process.exit(1);
});

launchApp().catch(e => {
  console.error("Cant start liquidator", e);
  process.exit(1); // exit code is easily visible for killled docker containers and ecs services
});
