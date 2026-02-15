import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  checkSession,
  deleteObject,
  deletePrefix,
  getBuckets,
  getDownloadUrl,
  getObjects,
  login,
  logout,
  uploadFile,
} from "./lib/api";
import type { FileEntry, UploadProgress } from "./lib/types";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FilePreview } from "../components/FilePreview";
import { LoginForm } from "../components/LoginForm";
import { ObjectTable } from "../components/ObjectTable";
import { UploadDropzone } from "../components/UploadDropzone";

type DeleteTarget = { type: "file"; key: string } | { type: "folder"; key: string } | null;

export const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [filter, setFilter] = useState("");
  const [autoLoadOnScroll, setAutoLoadOnScroll] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

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

    const foldersByKey = new Map<string, (typeof objectsQuery.data.pages)[number]["folders"][number]>();
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

        if (
          entry?.isIntersecting &&
          objectsQuery.hasNextPage &&
          !objectsQuery.isFetchingNextPage
        ) {
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

  const handleUpload = async (files: FileList) => {
    if (!selectedBucket) {
      return;
    }

    setGlobalError(null);

    for (const file of Array.from(files)) {
      setUploadProgress((prev) => [...prev, { filename: file.name, percent: 0 }]);

      try {
        await uploadFile(selectedBucket, currentPrefix, file, (percent) => {
          setUploadProgress((prev) =>
            prev.map((item) => (item.filename === file.name ? { ...item, percent } : item)),
          );
        });
      } catch (error) {
        setGlobalError(error instanceof Error ? error.message : "Upload failed");
      } finally {
        setUploadProgress((prev) => prev.filter((item) => item.filename !== file.name));
      }
    }

    await handleRefresh();
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

        <UploadDropzone disabled={!selectedBucket} onFilesSelected={handleUpload} />

        {uploadProgress.length ? (
          <div className="upload-list">
            {uploadProgress.map((item) => (
              <div key={item.filename} className="upload-item">
                <span>{item.filename}</span>
                <span>{item.percent}%</span>
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
              <div ref={loadMoreSentinelRef} className="table-pagination-sentinel" aria-hidden="true" />
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
    </div>
  );
};
