import type { ILogger } from "@gearbox-protocol/sdk/onchain";
import { prettifyError } from "zod";
import { SlackNotifier } from "./SlackNotifier.js";
import { NotificationConfig } from "./schema.js";
import { TelegramNotifier } from "./TelegramNotifier.js";
import type { INotifier } from "./types.js";

export function createNotifier(
  config: NotificationConfig,
  logger?: ILogger,
): INotifier | undefined {
  const parsed = NotificationConfig.safeParse(config);
  if (!parsed.success) {
    console.log(">>>>", parsed.error);
    logger?.warn(`invalid notification config: ${prettifyError(parsed.error)}`);
    return undefined;
  }

  switch (parsed.data.type) {
    case "telegram":
      return new TelegramNotifier(parsed.data, logger);
    case "slack":
      return new SlackNotifier(parsed.data, logger);
  }
}
