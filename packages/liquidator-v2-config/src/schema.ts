import { z } from "zod/v4";
import { BatchLiquidatorSchema } from "./batch-liquidator.js";
import { DeleverageLiquidatorSchema } from "./deleverage-liquidator.js";
import { FullLiquidatorSchema } from "./full-liquidator.js";
import { PartialLiquidatorSchema } from "./partial-liquidator.js";

export const ConfigSchema = z.discriminatedUnion("liquidationMode", [
  FullLiquidatorSchema,
  PartialLiquidatorSchema,
  BatchLiquidatorSchema,
  DeleverageLiquidatorSchema,
]);

export type ConfigSchema = z.infer<typeof ConfigSchema>;
