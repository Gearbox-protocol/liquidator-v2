import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { describe, expect, it, vi } from "vitest";

import { SSMManager, ssmManagerProxy } from "./SSMManager.js";

vi.mock("@aws-sdk/client-ssm", async () => {
  const originalModule = await vi.importActual("@aws-sdk/client-ssm");
  return {
    ...originalModule,
    SSMClient: class {
      send = vi.fn((command: unknown) => {
        if (command instanceof GetParameterCommand) {
          const parameterName = command.input.Name;
          if (parameterName === "PARAM") {
            return Promise.resolve({
              Parameter: { Value: "simple-string-value" },
            });
          }
        }
        return Promise.reject(new Error("Parameter not found"));
      });
    },
  };
});

describe("ssm manager", () => {
  const ssm = new SSMManager();

  it("should get ssm parameter", async () => {
    const parameter = await ssm.parameter("PARAM");
    expect(parameter).toBe("simple-string-value");
  });

  it("should throw an error for non-existent parameter", async () => {
    await expect(ssm.parameter("NON_EXISTENT_PARAM")).rejects.toThrow(
      "Parameter not found",
    );
  });
});

describe("ssm manager proxy", () => {
  it("should access parameter via proxy", async () => {
    const parameter = await ssmManagerProxy().PARAM;
    expect(parameter).toBe("simple-string-value");
  });
});
