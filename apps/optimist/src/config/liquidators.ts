import {
  addressArrayLike,
  addressLike,
  CensoredString,
  CensoredURL,
} from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";

export const DegenConfig = z.object({
  degenNFT: addressLike(),
  recipients: addressArrayLike(),
});

export type DegenConfig = z.infer<typeof DegenConfig>;

export const KycConfig = z.object({
  /**
   * Securitize DS registry admin, impersonated on the fork.
   * DSTokens are skipped when omitted
   */
  securitizeAdmin: addressLike().optional(),
  /**
   * Midas access control admin, impersonated on the fork
   * (MIDAS_ACL_ADMIN in periphery-v3/router-v3 foundry tests).
   * Midas gateways are skipped when omitted
   */
  midasAdmin: addressLike().optional(),
});

export type KycConfig = z.infer<typeof KycConfig>;

export const SetupConfig = z
  .object({
    /**
     * Automatically top up liquidator balance to exclude low balance errors
     */
    topUp: z.boolean().default(true),
    /**
     * In emergency mode, all contracts will be paused after setting LT to zero and before liquidations
     */
    emergencyMode: z.boolean().optional(),
    /**
     * Set all LTs to zero
     */
    zeroLT: z.boolean().optional(),
    /**
     * Set particular LTs to particular values
     */
    lts: z.record(z.string(), z.number().int().min(0).max(10000)).optional(),
    /**
     * Mint degen NFTs to some addresses
     */
    mintDegenNFT: DegenConfig.optional(),
    /**
     * Pass KYC of every RWA token and midas gateway for liquidator addresses
     */
    kyc: KycConfig.optional(),
    /**
     * Deal a large amount of every market underlying to liquidator addresses,
     * required by strategies that liquidate with the liquidator's own funds
     */
    fundUnderlying: z.boolean().optional(),
    /**
     * Hack loss policy to test CreditAccountNotLiquidatableWithLossException revert
     *
     */
    hackLossPolicy: z.boolean().optional(),
  })
  .refine(v => !(v.lts && v.zeroLT), {
    error: "cannot have both zeroLT and fixed LTs",
  });

export type SetupConfig = z.infer<typeof SetupConfig>;

export const LiquidatorAddressConfig = z.object({
  /**
   * If this address should be checked for emergency permissions
   */
  emergency: z.boolean().optional(),
});

export type LiquidatorAddressConfig = z.infer<typeof LiquidatorAddressConfig>;

export const LiquidatorConfig = z.object({
  /**
   * Id to distinguish full/partial etc tracks,
   * Used as
   * - a part of container ids
   * - a part of output file name
   * - loki label
   */
  id: z
    .string()
    .regex(/[0-9A-Za-z_]+/)
    .min(2),
  /**
   * Addresses of instances that run this config
   */
  addresses: z
    .record(addressLike(), LiquidatorAddressConfig.nullish())
    .default({}),
  /**
   * Name of the track to show in reports
   */
  name: z.string(),
  /**
   * RPC to use for anvil fork, default to originRPC from root config
   */
  rpc: z.string().transform(CensoredURL.transform).optional(),
  /**
   * Disables anvil fork rate limit by setting --no-rate-limit anvil flag
   */
  disableRateLimit: z.boolean().optional(),
  /**
   * Anvil memory limit in MB, if not set, will use default value from anvil itself
   */
  anvilMemoryLimit: z.number().positive().optional(),
  /**
   * ENV to pass to liquidator container - everything here is uncensored
   */
  env: z.record(z.string(), z.string()).default({}),
  /**
   * Secrets to pass to liquidator container - everything here is censored
   * Still passed as ENV to container, the purpose is to censor strings in optimist logs
   */
  secrets: z
    .record(z.string(), z.string().transform(CensoredString.transform))
    .default({}),
  /**
   * Override docker image to use
   */
  image: z.string().optional(),
  /**
   * Tag of docker image.
   * Secret is required to be able to load latest production version from AWS
   */
  imageTag: z.string().default("latest"),
  /**
   * Delay before start, in minutes
   */
  delay: z.number().positive().optional(),
  /**
   * Disables zeroDiscovery warning for this track
   */
  disableZeroDiscoveryWarning: z.boolean().optional(),
  setup: SetupConfig.prefault({}),
});

export type LiquidatorConfig = z.infer<typeof LiquidatorConfig>;
