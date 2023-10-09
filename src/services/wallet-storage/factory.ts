import type { Wallet } from "ethers";
import { Service } from "typedi";

import config from "../../config";
import AwsSecretsManagerStorage from "./awsSecretsManagerStorage";
import { WALLET_STORAGE } from "./constants";
import FsStorage from "./fsStorage";
import type { IWalletStorage } from "./types";

function createWalletStorage(): IWalletStorage {
  if (config.keyPath) {
    return new FsStorage();
  } else if (config.keySecret) {
    return new AwsSecretsManagerStorage();
  }
  throw new Error(
    "cannot instantiate wallet storage. Please set KEY_PATH or KEY_SECRET env variable",
  );
}

@Service({ factory: createWalletStorage, id: WALLET_STORAGE })
export class WalletStorage implements IWalletStorage {
  launch: () => Promise<void>;
  getOrCreateKey: (num: number) => Promise<Wallet>;
}
