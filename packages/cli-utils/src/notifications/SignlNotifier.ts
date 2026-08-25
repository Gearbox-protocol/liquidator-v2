import type { ILogger } from "@gearbox-protocol/sdk/onchain";
import { withRetry } from "viem";
import type { CensoredString } from "../CensoredString.js";
import type { SignlConfig } from "./schema.js";
import { ThrottleManager } from "./ThrottleManager.js";
import type { ThrottleFn } from "./types.js";

export type SignlServiceOptions = SignlConfig & {
  retryInterval?: number;
  retryCount?: number;
  throttleFn?: ThrottleFn;
};

const DEFAULT_RETRY_INTERVAL = 1000;
const DEFAULT_RETRY_COUNT = 5;

export default class SignlNotifier {
  readonly #logger?: ILogger;

  readonly #apiKey: CensoredString;
  readonly #teamId: CensoredString;
  readonly #retryInterval: number;
  readonly #retryCount: number;

  readonly #throttleManager = new ThrottleManager();
  readonly #throttleFn?: ThrottleFn;

  constructor(opts: SignlServiceOptions, logger?: ILogger) {
    this.#apiKey = opts.apiKey;
    this.#teamId = opts.teamId;
    this.#retryInterval = opts.retryInterval ?? DEFAULT_RETRY_INTERVAL;
    this.#retryCount = opts.retryCount ?? DEFAULT_RETRY_COUNT;
    this.#logger = logger;
    this.#throttleFn = opts.throttleFn;
    this.#logger?.info(opts, "signl notifier configured");
  }

  public alert(message: string, dedupeKey?: string): void {
    void this.#sendAlert(message, dedupeKey).catch(e => this.#logger?.error(e));
  }

  async #sendAlert(message: string, dedupeKey?: string): Promise<void> {
    if (dedupeKey && !this.#throttleManager.canSend(dedupeKey)) {
      return;
    }

    const text = message.slice(0, 64); // it's to be shown in mobile notifications anyways
    this.#logger?.debug("sending signl alert");

    await withRetry(
      async () => {
        const resp = await fetch(
          `https://connect.signl4.com/api/v2/alerts?x-s4-api-key=${this.#apiKey.value}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              category: "emergency",
              severity: 0,
              teamId: this.#teamId.value,
              text,
              title: "GEARBOX ALERT",
            }),
          },
        );
        if (resp.ok) {
          this.#logger?.warn("signl alert sent");
          const data = await resp.json();
          this.#logger?.info(`signl alert response: ${JSON.stringify(data)}`);
        } else {
          throw new Error(`signl api error ${resp.status}: ${resp.statusText}`);
        }
      },
      { delay: this.#retryInterval, retryCount: this.#retryCount },
    );

    if (dedupeKey) {
      this.#throttleManager.onSent(dedupeKey, this.#throttleFn);
    }
  }
}
