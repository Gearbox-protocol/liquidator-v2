import {
  createRevolverTransport,
  getProviders,
  type INotificationService,
} from "@gearbox-protocol/cli-utils";
import type { ILogger } from "@gearbox-protocol/sdk";
import {
  logSplitterTransport,
  RevolverTransport,
  resilientTransport,
} from "@gearbox-protocol/sdk/dev";
import { http, type Transport } from "viem";
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
  const providers = getProviders(config);

  let transports = providers.map(
    ({ url, name, httpTransportOptions }): Transport =>
      http(url, {
        timeout: config.optimistic ? 240_000 : 10_000,
        retryCount: config.optimistic ? 3 : undefined,
        ...httpTransportOptions,
        key: name,
        name: name,
      }),
  );

  transports = transports.map(t => resilientTransport(t));

  transports = transports.map(t => logSplitterTransport(t));

  return RevolverTransport.create({
    transports,
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
