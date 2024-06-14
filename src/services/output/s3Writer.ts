import { join } from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { json_stringify } from "../../utils/index.js";
import BaseWriter from "./BaseWriter.js";
import type { IOptimisticOutputWriter } from "./types.js";

export default class S3Writer
  extends BaseWriter
  implements IOptimisticOutputWriter
{
  public async write(
    prefix: string | bigint | number,
    result: unknown,
  ): Promise<void> {
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
