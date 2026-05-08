import { securitizeLiquidatorHelperAbi } from "@gearbox-protocol/liquidator-contracts/abi";
import {
  type CreditAccountData,
  hexEq,
  type OnchainSDK,
  PERCENTAGE_FACTOR,
  RWA_FACTORY_SECURITIZE,
  sendRawTx,
} from "@gearbox-protocol/sdk";
import { iSecuritizeRedemptionGatewayAbi } from "@gearbox-protocol/sdk/plugins/adapters";
import {
  BaseError,
  encodeFunctionData,
  parseEther,
  type SimulateContractReturnType,
} from "viem";
import type {
  FullLiquidatorSchema,
  LiqduiatorConfig,
} from "../../config/index.js";
import { DI } from "../../di.js";
import { errorAbis } from "../../errors/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import { RWAContractsDeployer, resolveRWAContext } from "./rwa/index.js";
import type {
  ILiquidationStrategy,
  MakeLiquidatableResult,
  RWALiquidationPreview,
} from "./types.js";

export default class LiquidationStrategyRWAViaStablecoins
  extends AccountHelper
  implements ILiquidationStrategy<RWALiquidationPreview>
{
  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<FullLiquidatorSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("RWAStrategy")
  logger!: ILogger;

  #deployer: RWAContractsDeployer;

  constructor() {
    super();
    this.#deployer = new RWAContractsDeployer(this.sdk);
  }

  public get name(): string {
    return "rwa-via-stablecoins";
  }

  public async launch(): Promise<void> {
    await this.#deployer.syncState();
  }

  public async syncState(_blockNumber: bigint): Promise<void> {}

  public isApplicable(ca: CreditAccountData, _optimistic: boolean): boolean {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const ctx = resolveRWAContext(this.sdk, cm.underlying);
    if (!ctx) {
      return false;
    }
    // need to have DSToken balance on the account
    return ca.tokens.some(t => hexEq(t.token, ctx.dsToken) && t.balance > 0n);
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    if (!this.config.optimistic) {
      throw new Error("makeLiquidatable only works in optimistic mode");
    }
    const cs = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const ctx = resolveRWAContext(this.sdk, cs.underlying);
    if (!ctx) {
      throw new Error(`Credit manager ${cs.name} is not an RWA credit manager`);
    }
    const { factory, dsToken, gateway } = ctx;

    // RWA underlying is an ERC-4626 vault around the stablecoin we need to fund the redeemer with
    const meta = this.sdk.tokensMeta.mustGet(cs.underlying);
    if (!this.sdk.tokensMeta.isRWAUnderlying(meta)) {
      throw new Error(`underlying ${cs.underlying} is not an RWA underlying`);
    }
    const stable = meta.asset;

    const dsBalance =
      ca.tokens.find(t => hexEq(t.token, dsToken))?.balance ?? 0n;
    if (dsBalance === 0n) {
      throw new Error("warning: no DSToken balance on account");
    }

    const gatewayAdapter = cs.creditManager.adapters.mustGet(gateway).address;
    const investor = await factory.getInvestor(ca.creditAccount);

    const snapshotId = await this.client.anvil.snapshot();

    // 1. Redeem all DSTokens via the factory multicall, impersonating the investor.
    const redeemTx = factory.multicall(
      ca.creditAccount,
      [
        {
          target: gatewayAdapter,
          callData: encodeFunctionData({
            abi: iSecuritizeRedemptionGatewayAbi,
            functionName: "redeem",
            args: [dsBalance],
          }),
        },
      ],
      {
        type: RWA_FACTORY_SECURITIZE,
        tokensToRegister: [],
        signaturesToCache: [],
      },
    );
    await this.client.anvil.impersonateAccount({ address: investor });
    await this.client.anvil.setBalance({
      address: investor,
      value: parseEther("100"),
    });
    const hash = await sendRawTx(this.client.anvil, {
      account: investor,
      tx: redeemTx,
    });
    const receipt = await this.client.anvil.waitForTransactionReceipt({ hash });
    await this.client.anvil.stopImpersonatingAccount({ address: investor });
    if (receipt.status === "reverted") {
      throw new Error(
        `redeem reverted in tx ${hash} for account ${ca.creditAccount}`,
      );
    }
    this.logger.debug(
      `redeemed ${this.sdk.tokensMeta.formatBN(dsToken, dsBalance, { symbol: true })} via ${this.sdk.labelAddress(gateway)} in tx ${hash}`,
    );

    // 2. Pick the redeemer that was just created (last unclaimed).
    const redeemers = await this.client.pub.readContract({
      abi: iSecuritizeRedemptionGatewayAbi,
      address: gateway,
      functionName: "getUnclaimedRedeemers",
      args: [ca.creditAccount],
    });
    if (redeemers.length === 0) {
      throw new Error(`no redeemers found for account ${ca.creditAccount}`);
    }
    const redeemer = redeemers[redeemers.length - 1];

    // 3. Fund the redeemer with enough stablecoin to cover the discounted debt.
    // The pool needs `stableOnRedeemers * liquidationDiscount / PERCENTAGE_FACTOR >= debt`,
    // so flip the formula and add a buffer for interest/fee drift between snapshot and tx.
    const totalDebt = ca.debt + ca.accruedInterest + ca.accruedFees;
    const amount =
      2n *
      ((totalDebt * PERCENTAGE_FACTOR) /
        BigInt(cs.creditManager.liquidationDiscount));
    await this.client.anvil.deal({
      erc20: stable,
      account: redeemer,
      amount,
    });
    this.logger.debug(
      `funded redeemer ${redeemer} with ${this.sdk.tokensMeta.formatBN(stable, amount, { symbol: true })}`,
    );

    const account = await this.sdk.accounts.getCreditAccountData(
      ca.creditAccount,
    );
    if (!account) {
      throw new Error(`account ${ca.creditAccount} not found after redeem`);
    }
    return { account, snapshotId };
  }

  public async preview(ca: CreditAccountData): Promise<RWALiquidationPreview> {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const ctx = resolveRWAContext(this.sdk, cm.underlying);
    const redemptionGateway = ctx?.gateway;
    if (!redemptionGateway) {
      throw new Error(
        `cannot resolve redemption gateway for ${cm.underlying} in ${cm.name}`,
      );
    }
    const priceUpdates = await this.sdk.accounts.getOnDemandPriceUpdates(
      ca,
      !this.config.updateReservePrices,
    );
    try {
      const { result: canLiquidate } = await this.client.pub.simulateContract({
        account: this.client.account,
        abi: [...securitizeLiquidatorHelperAbi, ...errorAbis],
        address: this.#deployer.address,
        functionName: "canLiquidateViaStablecoins",
        args: [ca.creditAccount, redemptionGateway, priceUpdates],
      });
      if (!canLiquidate) {
        this.logger.info(
          `account ${ca.creditAccount} cannot be liquidated via stablecoins yet`,
        );
        throw new Error(
          "warning: account cannot be liquidated via stablecoins",
        );
      }
    } catch (e) {
      throw new BaseError("cant preview rwa liquidation", {
        cause: e as Error,
      });
    }

    return {
      calls: [],
      underlyingBalance: 0n,
      redemptionGateway,
      priceUpdates,
      skipOnFailure: false,
    };
  }

  public async simulate(
    account: CreditAccountData,
    preview: RWALiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    const result = await this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...securitizeLiquidatorHelperAbi, ...errorAbis],
      address: this.#deployer.address,
      functionName: "liquidateViaStablecoins",
      args: [
        account.creditAccount,
        preview.redemptionGateway,
        preview.priceUpdates,
      ],
    });
    return result as unknown as SimulateContractReturnType<unknown[], any, any>;
  }
}
