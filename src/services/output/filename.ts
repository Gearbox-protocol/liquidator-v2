import config from "../../config";
export default function getFilename(prefix: number | string): string {
  return (
    [
      prefix,
      config.underlying?.toLowerCase(),
      config.outSuffix.replaceAll("-", ""),
    ]
      .filter(i => !!i)
      .join("-") + ".json"
  );
}
