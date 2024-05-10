import type { AxiosInstance } from "axios";
import axios, { isAxiosError } from "axios";
import axiosRetry from "axios-retry";
import { Inject, Service } from "typedi";

import { CONFIG, ConfigSchema } from "../../config";
import { Logger, LoggerInterface } from "../../log";
import type { INotifier } from "./types";

@Service()
export default class TelegramNotifier implements INotifier {
  @Logger("TelegramNotifier")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: ConfigSchema;

  #messageOptions: Record<string, string>;
  #client?: AxiosInstance;

  constructor(markdown?: boolean) {
    this.#messageOptions = markdown ? { parse_mode: "MarkdownV2" } : {};
  }

  public alert(message: string): void {
    this.#sendToTelegram(
      message,
      this.config.telegramAlersChannel!,
      "alert",
    ).catch(console.error);
  }

  public notify(message: string): void {
    this.#sendToTelegram(
      message,
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
      axiosRetry(this.#client);
    }
    return this.#client;
  }
}
