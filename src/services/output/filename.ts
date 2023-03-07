import config from "../../config";
export default function getFilename(): string {
  return (
    [
      config.optimisticForkHead,
      config.underlying?.toLowerCase(),
      config.outSuffix.replaceAll("-", ""),
    ]
      .filter(i => !!i)
      .join("-") + ".json"
  );
}
