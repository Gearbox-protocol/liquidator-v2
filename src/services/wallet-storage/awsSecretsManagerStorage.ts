import {
  GetSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { Wallet } from "ethers";
import { Inject } from "typedi";

import config from "../../config";
import { AMPQService } from "../ampqService";
import { IWalletStorage } from "./types";

export default class AwsSecretsManagerStorage implements IWalletStorage {
  @Inject()
  ampqService: AMPQService;

  private encryptedWallets?: unknown[];
  private client = new SecretsManagerClient({});

  public async launch(): Promise<void> {
    try {
      const { SecretString } = await this.client.send(
        new GetSecretValueCommand({
          SecretId: config.keySecret,
        }),
      );
      if (!SecretString) {
        throw new Error("secret not found");
      }
      const keys = JSON.parse(SecretString);
      if (Array.isArray(keys)) {
        throw new Error("secret must be an array");
      }
      this.encryptedWallets = keys;
    } catch (e) {
      this.ampqService.error(`Cant get keys from AWS secrets manager: ${e}`);
      process.exit(1);
    }
  }

  public async getOrCreateKey(num: number): Promise<Wallet> {
    if (!this.encryptedWallets) {
      throw new Error("encrypted wallets were not initialized");
    }
    if (this.encryptedWallets.length > num) {
      try {
        const encryptedWallet = this.encryptedWallets[num];
        return Wallet.fromEncryptedJson(
          JSON.stringify(encryptedWallet),
          config.walletPassword,
        );
      } catch (e) {
        this.ampqService.error(`Cant get key from: ${e}`);
        process.exit(1);
      }
    }

    try {
      const newWallet = Wallet.createRandom();
      const encryptedWallet = await newWallet.encrypt(config.walletPassword);
      this.encryptedWallets.push(JSON.parse(encryptedWallet));
      await this.client.send(
        new UpdateSecretCommand({
          SecretId: config.keySecret,
          SecretString: JSON.stringify(this.encryptedWallets),
        }),
      );
      return newWallet;
    } catch (e) {
      this.ampqService.error(`Cant create new key: ${e}`);
      process.exit(1);
    }
  }
}
