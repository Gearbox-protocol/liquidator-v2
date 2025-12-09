import { zommandRegistry } from "@gearbox-protocol/cli-utils";
import { ZodAddress } from "@gearbox-protocol/sdk";
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
   * Address of the partial liquidation bot (for deleverage)
   */
  partialLiquidationBot: ZodAddress()
    // .default("0xc73a6741c77164dd06ff6edb09e8374abdf75c19")
    .register(zommandRegistry, {
      flags: "--partial-liquidation-bot <address>",
      description: "Address of the partial liquidation bot (for deleverage)",
      env: "PARTIAL_LIQUIDATION_BOT",
    }),
});

export type DeleverageLiquidatorSchema = z.infer<
  typeof DeleverageLiquidatorSchema
>;
