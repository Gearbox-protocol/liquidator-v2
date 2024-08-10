import {
  iExceptionsAbi,
  ilpPriceFeedExceptionsAbi,
  iRedstoneErrorsAbi,
  iRedstonePriceFeedExceptionsAbi,
} from "@gearbox-protocol/types/abi";

export const exceptionsAbis = [
  ...iExceptionsAbi,
  ...iRedstonePriceFeedExceptionsAbi,
  ...iRedstoneErrorsAbi,
  ...ilpPriceFeedExceptionsAbi,
];
