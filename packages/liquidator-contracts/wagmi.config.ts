import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

const project = process.env.ROUTER_V3_DIR;
if (!project) {
  throw new Error(
    "ROUTER_V3_DIR env variable must point to a router-v3 checkout",
  );
}

export default defineConfig({
  out: "src/abi/abi.generated.ts",
  plugins: [
    foundry({
      project,
      artifacts: "forge-out",
      include: [
        "AaveFLTaker.sol/AaveFLTaker.json",
        "AaveLiquidator.sol/AaveLiquidator.json",
        "AaveUnwinder.sol/AaveUnwinder.json",
        "BatchLiquidator.sol/BatchLiquidator.json",
        "GhoFMTaker.sol/GhoFMTaker.json",
        "GhoFrxUSDLiquidator.sol/GhoFrxUSDLiquidator.json",
        "GhoFrxUSDUnwinder.sol/GhoFrxUSDUnwinder.json",
        "GhoLiquidator.sol/GhoLiquidator.json",
        "GhoUnwinder.sol/GhoUnwinder.json",
        "IBatchLiquidator.sol/IBatchLiquidator.json",
        "IGhoFlashMinter.sol/IGhoFlashMinter.json",
        "IMorphoFlashLoan.sol/IMorphoFlashLoan.json",
        "IPartialLiquidator.sol/IPartialLiquidator.json",
        "ISiloFlashLoan.sol/ISiloFlashLoan.json",
        "IUnwinder.sol/IUnwinder.json",
        "MorphoLiquidator.sol/MorphoLiquidator.json",
        "MorphoUnwinder.sol/MorphoUnwinder.json",
        "SecuritizeLiquidatorHelper.sol/SecuritizeLiquidatorHelper.json",
        "SiloFLTaker.sol/SiloFLTaker.json",
        "SiloLiquidator.sol/SiloLiquidator.json",
        "SiloUnwinder.sol/SiloUnwinder.json",
      ],
      forge: {
        clean: false,
        build: false,
        rebuild: false,
      },
    }),
  ],
}) as unknown;
