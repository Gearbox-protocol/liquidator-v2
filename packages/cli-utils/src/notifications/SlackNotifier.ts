import type { ILogger } from "@gearbox-protocol/sdk/onchain";
import type { SlackConfig } from "./schema.js";
import type {
  IDedupableNotification,
  INotifier,
  NotificationSeverity,
} from "./types.js";

// TODO: no throttling or deduplication yet
export class SlackNotifier implements INotifier {
  readonly #config: SlackConfig;
  readonly #logger?: ILogger;

  constructor(config: SlackConfig, logger?: ILogger) {
    this.#config = config;
    this.#logger = logger;
  }

  public notify(
    message: IDedupableNotification,
    severity: NotificationSeverity,
  ): void {
    if (this.#config.alertsOnly && severity === "notification") {
      return;
    }
    const emoji = severity === "alert" ? "🚨" : "ℹ️";
    const messageText = typeof message === "string" ? message : message.plain;

    void this.#sendToSlack(`${emoji} Alert: ${messageText}`);
  }

  async #sendToSlack(text: string): Promise<void> {
    try {
      this.#logger?.debug(`Sending message to Slack: ${text}`);

      // Use fetch instead of axios to avoid adding dependencies
      const response = await fetch(this.#config.webhookUrl.value, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      this.#logger?.debug("Slack message sent successfully");
    } catch (error) {
      this.#logger?.error("Error sending Slack message:", error);
      throw error;
    }
  }
}
