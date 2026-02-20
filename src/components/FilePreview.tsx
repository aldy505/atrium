import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import csv from "highlight.js/lib/languages/plaintext";
import { getDownloadUrl, getObjectMetadata, getTextPreview } from "../app/lib/api";
import type { FileEntry } from "../app/lib/types";
import { getExtension, isImageFile, isTextFile } from "./FileIcon";

hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("csv", csv);

type FilePreviewProps = {
  bucket: string;
  file: FileEntry | null;
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

export const FilePreview = ({ bucket, file }: FilePreviewProps) => {
  const [textContent, setTextContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const metadataQuery = useQuery({
    queryKey: ["object-metadata", bucket, file?.key],
    queryFn: () => getObjectMetadata(bucket, file!.key),
    enabled: Boolean(file && bucket),
  });

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!file || !isTextFile(file.name)) {
        setTextContent("");
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await getTextPreview(bucket, file.key);
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
  }, [bucket, file]);

  const highlighted = useMemo(() => {
    if (!file || !textContent) {
      return "";
    }

    const language = getLanguage(file.name);
    return hljs.highlight(textContent, { language }).value;
  }, [file, textContent]);

  const metadata = metadataQuery.data;
  const metadataSize = metadata?.size ?? file?.size;
  const metadataLastModified = metadata?.lastModified ?? file?.lastModified;
  const metadataContentType = metadata?.contentType ?? file?.contentType;

  if (!file) {
    return (
      <div className="preview-empty center-feedback">
        <p>Select a file to preview</p>
      </div>
    );
  }

  if (isImageFile(file.name)) {
    return (
      <div className="preview-panel">
        <h3>{file.name}</h3>
        <img
          src={getDownloadUrl(bucket, file.key, true)}
          alt={file.name}
          className="preview-image"
        />
        <PreviewMetadata
          size={metadataSize}
          lastModified={metadataLastModified}
          contentType={metadataContentType}
        />
      </div>
    );
  }

  if (isTextFile(file.name)) {
    return (
      <div className="preview-panel">
        <h3>{file.name}</h3>
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
        <PreviewMetadata
          size={metadataSize}
          lastModified={metadataLastModified}
          contentType={metadataContentType}
        />
      </div>
    );
  }

  return (
    <div className="preview-panel">
      <h3>{file.name}</h3>
      <p>No preview available for this file type.</p>
      <PreviewMetadata
        size={metadataSize}
        lastModified={metadataLastModified}
        contentType={metadataContentType}
      />
    </div>
  );
};
