import { zommandRegistry } from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const WalletLiquidatorSchema = z.object({
  ...CommonSchema.shape,
  /**
   * Liquidator mode
   */
  liquidationMode: z
    .enum(["wallet-full", "wallet-partial"])
    .register(zommandRegistry, {
      flags: "--liquidation-mode <mode>",
      description:
        "Liquidator mode (full/partial/batch/deleverage/wallet-full/wallet-partial)",
      env: "LIQUIDATION_MODE",
    }),
});

export type WalletLiquidatorSchema = z.infer<typeof WalletLiquidatorSchema>;
