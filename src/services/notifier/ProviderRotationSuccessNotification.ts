import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import type { NetworkType } from "@gearbox-protocol/sdk";
import { md } from "@vlad-yakovlev/telegram-md";
import type { Address, BaseError } from "viem";
import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";

export class ProviderRotationSuccessNotification implements INotification {
  readonly #oldT: string;
  readonly #newT: string;
  readonly #reason: string;
  readonly #network: NetworkType;

  constructor(oldT: string, newT: string, reason?: BaseError) {
    const cfg = DI.get(DI.Config) as Config;
    this.#network = cfg.network;
    this.#oldT = oldT;
    this.#newT = newT;
    this.#reason = reason ? `: ${reason.shortMessage} ${reason.details}` : "";
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (recipient) {
      return undefined;
    }

    return {
      dedupeKey: "provider-rotation-success",
      plain: `[${this.#network}] rotated rpc provider from ${this.#oldT} to ${this.#newT}${this.#reason}`,
      md: md`[${this.#network}] rotated rpc provider from ${md.bold(this.#oldT)} to ${md.bold(this.#newT)}${this.#reason}`,
    };
  }
}
