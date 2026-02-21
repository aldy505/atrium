import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  checkSession,
  createFolder,
  deleteObject,
  deletePrefix,
  getBuckets,
  getDownloadUrl,
  getObjects,
  login,
  logout,
  uploadFile,
} from "./lib/api";
import type { FileEntry, UploadSelection, UploadSourceFile, UploadTask } from "./lib/types";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CreateFolderDialog } from "../components/CreateFolderDialog";
import { FilePreview } from "../components/FilePreview";
import { LoginForm } from "../components/LoginForm";
import { ObjectTable } from "../components/ObjectTable";
import { UploadDropzone } from "../components/UploadDropzone";

type DeleteTarget = { type: "file"; key: string } | { type: "folder"; key: string } | null;

const UPLOAD_CONCURRENCY = 3;

const normalizeRelativePath = (value: string): string => {
  return value
    .replace(/\\+/g, "/")
    .split("/")
    .filter((segment) => Boolean(segment) && segment !== ".")
    .join("/");
};

const splitPathSegments = (value: string): string[] => {
  return normalizeRelativePath(value)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
};

export const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [filter, setFilter] = useState("");
  const [autoLoadOnScroll, setAutoLoadOnScroll] = useState(true);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [isUploadingBatch, setIsUploadingBatch] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const uploadSourceMapRef = useRef<Map<string, UploadSourceFile>>(new Map());
  const uploadAbortMapRef = useRef<Map<string, () => void>>(new Map());
  const canceledUploadTaskIdsRef = useRef<Set<string>>(new Set());
  const uploadBatchInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        const ok = await checkSession();
        if (active) {
          setIsAuthenticated(ok);
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    };

    void init();

    return () => {
      active = false;
    };
  }, []);

  const bucketsQuery = useQuery({
    queryKey: ["buckets", isAuthenticated],
    queryFn: getBuckets,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!selectedBucket && bucketsQuery.data?.length) {
      setSelectedBucket(bucketsQuery.data[0]);
    }
  }, [bucketsQuery.data, selectedBucket]);

  const objectsQuery = useInfiniteQuery({
    queryKey: ["objects", selectedBucket, currentPrefix],
    queryFn: ({ pageParam }) =>
      getObjects(selectedBucket, currentPrefix, {
        continuationToken: pageParam || undefined,
        maxKeys: 200,
      }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextContinuationToken ?? undefined,
    enabled: isAuthenticated && Boolean(selectedBucket),
  });

  const objectsData = useMemo(() => {
    if (!objectsQuery.data?.pages.length) {
      return null;
    }

    const foldersByKey = new Map<
      string,
      (typeof objectsQuery.data.pages)[number]["folders"][number]
    >();
    const filesByKey = new Map<string, (typeof objectsQuery.data.pages)[number]["files"][number]>();

    for (const page of objectsQuery.data.pages) {
      for (const folder of page.folders) {
        foldersByKey.set(folder.key, folder);
      }

      for (const file of page.files) {
        filesByKey.set(file.key, file);
      }
    }

    const firstPage = objectsQuery.data.pages[0];
    const lastPage = objectsQuery.data.pages[objectsQuery.data.pages.length - 1];

    return {
      bucket: firstPage.bucket,
      prefix: firstPage.prefix,
      folders: Array.from(foldersByKey.values()),
      files: Array.from(filesByKey.values()),
      isTruncated: lastPage.isTruncated,
      nextContinuationToken: lastPage.nextContinuationToken,
    };
  }, [objectsQuery.data]);

  const canLoadMore = Boolean(objectsData?.isTruncated && objectsQuery.hasNextPage);

  useEffect(() => {
    if (!autoLoadOnScroll || !canLoadMore || objectsQuery.isFetchingNextPage) {
      return;
    }

    const target = loadMoreSentinelRef.current;

    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (entry?.isIntersecting && objectsQuery.hasNextPage && !objectsQuery.isFetchingNextPage) {
          void objectsQuery.fetchNextPage();
        }
      },
      {
        root: null,
        rootMargin: "220px 0px",
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [
    autoLoadOnScroll,
    canLoadMore,
    objectsQuery.fetchNextPage,
    objectsQuery.hasNextPage,
    objectsQuery.isFetchingNextPage,
  ]);

  const loginMutation = useMutation({
    mutationFn: ({
      accessKeyId,
      secretAccessKey,
    }: {
      accessKeyId: string;
      secretAccessKey: string;
    }) => login(accessKeyId, secretAccessKey),
    onSuccess: () => {
      setIsAuthenticated(true);
      setAuthError(null);
    },
    onError: (error) => {
      setAuthError(error instanceof Error ? error.message : "Authentication failed");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setIsAuthenticated(false);
      setSelectedBucket("");
      setCurrentPrefix("");
      setSelectedFile(null);
    },
  });

  const handleRefresh = async () => {
    setSelectedFile(null);
    await objectsQuery.refetch();
    await bucketsQuery.refetch();
  };

  const updateUploadTask = (taskId: string, updater: (task: UploadTask) => UploadTask): void => {
    setUploadTasks((prev) => prev.map((task) => (task.id === taskId ? updater(task) : task)));
  };

  const cancelUploadTask = (taskId: string): void => {
    canceledUploadTaskIdsRef.current.add(taskId);
    uploadAbortMapRef.current.get(taskId)?.();

    updateUploadTask(taskId, (task) => {
      if (task.status === "success") {
        return task;
      }

      return {
        ...task,
        status: "canceled",
        error: "Canceled",
      };
    });
  };

  const cancelAllUploads = (): void => {
    setUploadTasks((prev) =>
      prev.map((task) => {
        if (task.status === "success" || task.status === "error" || task.status === "canceled") {
          return task;
        }

        canceledUploadTaskIdsRef.current.add(task.id);
        uploadAbortMapRef.current.get(task.id)?.();

        return {
          ...task,
          status: "canceled",
          error: "Canceled",
        };
      }),
    );
  };

  const ensureFolderPath = async (
    bucket: string,
    prefix: string,
    relativeFolderPath: string,
    createdFolders: Set<string>,
  ): Promise<void> => {
    const segments = splitPathSegments(relativeFolderPath);

    if (!segments.length) {
      return;
    }

    let cursor = prefix;

    for (const segment of segments) {
      const cacheKey = `${cursor}::${segment}`;

      if (!createdFolders.has(cacheKey)) {
        const response = await createFolder(bucket, cursor, segment);
        cursor = response.key;
        createdFolders.add(cacheKey);
      } else {
        cursor = `${cursor}${segment}/`;
      }
    }
  };

  const runUploadBatch = async (
    bucket: string,
    prefix: string,
    sourceFiles: UploadSourceFile[],
    emptyFolders: string[],
  ): Promise<void> => {
    if (uploadBatchInFlightRef.current) {
      setGlobalError("Another upload batch is still running");
      return;
    }

    const dedupedFiles = new Map<string, UploadSourceFile>();

    for (const source of sourceFiles) {
      const path = normalizeRelativePath(source.relativePath || source.file.name);
      if (!path) {
        continue;
      }

      dedupedFiles.set(path, {
        file: source.file,
        relativePath: path,
      });
    }

    const taskRecords = Array.from(dedupedFiles.values()).map((source) => {
      const taskId = crypto.randomUUID();

      uploadSourceMapRef.current.set(taskId, source);

      return {
        id: taskId,
        filename: source.file.name,
        relativePath: source.relativePath,
        size: source.file.size,
        percent: 0,
        status: "queued",
      } satisfies UploadTask;
    });

    if (!taskRecords.length && !emptyFolders.length) {
      return;
    }

    uploadBatchInFlightRef.current = true;
    setUploadTasks((prev) => [...prev, ...taskRecords]);
    setIsUploadingBatch(true);
    setGlobalError(null);

    try {
      const createdFolders = new Set<string>();

      for (const folderPath of Array.from(new Set(emptyFolders))) {
        await ensureFolderPath(bucket, prefix, folderPath, createdFolders);
      }

      const queue = taskRecords.map((task) => task.id);
      let activeCount = 0;

      await new Promise<void>((resolve) => {
        const launchNext = () => {
          while (activeCount < UPLOAD_CONCURRENCY && queue.length) {
            const taskId = queue.shift();

            if (!taskId) {
              continue;
            }

            if (canceledUploadTaskIdsRef.current.has(taskId)) {
              continue;
            }

            const source = uploadSourceMapRef.current.get(taskId);

            if (!source) {
              continue;
            }

            activeCount += 1;

            updateUploadTask(taskId, (task) => ({
              ...task,
              status: "uploading",
              percent: task.percent || 0,
              error: undefined,
            }));

            const request = uploadFile(
              bucket,
              prefix,
              source.file,
              source.relativePath,
              (percent) => {
                updateUploadTask(taskId, (task) => ({ ...task, percent }));
              },
            );

            uploadAbortMapRef.current.set(taskId, request.abort);

            void request.promise
              .then(() => {
                updateUploadTask(taskId, (task) => ({
                  ...task,
                  percent: 100,
                  status: "success",
                  error: undefined,
                }));
              })
              .catch((error: unknown) => {
                const isAbort =
                  error instanceof Error &&
                  (error.name === "AbortError" || error.message === "Upload canceled");

                updateUploadTask(taskId, (task) => ({
                  ...task,
                  status: isAbort ? "canceled" : "error",
                  error: isAbort
                    ? "Canceled"
                    : error instanceof Error
                      ? error.message
                      : "Upload failed",
                }));
              })
              .finally(() => {
                activeCount = Math.max(0, activeCount - 1);
                uploadAbortMapRef.current.delete(taskId);

                if (!queue.length && activeCount === 0) {
                  resolve();
                  return;
                }

                launchNext();
              });
          }

          if (!queue.length && activeCount === 0) {
            resolve();
          }
        };

        launchNext();
      });

      await handleRefresh();
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      uploadBatchInFlightRef.current = false;
      setIsUploadingBatch(false);
    }
  };

  const handleUploadSelection = async (selection: UploadSelection) => {
    if (!selectedBucket) {
      return;
    }

    await runUploadBatch(selectedBucket, currentPrefix, selection.files, selection.emptyFolders);
  };

  const retryUploadTask = async (taskId: string): Promise<void> => {
    if (!selectedBucket) {
      return;
    }

    const source = uploadSourceMapRef.current.get(taskId);

    if (!source) {
      return;
    }

    await runUploadBatch(selectedBucket, currentPrefix, [source], []);
  };

  const deleteMutation = useMutation({
    mutationFn: async (target: DeleteTarget) => {
      if (!target || !selectedBucket) {
        return;
      }

      if (target.type === "file") {
        await deleteObject(selectedBucket, target.key);
      } else {
        await deletePrefix(selectedBucket, target.key);
      }
    },
    onSuccess: async () => {
      setDeleteTarget(null);
      await handleRefresh();
    },
    onError: (error) => {
      setGlobalError(error instanceof Error ? error.message : "Delete failed");
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!selectedBucket) {
        throw new Error("Select a bucket first");
      }

      return createFolder(selectedBucket, currentPrefix, name);
    },
    onSuccess: (response) => {
      setCurrentPrefix(response.key);
      setSelectedFile(null);
      setCreateFolderOpen(false);
      void handleRefresh();
    },
    onError: (error) => {
      setGlobalError(error instanceof Error ? error.message : "Create folder failed");
    },
  });

  const statusText = useMemo(() => {
    if (objectsQuery.isLoading) {
      return "Loading objects...";
    }

    return null;
  }, [objectsQuery.isLoading]);

  const objectsErrorMessage = useMemo(() => {
    if (!objectsQuery.isError) {
      return null;
    }

    return objectsQuery.error instanceof Error
      ? objectsQuery.error.message
      : "Failed to load directory list.";
  }, [objectsQuery.error, objectsQuery.isError]);

  const uploadSummary = useMemo(() => {
    if (!uploadTasks.length) {
      return null;
    }

    const totalBytes = uploadTasks.reduce((sum, task) => sum + task.size, 0);
    const uploadedBytes = uploadTasks.reduce((sum, task) => {
      return sum + Math.floor((task.size * task.percent) / 100);
    }, 0);
    const doneCount = uploadTasks.filter((task) => task.status === "success").length;
    const errorCount = uploadTasks.filter((task) => task.status === "error").length;
    const canceledCount = uploadTasks.filter((task) => task.status === "canceled").length;
    const activeCount = uploadTasks.filter(
      (task) => task.status === "uploading" || task.status === "queued",
    ).length;

    const overallPercent = totalBytes === 0 ? 100 : Math.round((uploadedBytes / totalBytes) * 100);

    return {
      overallPercent,
      doneCount,
      errorCount,
      canceledCount,
      activeCount,
      totalCount: uploadTasks.length,
    };
  }, [uploadTasks]);

  if (authLoading) {
    return (
      <div className="centered">
        <div className="center-feedback">
          <span className="spinner" aria-hidden="true" />
          <p>Loading session...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginForm
        isLoading={loginMutation.isPending}
        error={authError}
        onSubmit={async (accessKeyId, secretAccessKey) =>
          loginMutation.mutateAsync({ accessKeyId, secretAccessKey })
        }
      />
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Buckets</h2>
          <button type="button" onClick={() => void bucketsQuery.refetch()}>
            Refresh
          </button>
        </div>
        <div className="bucket-list">
          {bucketsQuery.data?.map((bucket) => (
            <button
              key={bucket}
              type="button"
              className={bucket === selectedBucket ? "bucket active" : "bucket"}
              onClick={() => {
                setSelectedBucket(bucket);
                setCurrentPrefix("");
                setSelectedFile(null);
              }}
            >
              {bucket}
            </button>
          ))}
        </div>
        <button type="button" className="logout" onClick={() => logoutMutation.mutate()}>
          Sign out
        </button>
      </aside>

      <main className="main-panel">
        <header className="toolbar">
          <div>
            <h1>Object Browser</h1>
            <Breadcrumbs
              bucket={selectedBucket}
              prefix={currentPrefix}
              onNavigate={(prefix) => {
                setCurrentPrefix(prefix);
                setSelectedFile(null);
              }}
            />
          </div>
          <div className="toolbar-actions">
            <label className="auto-load-toggle">
              <input
                type="checkbox"
                checked={autoLoadOnScroll}
                onChange={(event) => setAutoLoadOnScroll(event.target.checked)}
              />
              <span>Auto-load on scroll</span>
            </label>
            <button
              type="button"
              onClick={() => setCreateFolderOpen(true)}
              disabled={!selectedBucket}
            >
              New folder
            </button>
            <input
              type="search"
              value={filter}
              placeholder="Filter by name"
              onChange={(event) => setFilter(event.target.value)}
            />
            <button type="button" onClick={() => void handleRefresh()}>
              Refresh
            </button>
          </div>
        </header>

        <UploadDropzone
          disabled={!selectedBucket || isUploadingBatch}
          onSelection={handleUploadSelection}
        />

        {uploadSummary ? (
          <div className="upload-list">
            <div className="upload-summary">
              <strong>
                Uploads: {uploadSummary.overallPercent}% ({uploadSummary.doneCount}/
                {uploadSummary.totalCount})
              </strong>
              <span>
                Active {uploadSummary.activeCount} · Errors {uploadSummary.errorCount} · Canceled{" "}
                {uploadSummary.canceledCount}
              </span>
              <div className="upload-summary-actions">
                <button type="button" onClick={cancelAllUploads} disabled={!isUploadingBatch}>
                  Cancel all
                </button>
              </div>
            </div>

            {uploadTasks.map((item) => (
              <div key={item.id} className="upload-item">
                <div className="upload-item-main">
                  <span className="upload-item-path">{item.relativePath}</span>
                  <span>
                    {item.percent}% · {item.status}
                  </span>
                </div>
                <div className="upload-item-actions">
                  {item.status === "queued" || item.status === "uploading" ? (
                    <button type="button" onClick={() => cancelUploadTask(item.id)}>
                      Cancel
                    </button>
                  ) : null}
                  {item.status === "error" || item.status === "canceled" ? (
                    <button
                      type="button"
                      onClick={() => void retryUploadTask(item.id)}
                      disabled={isUploadingBatch}
                    >
                      Retry
                    </button>
                  ) : null}
                  {item.error ? <span className="upload-item-error">{item.error}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="content-panel">
          {objectsErrorMessage ? (
            <div className="center-feedback error-banner" role="alert">
              <p>{objectsErrorMessage}</p>
            </div>
          ) : null}

          {!objectsErrorMessage && statusText ? (
            <div className="center-feedback status-banner" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <p>{statusText}</p>
            </div>
          ) : null}

          {!statusText && !objectsErrorMessage && objectsData ? (
            <ObjectTable
              folders={objectsData.folders}
              files={objectsData.files}
              filter={filter}
              onOpenFolder={(key) => {
                setCurrentPrefix(key);
                setSelectedFile(null);
              }}
              onSelectFile={setSelectedFile}
              onDeleteFolder={(key) => setDeleteTarget({ type: "folder", key })}
              onDeleteFile={(key) => setDeleteTarget({ type: "file", key })}
              onDownloadFile={(key) => {
                window.open(getDownloadUrl(selectedBucket, key), "_blank");
              }}
            />
          ) : null}

          {!statusText && !objectsErrorMessage && canLoadMore ? (
            <>
              <div className="table-pagination">
                <button
                  type="button"
                  onClick={() => void objectsQuery.fetchNextPage()}
                  disabled={objectsQuery.isFetchingNextPage}
                >
                  {objectsQuery.isFetchingNextPage ? "Loading more..." : "Load more"}
                </button>
              </div>
              <div
                ref={loadMoreSentinelRef}
                className="table-pagination-sentinel"
                aria-hidden="true"
              />
            </>
          ) : null}

          {globalError ? (
            <div className="center-overlay" role="alert">
              <div className="center-feedback error-banner">
                <p>{globalError}</p>
                <button type="button" onClick={() => setGlobalError(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <section className="preview-column">
        <FilePreview bucket={selectedBucket} file={selectedFile} />
      </section>

      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete ${deleteTarget.type}`}
          message={
            deleteTarget.type === "file"
              ? `Delete file "${deleteTarget.key}"?`
              : `Delete folder "${deleteTarget.key}" and all contents?`
          }
          isLoading={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => deleteMutation.mutateAsync(deleteTarget)}
        />
      ) : null}

      {createFolderOpen ? (
        <CreateFolderDialog
          bucket={selectedBucket}
          prefix={currentPrefix}
          isLoading={createFolderMutation.isPending}
          onCancel={() => setCreateFolderOpen(false)}
          onCreate={async (name) => {
            await createFolderMutation.mutateAsync(name);
          }}
        />
      ) : null}
    </div>
  );
};
