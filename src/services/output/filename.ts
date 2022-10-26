import config from "../../config";
export default function getFilename(startingBlock: number): string {
  return (
    [
      startingBlock,
      config.underlying?.toLowerCase(),
      config.outSuffix.replaceAll("-", ""),
    ]
      .filter(i => !!i)
      .join("-") + ".json"
  );
}
