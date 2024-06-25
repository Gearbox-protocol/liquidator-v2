import {
  iExceptionsAbi,
  ilpPriceFeedExceptionsAbi,
  iRedstonePriceFeedExceptionsAbi,
} from "@gearbox-protocol/types/abi";

export const exceptionsAbis = [
  ...iExceptionsAbi,
  ...iRedstonePriceFeedExceptionsAbi,
  ...ilpPriceFeedExceptionsAbi,
];
