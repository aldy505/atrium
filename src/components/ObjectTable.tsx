import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileEntry, FolderEntry } from "../app/lib/types";
import { FileIcon } from "./FileIcon";

type ObjectTableProps = {
  folders: FolderEntry[];
  files: FileEntry[];
  filter: string;
  isInitialLoading?: boolean;
  loadingMore?: boolean;
  scrollStateKey: string;
  initialScrollTop?: number;
  enableS3UriCopy?: boolean;
  onScrollProgress?: (progress: number) => void;
  onScrollPositionChange?: (scrollTop: number) => void;
  onOpenFolder: (key: string) => void;
  onSelectFolder: (folder: FolderEntry) => void;
  onSelectFile: (file: FileEntry) => void;
  onDeleteFolder: (key: string) => void;
  onDeleteFile: (key: string) => void;
  onDownloadFile: (key: string) => void;
};

type TableRow =
  | { kind: "folder"; id: string; value: FolderEntry }
  | { kind: "file"; id: string; value: FileEntry };

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
  isInitialLoading = false,
  loadingMore = false,
  scrollStateKey,
  initialScrollTop = 0,
  enableS3UriCopy = false,
  onScrollProgress,
  onScrollPositionChange,
  onOpenFolder,
  onSelectFolder,
  onSelectFile,
  onDeleteFolder,
  onDeleteFile,
  onDownloadFile,
}: ObjectTableProps) => {
  if (isInitialLoading) {
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
            {Array.from({ length: 10 }, (_, index) => (
              <tr key={`skeleton-${index}`}>
                <td>
                  <span className="skeleton-cell skeleton-name" />
                </td>
                <td>
                  <span className="skeleton-cell skeleton-short" />
                </td>
                <td>
                  <span className="skeleton-cell skeleton-medium" />
                </td>
                <td>
                  <span className="skeleton-cell skeleton-short" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const normalized = filter.toLowerCase();
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const appliedScrollKeyRef = useRef<string | null>(null);
  const rows = useMemo<TableRow[]>(() => {
    const filteredFolders = folders.filter((entry) =>
      entry.name.toLowerCase().includes(normalized),
    );
    const filteredFiles = files.filter((entry) => entry.name.toLowerCase().includes(normalized));

    return [
      ...filteredFolders.map(
        (folder) => ({ kind: "folder", id: `folder:${folder.key}`, value: folder }) as const,
      ),
      ...filteredFiles.map(
        (file) => ({ kind: "file", id: `file:${file.key}`, value: file }) as const,
      ),
    ];
  }, [files, folders, normalized]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  useEffect(() => {
    const element = tableScrollRef.current;

    if (!element) {
      return;
    }

    if (appliedScrollKeyRef.current !== scrollStateKey) {
      element.scrollTop = initialScrollTop;
      appliedScrollKeyRef.current = scrollStateKey;
    }
  }, [initialScrollTop, scrollStateKey]);

  useEffect(() => {
    const element = tableScrollRef.current;

    if (!element) {
      return;
    }

    const handleScroll = () => {
      onScrollPositionChange?.(element.scrollTop);
      const scrollable = element.scrollHeight - element.clientHeight;
      const progress =
        scrollable > 0 ? Math.min(1, Math.max(0, element.scrollTop / scrollable)) : 0;
      onScrollProgress?.(progress);
    };

    handleScroll();
    element.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      element.removeEventListener("scroll", handleScroll);
    };
  }, [onScrollPositionChange, onScrollProgress, rows.length]);

  if (!rows.length) {
    return <div className="empty-state">No objects found in this location.</div>;
  }

  return (
    <div>
      <div className="object-table-wrap" ref={tableScrollRef}>
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
            {paddingTop > 0 ? (
              <tr aria-hidden="true">
                <td
                  colSpan={4}
                  style={{ height: `${paddingTop}px`, padding: 0, borderBottom: "none" }}
                />
              </tr>
            ) : null}
            {virtualItems.map((virtualItem) => {
              const row = rows[virtualItem.index];

              if (row.kind === "folder") {
                const folder = row.value;

                return (
                  <tr key={row.id} data-index={virtualItem.index} ref={virtualizer.measureElement}>
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
                      <div className="table-actions">
                        {enableS3UriCopy ? (
                          <button type="button" onClick={() => onSelectFolder(folder)}>
                            Details
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="danger"
                          onClick={() => onDeleteFolder(folder.key)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              const file = row.value;

              return (
                <tr key={row.id} data-index={virtualItem.index} ref={virtualizer.measureElement}>
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
                      <button
                        type="button"
                        className="danger"
                        onClick={() => onDeleteFile(file.key)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {paddingBottom > 0 ? (
              <tr aria-hidden="true">
                <td
                  colSpan={4}
                  style={{ height: `${paddingBottom}px`, padding: 0, borderBottom: "none" }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {loadingMore ? (
        <div className="object-table-loading-more" aria-live="polite">
          Loading more...
        </div>
      ) : null}
    </div>
  );
};
