import { iPartialLiquidatorAbi } from "@gearbox-protocol/liquidator-v2-contracts/abi";
import { ADDRESS_0X0 } from "@gearbox-protocol/sdk-gov";
import { iDegenDistributorV3Abi } from "@gearbox-protocol/types/abi";
import type { Address } from "viem";

import type { Config } from "../../config/index.js";
import type { CreditManagerData } from "../../data/index.js";
import { DI } from "../../di.js";
import type { ILogger } from "../../log/index.js";
import type { AddressProviderService } from "../AddressProviderService.js";
import type Client from "../Client.js";
import type { MerkleDistributorInfo } from "./types.js";

export default abstract class PartialLiquidatorContract {
  abstract logger: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.AddressProvider)
  addressProvider!: AddressProviderService;

  @DI.Inject(DI.Client)
  client!: Client;

  #registeredCMs: Record<Address, boolean> = {};
  #address?: Address;
  #router: Address;
  #bot: Address;
  #creditManagers: CreditManagerData[] = [];

  public readonly name: string;

  constructor(name: string, router: Address, bot: Address) {
    this.name = name;
    this.#router = router;
    this.#bot = bot;
  }

  /**
   * Registers router, partial liquidation bot and credit manager addresses in liquidator contract if necessary
   */
  public async configure(): Promise<void> {
    const [currentRouter, currentBot] = await Promise.all([
      this.client.pub.readContract({
        abi: iPartialLiquidatorAbi,
        address: this.address,
        functionName: "router",
      }),
      this.client.pub.readContract({
        abi: iPartialLiquidatorAbi,
        address: this.address,
        functionName: "partialLiquidationBot",
      }),
    ]);

    if (this.router.toLowerCase() !== currentRouter.toLowerCase()) {
      this.logger.warn(
        `need to update router from ${currentRouter} to ${this.router}`,
      );
      const receipt = await this.client.simulateAndWrite({
        abi: iPartialLiquidatorAbi,
        address: this.address,
        functionName: "setRouter",
        args: [this.router],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `PartialLiquidator.setRouter(${this.router}) tx ${receipt.transactionHash} reverted`,
        );
      }
      this.logger.info(
        `set router to ${this.router} in tx ${receipt.transactionHash}`,
      );
    }

    if (this.bot.toLowerCase() !== currentBot.toLowerCase()) {
      this.logger.warn(`need to update bot from ${currentBot} to ${this.bot}`);
      const receipt = await this.client.simulateAndWrite({
        abi: iPartialLiquidatorAbi,
        address: this.address,
        functionName: "setPartialLiquidationBot",
        args: [this.bot],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `PartialLiquidator.setPartialLiquidationBot(${this.bot}) tx ${receipt.transactionHash} reverted`,
        );
      }
      this.logger.info(
        `set bot to ${this.bot} in tx ${receipt.transactionHash}`,
      );
    }
    const cmToCa = await this.#getLiquidatorAccounts(this.#creditManagers);

    try {
      await this.#claimDegenNFTs(cmToCa, this.#creditManagers);
    } catch (e) {
      this.logger.warn(`failed to obtain degen NFTs: ${e}`);
    }

    for (const cm of this.#creditManagers) {
      const { address, name } = cm;
      const ca = cmToCa[address];
      if (ca === ADDRESS_0X0) {
        await this.#registerCM(cm);
      } else {
        this.logger.debug(
          `credit manager ${name} (${address}) already registered with account ${ca}`,
        );
        this.#registeredCMs[address.toLowerCase() as Address] = true;
      }
    }
  }

  public abstract deploy(): Promise<void>;

  public addCreditManager(cm: CreditManagerData): void {
    this.#creditManagers.push(cm);
  }

  public get isSupported(): boolean {
    return this.#creditManagers.length > 0;
  }

  async #getLiquidatorAccounts(
    cms: CreditManagerData[],
  ): Promise<Record<Address, Address>> {
    const results = await this.client.pub.multicall({
      allowFailure: false,
      contracts: cms.map(cm => ({
        abi: iPartialLiquidatorAbi,
        address: this.address,
        functionName: "cmToCA",
        args: [cm.address],
      })),
    });
    this.logger.debug(`loaded ${cms.length} liquidator credit accounts`);
    return Object.fromEntries(cms.map((cm, i) => [cm.address, results[i]]));
  }

  /**
   * Claim NFT tokens as liquidator contract, so that the contract can open credit accounts in Degen NFT protected credit managers
   * @param cmToCa
   * @param cms
   * @returns
   */
  async #claimDegenNFTs(
    cmToCa: Record<string, string>,
    cms: CreditManagerData[],
  ): Promise<void> {
    const account = this.address;

    let nfts = 0;
    for (const { address, name, degenNFT } of cms) {
      if (cmToCa[address] === ADDRESS_0X0 && degenNFT !== ADDRESS_0X0) {
        this.logger.debug(
          `need degen NFT ${degenNFT} for credit manager ${name}`,
        );
        nfts++;
      }
    }
    if (nfts === 0) {
      return;
    }

    const distributor = await this.addressProvider.findService(
      "DEGEN_DISTRIBUTOR",
      0,
      0,
    );
    this.logger.debug(`degen distributor: ${distributor}`);
    const [distributorNFT, merkelRoot, claimed] =
      await this.client.pub.multicall({
        allowFailure: false,
        contracts: [
          {
            address: distributor,
            abi: iDegenDistributorV3Abi,
            functionName: "degenNFT",
          },
          {
            address: distributor,
            abi: iDegenDistributorV3Abi,
            functionName: "merkleRoot",
          },
          {
            address: distributor,
            abi: iDegenDistributorV3Abi,
            functionName: "claimed",
            args: [account],
          },
        ],
      });
    const merkleRootURL = `https://dm.gearbox.finance/${this.config.network.toLowerCase()}_${merkelRoot}.json`;
    this.logger.debug(
      `merkle root: ${merkleRootURL}, degen distributor NFT: ${distributorNFT}, claimed: ${claimed}`,
    );

    const resp = await fetch(merkleRootURL);
    const merkle = (await resp.json()) as MerkleDistributorInfo;
    const claims = merkle.claims[account];
    if (!claims) {
      throw new Error(`${account} is not eligible for degen NFT claim`);
    }
    this.logger.debug(claims, `claims`);
    if (BigInt(claims.amount) <= claimed) {
      throw new Error(`already claimed`);
    }

    const receipt = await this.client.simulateAndWrite({
      address: distributor,
      abi: iDegenDistributorV3Abi,
      functionName: "claim",
      args: [
        BigInt(claims.index), // uint256 index,
        account, // address account,
        BigInt(claims.amount), // uint256 totalAmount,
        claims.proof, // bytes32[] calldata merkleProof
      ],
    });
    if (receipt.status === "reverted") {
      throw new Error(`degenDistributor.claim reverted`);
    }
    this.logger.debug(`${account} claimed ${BigInt(claims.amount)} degenNFTs`);
  }

  async #registerCM(cm: CreditManagerData): Promise<void> {
    const { address, name } = cm;
    try {
      this.logger.debug(`need to register credit manager ${name} (${address})`);
      const receipt = await this.client.simulateAndWrite({
        abi: iPartialLiquidatorAbi,
        address: this.address,
        functionName: "registerCM",
        args: [address],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `Liquidator.registerCM(${address}) reverted: ${receipt.transactionHash}`,
        );
      }
      this.logger.info(
        `registered credit manager ${name} (${address}) in tx ${receipt.transactionHash}`,
      );
      this.#registeredCMs[address.toLowerCase() as Address] = true;
    } catch (e) {
      this.logger.error(
        `failed to register credit manager ${name} (${address}): ${e}`,
      );
      this.#registeredCMs[address.toLowerCase() as Address] = false;
    }
  }

  protected set address(value: Address) {
    this.#address = value;
  }

  public get address(): Address {
    if (!this.#address) {
      throw new Error("liquidator contract address not set");
    }
    return this.#address;
  }

  protected get router(): Address {
    return this.#router;
  }

  protected get bot(): Address {
    return this.#bot;
  }
}
