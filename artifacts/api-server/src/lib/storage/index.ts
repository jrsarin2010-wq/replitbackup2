import { ReplitStorageBackend } from "./replit";
import { S3StorageBackend } from "./s3";
import type { IStorageBackend } from "./types";

export type { IStorageBackend, IStorageFile, FileMetadata } from "./types";

let _backend: IStorageBackend | null = null;

export function getStorageBackend(): IStorageBackend {
  if (_backend) return _backend;

  if (process.env["S3_ENDPOINT"]) {
    _backend = new S3StorageBackend();
  } else {
    _backend = new ReplitStorageBackend();
  }

  return _backend;
}

export function resetStorageBackend(): void {
  _backend = null;
}
