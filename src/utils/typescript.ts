/**
 * Typescript helper for converting json interfaces to classes
 * @returns
 */
export function createClassFromType<T>() {
  return class {
    constructor(args: T) {
      Object.assign(this, args);
    }
  } as new (args: T) => T;
}
