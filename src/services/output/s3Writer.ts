import { join } from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { json_stringify } from "../utils/bigint-serializer";
import BaseWriter from "./BaseWriter";
import type { IOptimisticOutputWriter } from "./types";

export default class S3Writer
  extends BaseWriter
  implements IOptimisticOutputWriter
{
  public async write(prefix: number | string, result: unknown): Promise<void> {
    const key = join(this.config.outS3Prefix, this.getFilename(prefix));
    const client = new S3Client({});
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.config.outS3Bucket,
          Key: key,
          ContentType: "application/json",
          Body: json_stringify(result),
        }),
      );
    } catch (e) {
      console.error(e);
    }
  }
}
