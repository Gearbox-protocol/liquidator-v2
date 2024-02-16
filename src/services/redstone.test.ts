import { tokenDataByNetwork } from "@gearbox-protocol/sdk";
import { expect, it } from "vitest";

import { RedstoneService } from "./redstoneService";

it("should update redstone", async () => {
  const redstone = new RedstoneService();
  const updates = await redstone.updateRedstone([
    tokenDataByNetwork.Mainnet.osETH, // main redstone
    tokenDataByNetwork.Mainnet.USDC, // reserve redstone
    tokenDataByNetwork.Mainnet["1INCH"], // no redstone
  ]);
  expect(updates).toEqual([
    {
      callData: expect.stringMatching(/^0x[0-9a-fA-F]+$/),
      token: tokenDataByNetwork.Mainnet.osETH.toLowerCase(),
    },
    {
      callData: expect.stringMatching(/^0x[0-9a-fA-F]+$/),
      token: tokenDataByNetwork.Mainnet.USDC.toLowerCase(),
    },
  ]);
});
