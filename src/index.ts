// These imports are required to establish correct order of dependency injections
import "./services/Client.js";
import "./services/HealthCheckerService.js";
import "./services/Scanner.js";
import "./services/liquidate/index.js";
import "./services/output/index.js";
import "./services/notifier/index.js";
import "./services/swap/index.js";

import { setTimeout } from "node:timers/promises";

import {
  secretsManagerProxy,
  ssmManagerProxy,
  Zommand,
} from "@gearbox-protocol/cli-utils";

import attachSDK from "./attachSDK.js";
import { ConfigSchema, loadConfig } from "./config/index.js";
import { DI } from "./di.js";
import Liquidator from "./Liquidator.js";
import version from "./version.js";

Error.stackTraceLimit = Infinity;

process.on("uncaughtException", e => {
  console.error(e);
  process.exit(1);
});

process.on("unhandledRejection", e => {
  console.error(e);
  process.exit(1);
});

const program = new Zommand("liquidator-v2", {
  schema: ConfigSchema,
  configFile: true,
  templateData: {
    ...process.env,
    sm: secretsManagerProxy(),
    ssm: ssmManagerProxy(),
  },
})
  .description("Liquidator v2")
  .version(version)
  .action(async schema => {
    const logger = DI.create(DI.Logger, "App");
    const msg = [
      `Launching liquidator v${version} in`,
      schema.optimistic ? "optimistic" : "",
      schema.liquidationMode ?? "full",
      "mode",
    ]
      .filter(Boolean)
      .join(" ");
    logger.info(schema, msg);

    const config = await loadConfig(schema);
    DI.set(DI.Config, config);
    const service = await attachSDK();
    DI.set(DI.CreditAccountService, service);
    const app = new Liquidator();
    await app.launch();
  });

program.parseAsync().catch(async e => {
  console.error(e);
  await setTimeout(10000);
  process.exit(1);
});
