import type { FileEntry } from "../app/lib/types";

export type PdfPreviewTarget = {
  bucket: string;
  fileKey: string;
  fileName: string;
};

export const buildPdfPreviewTarget = (
  bucket: string,
  file: Pick<FileEntry, "key" | "name">,
): PdfPreviewTarget => ({
  bucket,
  fileKey: file.key,
  fileName: file.name,
});

export const shouldClosePdfPreview = (
  target: PdfPreviewTarget | null,
  bucket: string,
  selectedObject: Pick<FileEntry, "key"> | null,
  isPreviewOpen: boolean,
): boolean => {
  if (!target) {
    return false;
  }

  if (!bucket || bucket !== target.bucket) {
    return true;
  }

  if (!selectedObject || selectedObject.key !== target.fileKey) {
    return true;
  }

  return !isPreviewOpen;
};
