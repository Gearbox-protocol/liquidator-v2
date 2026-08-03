import { zommandRegistry } from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const WalletLiquidatorSchema = z.object({
  ...CommonSchema.shape,
  /**
   * Liquidator mode
   */
  liquidationMode: z.literal("wallet").register(zommandRegistry, {
    flags: "--liquidation-mode <mode>",
    description: "Liquidator mode (full/partial/batch/deleverage/wallet)",
    env: "LIQUIDATION_MODE",
  }),
});

export type WalletLiquidatorSchema = z.infer<typeof WalletLiquidatorSchema>;
