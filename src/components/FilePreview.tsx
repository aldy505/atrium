import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import csv from "highlight.js/lib/languages/plaintext";
import {
  getDownloadUrl,
  getObjectMetadata,
  getObjectTags,
  getTextPreview,
  putObjectTags,
} from "../app/lib/api";
import { buildS3Uri, copyTextToClipboard } from "../app/lib/s3-uri";
import type { FileEntry, FolderEntry, ObjectTag } from "../app/lib/types";
import { getExtension, isImageFile, isPdfFile, isTextFile } from "./FileIcon";

hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("csv", csv);

const PdfPreview = lazy(async () => {
  const module = await import("./PdfPreview");
  return { default: module.PdfPreview };
});

type FilePreviewProps = {
  bucket: string;
  file: FileEntry | FolderEntry | null;
  enableS3UriCopy?: boolean;
};

type EditableTag = {
  id: string;
  key: string;
  value: string;
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

const isPdfContentType = (contentType?: string): boolean => {
  if (!contentType) {
    return false;
  }

  return contentType.split(";")[0]?.trim().toLowerCase() === "application/pdf";
};

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const MAX_TAGS = 10;
const MAX_TAG_KEY_LENGTH = 128;
const MAX_TAG_VALUE_LENGTH = 256;

const createTagId = (): string => {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
};

const mapObjectTagsToEditable = (tags: ObjectTag[]): EditableTag[] => {
  return tags.map((tag) => ({
    id: createTagId(),
    key: tag.key,
    value: tag.value,
  }));
};

const normalizeTags = (tags: EditableTag[]): ObjectTag[] => {
  return tags.map((tag) => ({
    key: tag.key.trim(),
    value: tag.value,
  }));
};

const sortTags = (tags: ObjectTag[]): ObjectTag[] => {
  return [...tags].sort((left, right) => {
    const keyCompare = left.key.localeCompare(right.key);
    return keyCompare !== 0 ? keyCompare : left.value.localeCompare(right.value);
  });
};

const areTagsEqual = (left: EditableTag[], right: EditableTag[]): boolean => {
  const normalizedLeft = sortTags(normalizeTags(left));
  const normalizedRight = sortTags(normalizeTags(right));

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((tag, index) => {
    const candidate = normalizedRight[index];
    return candidate?.key === tag.key && candidate?.value === tag.value;
  });
};

const validateTags = (tags: EditableTag[]): string | null => {
  if (tags.length > MAX_TAGS) {
    return `You can only set up to ${MAX_TAGS} tags.`;
  }

  const seen = new Set<string>();

  for (const tag of tags) {
    const key = tag.key.trim();

    if (!key) {
      return "Tag key is required.";
    }

    if (key.length > MAX_TAG_KEY_LENGTH) {
      return `Tag keys must be ${MAX_TAG_KEY_LENGTH} characters or less.`;
    }

    if (tag.value.length > MAX_TAG_VALUE_LENGTH) {
      return `Tag values must be ${MAX_TAG_VALUE_LENGTH} characters or less.`;
    }

    if (seen.has(key)) {
      return "Tag keys must be unique.";
    }

    seen.add(key);
  }

  return null;
};

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
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [editableTags, setEditableTags] = useState<EditableTag[]>([]);
  const [initialTags, setInitialTags] = useState<EditableTag[]>([]);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [tagFeedback, setTagFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const isFile = file?.type === "file";
  const fileEntry = isFile ? file : null;

  const metadataQuery = useQuery({
    queryKey: ["object-metadata", bucket, fileEntry?.key],
    queryFn: () => getObjectMetadata(bucket, fileEntry!.key),
    enabled: Boolean(fileEntry && bucket),
  });

  const tagsQuery = useQuery({
    queryKey: ["object-tags", bucket, fileEntry?.key],
    queryFn: () => getObjectTags(bucket, fileEntry!.key),
    enabled: Boolean(fileEntry && bucket),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 60_000,
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

  useEffect(() => {
    setTagFeedback(null);
    setEditableTags([]);
    setInitialTags([]);
  }, [fileEntry?.key]);

  useEffect(() => {
    if (!tagsQuery.data) {
      return;
    }

    const mappedTags = mapObjectTagsToEditable(tagsQuery.data.tags);

    // Don't overwrite local edits: only sync when editable and initial tags match
    if (!areTagsEqual(editableTags, initialTags)) {
      return;
    }

    // Avoid redundant updates when local tags already match the fetched tags
    if (areTagsEqual(initialTags, mappedTags)) {
      return;
    }

    setEditableTags(mappedTags);
    setInitialTags(mappedTags);
  }, [editableTags, initialTags, tagsQuery.data]);

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
  const isPdfPreviewable = Boolean(
    fileEntry && (isPdfFile(fileEntry.name) || isPdfContentType(metadataContentType)),
  );
  const hasLoadedTags = tagsQuery.status === "success";
  const isTagsLoading = tagsQuery.isPending || (tagsQuery.isFetching && !hasLoadedTags);
  const isTaggingSupported = hasLoadedTags && Boolean(tagsQuery.data?.isSupported);
  const tagQueryError =
    tagsQuery.error instanceof Error ? tagsQuery.error.message : "Failed to load tags.";
  const tagValidationError = validateTags(editableTags);
  const tagsChanged = !areTagsEqual(editableTags, initialTags);
  const canAddTag =
    isTaggingSupported && !isTagsLoading && !isSavingTags && editableTags.length < MAX_TAGS;
  const canSaveTags =
    isTaggingSupported && !isSavingTags && !isTagsLoading && tagsChanged && !tagValidationError;

  useEffect(() => {
    setIsPdfModalOpen(Boolean(fileEntry && isPdfPreviewable));
  }, [fileEntry?.key, isPdfPreviewable]);

  if (!file) {
    return (
      <div className="preview-empty center-feedback">
        <p>Select a file to preview</p>
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
      // Clipboard copy failed; keep default button label without changing status.
    }
  };

  const copyButton = canCopyS3Uri ? (
    <button type="button" onClick={() => void handleCopyS3Uri()}>
      {copyStatus === "copied" ? "Copied!" : "Copy S3 URI"}
    </button>
  ) : null;

  const handleAddTag = () => {
    if (!canAddTag) {
      return;
    }

    setTagFeedback(null);
    setEditableTags((previous) => [...previous, { id: createTagId(), key: "", value: "" }]);
  };

  const handleRemoveTag = (tagId: string) => {
    setTagFeedback(null);
    setEditableTags((previous) => previous.filter((tag) => tag.id !== tagId));
  };

  const handleChangeTag = (tagId: string, field: "key" | "value", value: string) => {
    setTagFeedback(null);
    setEditableTags((previous) =>
      previous.map((tag) => (tag.id === tagId ? { ...tag, [field]: value } : tag)),
    );
  };

  const handleSaveTags = async () => {
    if (!fileEntry || !isTaggingSupported) {
      return;
    }

    const validationError = validateTags(editableTags);
    if (validationError) {
      setTagFeedback({ type: "error", message: validationError });
      return;
    }

    try {
      setIsSavingTags(true);
      await putObjectTags(bucket, fileEntry.key, normalizeTags(editableTags));
      const refreshed = await tagsQuery.refetch();
      if (refreshed.data?.tags) {
        const mappedTags = mapObjectTagsToEditable(refreshed.data.tags);
        setEditableTags(mappedTags);
        setInitialTags(mappedTags);
      }
      setTagFeedback({ type: "success", message: "Tags saved." });
    } catch (saveError) {
      setTagFeedback({
        type: "error",
        message: saveError instanceof Error ? saveError.message : "Failed to save tags.",
      });
    } finally {
      setIsSavingTags(false);
    }
  };

  const tagsSection = fileEntry ? (
    <section className="preview-tags" aria-label="Object tags">
      <div className="preview-tags-header">
        <h4>Tags</h4>
        <button type="button" onClick={handleAddTag} disabled={!canAddTag}>
          Add Tag
        </button>
      </div>
      {isTagsLoading ? <p className="preview-tags-note">Loading tags...</p> : null}
      {tagsQuery.isError ? <p className="preview-tags-error">{tagQueryError}</p> : null}
      {hasLoadedTags && isTaggingSupported && editableTags.length === 0 ? (
        <p className="preview-tags-note">No tags yet. Add a tag to get started.</p>
      ) : null}
      {hasLoadedTags && isTaggingSupported ? (
        <div className="preview-tags-list">
          {editableTags.map((tag, index) => (
            <div className="preview-tags-row" key={tag.id}>
              <input
                type="text"
                value={tag.key}
                placeholder="Key"
                aria-label={`Tag key ${index + 1}`}
                maxLength={MAX_TAG_KEY_LENGTH}
                disabled={isSavingTags}
                onChange={(event) => {
                  handleChangeTag(tag.id, "key", event.target.value);
                }}
              />
              <input
                type="text"
                value={tag.value}
                placeholder="Value"
                aria-label={`Tag value ${index + 1}`}
                maxLength={MAX_TAG_VALUE_LENGTH}
                disabled={isSavingTags}
                onChange={(event) => {
                  handleChangeTag(tag.id, "value", event.target.value);
                }}
              />
              <button
                type="button"
                aria-label={`Remove tag ${tag.key.trim() || index + 1}`}
                onClick={() => {
                  handleRemoveTag(tag.id);
                }}
                disabled={isSavingTags}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {hasLoadedTags && !isTaggingSupported ? (
        <p className="preview-tags-note">
          {tagsQuery.data?.unsupportedReason ||
            "Object tagging is unavailable for this provider or current credentials."}
        </p>
      ) : null}
      {tagValidationError ? (
        <p className="preview-tags-error" role="alert">
          {tagValidationError}
        </p>
      ) : null}
      {tagFeedback ? (
        <p
          className={tagFeedback.type === "error" ? "preview-tags-error" : "preview-tags-success"}
          role={tagFeedback.type === "error" ? "alert" : undefined}
          aria-live="polite"
        >
          {tagFeedback.message}
        </p>
      ) : null}
      <div className="preview-tags-actions">
        <button type="button" onClick={() => void handleSaveTags()} disabled={!canSaveTags}>
          {isSavingTags ? "Saving..." : "Save Tags"}
        </button>
      </div>
    </section>
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
        {tagsSection}
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
        {tagsSection}
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

  if (isPdfPreviewable && fileEntry) {
    return (
      <>
        <div className="preview-panel">
          <h3>{file.name}</h3>
          {copyButton}
          <PreviewMetadata
            size={metadataSize}
            lastModified={metadataLastModified}
            contentType={metadataContentType}
          />
          {tagsSection}
          <div className="status-banner preview-pdf-card">
            <p>
              PDF preview opens in a larger viewer so page navigation, thumbnails, search, and zoom
              remain usable.
            </p>
            <div className="preview-pdf-actions">
              <button
                type="button"
                onClick={() => {
                  setIsPdfModalOpen(true);
                }}
              >
                Open preview
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.assign(getDownloadUrl(bucket, file.key));
                }}
              >
                Download PDF
              </button>
            </div>
          </div>
        </div>
        {isPdfModalOpen ? (
          <Suspense
            fallback={
              <div className="modal-overlay pdf-preview-overlay" role="dialog" aria-modal="true">
                <div className="modal-card pdf-preview-dialog">
                  <div
                    className="center-feedback status-banner pdf-preview-loading-shell"
                    aria-live="polite"
                  >
                    <span className="spinner" aria-hidden="true" />
                    <p>Loading PDF viewer...</p>
                  </div>
                </div>
              </div>
            }
          >
            <PdfPreview
              key={file.key}
              bucket={bucket}
              fileKey={file.key}
              fileName={file.name}
              onClose={() => {
                setIsPdfModalOpen(false);
              }}
            />
          </Suspense>
        ) : null}
      </>
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
      {tagsSection}
      <p>No preview available for this file type.</p>
    </div>
  );
};
