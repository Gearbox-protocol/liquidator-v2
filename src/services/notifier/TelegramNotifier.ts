import type { AxiosInstance } from "axios";
import axios, { isAxiosError } from "axios";
import axiosRetry, { isNetworkError, isRetryableError } from "axios-retry";

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

  public alert(message: INotifierMessage): void {
    this.#sendToTelegram(
      message.markdown,
      this.config.telegramAlersChannel!,
      "alert",
    ).catch(console.error);
  }

  public notify(message: INotifierMessage): void {
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
          { status: e.status, data: e.response?.data, code: e.code },
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
        baseURL: `https://api.telegram.org/bot${this.config.telegramBotToken!}/sendMessage`,
        headers: {
          "Content-Type": "application/json",
        },
      });
      axiosRetry(this.#client, {
        retries: 5,
        retryDelay: cnt => 5000 + cnt * 500,
        retryCondition: e => {
          this.log.error(
            {
              data: e.response?.data,
              code: e.code,
              status: e.status,
              condition: isNetworkError(e) || isRetryableError(e),
            },
            `axios retry: ${e.message}`,
          );
          return isNetworkError(e) || isRetryableError(e);
        },
      });
    }
    return this.#client;
  }
}
