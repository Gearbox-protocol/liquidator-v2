import {
  type CreditAccountData,
  type GearboxSDK,
  type ICreditAccountsService,
  isVersionRange,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import { iBotListV310Abi } from "@gearbox-protocol/sdk/abi/310/generated";
import type {
  BotsPlugin,
  PartialLiquidationBotV310Contract,
  BotParameters as TBotParameters,
} from "@gearbox-protocol/sdk/plugins/bots";
import type { Address } from "viem";
import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import { DELEVERAGE_PERMISSIONS } from "../utils/permissions.js";
import type { StatusCode } from "../utils/status.js";
import type Client from "./Client.js";

export interface BotParameters extends TBotParameters {
  address: Address;
}

export interface DeleverageBotStatus {
  address: Address;
  status: StatusCode;
  minHealthFactor: number;
  maxHealthFactor: number;
}

export interface DeleverageStatus {
  status: StatusCode;
  bots: DeleverageBotStatus[];
}

@DI.Injectable(DI.Deleverage)
export default class DeleverageService {
  @Logger("DeleverageService")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.CreditAccountService)
  caService!: ICreditAccountsService;

  @DI.Inject(DI.Client)
  client!: Client;

  public get bots(): PartialLiquidationBotV310Contract[] {
    return this.sdk.plugins.bots.bots;
  }

  public get bot(): PartialLiquidationBotV310Contract {
    // TODO: support multiple bots
    return this.bots[0];
  }

  public async filterDeleverageAccounts(
    accounts_: CreditAccountData[],
    blockNumber?: bigint,
  ): Promise<CreditAccountData[]> {
    if (this.config.optimistic) {
      return accounts_;
    }

    const accounts = accounts_.filter(ca => {
      const cm = this.caService.sdk.marketRegister.findCreditManager(
        ca.creditManager,
      );
      return isVersionRange(cm.creditFacade.version, VERSION_RANGE_310);
    });

    const res = await this.client.pub.multicall({
      contracts: accounts.map(ca => {
        const cm = this.caService.sdk.marketRegister.findCreditManager(
          ca.creditManager,
        );
        return {
          address: cm.creditFacade.botList,
          abi: iBotListV310Abi,
          functionName: "getBotStatus",
          args: [this.bot.address, ca.creditAccount],
        } as const;
      }),
      allowFailure: true,
      blockNumber,
    });
    const result: CreditAccountData[] = [];
    let errored = 0;
    for (let i = 0; i < accounts.length; i++) {
      const ca = accounts[i];
      const r = res[i];
      if (r.status === "success") {
        const [permissions, forbidden] = r.result;
        if (
          !!permissions &&
          !forbidden &&
          (permissions & DELEVERAGE_PERMISSIONS) === DELEVERAGE_PERMISSIONS
        ) {
          result.push(ca);
        }
      } else if (r.status === "failure") {
        errored++;
      }
    }
    this.log.debug(
      { errored, before: accounts_.length, after: result.length },
      "filtered accounts for deleverage",
    );
    return result;
  }

  private get sdk(): GearboxSDK<{ bots: BotsPlugin }> {
    return this.caService.sdk as GearboxSDK<{ bots: BotsPlugin }>;
  }

  public get status(): DeleverageStatus | undefined {
    if (this.config.liquidationMode !== "deleverage") {
      return undefined;
    }
    return {
      status: this.bots.length === 1 ? "healthy" : "alert",
      bots: this.bots.map(b => ({
        address: b.address,
        status: "healthy",
        minHealthFactor: b.minHealthFactor,
        maxHealthFactor: b.maxHealthFactor,
      })),
    };
  }
}
