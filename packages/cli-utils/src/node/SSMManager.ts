import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export class SSMManager {
  #ssmClient?: SSMClient;
  #parameters: Map<string, string> = new Map();

  public async parameter(name: string): Promise<string> {
    if (this.#parameters.has(name)) {
      return this.#parameters.get(name)!;
    }

    if (!this.#ssmClient) {
      this.#ssmClient = new SSMClient({});
    }

    const response = await this.#ssmClient.send(
      new GetParameterCommand({
        Name: name,
      }),
    );
    const value = response.Parameter?.Value;
    if (!value) {
      throw new Error(`parameter ${name} value not found`);
    }
    this.#parameters.set(name, value);
    return value;
  }
}

export const ssmManagerProxy = (
  mgr?: SSMManager,
): Record<string, Promise<unknown>> =>
  new Proxy<any>(mgr ?? new SSMManager(), {
    get(target, prop) {
      if (
        typeof prop === "string" &&
        !["parameter", "then", "catch", "finally"].includes(prop)
      ) {
        return target.parameter(prop);
      }
    },
  });
