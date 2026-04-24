import { Readable } from "stream";

export interface FileMetadata {
  contentType?: string;
  size?: number;
  customMetadata?: Record<string, string>;
}

export interface IStorageFile {
  name: string;
  exists(): Promise<boolean>;
  getMetadata(): Promise<FileMetadata>;
  setMetadata(customMetadata: Record<string, string>): Promise<void>;
  createReadStream(): Readable;
}

export interface IStorageBackend {
  file(bucketName: string, objectName: string): IStorageFile;
  signUrl(params: {
    bucketName: string;
    objectName: string;
    method: "GET" | "PUT";
    ttlSec: number;
  }): Promise<string>;
}
