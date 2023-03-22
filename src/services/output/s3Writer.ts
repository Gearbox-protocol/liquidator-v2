import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { join } from "node:path";

import config from "../../config";
import getFilename from "./filename";
import { IOptimisticOutputWriter } from "./types";

export default class S3Writer implements IOptimisticOutputWriter {
  public async write(prefix: number | string, result: unknown): Promise<void> {
    const key = join(config.outS3Prefix ?? "", getFilename(prefix));
    const client = new S3Client({});
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.outS3Bucket,
          Key: key,
          ContentType: "application/json",
          Body: JSON.stringify(result),
        }),
      );
    } catch (e) {
      console.error(e);
    }
  }
}
