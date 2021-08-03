import { BigNumber } from "ethers";

const ONE = BigNumber.from(1);
const TWO = BigNumber.from(2);


export function sqrt(x: BigNumber) {
  let z = x.add(ONE).div(TWO);
  let y = x;
  while (z.sub(y).isNegative()) {
    y = z;
    z = x.div(z).add(z).div(TWO);
  }
  return y;
}
