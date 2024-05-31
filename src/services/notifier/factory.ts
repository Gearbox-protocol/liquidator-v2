import { Container, Service } from "typedi";

import type { Config } from "../../config/index.js";
import { CONFIG } from "../../config/index.js";
import { NOTIFIER } from "./constants.js";
import NoopNotifier from "./NoopNotifier.js";
import TelegramNotifier from "./TelegramNotifier.js";
import type { INotifier, INotifierMessage } from "./types.js";

function createNotifier(): INotifier {
  const cfg = Container.get(CONFIG) as Config;
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
  alert: (message: INotifierMessage) => void;
  notify: (message: INotifierMessage) => void;
}
