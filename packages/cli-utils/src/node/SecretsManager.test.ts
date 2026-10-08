import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";

import { SecretsManager, secretsManagerProxy } from "./SecretsManager.js";

vi.mock("@aws-sdk/client-secrets-manager", async () => {
  const originalModule = await vi.importActual(
    "@aws-sdk/client-secrets-manager",
  );
  return {
    ...originalModule,
    SecretsManagerClient: class {
      send = vi.fn((command: unknown) => {
        if (command instanceof GetSecretValueCommand) {
          const secretId = command.input.SecretId;
          if (secretId === "SIMPLE_SECRET") {
            return Promise.resolve({ SecretString: "simple-string-value" });
          } else if (secretId === "JSON_SECRET") {
            return Promise.resolve({
              SecretString: JSON.stringify({
                key: "value",
                deep: { key: "deep_value" },
              }),
            });
          }
        }
        return Promise.reject(new Error("Secret not found"));
      });
    },
  };
});

describe("secrets manager", () => {
  const sm = new SecretsManager();

  it("should return a simple string value for SIMPLE_SECRET", async () => {
    const secret = await sm.secret("SIMPLE_SECRET");
    expect(secret).toBe("simple-string-value");
  });

  it("should return value at path for json secrets", async () => {
    const secret = await sm.secret("JSON_SECRET.deep.key");
    expect(secret).toBe("deep_value");
  });

  it("should throw an error for non-existent secret", async () => {
    await expect(sm.secret("NON_EXISTENT_SECRET")).rejects.toThrow(
      "Secret not found",
    );
  });
});

describe("secrets manager proxy", () => {
  it("should access top-level simple string value", async () => {
    const secret = await secretsManagerProxy().SIMPLE_SECRET;
    expect(secret).toBe("simple-string-value");
  });

  it("should access top-level json object", async () => {
    const secret = await secretsManagerProxy().JSON_SECRET;
    expect(secret).toEqual({
      key: "value",
      deep: { key: "deep_value" },
    });
  });
});
