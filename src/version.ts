const version =
  // set in docker build
  process.env.PACKAGE_VERSION ??
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../package.json").version ??
  "dev";

export default version;
