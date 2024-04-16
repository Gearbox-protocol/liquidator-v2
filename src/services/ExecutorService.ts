// import {
//   FlashbotsBundleProvider,
//   FlashbotsTransactionResolution,
// } from "@flashbots/ethers-provider-bundle";
import { PERCENTAGE_FACTOR } from "@gearbox-protocol/sdk";
import type { PopulatedTransaction } from "ethers";
import { BigNumber, providers, Wallet } from "ethers";
import { Inject, Service } from "typedi";

import { Logger, LoggerInterface } from "../log";
import { mine } from "./utils";

const GAS_TIP_MULTIPLIER = BigNumber.from(15000);

@Service()
export default class ExecutorService {
  @Inject()
  public wallet: Wallet;

  @Inject()
  public provider: providers.Provider;

  @Logger("ExecutorService")
  public logger: LoggerInterface;

  #isAnvil = false;

  // #flashbots?: FlashbotsBundleProvider;

  public async launch(): Promise<void> {
    try {
      const resp = await (this.provider as providers.JsonRpcProvider).send(
        "anvil_nodeInfo",
        [],
      );
      this.#isAnvil = "forkConfig" in resp;
    } catch {}
    if (this.#isAnvil) {
      this.logger.debug("running on anvil");
    } else {
      this.logger.debug("running on real rpc");
    }
  }

  public async sendPrivate(
    txData: PopulatedTransaction,
  ): Promise<providers.TransactionReceipt> {
    // if (!config.optimistic && config.flashbotsRpc) {
    //   const flashbots = await this.getFlashbots();
    //   this.logger.debug(`sending tx via flashbots`);
    //   const resp = await flashbots.sendPrivateTransaction({
    //     transaction: txData,
    //     signer: this.wallet,
    //   });
    //   if ("error" in resp) {
    //     this.logger.error(
    //       `flashbots relay error ${resp.error.code}: ${resp.error.message}`,
    //     );
    //   } else {
    //     this.logger.debug(resp.transaction, "sent tx via flashbots");
    //     const resolution = await resp.wait();
    //     if (resolution === FlashbotsTransactionResolution.TransactionIncluded) {
    //       this.logger.debug(resp.transaction, "transaction included");
    //       const receipts = await resp.receipts();
    //       if (receipts.length === 0) {
    //         throw new Error(`receipts are empty`);
    //       }
    //       return receipts[0];
    //     }
    //   }
    // }

    this.logger.debug(`sending tx via normal rpc`);
    const req = await this.wallet.populateTransaction(txData);
    if (req.maxPriorityFeePerGas) {
      req.maxPriorityFeePerGas = BigNumber.from(req.maxPriorityFeePerGas)
        .mul(GAS_TIP_MULTIPLIER)
        .div(PERCENTAGE_FACTOR);
    }
    const signedTx = await this.wallet.signTransaction(req);
    const tx = await this.provider.sendTransaction(signedTx);
    this.logger.debug(`sent transaction ${tx.hash}`);
    return this.#isAnvil
      ? mine(this.provider as providers.JsonRpcProvider, tx)
      : tx.wait();
  }

  // private async getFlashbots(): Promise<FlashbotsBundleProvider> {
  //   if (!config.flashbotsRpc) {
  //     throw new Error(`flashbots rpc not enabled`);
  //   }

  //   if (!this.#flashbots) {
  //     // TODO: set env variable
  //     // `authSigner` is an Ethereum private key that does NOT store funds and is NOT your bot's primary key.
  //     // This is an identifying key for signing payloads to establish reputation and whitelisting
  //     // In production, this should be used across multiple bundles to build relationship. In this example, we generate a new wallet each time
  //     const authSigner = Wallet.createRandom();

  //     this.#flashbots = await FlashbotsBundleProvider.create(
  //       this.provider,
  //       authSigner,
  //     );
  //   }

  //   return this.#flashbots;
  // }

  public get address(): string {
    return this.wallet.address;
  }
}
