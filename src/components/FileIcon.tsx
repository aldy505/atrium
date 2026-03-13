type FileIconProps = {
  name: string;
  isFolder?: boolean;
};

const imageExts = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg"]);
const textExts = new Set(["txt", "md", "json", "xml", "csv", "log"]);
const pdfExts = new Set(["pdf"]);

export const getExtension = (name: string): string => {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
};

export const isImageFile = (name: string): boolean => imageExts.has(getExtension(name));
export const isTextFile = (name: string): boolean => textExts.has(getExtension(name));
export const isPdfFile = (name: string): boolean => pdfExts.has(getExtension(name));

export const FileIcon = ({ name, isFolder }: FileIconProps) => {
  if (isFolder) {
    return <span className="file-icon">📁</span>;
  }

  if (isImageFile(name)) {
    return <span className="file-icon">🖼️</span>;
  }

  if (isTextFile(name)) {
    return <span className="file-icon">📄</span>;
  }

  if (isPdfFile(name)) {
    return <span className="file-icon">📕</span>;
  }

  return <span className="file-icon">🧱</span>;
};
