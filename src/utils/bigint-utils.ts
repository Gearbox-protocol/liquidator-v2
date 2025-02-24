export class BigIntUtils {
  static max(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
  }

  static min(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
  }
}
