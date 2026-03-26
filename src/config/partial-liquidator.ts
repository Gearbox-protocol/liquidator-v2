import {
  boolLike,
  optionalAddressArrayLike,
  zommandRegistry,
} from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const PartialLiquidatorSchema = z.object({
  ...CommonSchema.shape,
  /**
   * Liquidator mode
   */
  liquidationMode: z.literal("partial").register(zommandRegistry, {
    flags: "--liquidation-mode <mode>",
    description: "Liquidator mode (full/partial/batch/deleverage)",
    env: "LIQUIDATION_MODE",
  }),

  /**
   * Fallback to use full liquidator when partial liquidator fails
   */
  partialFallback: boolLike().optional().register(zommandRegistry, {
    flags: "--partial-fallback",
    description:
      "Fallback to use full liquidator when partial liquidator fails",
    env: "PARTIAL_FALLBACK",
  }),

  /**
   * Desired HF after partial liquidation, with 4 decimals (100% = 10000)
   */
  targetPartialHF: z.coerce.bigint().default(10100n).register(zommandRegistry, {
    flags: "--target-partial-hf <hf>",
    description:
      "Desired HF after partial liquidation, with 4 decimals (100% = 10000)",
    env: "TARGET_PARTIAL_HF",
  }),
  /**
   * Optimal HF for partial liquidation will be calculated for accounts with following underlying tokens
   * Takes precedence over targetPartialHF
   */
  calculatePartialHF: optionalAddressArrayLike().register(zommandRegistry, {
    flags: "--calculate-partial-hf <tokens>",
    description:
      "Optimal HF for partial liquidation will be calculated for accounts with following underlying tokens",
    env: "CALCULATE_PARTIAL_HF",
  }),
});

export type PartialLiquidatorSchema = z.infer<typeof PartialLiquidatorSchema>;
