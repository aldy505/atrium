import type { FileEntry, FolderEntry } from "../app/lib/types";
import { FileIcon } from "./FileIcon";

type ObjectTableProps = {
  folders: FolderEntry[];
  files: FileEntry[];
  filter: string;
  onOpenFolder: (key: string) => void;
  onSelectFile: (file: FileEntry) => void;
  onDeleteFolder: (key: string) => void;
  onDeleteFile: (key: string) => void;
  onDownloadFile: (key: string) => void;
};

const formatSize = (size: number): string => {
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

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

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

export const ObjectTable = ({
  folders,
  files,
  filter,
  onOpenFolder,
  onSelectFile,
  onDeleteFolder,
  onDeleteFile,
  onDownloadFile,
}: ObjectTableProps) => {
  const normalized = filter.toLowerCase();

  const filteredFolders = folders.filter((entry) => entry.name.toLowerCase().includes(normalized));
  const filteredFiles = files.filter((entry) => entry.name.toLowerCase().includes(normalized));

  if (!filteredFolders.length && !filteredFiles.length) {
    return <div className="empty-state">No objects found in this location.</div>;
  }

  return (
    <div className="object-table-wrap">
      <table className="object-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Modified</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredFolders.map((folder) => (
            <tr key={folder.key}>
              <td>
                <button
                  type="button"
                  className="link-button name-button"
                  onClick={() => onOpenFolder(folder.key)}
                  title={folder.name}
                >
                  <FileIcon name={folder.name} isFolder />
                  <span className="name-text">{folder.name}</span>
                </button>
              </td>
              <td>-</td>
              <td>-</td>
              <td>
                <button type="button" className="danger" onClick={() => onDeleteFolder(folder.key)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {filteredFiles.map((file) => (
            <tr key={file.key}>
              <td>
                <button
                  type="button"
                  className="link-button name-button"
                  onClick={() => onSelectFile(file)}
                  title={file.name}
                >
                  <FileIcon name={file.name} />
                  <span className="name-text">{file.name}</span>
                </button>
              </td>
              <td>{formatSize(file.size)}</td>
              <td>{formatModified(file.lastModified)}</td>
              <td>
                <div className="table-actions">
                  <button type="button" onClick={() => onDownloadFile(file.key)}>
                    Download
                  </button>
                  <button type="button" className="danger" onClick={() => onDeleteFile(file.key)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
