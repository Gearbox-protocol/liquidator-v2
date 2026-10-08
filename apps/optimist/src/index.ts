import "./docker";

import { setTimeout } from "node:timers/promises";

import {
  secretsManagerProxy,
  ssmManagerProxy,
  Zommand,
} from "@gearbox-protocol/cli-utils/node";
import { customAlphabet } from "nanoid";
import { Config } from "./config";
import DI from "./di";
import injectSDK from "./injectSDK";
import Optimist from "./Optimist";
import { tag, version } from "./version";

const nanoid = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  10,
);

const EXECUTION_ID = process.env.EXECUTION_ID || nanoid();
process.env.EXECUTION_ID = EXECUTION_ID;

const program = new Zommand("optimist", {
  schema: Config,
  configFile: "config.yml",
  templateData: {
    ...process.env,
    EXECUTION_ID,
    sm: secretsManagerProxy(),
    ssm: ssmManagerProxy(),
    optimist: {
      version,
      tag,
    },
  },
})
  .description("Optimistically liquidate gearbox credit accounts")
  .version(version)
  .action(async config => {
    DI.set(DI.Config, config);

    const logger = DI.create(DI.Logger, "App");
    logger.info(
      config,
      `starting execution ${config.executionId} with optimist v${version} on ${config.network}`,
    );

    await injectSDK(config);
    const optimist = new Optimist();
    await optimist.run();
  });

console.log(`optimist v${version} (${tag})`);

program.parseAsync().catch(async e => {
  console.error(e);
  await setTimeout(10000);
  process.exit(1);
});
