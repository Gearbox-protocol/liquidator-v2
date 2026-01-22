import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import type { NetworkType } from "@gearbox-protocol/sdk";
import { md } from "@vlad-yakovlev/telegram-md";
import type { Address, BaseError } from "viem";
import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";

export class ProviderRotationErrorNotification implements INotification {
  readonly #oldT: string;
  readonly #network: NetworkType;
  readonly #reason: string;

  constructor(oldT: string, reason?: BaseError) {
    const cfg = DI.get(DI.Config) as Config;
    this.#network = cfg.network;
    this.#oldT = oldT;
    this.#reason = reason ? `: ${reason.shortMessage} ${reason.details}` : "";
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (recipient) {
      return undefined;
    }
    return {
      dedupeKey: "provider-rotation-error",
      plain: `[${this.#network}] failed to rotate rpc provider from ${this.#oldT}${this.#reason}`,
      md: md`[${this.#network}] failed to rotate rpc provider from ${md.bold(this.#oldT)}${this.#reason}`,
    };
  }
}
