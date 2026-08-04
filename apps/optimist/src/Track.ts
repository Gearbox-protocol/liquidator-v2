import { readFile } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { OptimisticResult } from "@gearbox-protocol/liquidator-v2-config";
import {
  AddressSet,
  json_parse,
  TypedObjectUtils,
} from "@gearbox-protocol/sdk";
import { iAliasedLossPolicyV310Abi } from "@gearbox-protocol/sdk/abi/310/generated";
import { iDegenNFTV2Abi } from "@gearbox-protocol/sdk/abi/iDegenNFTV2";
import type { AnvilClient } from "@gearbox-protocol/sdk/dev";
import {
  createAnvilClient,
  createMinter,
  registerRWAInvestor,
  setLTs,
  setLTZero,
} from "@gearbox-protocol/sdk/dev";
import type { Logger as ILogger } from "pino";
import type { Address } from "viem";
import {
  encodeAbiParameters,
  encodePacked,
  http,
  isAddress,
  keccak256,
  pad,
  parseEther,
  parseUnits,
} from "viem";
import type { Config, KycConfig, LiquidatorConfig } from "./config";
import DI from "./di";
import type { ContainerManager } from "./docker";
import type { ContainerInfo } from "./docker/types";
import { Logger } from "./logger";
import type { ITrack, OptimisticFile, TrackResult, TypedSDK } from "./types";
import { formatTs, getChain } from "./utils";

export type TrackOptions = LiquidatorConfig & {
  optimisticTimestamp: number;
};

/**
 * Amount of each underlying dealt to liquidator addresses, in whole tokens.
 * Deliberately way above any account debt, so that strategies spending the
 * liquidator's own funds never run out and no per-account math is needed
 */
const UNDERLYING_FUND_AMOUNT = "1000000000";

export default class Track implements ITrack {
  @DI.Inject(DI.Config)
  public readonly config!: Config;

  @DI.Inject(DI.Docker)
  public readonly docker!: ContainerManager;

  @DI.Inject(DI.SDK)
  public readonly sdk!: TypedSDK;

  @Logger("Track")
  public readonly logger!: ILogger;

  readonly #options: TrackOptions;

  #anvil?: AnvilClient;
  #status = "started";

  constructor(opts: TrackOptions) {
    this.#options = opts;
    this.logger = this.logger.child({ track: opts.id });
  }

  public async run(blockNumber: bigint): Promise<TrackResult> {
    if (this.#options.delay) {
      this.logger.info(`delaying start by ${this.#options.delay} minutes`);
      await setTimeout(this.#options.delay * 60_000);
    }
    let anvilContainer: ContainerInfo | undefined;
    let liquidatorContainer: ContainerInfo | undefined;
    const startedAt = new Date();
    try {
      this.logger?.debug({ startedAt }, "starting track");
      anvilContainer = await this.docker.anvil({
        blockNumber,
        forkURL: this.#options.rpc?.value ?? this.config.originRPC.value,
        image: this.config.anvilImage,
        trackId: this.#options.id,
        disableRateLimit:
          this.#options.disableRateLimit ?? this.config.disableRateLimit,
        anvilMemoryLimit: this.#options.anvilMemoryLimit,
      });

      const url = this.docker.getAnvilURL(this.#options.id);
      this.logger.debug(`track will connect to anvil at ${url}`);
      const chain = await getChain(url, this.config.network);
      this.#anvil = createAnvilClient({
        chain,
        transport: http(url, { timeout: 240_000 }),
      });

      const startBlock = await this.anvil.getBlock({
        blockTag: "latest",
      });
      const startBlockNumber = startBlock.number;
      this.logger?.debug(
        {
          container: anvilContainer.id,
          blockNumber,
          startBlockNumber,
          startBlockTimestamp: formatTs(startBlock),
          tag: "timing",
        },
        "started anvil",
      );
      await this.anvil.setBlockTimestampInterval({ interval: 0 });

      await this.#setup();
      const endBlockNumber = await this.anvil.getBlockNumber();
      const endBlock = await this.anvil.getBlock({
        blockNumber: endBlockNumber,
      });
      this.logger?.debug(
        {
          endBlockNumber,
          endBlockTimestamp: formatTs(endBlock),
          blockDelta: endBlockNumber - startBlockNumber,
          timestampDelta:
            (endBlock?.timestamp ?? 0) - (startBlock?.timestamp ?? 0),
          tag: "timing",
        },
        "setup complete",
      );
      liquidatorContainer = await this.#runLiquidator();
      const results = await this.#readResults();
      this.#status = "finished";
      return {
        id: this.#options.id,
        name: this.#options.name,
        start: startedAt,
        version: liquidatorContainer.imageVersion,
        end: new Date(),
        results: results.map(r => ({ ...r, trackId: this.#options.id })),
      };
    } catch (e) {
      this.#status = "failed";
      this.logger?.error(e);
      return {
        id: this.#options.id,
        name: this.#options.name,
        version: "",
        error: `${e}`,
        results: [],
        start: startedAt,
        end: new Date(),
      };
    } finally {
      await this.docker.stop(
        [anvilContainer?.id, liquidatorContainer?.id].filter(
          Boolean,
        ) as string[],
      );
    }
  }

  async #runLiquidator(): Promise<ContainerInfo> {
    const container = await this.docker.liquidator({
      ...this.#options,
      env: {
        ...this.#options.env,
        // make sure that all liquidators use the same timestamp
        OPTIMISTIC_TIMESTAMP: this.#options.optimisticTimestamp.toString(),
      },
    });
    this.logger?.debug(
      { container: container.id, version: container.imageVersion },
      "started liquidator container",
    );
    const { exitCode, error } = await this.docker.wait(container.id);
    if (exitCode) {
      this.logger?.error(`liquidator exited with error ${exitCode}: ${error}`);
    } else {
      this.logger.info("liquidator finished successfully");
    }
    return container;
  }

  /**
   * Set UP conditions for liquidations of (some) credit accounts
   * @returns
   */
  async #setup(): Promise<void> {
    const opts = this.#options.setup;

    if (opts.topUp) {
      await this.#topUpBalance();
    }

    for (const m of this.sdk.marketRegister.markets) {
      for (const cm of m.creditManagers) {
        if (cm.isExpired) {
          this.logger.debug(
            `skipping ${cm.name} (${cm.creditManager.address}) because it is expired`,
          );
          continue;
        }
        const borrowed =
          m.pool.pool.creditManagerDebtParams.get(cm.creditManager.address)
            ?.borrowed ?? 0n;
        if (borrowed === 0n) {
          this.logger.debug(
            `skipping ${cm.name} (${cm.creditManager.address}) because it has no borrowed`,
          );
          continue;
        }
        if (opts.zeroLT) {
          await setLTZero(this.anvil, cm.state, this.logger);
        } else if (opts.lts) {
          await setLTs(this.anvil, cm.state, opts.lts);
        }
      }
    }

    if (opts.emergencyMode) {
      await this.#initEmergencyMode();
    } else {
      this.logger.debug("skipping emergency mode");
    }

    if (opts.mintDegenNFT) {
      const { degenNFT, recipients } = opts.mintDegenNFT;
      for (const recipient of recipients) {
        await this.#mintDegenNft(degenNFT, recipient);
      }
    }

    if (opts.kyc) {
      await this.#passKYC(opts.kyc);
    }

    if (opts.fundUnderlying) {
      await this.#fundUnderlying();
    }

    if (opts.hackLossPolicy) {
      await this.#hackLossPolicy();
    }
  }

  async #initEmergencyMode(): Promise<void> {
    // TODO: need to update MarketCompressor
    // this.logger.debug("initiating emergency mode");
    // const [acl, multipauseAddr] = await Promise.all([
    //   this.addressProvider.getACL(),
    //   this.addressProvider.getService("MULTI_PAUSE", 0),
    // ]);
    // const configuratorAddr = await acl.read.owner();
    // await impersonate(this.anvil, configuratorAddr);
    // const hash = await this.anvil.writeContract({
    //   address: multipauseAddr,
    //   account: configuratorAddr,
    //   abi: iMultiPauseAbi,
    //   functionName: "pauseAllCreditManagers",
    //   args: [],
    // });
    // await this.anvil.waitForTransactionReceipt({ hash });
    // this.logger.info({ tx: hash }, `paused all credit managers`);
    // await stopImpersonate(this.anvil, configuratorAddr);
  }

  /**
   * Addresses the liquidator of this track can send transactions from:
   * configured instances plus the sender used in optimistic mode
   */
  #liquidatorAddresses(): Address[] {
    const addresses = [...TypedObjectUtils.keys(this.#options.addresses)];
    const liquidatorAddress = this.#options.env.LIQUIDATOR_ADDRESS;
    if (liquidatorAddress && isAddress(liquidatorAddress)) {
      addresses.push(liquidatorAddress);
    }
    return addresses;
  }

  async #topUpBalance(): Promise<void> {
    for (const w of this.#liquidatorAddresses()) {
      try {
        await this.anvil.setBalance({
          address: w,
          value: parseEther("1000000"),
        });
        this.logger?.debug(`set high balance for liquidator ${w}`);
      } catch (e) {
        this.logger?.error(`failed to set balance for ${w}: ${e}`);
      }
    }
  }

  /**
   * Passes the KYC of every RWA token and midas gateway, so that liquidators
   * are eligible to receive RWA collateral
   */
  async #passKYC(kyc: KycConfig): Promise<void> {
    const { securitizeAdmin, midasAdmin } = kyc;
    for (const investor of this.#liquidatorAddresses()) {
      const { securitizeTokens, midasGateways, failed } =
        await registerRWAInvestor({
          anvil: this.anvil,
          sdk: this.sdk,
          investor,
          securitizeAdmin,
          midasAdmin,
          logger: this.logger,
        });
      for (const { target, error } of failed) {
        this.logger.warn(`failed to pass kyc of ${target}: ${error}`);
      }
      this.logger.debug(
        `${investor} passed kyc of ${securitizeTokens.length} ds token(s) and ${midasGateways.length} midas gateway(s)`,
      );
    }
  }

  /**
   * Deals underlyings of all active markets to liquidator addresses.
   * For RWA markets, the unwrapped underlying (e.g. USDC behind dcUSDC) is dealt as well
   */
  async #fundUnderlying(): Promise<void> {
    const underlyings = new AddressSet();
    for (const cm of this.sdk.marketRegister.creditManagers) {
      if (cm.isExpired) {
        continue;
      }
      underlyings.add(cm.underlying);
      const meta = this.sdk.tokensMeta.get(cm.underlying);
      if (meta && this.sdk.tokensMeta.isRWAUnderlying(meta)) {
        underlyings.add(meta.asset);
      }
    }
    const addresses = this.#liquidatorAddresses();
    for (const token of underlyings) {
      const minter = createMinter(this.sdk, this.anvil, token);
      const amount = parseUnits(
        UNDERLYING_FUND_AMOUNT,
        this.sdk.tokensMeta.decimals(token),
      );
      for (const address of addresses) {
        // tryMint does not throw, it returns the balance after the attempt
        const balance = await minter.tryMint(token, address, amount);
        this.logger.debug(
          `${address} has ${this.sdk.tokensMeta.formatBN(token, balance, { symbol: true })}`,
        );
      }
    }
  }

  async #mintDegenNft(degenNFT: Address, recipient: Address): Promise<void> {
    const minter = await this.anvil.readContract({
      address: degenNFT,
      abi: iDegenNFTV2Abi,
      functionName: "minter",
    });
    await this.anvil.impersonateAccount({ address: minter });
    const hash = await this.anvil.writeContract({
      chain: this.anvil.chain,
      account: minter,
      address: degenNFT,
      abi: iDegenNFTV2Abi,
      functionName: "mint",
      args: [recipient, 10n],
    });
    await this.anvil.waitForTransactionReceipt({ hash });
    this.logger.debug(`minted degen nft to borrower ${recipient}, tx: ${hash}`);
    await this.anvil.stopImpersonatingAccount({ address: minter });
  }

  /**
   * Hack loss policy to test that it will revert with CreditAccountNotLiquidatableWithLossException
   */
  async #hackLossPolicy(): Promise<void> {
    const LOSS_POLICY: Address = "0x1848231C5DD4c5076d32C9707039Ab2c71453817";
    const weETH: Address = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee";
    const BTC_PRICE_FEED: Address =
      "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";

    const before = await this.anvil.readContract({
      address: LOSS_POLICY,
      abi: iAliasedLossPolicyV310Abi,
      functionName: "getAliasPriceFeedParams",
      args: [weETH],
    });

    const storageSlot = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [weETH, 3n],
      ),
    );

    const encodedStruct = encodePacked(
      ["uint8", "bool", "uint32", "address"],
      [18, false, 4500, BTC_PRICE_FEED],
    );

    // Pad to 32 bytes (equivalent to: cast pad)
    const paddedValue = pad(encodedStruct, { size: 32 });

    await this.anvil.setStorageAt({
      address: LOSS_POLICY,
      index: storageSlot,
      value: paddedValue,
    });

    const after = await this.anvil.readContract({
      address: LOSS_POLICY,
      abi: iAliasedLossPolicyV310Abi,
      functionName: "getAliasPriceFeedParams",
      args: [weETH],
    });
    this.logger.debug(
      { before, after },
      "getAliasPriceFeedParams before and after loss policy hack",
    );
  }

  async #readResults(): Promise<OptimisticResult[]> {
    const file = `${this.#options.id}.json`;
    try {
      const resp = await readFile(
        pathResolve(this.config.containerOutDir, file),
        "utf8",
      );
      const data: OptimisticFile = json_parse(resp);
      this.logger?.debug(`results from ${file}: ${data.result?.length ?? 0}`);
      return data.result ?? [];
    } catch (e) {
      this.logger?.error(
        `failed to read liquidator results from '${file}': ${e}`,
      );
      return [];
    }
  }

  private get anvil(): AnvilClient {
    if (!this.#anvil) {
      throw new Error("anvil client not initialized");
    }
    return this.#anvil;
  }

  public get id(): string {
    return this.#options.id;
  }

  public get status(): string {
    return this.#status;
  }

  public get completed(): boolean {
    return this.#status === "finished" || this.#status === "failed";
  }
}
