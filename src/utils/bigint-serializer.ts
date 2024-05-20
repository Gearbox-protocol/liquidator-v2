// Wrapper around JSON stringify/parse methods to support bigint serialization

function replacer(key: string, value: any) {
  if (typeof value === "bigint") {
    return {
      __type: "bigint",
      __value: value.toString(),
    };
  } else {
    return value;
  }
}

function reviver(key: string, value: any) {
  if (value && value.__type === "bigint") {
    return BigInt(value.__value);
  }
  return value;
}

export const json_stringify = (obj: any) => {
  return JSON.stringify(obj, replacer, 2);
};

export const json_parse = (s: string) => {
  return JSON.parse(s, reviver);
};
