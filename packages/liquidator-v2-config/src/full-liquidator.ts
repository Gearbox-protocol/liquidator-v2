import { zommandRegistry } from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";
import { CommonSchema } from "./common.js";

export const FullLiquidatorSchema = z
  .object({
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
     * Full-mode liquidation strategy set for this process.
     *
     * Values:
     * - `auto`: production default. Includes loss-policy, normal full, and RWA
     *   stablecoin strategies. Routing is decided by account type and
     *   per-strategy `isApplicable`: non-RWA accounts use loss policy when they
     *   have bad debt and fall back to normal full liquidation otherwise, while
     *   RWA accounts use only the RWA stablecoin strategy.
     * - `rwa`: include only `LiquidationStrategyRWAViaStablecoins`
     *   Intended for optimistic RWA tracks.
     * - `loss`: include only `LiquidationStrategyLossPolicy`
     *   Intended for optimistic loss-policy tracks.
     * - `full`: include only `LiquidationStrategyFull`
     *   Intended for optimistic normal-full tracks.
     *
     * Optimistic mode rejects `auto`, so the external runner must invoke
     * explicit tracks: `rwa`, `loss`, and `full`.
     */
    strategy: z
      .enum(["auto", "rwa", "loss", "full"])
      .default("auto")
      .register(zommandRegistry, {
        flags: "--strategy <strategy>",
        description:
          "Full-mode liquidation strategy set (auto/rwa/loss/full). Optimistic mode requires an explicit track.",
        env: "STRATEGY",
      }),
  })
  .refine(data => !(data.optimistic === true && data.strategy === "auto"), {
    message:
      "strategy=auto is not allowed in optimistic mode; pick one of rwa/loss/full",
  });

export type FullLiquidatorSchema = z.infer<typeof FullLiquidatorSchema>;
