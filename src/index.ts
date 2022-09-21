#!/usr/bin/env node

import "reflect-metadata";

import { createApp } from "./app";
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
  .then(() => createApp())
  .catch(e => {
    console.log("Cant start bot", e);
  });
