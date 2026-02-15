export type SessionCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type FolderEntry = {
  type: "folder";
  key: string;
  name: string;
};

export type FileEntry = {
  type: "file";
  key: string;
  name: string;
  size: number;
  lastModified?: string;
  contentType?: string;
};

export type ListObjectsResponse = {
  bucket: string;
  prefix: string;
  continuationToken?: string;
  nextContinuationToken?: string;
  isTruncated: boolean;
  folders: FolderEntry[];
  files: FileEntry[];
};

export type ApiErrorShape = {
  error: string;
  details?: string;
};
