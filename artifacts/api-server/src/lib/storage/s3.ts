import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable, PassThrough } from "stream";
import type { IStorageBackend, IStorageFile, FileMetadata } from "./types";

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      endpoint: process.env["S3_ENDPOINT"]!,
      region: process.env["S3_REGION"] || "auto",
      credentials: {
        accessKeyId: process.env["S3_ACCESS_KEY_ID"]!,
        secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"]!,
      },
      forcePathStyle: true,
    });
  }
  return _s3Client;
}

class S3StorageFile implements IStorageFile {
  name: string;
  private bucketName: string;

  constructor(bucketName: string, objectName: string) {
    this.bucketName = bucketName;
    this.name = objectName;
  }

  async exists(): Promise<boolean> {
    try {
      await getS3Client().send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: this.name }),
      );
      return true;
    } catch (err) {
      if (
        (err as { name?: string }).name === "NotFound" ||
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      ) {
        return false;
      }
      throw err;
    }
  }

  async getMetadata(): Promise<FileMetadata> {
    const result = await getS3Client().send(
      new HeadObjectCommand({ Bucket: this.bucketName, Key: this.name }),
    );
    return {
      contentType: result.ContentType,
      size: result.ContentLength,
      customMetadata: result.Metadata ?? {},
    };
  }

  async setMetadata(customMetadata: Record<string, string>): Promise<void> {
    const existing = await getS3Client().send(
      new HeadObjectCommand({ Bucket: this.bucketName, Key: this.name }),
    );
    await getS3Client().send(
      new CopyObjectCommand({
        Bucket: this.bucketName,
        Key: this.name,
        CopySource: `${this.bucketName}/${this.name}`,
        ContentType: existing.ContentType,
        Metadata: { ...(existing.Metadata ?? {}), ...customMetadata },
        MetadataDirective: "REPLACE",
      }),
    );
  }

  createReadStream(): Readable {
    const passthrough = new PassThrough();
    getS3Client()
      .send(new GetObjectCommand({ Bucket: this.bucketName, Key: this.name }))
      .then((res) => {
        const body = res.Body as Readable;
        body.pipe(passthrough);
      })
      .catch((err) => passthrough.destroy(err));
    return passthrough;
  }
}

export class S3StorageBackend implements IStorageBackend {
  file(bucketName: string, objectName: string): IStorageFile {
    return new S3StorageFile(bucketName, objectName);
  }

  async signUrl(params: {
    bucketName: string;
    objectName: string;
    method: "GET" | "PUT";
    ttlSec: number;
  }): Promise<string> {
    const command =
      params.method === "PUT"
        ? new PutObjectCommand({
            Bucket: params.bucketName,
            Key: params.objectName,
          })
        : new GetObjectCommand({
            Bucket: params.bucketName,
            Key: params.objectName,
          });

    return getSignedUrl(getS3Client(), command, {
      expiresIn: params.ttlSec,
    });
  }
}
