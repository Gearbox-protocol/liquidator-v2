import Container, { Service } from "typedi";

import type { ConfigSchema } from "../../config";
import { CONFIG } from "../../config";
import { NOTIFIER } from "./constants";
import NoopNotifier from "./NoopNotifier";
import TelegramNotifier from "./TelegramNotifier";
import type { INotifier } from "./types";

function createNotifier(): INotifier {
  const cfg = Container.get(CONFIG) as ConfigSchema;
  if (
    cfg.telegramBotToken &&
    cfg.telegramAlersChannel &&
    cfg.telegramNotificationsChannel
  ) {
    return Container.get(TelegramNotifier);
  }
  return new NoopNotifier();
}

@Service({ factory: createNotifier, id: NOTIFIER })
export class Notifier implements INotifier {
  alert: (message: string) => void;
  notify: (message: string) => void;
}
