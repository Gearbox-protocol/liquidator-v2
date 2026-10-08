import { expect, it } from "vitest";

import getPromisePath from "./getPromisePath.js";

const promised = (v: any) => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(v);
    }, 0);
  });
};

const obj = () => ({
  ONE: promised("one"),
  TWO: promised({
    THREE: promised("three"),
    FOUR: promised({
      FIVE: promised("five"),
      SIX: "six",
    }),
  }),
});

it.each([
  ["ONE", "one"],
  ["TWO.THREE", "three"],
  ["TWO.FOUR.FIVE", "five"],
  ["TWO.FOUR.SIX", "six"],
])("should get promised path", async (path, expected) => {
  const result = await getPromisePath(obj(), path);
  expect(result).toBe(expected);
});
