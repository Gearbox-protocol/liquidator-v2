import { boolLike, zommandRegistry } from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const FullLiquidatorSchema = z.object({
  ...CommonSchema.shape,
  /**
   * Liquidator mode
   */
  liquidationMode: z.literal("full").optional().register(zommandRegistry, {
    flags: "--liquidation-mode <mode>",
    description: "Liquidator mode (full/partial/batch/deleverage)",
    env: "LIQUIDATION_MODE",
  }),
  /**
   * Whether we should apply loss policy on full liquidation of accounts with bad debt
   */
  lossPolicy: z
    .enum(["only", "never", "fallback"])
    .default("never")
    .register(zommandRegistry, {
      flags: "--loss-policy <when>",
      description:
        "Whether we should apply loss policy on full liquidation of accounts with bad debt",
      env: "LOSS_POLICY",
    }),
});

export type FullLiquidatorSchema = z.infer<typeof FullLiquidatorSchema>;
