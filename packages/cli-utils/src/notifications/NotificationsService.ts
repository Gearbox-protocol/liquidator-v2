import {
  ADDRESS_0X0,
  AddressMap,
  type ILogger,
} from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";
import { createNotifier } from "./createNotifier.js";
import SignlNotifier, { type SignlServiceOptions } from "./SignlNotifier.js";
import type { NotificationConfig } from "./schema.js";
import type {
  IDedupableNotification,
  INotification,
  INotificationService,
  INotifier,
  NotificationLike,
  NotificationSeverity,
} from "./types.js";

export interface NotificationsServiceOptions {
  notifications: Array<NotificationConfig & { recipient?: Address }>;
  signl?: SignlServiceOptions;
}

export class NotificationsService implements INotificationService {
  readonly #logger?: ILogger;
  readonly #notifiers = new AddressMap<INotifier>();
  readonly #signlNotifier?: SignlNotifier;

  constructor(options: NotificationsServiceOptions, logger?: ILogger) {
    this.#logger = logger;
    for (const n of options.notifications) {
      const recipient = n.recipient ?? ADDRESS_0X0;
      const notifier = createNotifier(n, logger);
      if (notifier) {
        this.#notifiers.upsert(recipient, notifier);
      }
    }

    if (options.signl) {
      this.#signlNotifier = new SignlNotifier(options.signl);
    } else {
      this.#logger?.warn("signl notifier not configured");
    }
  }

  public registerRecipient(
    address: Address,
    options: NotificationConfig,
  ): void {
    const notifier = createNotifier(options, this.#logger);
    if (notifier) {
      this.#notifiers.upsert(address, notifier);
    }
  }

  public signl(message: string, dedupeKey?: string): void {
    this.#signlNotifier?.alert(message, dedupeKey);
  }

  public alert(msg: NotificationLike): void {
    this.#notify(msg, "alert");
  }

  public notify(msg: NotificationLike): void {
    this.#notify(msg, "notification");
  }

  #notify(msg: NotificationLike, severity: NotificationSeverity): void {
    const message = this.#toNotification(msg);
    for (const [addr, notifier] of this.#notifiers.entries()) {
      const recipient = addr === ADDRESS_0X0 ? undefined : addr;
      const recipientNotification = message.messageFor(recipient);
      if (recipientNotification) {
        const notification = this.#toDedupableNotification(
          recipientNotification,
        );
        notifier.notify(notification, severity);
        // log global notifications
        if (addr === ADDRESS_0X0) {
          if (severity === "alert") {
            this.#logger?.warn(notification.plain);
          } else {
            this.#logger?.debug(notification.plain);
          }
        }
      }
    }
  }

  #toNotification(message: NotificationLike): INotification {
    // global notification without deduplication
    if (typeof message === "string" || !("messageFor" in message)) {
      return {
        messageFor: (recipient?: Address) => (recipient ? undefined : message),
      };
    }
    return message;
  }

  #toDedupableNotification(
    msg: string | IDedupableNotification,
  ): IDedupableNotification {
    if (typeof msg === "string") {
      return {
        plain: msg,
      };
    }
    return msg;
  }
}
