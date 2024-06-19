import type { IFactory } from "di-at-home";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import NoopNotifier from "./NoopNotifier.js";
import TelegramNotifier from "./TelegramNotifier.js";
import type { INotifier } from "./types.js";

@DI.Factory(DI.Notifier)
export class NotifierFactory implements IFactory<INotifier, []> {
  @DI.Inject(DI.Config)
  config!: Config;

  produce(): INotifier {
    if (
      this.config.telegramBotToken &&
      this.config.telegramAlersChannel &&
      this.config.telegramNotificationsChannel
    ) {
      return new TelegramNotifier();
    }
    return new NoopNotifier();
  }
}
