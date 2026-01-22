import {
  type INotificationService,
  NotificationsService,
  type NotificationsServiceOptions,
} from "@gearbox-protocol/cli-utils";
import { findCuratorMarketConfigurator } from "@gearbox-protocol/sdk";
import type { IFactory } from "di-at-home";
import type { Address } from "viem";
import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import { type ILogger, Logger } from "../../log/index.js";

@DI.Factory(DI.Notifier)
export class NotifierFactory implements IFactory<INotificationService, []> {
  @Logger("Notifier")
  logger!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  public produce(): INotificationService {
    const { network } = this.config;
    const notifications: NotificationsServiceOptions["notifications"] = [];

    for (const n of this.config.notifications) {
      let recipient: Address | undefined;
      if (n.curator) {
        recipient = findCuratorMarketConfigurator(n.curator, network);
        if (!recipient) {
          this.logger.warn(
            `market configurator for ${n.curator} in ${network} not found`,
          );
          continue;
        }
      }
      notifications.push({
        ...n,
        recipient,
      });
    }
    return new NotificationsService(
      {
        notifications,
      },
      this.logger,
    );
  }
}
