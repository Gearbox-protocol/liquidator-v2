import {
  createRevolverTransport,
  type INotificationService,
} from "@gearbox-protocol/cli-utils";
import type { ILogger } from "@gearbox-protocol/sdk";
import type { Transport } from "viem";
import type { CommonSchema } from "../config/common.js";
import {
  ProviderRotationErrorNotification,
  ProviderRotationSuccessNotification,
} from "../services/notifier/index.js";

export function createTransport(
  config: CommonSchema,
  logger: ILogger,
  notifier: INotificationService,
): Transport {
  return createRevolverTransport(config, {
    defaultHTTPOptions: {
      timeout: config.optimistic ? 240_000 : 10_000,
      retryCount: config.optimistic ? 3 : undefined,
    },
    logger: logger?.child?.({ name: "transport" }),
    onRotateSuccess: (oldT, newT, reason) => {
      notifier.notify(
        new ProviderRotationSuccessNotification(oldT, newT, reason),
      );
    },
    onRotateFailed: (oldT, reason) => {
      notifier.alert(new ProviderRotationErrorNotification(oldT, reason));
    },
    selectionStrategy: "ordered",
  });
}
