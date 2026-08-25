import type { ILogger, NetworkType } from "@gearbox-protocol/sdk/onchain";
import { AddressMap } from "@gearbox-protocol/sdk/onchain";
import { z } from "zod/v4";
import { fetchRetry } from "./fetchRetry.js";
import {
  type ClientWhitelistItem,
  whitelistItemSchema,
} from "./schemas/whitelist-schema.js";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const whitelistResponseSchema = z.array(whitelistItemSchema);

/**
 * Whitelist mode:
 * - `hard`: entries come from static config and block the action entirely.
 * - `soft`: entries come from the remote endpoint, do not block the action,
 *   but can be used to annotate notifications when the action fails.
 */
export type WhitelistMode = "soft" | "hard";

export interface WhitelistOptions {
  /**
   * Full URL of the remote (soft) whitelist endpoint. When omitted, only the
   * static hard whitelist is used.
   */
  url?: string;
  network: NetworkType;
  /**
   * Static (hard) whitelist entries, supplied via config.
   */
  hard?: ClientWhitelistItem[];
  logger?: ILogger;
}

/**
 * Holds two whitelists:
 * - a `hard` whitelist built once from static config, always available;
 * - a `soft` whitelist fetched from the backend and kept in
 *   memory with a periodic refresh.
 *
 * On soft fetch failure the previous in-memory copy is retained; if no
 * successful fetch has occurred yet the soft whitelist is considered empty.
 */
export class Whitelist {
  readonly #url?: string;
  readonly #network: NetworkType;
  readonly #logger?: ILogger;

  #soft = new AddressMap<ClientWhitelistItem>();
  readonly #hard: AddressMap<ClientWhitelistItem>;
  #refreshInterval?: number;

  constructor({ url, network, hard = [], logger }: WhitelistOptions) {
    this.#url = url;
    this.#network = network;
    this.#logger = logger?.child?.({ name: "whitelist" }) ?? logger;
    this.#hard = new AddressMap<ClientWhitelistItem>();
    for (const entry of hard) {
      this.#hard.upsert(entry.address, entry);
    }
  }

  /**
   * Performs the initial soft fetch and starts the periodic refresh timer.
   * Failure of the initial fetch is non-fatal: the soft whitelist stays empty.
   * When no `url` is configured this is a no-op (only the hard whitelist is used).
   */
  public async start(): Promise<void> {
    if (!this.#url) {
      this.#logger?.debug(
        `no whitelist url configured, using ${this.#hard.size} hard whitelist entries for ${this.#network}`,
      );
      return;
    }
    this.#logger?.info(
      `loading ${this.#network} whitelist from ${this.#url}, refresh every ${REFRESH_INTERVAL_MS / 1000}s`,
    );
    await this.#refresh();
    this.#refreshInterval = setInterval(() => {
      this.#refresh().catch(e => {
        this.#logger?.warn(`unexpected whitelist refresh error: ${e}`);
      });
    }, REFRESH_INTERVAL_MS) as unknown as number;
  }

  /** Stops the refresh timer. */
  public stop(): void {
    if (this.#refreshInterval) {
      clearInterval(this.#refreshInterval);
      this.#refreshInterval = undefined;
    }
  }

  /**
   * Fetches the soft whitelist from the backend, parses it and atomically
   * replaces the in-memory map. On any error logs a warning and retains
   * the previous map.
   */
  async #refresh(): Promise<void> {
    if (!this.#url) {
      return;
    }
    try {
      const resp = await fetchRetry(this.#url);
      if (!resp.ok) {
        throw new Error(
          `whitelist fetch failed: ${resp.status} ${resp.statusText}`,
        );
      }
      const data = await resp.json();
      const items = whitelistResponseSchema
        .parse(data)
        .filter(i => i.network === this.#network);
      const next = new AddressMap<ClientWhitelistItem>();
      for (const item of items) {
        next.upsert(item.address, {
          address: item.address,
          reason: item.reason,
          expiresAt: item.expiresAt,
          contractType: item.contractType,
        });
      }
      this.#soft = next;
      this.#logger?.debug(
        `loaded ${items.length} soft whitelist entries for ${this.#network}`,
      );
    } catch (e) {
      this.#logger?.warn(
        `failed to refresh whitelist from ${this.#url}, keeping previous version: ${e}`,
      );
    }
  }

  /**
   * Returns the matching whitelist entry for the given address in the
   * requested mode, or `undefined` if absent or expired.
   */
  public has(
    address: string,
    mode: WhitelistMode,
  ): ClientWhitelistItem | undefined {
    const list = mode === "hard" ? this.#hard : this.#soft;
    const item = list.get(address);
    if (!item) {
      return undefined;
    }
    if (item.expiresAt !== undefined && Date.now() / 1000 >= item.expiresAt) {
      return undefined;
    }
    return item;
  }
}
