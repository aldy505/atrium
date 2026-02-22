import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import csv from "highlight.js/lib/languages/plaintext";
import { getDownloadUrl, getObjectMetadata, getTextPreview } from "../app/lib/api";
import { buildS3Uri, copyTextToClipboard } from "../app/lib/s3-uri";
import type { FileEntry, FolderEntry } from "../app/lib/types";
import { getExtension, isImageFile, isTextFile } from "./FileIcon";

hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("csv", csv);

type FilePreviewProps = {
  bucket: string;
  file: FileEntry | FolderEntry | null;
  enableS3UriCopy?: boolean;
};

const getLanguage = (filename: string): string => {
  const ext = getExtension(filename);

  switch (ext) {
    case "json":
      return "json";
    case "xml":
      return "xml";
    case "md":
      return "markdown";
    case "csv":
      return "csv";
    default:
      return "plaintext";
  }
};

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const formatSize = (size?: number): string => {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return "-";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(1)} ${unit}`;
};

const formatModified = (lastModified?: string): string => {
  if (!lastModified) {
    return "-";
  }

  const date = new Date(lastModified);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const diffMs = date.getTime() - Date.now();

  if (Math.abs(diffMs) > RECENT_WINDOW_MS) {
    return date.toLocaleString();
  }

  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) {
    return relativeTimeFormatter.format(Math.round(diffMs / 1000), "second");
  }

  if (absMs < 3_600_000) {
    return relativeTimeFormatter.format(Math.round(diffMs / 60_000), "minute");
  }

  if (absMs < 86_400_000) {
    return relativeTimeFormatter.format(Math.round(diffMs / 3_600_000), "hour");
  }

  return relativeTimeFormatter.format(Math.round(diffMs / 86_400_000), "day");
};

type PreviewMetadataProps = {
  size?: number;
  lastModified?: string;
  contentType?: string;
};

const PreviewMetadata = ({ size, lastModified, contentType }: PreviewMetadataProps) => {
  return (
    <div className="preview-meta" aria-label="File metadata">
      <div className="preview-meta-row">
        <span className="preview-meta-label">Size</span>
        <span className="preview-meta-value">{formatSize(size)}</span>
      </div>
      <div className="preview-meta-row">
        <span className="preview-meta-label">Modified</span>
        <span className="preview-meta-value">{formatModified(lastModified)}</span>
      </div>
      <div className="preview-meta-row">
        <span className="preview-meta-label">Type</span>
        <span className="preview-meta-value">{contentType || "application/octet-stream"}</span>
      </div>
    </div>
  );
};

export const FilePreview = ({ bucket, file, enableS3UriCopy = false }: FilePreviewProps) => {
  const [textContent, setTextContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const isFile = file?.type === "file";
  const fileEntry = isFile ? file : null;

  const metadataQuery = useQuery({
    queryKey: ["object-metadata", bucket, file?.key],
    queryFn: () => getObjectMetadata(bucket, fileEntry!.key),
    enabled: Boolean(fileEntry && bucket),
  });

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!fileEntry || !isTextFile(fileEntry.name)) {
        setTextContent("");
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await getTextPreview(bucket, fileEntry.key);
        if (isMounted) {
          setTextContent(result);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to preview file");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [bucket, fileEntry]);

  useEffect(() => {
    if (copyStatus !== "copied") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopyStatus("idle");
    }, 2000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [copyStatus]);

  useEffect(() => {
    setCopyStatus("idle");
  }, [file?.key]);

  const highlighted = useMemo(() => {
    if (!fileEntry || !textContent) {
      return "";
    }

    const language = getLanguage(fileEntry.name);
    return hljs.highlight(textContent, { language }).value;
  }, [fileEntry, textContent]);

  const metadata = metadataQuery.data;
  const metadataSize = metadata?.size ?? fileEntry?.size;
  const metadataLastModified = metadata?.lastModified ?? fileEntry?.lastModified;
  const metadataContentType = metadata?.contentType ?? fileEntry?.contentType;

  if (!file) {
    return (
      <div className="preview-empty center-feedback">
        <p>
          {enableS3UriCopy ? "Select a file or folder to view details" : "Select a file to preview"}
        </p>
      </div>
    );
  }

  const s3Uri = buildS3Uri(bucket, file);
  const canCopyS3Uri = enableS3UriCopy && Boolean(bucket);
  const handleCopyS3Uri = async () => {
    try {
      await copyTextToClipboard(s3Uri);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  const copyButton = canCopyS3Uri ? (
    <button type="button" onClick={() => void handleCopyS3Uri()}>
      {copyStatus === "copied" ? "Copied!" : "Copy S3 URI"}
    </button>
  ) : null;

  if (file.type === "folder") {
    return (
      <div className="preview-panel">
        <h3>{file.name}</h3>
        {copyButton}
        <p>S3 URI: {s3Uri}</p>
      </div>
    );
  }

  if (isImageFile(file.name)) {
    return (
      <div className="preview-panel">
        <h3>{file.name}</h3>
        {copyButton}
        <PreviewMetadata
          size={metadataSize}
          lastModified={metadataLastModified}
          contentType={metadataContentType}
        />
        <img
          src={getDownloadUrl(bucket, file.key, true)}
          alt={file.name}
          className="preview-image"
        />
      </div>
    );
  }

  if (isTextFile(file.name)) {
    return (
      <div className="preview-panel">
        <h3>{file.name}</h3>
        {copyButton}
        <PreviewMetadata
          size={metadataSize}
          lastModified={metadataLastModified}
          contentType={metadataContentType}
        />
        {isLoading ? (
          <div className="center-feedback status-banner" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <p>Loading preview...</p>
          </div>
        ) : null}
        {error ? (
          <div className="center-feedback error-banner" role="alert">
            <p>{error}</p>
          </div>
        ) : null}
        {!isLoading && !error ? (
          <div className="preview-body">
            <pre className="preview-text" dangerouslySetInnerHTML={{ __html: highlighted }} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="preview-panel">
      <h3>{file.name}</h3>
      {copyButton}
      <PreviewMetadata
        size={metadataSize}
        lastModified={metadataLastModified}
        contentType={metadataContentType}
      />
      <p>No preview available for this file type.</p>
    </div>
  );
};
