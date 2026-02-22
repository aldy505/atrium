import type { ListObjectsResponse, ObjectMetadataResponse, RuntimeConfigResponse } from "./types";

export type UploadRequest = {
  promise: Promise<void>;
  abort: () => void;
};

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
};

export const checkSession = async (): Promise<boolean> => {
  const response = await fetch("/api/auth/me", { credentials: "include" });
  return response.ok;
};

export const login = async (accessKeyId: string, secretAccessKey: string): Promise<void> => {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ accessKeyId, secretAccessKey }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Authentication failed");
  }
};

export const logout = async (): Promise<void> => {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
};

export const getBuckets = async (): Promise<string[]> => {
  const response = await fetch("/api/s3/buckets", {
    credentials: "include",
  });

  const body = await parseResponse<{ buckets: string[] }>(response);
  return body.buckets;
};

export const getObjects = async (
  bucket: string,
  prefix: string,
  options?: { continuationToken?: string; maxKeys?: number },
): Promise<ListObjectsResponse> => {
  const params = new URLSearchParams({ bucket, prefix });

  if (options?.continuationToken) {
    params.set("continuationToken", options.continuationToken);
  }

  if (options?.maxKeys) {
    params.set("maxKeys", String(options.maxKeys));
  }

  const response = await fetch(`/api/s3/objects?${params.toString()}`, {
    credentials: "include",
  });

  return parseResponse<ListObjectsResponse>(response);
};

export const uploadFile = (
  bucket: string,
  prefix: string,
  file: File,
  relativePath: string,
  onProgress: (percent: number) => void,
): UploadRequest => {
  let aborted = false;
  let xhr: XMLHttpRequest | null = null;

  const promise = new Promise<void>((resolve, reject) => {
    const params = new URLSearchParams({ bucket, prefix });
    const formData = new FormData();
    formData.append("relativePath", relativePath);
    formData.append("file", file);

    xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/s3/upload?${params.toString()}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      const currentXhr = xhr;

      if (!currentXhr) {
        reject(new Error("Upload failed"));
        return;
      }

      if (aborted) {
        reject(Object.assign(new Error("Upload canceled"), { name: "AbortError" }));
        return;
      }

      if (currentXhr.status >= 200 && currentXhr.status < 300) {
        resolve();
      } else {
        try {
          const body = JSON.parse(currentXhr.responseText) as { error?: string };
          reject(new Error(body.error || `Upload failed (${currentXhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${currentXhr.status})`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Upload failed due to network error"));
    xhr.onabort = () => {
      aborted = true;
      reject(Object.assign(new Error("Upload canceled"), { name: "AbortError" }));
    };
    xhr.send(formData);
  });

  return {
    promise,
    abort: () => {
      aborted = true;
      xhr?.abort();
    },
  };
};

export const deleteObject = async (bucket: string, key: string): Promise<void> => {
  const params = new URLSearchParams({ bucket, key });
  const response = await fetch(`/api/s3/object?${params.toString()}`, {
    method: "DELETE",
    credentials: "include",
  });

  await parseResponse<{ ok: boolean }>(response);
};

export const deletePrefix = async (bucket: string, prefix: string): Promise<number> => {
  const params = new URLSearchParams({ bucket, prefix });
  const response = await fetch(`/api/s3/prefix?${params.toString()}`, {
    method: "DELETE",
    credentials: "include",
  });

  const body = await parseResponse<{ ok: boolean; deleted: number }>(response);
  return body.deleted;
};

export const createFolder = async (
  bucket: string,
  prefix: string,
  name: string,
): Promise<{ ok: boolean; key: string; placeholderCreated?: boolean }> => {
  const response = await fetch("/api/s3/folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ bucket, prefix, name }),
  });

  return parseResponse<{ ok: boolean; key: string; placeholderCreated?: boolean }>(response);
};

export const getDownloadUrl = (bucket: string, key: string, inline = false): string => {
  const params = new URLSearchParams({ bucket, key, inline: inline ? "1" : "0" });
  return `/api/s3/download?${params.toString()}`;
};

export const getTextPreview = async (bucket: string, key: string): Promise<string> => {
  const params = new URLSearchParams({ bucket, key });
  const response = await fetch(`/api/s3/preview-text?${params.toString()}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to load text preview");
  }

  return response.text();
};

export const getObjectMetadata = async (
  bucket: string,
  key: string,
): Promise<ObjectMetadataResponse> => {
  const params = new URLSearchParams({ bucket, key });
  const response = await fetch(`/api/s3/object-metadata?${params.toString()}`, {
    credentials: "include",
  });

  return parseResponse<ObjectMetadataResponse>(response);
};

export const getRuntimeConfig = async (): Promise<RuntimeConfigResponse> => {
  const response = await fetch("/api/runtime-config", {
    credentials: "same-origin",
  });

  return parseResponse<RuntimeConfigResponse>(response);
};
