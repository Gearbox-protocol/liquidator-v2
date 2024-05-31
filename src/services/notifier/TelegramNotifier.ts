import type { AxiosInstance } from "axios";
import axios, { isAxiosError } from "axios";
import axiosRetry from "axios-retry";
import { Inject, Service } from "typedi";

import { CONFIG, Config } from "../../config";
import { Logger, LoggerInterface } from "../../log";
import type { INotifier, INotifierMessage } from "./types";

@Service()
export default class TelegramNotifier implements INotifier {
  @Logger("TelegramNotifier")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: Config;

  #messageOptions: Record<string, string> = { parse_mode: "MarkdownV2" };
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
    console.log(`sending telegram ${severity} to channel ${channelId}...`);
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
          { status: e.status, data: e.response?.data },
          `cannot send telegram ${severity}`,
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
        retryDelay: () => 5000,
        validateResponse: response => {
          this.log.debug(
            { state: response.status, data: response.data },
            "telegram bot error",
          );
          return (
            response.status >= 200 && response.status < 300 && response.data.ok
          );
        },
      });
    }
    return this.#client;
  }
}
