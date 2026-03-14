import { isImageFile, isPdfFile, isTextFile } from "./FileIcon";

export type PreviewKind = "image" | "text" | "pdf" | "generic";
export type PreviewPresentation = "inline" | "modal-trigger";

export const isPdfContentType = (contentType?: string): boolean => {
  if (!contentType) {
    return false;
  }

  return contentType.split(";")[0]?.trim().toLowerCase() === "application/pdf";
};

export const getPreviewKind = (filename: string, contentType?: string): PreviewKind => {
  if (isImageFile(filename)) {
    return "image";
  }

  if (isPdfFile(filename) || isPdfContentType(contentType)) {
    return "pdf";
  }

  if (isTextFile(filename)) {
    return "text";
  }

  return "generic";
};

export const getPreviewPresentation = (kind: PreviewKind): PreviewPresentation => {
  return kind === "pdf" ? "modal-trigger" : "inline";
};
