import { addressLike, zommandRegistry } from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const BatchLiquidatorSchema = z.object({
  ...CommonSchema.shape,
  /**
   * Liquidator mode
   */
  liquidationMode: z.literal("batch").register(zommandRegistry, {
    flags: "--liquidation-mode <mode>",
    description: "Liquidator mode (full/partial/batch/deleverage)",
    env: "LIQUIDATION_MODE",
  }),
  /**
   * Number of accounts to liquidate at once using batch liquidator
   */
  batchSize: z.coerce
    .number()
    .nonnegative()
    .default(10)
    .register(zommandRegistry, {
      flags: "--batch-size <size>",
      description:
        "Number of accounts to liquidate at once using batch liquidator",
      env: "BATCH_SIZE",
    }),

  /**
   * Address of deployed batch liquidator contract (3.0)
   */
  batchLiquidatorAddress: addressLike().optional().register(zommandRegistry, {
    flags: "--batch-liquidator-address <address>",
    description: "Address of deployed batch liquidator contract",
    env: "BATCH_LIQUIDATOR_ADDRESS",
  }),
});

export type BatchLiquidatorSchema = z.infer<typeof BatchLiquidatorSchema>;
