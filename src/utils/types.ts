export type Numberish = number | bigint;
export type Arrayish<T> = readonly T[] | T[];

// biome-ignore lint/suspicious/noRedeclare: it's ok
export type ArrayElementType<T> = T extends readonly (infer U)[] | (infer U)[]
  ? U
  : never;
