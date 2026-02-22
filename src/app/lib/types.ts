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

export type ObjectMetadataResponse = {
  bucket: string;
  key: string;
  size?: number;
  lastModified?: string;
  contentType: string;
};

export type UploadProgress = {
  filename: string;
  percent: number;
};

export type UploadSourceFile = {
  file: File;
  relativePath: string;
};

export type UploadSelection = {
  files: UploadSourceFile[];
  emptyFolders: string[];
};

export type UploadTaskStatus = "queued" | "uploading" | "success" | "error" | "canceled";

export type UploadTask = {
  id: string;
  filename: string;
  relativePath: string;
  size: number;
  percent: number;
  status: UploadTaskStatus;
  error?: string;
};

export type RuntimeSentryConfig = {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: string | number;
  enableLogs?: boolean;
  enableMetrics?: boolean;
  replaysSessionSampleRate?: string | number;
  replaysOnErrorSampleRate?: string | number;
};

export type RuntimeConfigResponse = {
  sentry?: RuntimeSentryConfig;
  features?: {
    enableS3UriCopy?: boolean;
  };
};
