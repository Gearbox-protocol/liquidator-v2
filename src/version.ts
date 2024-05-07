const version =
  // set in docker build
  process.env.PACKAGE_VERSION ?? "dev";

export default version;
