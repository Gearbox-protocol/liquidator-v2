/**
 * Similar to lodash.get, but supports promises
 * @param object
 * @param keys
 * @returns
 */
export default async function getPromisePath<V = any>(
  object: any,
  path: string,
): Promise<V> {
  return getPromised(object, path.split("."));
}

async function getPromised<V = any>(object: any, keys: string[]): Promise<V> {
  if (keys.length === 0) {
    return Promise.resolve(object);
  }
  const [key, ...rest] = keys;
  const value = object[key];
  const resolved = await Promise.resolve(value);
  return getPromised(resolved, rest);
}
