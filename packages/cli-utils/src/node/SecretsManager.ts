import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export class SecretsManager {
  #smClient?: SecretsManagerClient;
  #secrets: Map<string, string> = new Map();

  public async secret(key: string): Promise<string> {
    const [SecretId, ...jsonPath] = key.split(".");
    const secretStr = await this.#getSecret(SecretId);
    if (!jsonPath.length) {
      return secretStr;
    }
    let v = JSON.parse(secretStr);
    for (const p of jsonPath) {
      v = v[p];
    }
    if (!v || typeof v !== "string") {
      throw new Error(`cannot find secret '${key}'`);
    }
    return v;
  }

  public async secretRaw(key: string): Promise<unknown> {
    const val = await this.#getSecret(key);
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }

  async #getSecret(SecretId: string): Promise<string> {
    if (this.#secrets.has(SecretId)) {
      return this.#secrets.get(SecretId)!;
    }

    if (!this.#smClient) {
      this.#smClient = new SecretsManagerClient({});
    }
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ssm/command/GetParameterCommand/
    const { SecretString } = await this.#smClient.send(
      new GetSecretValueCommand({ SecretId }),
    );
    if (!SecretString) {
      throw new Error(`secret '${SecretId}' not found`);
    }
    this.#secrets.set(SecretId, SecretString);

    return SecretString;
  }
}

export const secretsManagerProxy = (
  mgr?: SecretsManager,
): Record<string, Promise<unknown>> =>
  new Proxy<any>(mgr ?? new SecretsManager(), {
    get(target, prop) {
      if (
        typeof prop === "string" &&
        !["secret", "secretRaw", "then", "catch", "finally"].includes(prop)
      ) {
        return target.secretRaw(prop);
      }
    },
  });
