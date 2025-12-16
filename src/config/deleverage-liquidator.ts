import { boolLike, zommandRegistry } from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const DeleverageLiquidatorSchema = z.object({
  ...CommonSchema.shape,
  /**
   * Liquidator mode
   */
  liquidationMode: z.literal("deleverage").register(zommandRegistry, {
    flags: "--liquidation-mode <mode>",
    description: "Liquidator mode (full/partial/batch/deleverage)",
    env: "LIQUIDATION_MODE",
  }),
  /**
   * In optimistic mode, use real health factor range to scan for accounts
   * and do not force-enable deleverage bot on accounts.
   *
   * This mode can be used to test that deleverage bot is able to detect accounts correctly
   */
  useProductionScanner: boolLike().optional().register(zommandRegistry, {
    flags: "--use-production-scanner",
    description:
      "In optimistic mode, use real health factor range to scan for accounts and do not force-enable deleverage bot on accounts",
    env: "USE_PRODUCTION_SCANNER",
  }),
});

export type DeleverageLiquidatorSchema = z.infer<
  typeof DeleverageLiquidatorSchema
>;
