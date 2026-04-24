import { Readable } from "stream";
import { Storage } from "@google-cloud/storage";
import type { IStorageBackend, IStorageFile, FileMetadata } from "./types";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const gcsClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

class ReplitStorageFile implements IStorageFile {
  private _file;
  name: string;

  constructor(bucketName: string, objectName: string) {
    this._file = gcsClient.bucket(bucketName).file(objectName);
    this.name = objectName;
  }

  async exists(): Promise<boolean> {
    const [exists] = await this._file.exists();
    return exists;
  }

  async getMetadata(): Promise<FileMetadata> {
    const [metadata] = await this._file.getMetadata();
    return {
      contentType: metadata.contentType as string | undefined,
      size: metadata.size ? Number(metadata.size) : undefined,
      customMetadata: (metadata.metadata as Record<string, string>) ?? {},
    };
  }

  async setMetadata(customMetadata: Record<string, string>): Promise<void> {
    await this._file.setMetadata({ metadata: customMetadata });
  }

  createReadStream(): Readable {
    return this._file.createReadStream();
  }
}

export class ReplitStorageBackend implements IStorageBackend {
  file(bucketName: string, objectName: string): IStorageFile {
    return new ReplitStorageFile(bucketName, objectName);
  }

  async signUrl(params: {
    bucketName: string;
    objectName: string;
    method: "GET" | "PUT";
    ttlSec: number;
  }): Promise<string> {
    const request = {
      bucket_name: params.bucketName,
      object_name: params.objectName,
      method: params.method,
      expires_at: new Date(Date.now() + params.ttlSec * 1000).toISOString(),
    };
    const response = await fetch(
      `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to sign object URL, status: ${response.status}`);
    }
    const data = (await response.json()) as { signed_url: string };
    return data.signed_url;
  }
}
