import { boolLike, zommandRegistry } from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const FullLiquidatorSchema = z.object({
  ...CommonSchema.shape,
  /**
   * Liquidator mode
   */
  liquidationMode: z.literal("full").register(zommandRegistry, {
    flags: "--liquidation-mode <mode>",
    description: "Liquidator mode (full/partial/batch/deleverage)",
    env: "LIQUIDATION_MODE",
  }),
  /**
   * Debt policy
   * full - liquidate fully
   * debt-only - try to liquidate only debt
   * debt-expired - try to liquidate only debt for expired accounts
   */
  debtPolicy: z
    .enum(["full", "debt-only", "debt-expired"])
    .default("full")
    .register(zommandRegistry, {
      flags: "--debt-policy <policy>",
      description: "Liquidate fully/debt only/debt only for expired accounts",
      env: "DEBT_POLICY",
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
