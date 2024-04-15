// import {
//   FlashbotsBundleProvider,
//   FlashbotsTransactionResolution,
// } from "@flashbots/ethers-provider-bundle";
import type { PopulatedTransaction } from "ethers";
import { providers, Wallet } from "ethers";
import { Inject, Service } from "typedi";

import { Logger, LoggerInterface } from "../log";

@Service()
export default class ExecutorService {
  @Inject()
  public wallet: Wallet;

  @Inject()
  public provider: providers.Provider;

  @Logger("ExecutorService")
  public logger: LoggerInterface;

  // #flashbots?: FlashbotsBundleProvider;

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

    this.logger.debug({ nonce: txData.nonce }, `sending tx via normal rpc`);
    const signedTx = await this.wallet.signTransaction(txData);
    const tx = await this.provider.sendTransaction(signedTx);
    this.logger.debug(`sent transaction ${tx.hash}`);
    return tx.wait(1);
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
