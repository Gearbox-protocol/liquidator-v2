import {
  addressLike,
  boolLike,
  optionalAddressArrayLike,
  zommandRegistry,
} from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const PartialV300ConfigSchema = z.object({
  /**
   * Address of deployed partial liquidator contract for all credit managers except for GHO- and DOLA- based
   */
  aavePartialLiquidatorAddress: addressLike()
    .optional()
    .register(zommandRegistry, {
      flags: "--aave-partial-liquidator-address <address>",
      description:
        "Address of deployed partial liquidator contract for all credit managers except for GHO- and DOLA- based",
      env: "AAVE_PARTIAL_LIQUIDATOR_ADDRESS",
    }),
  /**
   * Address of deployed partial liquidator contract for GHO credit managers
   */
  ghoPartialLiquidatorAddress: addressLike()
    .optional()
    .register(zommandRegistry, {
      flags: "--gho-partial-liquidator-address <address>",
      description:
        "Address of deployed partial liquidator contract for GHO credit managers",
      env: "GHO_PARTIAL_LIQUIDATOR_ADDRESS",
    }),
  /**
   * Address of deployed partial liquidator contract for DOLA credit managers
   */
  dolaPartialLiquidatorAddress: addressLike()
    .optional()
    .register(zommandRegistry, {
      flags: "--dola-partial-liquidator-address <address>",
      description:
        "Address of deployed partial liquidator contract for DOLA credit managers",
      env: "DOLA_PARTIAL_LIQUIDATOR_ADDRESS",
    }),
  /**
   * Address of deployed partial liquidator contract for Nexo credit managers
   */
  nexoPartialLiquidatorAddress: addressLike()
    .optional()
    .register(zommandRegistry, {
      flags: "--nexo-partial-liquidator-address <address>",
      description:
        "Address of deployed partial liquidator contract for Nexo credit managers",
      env: "NEXO_PARTIAL_LIQUIDATOR_ADDRESS",
    }),
  /**
   * Address of deployed partial liquidator contract for Sonic credit managers
   */
  siloPartialLiquidatorAddress: addressLike()
    .optional()
    .register(zommandRegistry, {
      flags: "--silo-partial-liquidator-address <address>",
      description:
        "Address of deployed partial liquidator contract for Silo credit managers",
      env: "SILO_PARTIAL_LIQUIDATOR_ADDRESS",
    }),
});

export type PartialV300ConfigSchema = z.infer<typeof PartialV300ConfigSchema>;

export const PartialLiquidatorSchema = z.object({
  ...CommonSchema.shape,
  ...PartialV300ConfigSchema.shape,
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
