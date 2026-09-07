import type { ILogger } from "@gearbox-protocol/sdk/onchain";
import { md } from "@vlad-yakovlev/telegram-md";
import Queue from "p-queue";
import { withRetry } from "viem";
import type { TelegramConfig } from "./schema.js";
import { ThrottleManager } from "./ThrottleManager.js";
import type {
  IDedupableNotification,
  INotifier,
  NotificationSeverity,
} from "./types.js";

export type TelegramNotifierOptions = TelegramConfig & {
  retryInterval?: number;
  retryCount?: number;
  maxChunkSize?: number;
  fetchFn?: typeof fetch;
};

interface TelegramPayload {
  text: string;
  parse_mode?: "MarkdownV2";
}

const DEFAULT_RETRY_INTERVAL = 1000;
const DEFAULT_RETRY_COUNT = 5;
const DEFAULT_MAX_CHUNK_SIZE = 4096;

export class TelegramNotifier implements INotifier {
  readonly #logger?: ILogger;
  readonly #alertsChannel: string;
  readonly #notificationsChannel?: string;
  readonly #botToken: string;
  readonly #prefix?: string;

  readonly #retryInterval: number;
  readonly #retryCount: number;
  readonly #maxChunkSize: number;
  readonly #fetchFn: typeof fetch;
  readonly #queue = new Queue({
    concurrency: 1,
    // https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
    // 20 messages/minute limit
    interval: 60_000,
    intervalCap: 20,
    strict: true,
  });
  readonly #throttleManager = new ThrottleManager();

  constructor(opts: TelegramNotifierOptions, logger?: ILogger) {
    this.#logger = logger;
    this.#alertsChannel = opts.alertsChannel.value;
    this.#botToken = opts.token.value;
    this.#notificationsChannel = opts.notificationsChannel?.value;
    this.#prefix = opts.prefix;
    this.#retryInterval = opts.retryInterval ?? DEFAULT_RETRY_INTERVAL;
    this.#retryCount = opts.retryCount ?? DEFAULT_RETRY_COUNT;
    this.#maxChunkSize = opts.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
    this.#fetchFn = opts.fetchFn ?? fetch;
  }

  public notify(
    message: IDedupableNotification,
    severity: NotificationSeverity,
  ): void {
    const dest =
      severity === "alert" ? this.#alertsChannel : this.#notificationsChannel;
    if (!dest) {
      return;
    }
    this.#enqueueTelegram(message, dest, severity === "alert");
  }

  async #enqueueTelegram(
    message: IDedupableNotification,
    channelId: string,
    severe = false,
  ): Promise<void> {
    if (!this.#throttleManager.canSend(message.dedupeKey)) {
      return;
    }

    const payloads = this.#toTelegramPayloads(message);
    for (const payload of payloads) {
      this.#queue.add(
        () =>
          this.#sendToTelegram(payload, channelId, severe).catch(e =>
            this.#logger?.error(e),
          ),
        {
          priority: severe ? 100 : 0,
          timeout: this.#retryInterval * this.#retryCount * 2,
        },
      );
    }

    this.#throttleManager.onSent(message.dedupeKey, message.throttleFn);
  }

  async #sendToTelegram(
    payload: TelegramPayload,
    channelId: string,
    severe = false,
  ): Promise<void> {
    const severity = severe ? "alert" : "notification";
    this.#logger?.debug(
      `sending telegram ${severity} to channel ${channelId}...`,
    );
    const url = `https://api.telegram.org/bot${this.#botToken}/sendMessage`;

    try {
      await withRetry(
        async () => {
          const resp = await this.#fetchFn(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...payload,
              chat_id: channelId,
            }),
          });
          if (resp.ok) {
            this.#logger?.debug(`telegram ${severity} sent successfully`);
          } else {
            const txt = await resp.text();
            throw new Error(`api error ${resp.status}: ${txt}`);
          }
        },
        { delay: this.#retryInterval, retryCount: this.#retryCount },
      );
    } catch (e) {
      this.#logger?.error(`cannot send telegram ${severity}: ${e}`);
    }
  }

  #toTelegramPayloads(message: IDedupableNotification): TelegramPayload[] {
    const { md: mdMessage, plain } = message;
    if (!mdMessage) {
      return this.#slicePlainText(plain);
    }
    let text = mdMessage;
    if (this.#prefix) {
      text = md.join([md.bold(this.#prefix), text], " ");
    }
    const mdText = text.toString();
    if (mdText.length > this.#maxChunkSize) {
      return this.#slicePlainText(plain);
    }
    return [{ text: mdText, parse_mode: "MarkdownV2" }];
  }

  /**
   * Telegram has a limit on message size (default 4096 characters).
   * This function slices the text into chunks respecting the limit.
   * Each chunk is prefixed with the prefix (if set), ensuring the total length <= maxChunkSize.
   * @param text - The text to slice.
   * @returns An array of texts.
   */
  #slicePlainText(text: string): TelegramPayload[] {
    const chunks = [];
    const prefix = this.#prefix ? `${this.#prefix} ` : "";
    const maxChunkSize = this.#maxChunkSize - prefix.length;

    for (let i = 0; i < text.length; i += maxChunkSize) {
      const chunkText = text.slice(i, i + maxChunkSize);
      chunks.push({ text: `${prefix}${chunkText}` });
    }
    return chunks;
  }
}
