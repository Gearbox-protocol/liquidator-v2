import { Token } from "typedi";

import { envConfig } from "./env";
import { ConfigSchema } from "./schema";

export const CONFIG = new Token("config");

export function loadConfig(): ConfigSchema {
  return ConfigSchema.parse(envConfig);
}

export type { ConfigSchema } from "./schema";
