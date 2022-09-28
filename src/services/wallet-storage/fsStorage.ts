import { Wallet } from "ethers";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { Inject } from "typedi";

import config from "../../config";
import { AMPQService } from "../ampqService";
import { IWalletStorage } from "./types";

export default class FsStorage implements IWalletStorage {
  @Inject()
  ampqService: AMPQService;

  public async launch(): Promise<void> {
    if (!config.keyPath) {
      throw new Error("key path is not set");
    }

    let dirExists = false;
    try {
      dirExists = (await stat(config.keyPath)).isDirectory();
    } catch {}

    if (dirExists) {
      return;
    }

    try {
      await mkdir(config.keyPath);
    } catch (e) {
      this.ampqService.error(
        `Cant create directory ${config.keyPath} to store keys`,
      );
    }
  }

  public async getOrCreateKey(num: number): Promise<Wallet> {
    const fileName = `${config.keyPath}${num}.json`;
    let keyExists = false;
    try {
      keyExists = (await stat(fileName)).isFile();
    } catch {}

    if (keyExists) {
      try {
        const encryptedWallet = await readFile(fileName);
        return Wallet.fromEncryptedJson(
          encryptedWallet.toString(),
          config.walletPassword,
        );
      } catch (e) {
        this.ampqService.error(`Cant get key from file: ${fileName} ${e}`);
        process.exit(1);
      }
    }

    const newWallet = Wallet.createRandom();
    const encryptedWallet = await newWallet.encrypt(config.walletPassword);
    await writeFile(fileName, encryptedWallet);
    return newWallet;
  }
}
