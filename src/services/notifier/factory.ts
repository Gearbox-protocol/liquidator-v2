import Container, { Service } from "typedi";

import type { Config } from "../../config";
import { CONFIG } from "../../config";
import { NOTIFIER } from "./constants";
import NoopNotifier from "./NoopNotifier";
import TelegramNotifier from "./TelegramNotifier";
import type { INotifier, INotifierMessage } from "./types";

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
