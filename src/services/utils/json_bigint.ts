// Wrapper around JSON stringify/parse methods to support bigint serialization

import { BigNumber } from "ethers";

// @ts-ignore
function replacer(key, value) {
  if (typeof value === "bigint") {
    return {
      __type: "bigint",
      __value: value.toString(),
    };
  } else {
    return value;
  }
}

// @ts-ignore
function reviver(key, value) {
  if (value && value.__type === "bigint") {
    return BigInt(value.__value);
  }
  if (value && value.type === "BigNumber" && "hex" in value) {
    return BigNumber.from(value.hex);
  }
  return value;
}

// @ts-ignore
export const json_stringify = obj => {
  return JSON.stringify(obj, replacer, 2);
};

// @ts-ignore
export const json_parse = s => {
  return JSON.parse(s, reviver);
};
