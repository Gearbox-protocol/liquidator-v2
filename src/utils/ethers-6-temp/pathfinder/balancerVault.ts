export enum PoolSpecialization {
  GeneralPool = 0,
  MinimalSwapInfoPool,
  TwoTokenPool,
}

/**
 * Splits a poolId into its components, i.e. pool address, pool specialization and its nonce
 * @param poolId - a bytes32 string of the pool's ID
 * @returns an object with the decomposed poolId
 */
export const splitPoolId = (poolId: string) => {
  return {
    address: getPoolAddress(poolId),
    specialization: getPoolSpecialization(poolId),
    nonce: getPoolNonce(poolId),
  };
};

/**
 * Extracts a pool's address from its poolId
 * @param poolId - a bytes32 string of the pool's ID
 * @returns the pool's address
 */
export const getPoolAddress = (poolId: string): string => {
  if (poolId.length !== 66) throw new Error("Invalid poolId length");
  return poolId.slice(0, 42);
};

/**
 * Extracts a pool's specialization from its poolId
 * @param poolId - a bytes32 string of the pool's ID
 * @returns the pool's specialization
 */
export const getPoolSpecialization = (poolId: string): PoolSpecialization => {
  if (poolId.length !== 66) throw new Error("Invalid poolId length");

  // Only have 3 pool specializations so we can just pull the relevant character
  const specializationCode = parseInt(poolId[45], 10);
  if (specializationCode >= 3) throw new Error("Invalid pool specialization");

  return specializationCode;
};

/**
 * Extracts a pool's nonce from its poolId
 * @param poolId - a bytes32 string of the pool's ID
 * @returns the pool's nonce
 */
export const getPoolNonce = (poolId: string): bigint => {
  if (poolId.length !== 66) throw new Error("Invalid poolId length");
  return BigInt(`0x${poolId.slice(46)}`);
};
