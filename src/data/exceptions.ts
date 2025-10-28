import {
  iExceptionsAbi,
  ilpPriceFeedExceptionsAbi,
  iRedstoneErrorsAbi,
  iRedstonePriceFeedExceptionsAbi,
  iRouterV3ErrorsAbi,
} from "@gearbox-protocol/types/abi";

export const exceptionsAbis = [
  ...iExceptionsAbi,
  ...iRedstonePriceFeedExceptionsAbi,
  ...iRedstoneErrorsAbi,
  ...ilpPriceFeedExceptionsAbi,
  ...iRouterV3ErrorsAbi,
] as const;
