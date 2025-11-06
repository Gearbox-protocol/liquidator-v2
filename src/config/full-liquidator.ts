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
   * If true, try to liquidate with loss policy in case of bad debt
   */
  applyLossPolicy: boolLike().optional().register(zommandRegistry, {
    flags: "--apply-loss-policy",
    description:
      "If true, try to liquidate with loss policy in case of bad debt",
    env: "APPLY_LOSS_POLICY",
  }),
});

export type FullLiquidatorSchema = z.infer<typeof FullLiquidatorSchema>;
