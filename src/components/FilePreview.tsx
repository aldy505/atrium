import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import csv from "highlight.js/lib/languages/plaintext";
import { getDownloadUrl, getTextPreview } from "../app/lib/api";
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

export const FilePreview = ({ bucket, file }: FilePreviewProps) => {
  const [textContent, setTextContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
          <pre className="preview-text" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="preview-panel">
      <h3>{file.name}</h3>
      <p>No preview available for this file type.</p>
    </div>
  );
};
