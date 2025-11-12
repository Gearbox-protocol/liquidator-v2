import type { AxiosInstance } from "axios";
import axios, { isAxiosError } from "axios";
import axiosRetry, {
  exponentialDelay,
  isNetworkError,
  isRetryableError,
} from "axios-retry";
import { ObliviousSet } from "oblivious-set";
import { Address } from "viem";
import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import type { INotifier, INotifierMessage } from "./types.js";

export default class TelegramNotifier implements INotifier {
  @Logger("TelegramNotifier")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  #messageOptions: Record<string, any> = {
    parse_mode: "MarkdownV2",
    link_preview_options: { is_disabled: true },
  };
  #client?: AxiosInstance;
  #cooldowns: ObliviousSet<string>;

  constructor() {
    this.#cooldowns = new ObliviousSet(
      this.config.notificationCooldown * 1000 * 60,
    );
  }

  public setCooldown(key: string): void {
    this.#cooldowns.add(key);
  }

  public alert(message: INotifierMessage): void {
    if (message.key && this.#cooldowns.has(message.key)) {
      return;
    }
    this.#sendToTelegram(
      message.markdown,
      this.config.telegramAlertsChannel!,
      "alert",
    ).catch(console.error);
  }

  public notify(message: INotifierMessage): void {
    if (message.key && this.#cooldowns.has(message.key)) {
      return;
    }
    this.#sendToTelegram(
      message.markdown,
      this.config.telegramNotificationsChannel!,
    ).catch(console.error);
  }

  async #sendToTelegram(
    text: string,
    channelId: string,
    severity = "notification",
  ): Promise<void> {
    this.log.debug(`sending telegram ${severity} to channel ${channelId}...`);
    try {
      await this.client.post("", {
        ...this.#messageOptions,
        chat_id: channelId,
        text,
      });
      this.log.info(`telegram ${severity} sent successfully`);
    } catch (e) {
      if (isAxiosError(e)) {
        this.log.error(
          {
            status: e.response?.status,
            data: e.response?.data,
            code: e.code,
          },
          `cannot send telegram ${severity}: ${e.message}`,
        );
      } else {
        this.log.error(`cannot send telegram ${severity}: ${e}`);
      }
    }
  }

  private get client(): AxiosInstance {
    if (!this.#client) {
      this.#client = axios.create({
        baseURL: `https://api.telegram.org/bot${this.config.telegramBotToken?.value}/sendMessage`,
        headers: {
          "Content-Type": "application/json",
        },
      });
      axiosRetry(this.#client, {
        retries: 10,
        retryDelay: exponentialDelay,
        retryCondition: e => {
          return (
            isNetworkError(e) ||
            isRetryableError(e) ||
            (e.response?.data as any)?.error_code === 429
          );
        },
      });
    }
    return this.#client;
  }
}
