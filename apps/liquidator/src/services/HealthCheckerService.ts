import {
  type HealthPayload,
  type HealthStatusCode,
  type ILiquidatorHealthResponse,
  maxHealthStatusCode,
} from "@gearbox-protocol/cli-utils";
import { HealthServer } from "@gearbox-protocol/cli-utils/node";
import type { Config } from "@gearbox-protocol/liquidator-v2-config";
import type { RevolverTransportValue } from "@gearbox-protocol/sdk/dev";
import type { OnchainSDK } from "@gearbox-protocol/sdk/onchain";
import type { PublicClient, Transport } from "viem";
import { DI } from "../di.js";
import type { ILogger } from "../log/index.js";
import { Logger } from "../log/index.js";
import version from "../version.js";
import type Client from "./Client.js";
import type DeleverageService from "./DeleverageService.js";
import type { Scanner } from "./Scanner.js";

@DI.Injectable(DI.HealthChecker)
export default class HealthCheckerService {
  @Logger("HealthChecker")
  log!: ILogger;

  @DI.Inject(DI.Scanner)
  scanner!: Scanner;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Deleverage)
  deleverage!: DeleverageService;

  @DI.Inject(DI.Client)
  client!: Client;

  #server?: HealthServer<ILiquidatorHealthResponse>;

  /**
   * Launches health checker - simple web server
   */
  public launch(): void {
    if (this.config.optimistic) {
      return;
    }
    this.#server = new HealthServer<ILiquidatorHealthResponse>({
      port: this.config.port,
      version,
      labels: { network: this.config.network.toLowerCase() },
      logger: this.log,
      unref: true,
      status: () => this.#healthStatus,
      gauges: () => [
        {
          name: "block_number",
          help: "Latest processed block",
          samples: [{ value: this.scanner.lastUpdated }],
        },
      ],
    });
    this.#server.launch();
  }

  get #healthStatus(): HealthPayload<ILiquidatorHealthResponse> {
    const timestamp = Number(this.sdk.timestamp);
    const now = Math.ceil(Date.now() / 1000);
    const threshold = this.config.staleBlockThreshold;
    const timestampStatus: HealthStatusCode =
      threshold && now - timestamp <= threshold ? "healthy" : "alert";
    const liquidatableStatus: HealthStatusCode =
      this.scanner.liquidatableAccounts > 0 ? "alert" : "healthy";
    const balance = this.client.balance;
    const deleverage = this.deleverage.status;
    return {
      status: maxHealthStatusCode(
        timestampStatus,
        balance?.status,
        liquidatableStatus,
        deleverage?.status,
      ),
      network: this.config.network,
      family: "liquidators",
      liquidationMode: this.config.liquidationMode,
      address: this.client.address,
      balance,
      currentBlock: this.sdk.currentBlock,
      minHealthFactor: this.scanner.minHealthFactor,
      maxHealthFactor: this.scanner.maxHealthFactor,
      timestamp: {
        value: timestamp,
        status: timestampStatus,
      },
      marketsConfigurators: this.sdk.marketRegister.marketConfigurators.map(
        mc => mc.address,
      ),
      pools: this.sdk.marketRegister.pools.map(p => p.pool.address),
      creditManagers: this.sdk.marketRegister.creditManagers.map(
        cm => cm.creditManager.address,
      ),
      liquidatableAccounts: {
        value: this.scanner.liquidatableAccounts,
        status: liquidatableStatus,
      },
      deleverage,
      providers: (
        this.sdk.client as unknown as PublicClient<
          Transport<"revolver", RevolverTransportValue>
        >
      ).transport.statuses(),
    };
  }

  public async stop(): Promise<void> {
    await this.#server?.stop();
  }
}
