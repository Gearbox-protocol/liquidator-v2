// These imports are required to establish correct order of dependency injections
import "./services/Client.js";
import "./services/HealthCheckerService.js";
import "./services/Scanner.js";
import "./services/liquidate/index.js";
import "./services/output/index.js";
import "./services/notifier/index.js";
import "./services/swap/index.js";

import { launchApp } from "./app.js";

Error.stackTraceLimit = Infinity;

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
