import type { FileEntry, FolderEntry } from "./types";

type S3Entry = FileEntry | FolderEntry;

export const buildS3Uri = (bucket: string, entry: S3Entry): string => {
  const normalizedKey = entry.key.replace(/^\/+/, "");
  const key =
    entry.type === "folder"
      ? normalizedKey.endsWith("/")
        ? normalizedKey
        : `${normalizedKey}/`
      : normalizedKey.replace(/\/+$/, "");

  return key ? `s3://${bucket}/${key}` : `s3://${bucket}`;
};

export const copyTextToClipboard = async (text: string): Promise<void> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to execCommand fallback when Clipboard API write fails.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard API unavailable");
  }

  let textarea: HTMLTextAreaElement | null = null;
  let copied = false;

  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    copied = document.execCommand("copy");
  } finally {
    if (textarea && textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  }

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
};
