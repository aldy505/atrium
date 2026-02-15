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
  folders: FolderEntry[];
  files: FileEntry[];
};

export type UploadProgress = {
  filename: string;
  percent: number;
};
