// Mirror of packages/shared/src/whitelist-schema.ts; keep in sync.
import { NetworkType } from "@gearbox-protocol/sdk/onchain";
import { z } from "zod/v4";
import { addressLike } from "./schema-primitives.js";

/**
 * Schema for editing whitelist items.
 * We can input multiple addresses at once.
 */
export const whitelistItemsSchema = z.object({
  network: NetworkType,
  addresses: z.array(addressLike()).min(1),
  reason: z.string().default(""),
  issue: z.string().optional(),
  expiresAt: z.number().optional(),
});

export type WhitelistItems = z.infer<typeof whitelistItemsSchema>;

/**
 * Schema for a single whitelist item as returned by the API
 */
export const whitelistItemSchema = z.object({
  network: NetworkType,
  category: z.string(),
  address: addressLike(),
  reason: z.string().default(""),
  issue: z.string().optional(),
  contractType: z.string().optional(),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
});

export type WhitelistItem = z.infer<typeof whitelistItemSchema>;

/**
 * Subset of {@link WhitelistItemSchema} actually consumed by client apps.
 */
export const clientWhitelistItemSchema = whitelistItemSchema.pick({
  address: true,
  reason: true,
  expiresAt: true,
  contractType: true,
});

export type ClientWhitelistItem = z.infer<typeof clientWhitelistItemSchema>;
