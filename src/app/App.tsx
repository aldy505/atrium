import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from "@tanstack/react-query";
import {
  checkSession,
  createFolder,
  deleteObject,
  deletePrefix,
  getBuckets,
  getBucketSize,
  getDownloadUrl,
  getObjects,
  getRuntimeConfig,
  login,
  requestBucketSizeCalculation,
  logout,
  uploadFile,
} from "./lib/api";
import type {
  BucketSizeResponse,
  FileEntry,
  ListObjectsResponse,
  UploadSelection,
  UploadSourceFile,
  UploadTask,
} from "./lib/types";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CreateFolderDialog } from "../components/CreateFolderDialog";
import { FilePreview } from "../components/FilePreview";
import { LoginForm } from "../components/LoginForm";
import { ObjectTable } from "../components/ObjectTable";
import {
  buildPdfPreviewTarget,
  shouldClosePdfPreview,
  type PdfPreviewTarget,
} from "../components/pdf-preview-target";
import { UploadDropzone } from "../components/UploadDropzone";

type DeleteTarget = { type: "file"; key: string } | { type: "folder"; key: string } | null;
type SelectedObject = FileEntry;
type ObjectsPageParam = { continuationToken?: string; maxKeys: number };
type SortMode =
  | "name-asc"
  | "name-desc"
  | "size-asc"
  | "size-desc"
  | "modified-asc"
  | "modified-desc";

const UPLOAD_CONCURRENCY = 3;
const INITIAL_PAGE_SIZE = 100;
const PdfPreview = lazy(async () => {
  const module = await import("../components/PdfPreview");
  return { default: module.PdfPreview };
});

const calculateNextPageSize = (loadedItems: number): number => {
  if (loadedItems <= 100) {
    return 250;
  }

  if (loadedItems < 500) {
    return 500;
  }

  return 1000;
};

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

const buildPromptedFolderKey = (bucket: string, key: string): string => `${bucket}::${key}`;

const parseModifiedTime = (lastModified?: string): number => {
  if (!lastModified) {
    return 0;
  }

  const rawTime = new Date(lastModified).getTime();
  return Number.isNaN(rawTime) ? 0 : rawTime;
};

export const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [selectedObject, setSelectedObject] = useState<SelectedObject | null>(null);
  const [filter, setFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [isSearchDebouncing, setIsSearchDebouncing] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");
  const [isSorting, setIsSorting] = useState(false);
  const [folderLoadLimit, setFolderLoadLimit] = useState<number | null>(null);
  const [pendingLargeFolderKey, setPendingLargeFolderKey] = useState<string | null>(null);
  const [autoLoadOnScroll, setAutoLoadOnScroll] = useState(true);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [isUploadingBatch, setIsUploadingBatch] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [pdfPreviewTarget, setPdfPreviewTarget] = useState<PdfPreviewTarget | null>(null);
  const previewToggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestorePreviewToggleFocusRef = useRef(false);
  const prefetchInFlightRef = useRef(false);
  const promptedFolderKeysRef = useRef<Set<string>>(new Set());
  const promptedFolderLoadLimitsRef = useRef<Map<string, number | null>>(new Map());
  const requestedBucketSizeBucketsRef = useRef<Set<string>>(new Set());
  const tableScrollPositionsRef = useRef<Map<string, number>>(new Map());
  const scrollPersistTimeoutRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef<number | null>(null);
  const lastScrollKeyRef = useRef<string | null>(null);
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

  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: getRuntimeConfig,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!selectedBucket && bucketsQuery.data?.length) {
      setSelectedBucket(bucketsQuery.data[0]);
    }
  }, [bucketsQuery.data, selectedBucket]);

  const bucketSizeQuery = useQuery({
    queryKey: ["bucket-size", selectedBucket],
    queryFn: async (): Promise<BucketSizeResponse | null> => {
      if (!selectedBucket) {
        return null;
      }

      const size = await getBucketSize(selectedBucket);

      if (size) {
        return size;
      }

      if (!requestedBucketSizeBucketsRef.current.has(selectedBucket)) {
        requestedBucketSizeBucketsRef.current.add(selectedBucket);
        await requestBucketSizeCalculation(selectedBucket).catch(() => undefined);
      }

      return null;
    },
    enabled: isAuthenticated && Boolean(selectedBucket),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const data = query.state.data as BucketSizeResponse | null | undefined;

      if (!selectedBucket || data) {
        return false;
      }

      return requestedBucketSizeBucketsRef.current.has(selectedBucket) ? 15_000 : false;
    },
  });

  const isBucketSizeKnown = bucketSizeQuery.data !== null;
  const isBucketSizeUnknown =
    !isBucketSizeKnown &&
    Boolean(selectedBucket) &&
    requestedBucketSizeBucketsRef.current.has(selectedBucket);
  const isLargeBucket = isBucketSizeKnown
    ? (bucketSizeQuery.data?.objectCount ?? 0) >= 10_000
    : false;
  const shouldShowLargeFolderPrompt = isLargeBucket || isBucketSizeUnknown;

  const objectsQuery = useInfiniteQuery<
    ListObjectsResponse,
    Error,
    InfiniteData<ListObjectsResponse>,
    [string, string, string, number],
    ObjectsPageParam
  >({
    queryKey: ["objects", selectedBucket, currentPrefix, folderLoadLimit ?? 0],
    queryFn: ({ pageParam }) =>
      getObjects(selectedBucket, currentPrefix, {
        continuationToken: pageParam.continuationToken,
        maxKeys: pageParam.maxKeys,
      }),
    initialPageParam: {
      continuationToken: undefined,
      maxKeys:
        folderLoadLimit !== null
          ? Math.min(INITIAL_PAGE_SIZE, Math.max(1, folderLoadLimit))
          : INITIAL_PAGE_SIZE,
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.nextContinuationToken) {
        return undefined;
      }

      const loadedItems = allPages.reduce(
        (sum, page) => sum + page.folders.length + page.files.length,
        0,
      );
      const remainingItems =
        folderLoadLimit !== null
          ? Math.max(0, folderLoadLimit - loadedItems)
          : Number.POSITIVE_INFINITY;

      if (remainingItems <= 0) {
        return undefined;
      }

      const nextMaxKeys = Math.min(calculateNextPageSize(loadedItems), remainingItems);

      return {
        continuationToken: lastPage.nextContinuationToken,
        maxKeys: Math.max(1, nextMaxKeys),
      };
    },
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
  const tableStateKey = `${selectedBucket}::${currentPrefix}`;
  const loadedObjectCount = (objectsData?.folders.length ?? 0) + (objectsData?.files.length ?? 0);
  const sortTier =
    loadedObjectCount < 1_000 ? "small" : loadedObjectCount < 10_000 ? "medium" : "large";
  const nonNativeSortDisabled = sortTier === "large";
  const loadedObjectsLabel = objectsData
    ? objectsData.isTruncated
      ? `Loaded ${loadedObjectCount.toLocaleString()}+ objects`
      : `Loaded ${loadedObjectCount.toLocaleString()} objects`
    : null;
  const searchLimitWarning =
    loadedObjectCount >= 10_000 && filter
      ? "Search is limited to currently loaded items. For better results, navigate by folder prefix."
      : null;
  const sortWarning =
    nonNativeSortDisabled && sortMode !== "name-asc"
      ? "Large folder mode: size/date sorting is disabled for performance."
      : null;
  const folderHealthLabel = isLargeBucket
    ? `Large bucket: ~${(bucketSizeQuery.data?.objectCount ?? 0).toLocaleString()} objects`
    : isBucketSizeUnknown
      ? "Bucket size is being calculated. Large-folder warnings stay enabled until ready."
      : null;

  useEffect(() => {
    if (searchInput === filter) {
      setIsSearchDebouncing(false);
      return;
    }

    setIsSearchDebouncing(true);
    const timeoutId = window.setTimeout(() => {
      setFilter(searchInput);
      setIsSearchDebouncing(false);
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [filter, searchInput]);

  useEffect(() => {
    if (sortTier === "medium" && sortMode !== "name-asc") {
      setIsSorting(true);
      const timeoutId = window.setTimeout(() => {
        setIsSorting(false);
      }, 220);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    setIsSorting(false);
  }, [sortMode, sortTier]);

  const clearSearch = useCallback(() => {
    setSearchInput("");
    setFilter("");
    setIsSearchDebouncing(false);
  }, []);

  const sortedObjects = useMemo(() => {
    if (!objectsData) {
      return null;
    }

    const folders = [...objectsData.folders];
    const files = [...objectsData.files];

    if (sortMode === "name-asc") {
      return { folders, files };
    }

    if (sortMode === "name-desc") {
      folders.reverse();
      files.reverse();
      return { folders, files };
    }

    if (nonNativeSortDisabled) {
      return { folders, files };
    }

    if (sortMode === "size-asc") {
      files.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
    } else if (sortMode === "size-desc") {
      files.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
    } else if (sortMode === "modified-asc") {
      files.sort((a, b) => {
        const timeA = parseModifiedTime(a.lastModified);
        const timeB = parseModifiedTime(b.lastModified);
        return timeA - timeB || a.name.localeCompare(b.name);
      });
    } else if (sortMode === "modified-desc") {
      files.sort((a, b) => {
        const timeA = parseModifiedTime(a.lastModified);
        const timeB = parseModifiedTime(b.lastModified);
        return timeB - timeA || a.name.localeCompare(b.name);
      });
    }

    folders.sort((a, b) => a.name.localeCompare(b.name));
    return { folders, files };
  }, [nonNativeSortDisabled, objectsData, sortMode]);

  const saveScrollPosition = useCallback(
    (scrollTop: number) => {
      const key = `${selectedBucket}::${currentPrefix}`;
      tableScrollPositionsRef.current.set(key, scrollTop);
      lastScrollTopRef.current = scrollTop;
      lastScrollKeyRef.current = key;

      if (scrollPersistTimeoutRef.current !== null) {
        return;
      }

      scrollPersistTimeoutRef.current = window.setTimeout(() => {
        scrollPersistTimeoutRef.current = null;
        const latestKey = lastScrollKeyRef.current;
        const latestValue = lastScrollTopRef.current;

        if (!latestKey || typeof latestValue !== "number") {
          return;
        }

        window.sessionStorage.setItem(`object-scroll:${latestKey}`, String(latestValue));
      }, 100);
    },
    [currentPrefix, selectedBucket],
  );

  useEffect(() => {
    return () => {
      if (scrollPersistTimeoutRef.current !== null) {
        window.clearTimeout(scrollPersistTimeoutRef.current);
        scrollPersistTimeoutRef.current = null;
      }

      const latestKey = lastScrollKeyRef.current;
      const latestValue = lastScrollTopRef.current;

      if (latestKey && typeof latestValue === "number") {
        window.sessionStorage.setItem(`object-scroll:${latestKey}`, String(latestValue));
      }
    };
  }, []);

  const loadSavedScrollPosition = useCallback((key: string): number => {
    const inMemory = tableScrollPositionsRef.current.get(key);

    if (typeof inMemory === "number") {
      return inMemory;
    }

    const rawValue = window.sessionStorage.getItem(`object-scroll:${key}`);

    if (!rawValue) {
      return 0;
    }

    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);
  const restoredScrollTop = useMemo(
    () => loadSavedScrollPosition(tableStateKey),
    [loadSavedScrollPosition, tableStateKey],
  );

  const handleTableScrollProgress = useCallback(
    (progress: number) => {
      if (
        !autoLoadOnScroll ||
        progress < 0.8 ||
        !canLoadMore ||
        objectsQuery.isFetchingNextPage ||
        prefetchInFlightRef.current
      ) {
        return;
      }

      prefetchInFlightRef.current = true;
      void objectsQuery.fetchNextPage().finally(() => {
        prefetchInFlightRef.current = false;
      });
    },
    [autoLoadOnScroll, canLoadMore, objectsQuery],
  );

  const navigateToPrefix = useCallback(
    (prefix: string) => {
      setCurrentPrefix(prefix);
      clearSearch();
      setSelectedObject(null);
      setPdfPreviewTarget(null);
    },
    [clearSearch],
  );

  const handleOpenFolder = useCallback(
    (key: string) => {
      const promptedKey = buildPromptedFolderKey(selectedBucket, key);

      if (shouldShowLargeFolderPrompt && !promptedFolderKeysRef.current.has(promptedKey)) {
        setPendingLargeFolderKey(key);
        return;
      }

      if (promptedFolderKeysRef.current.has(promptedKey)) {
        const storedLimit = promptedFolderLoadLimitsRef.current.get(promptedKey);
        setFolderLoadLimit(typeof storedLimit === "undefined" ? null : storedLimit);
      }

      navigateToPrefix(key);
    },
    [navigateToPrefix, selectedBucket, shouldShowLargeFolderPrompt],
  );

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
      clearSearch();
      setSelectedObject(null);
      setIsPreviewOpen(false);
      setPdfPreviewTarget(null);
    },
  });

  const handleRefresh = async () => {
    setSelectedObject(null);
    setIsPreviewOpen(false);
    setPdfPreviewTarget(null);
    await objectsQuery.refetch();
    await bucketsQuery.refetch();
  };

  const handleSelectFile = useCallback((file: SelectedObject) => {
    setSelectedObject(file);
    setIsPreviewOpen(true);
  }, []);

  const isPreviewVisible = isPreviewOpen && Boolean(selectedObject);
  const closePreview = useCallback(() => {
    shouldRestorePreviewToggleFocusRef.current = true;
    setIsPreviewOpen(false);
    setPdfPreviewTarget(null);
  }, []);

  const handleOpenPdfPreview = useCallback(
    (file: SelectedObject) => {
      setPdfPreviewTarget(buildPdfPreviewTarget(selectedBucket, file));
    },
    [selectedBucket],
  );

  useEffect(() => {
    if (isPreviewVisible || !shouldRestorePreviewToggleFocusRef.current) {
      return;
    }

    previewToggleButtonRef.current?.focus();
    shouldRestorePreviewToggleFocusRef.current = false;
  }, [isPreviewVisible]);

  useEffect(() => {
    if (!shouldClosePdfPreview(pdfPreviewTarget, selectedBucket, selectedObject, isPreviewOpen)) {
      return;
    }

    setPdfPreviewTarget(null);
  }, [isPreviewOpen, pdfPreviewTarget, selectedBucket, selectedObject]);

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
      clearSearch();
      setSelectedObject(null);
      setCreateFolderOpen(false);
      void handleRefresh();
    },
    onError: (error) => {
      setGlobalError(error instanceof Error ? error.message : "Create folder failed");
    },
  });

  const statusText = useMemo(() => {
    if (isSearchDebouncing) {
      return "Preparing search...";
    }

    if (isSorting) {
      return "Sorting objects...";
    }

    return null;
  }, [isSearchDebouncing, isSorting]);

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
    <div className={isPreviewVisible ? "layout layout-with-preview" : "layout"}>
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
                setFolderLoadLimit(null);
                clearSearch();
                setSelectedObject(null);
                setIsPreviewOpen(false);
                setPdfPreviewTarget(null);
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
                setFolderLoadLimit(null);
                navigateToPrefix(prefix);
              }}
            />
            {folderHealthLabel ? (
              <p className="toolbar-note warning-text">{folderHealthLabel}</p>
            ) : null}
          </div>
          <div className="toolbar-actions">
            <button
              type="button"
              className="preview-toggle"
              ref={previewToggleButtonRef}
              onClick={() => {
                if (isPreviewVisible) {
                  closePreview();
                  return;
                }

                if (selectedObject) {
                  setIsPreviewOpen(true);
                }
              }}
              disabled={!selectedObject}
              aria-controls={isPreviewVisible ? "object-preview" : undefined}
              aria-expanded={isPreviewVisible}
            >
              {isPreviewVisible ? "Hide preview" : "Show preview"}
            </button>
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
              value={searchInput}
              placeholder="Filter by name"
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <select
              value={sortMode}
              onChange={(event) => {
                const nextSort = event.target.value as SortMode;
                if (nonNativeSortDisabled && nextSort !== "name-asc") {
                  setSortMode("name-asc");
                  return;
                }

                setSortMode(nextSort);
              }}
            >
              <option value="name-asc">Name (A-Z, S3 native)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="size-asc" disabled={nonNativeSortDisabled}>
                Size (smallest first)
              </option>
              <option value="size-desc" disabled={nonNativeSortDisabled}>
                Size (largest first)
              </option>
              <option value="modified-asc" disabled={nonNativeSortDisabled}>
                Modified (oldest first)
              </option>
              <option value="modified-desc" disabled={nonNativeSortDisabled}>
                Modified (newest first)
              </option>
            </select>
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

          {!objectsErrorMessage && (objectsData || objectsQuery.isLoading) ? (
            <>
              <ObjectTable
                folders={sortedObjects?.folders ?? []}
                files={sortedObjects?.files ?? []}
                filter={filter}
                loadingMore={objectsQuery.isFetchingNextPage}
                scrollStateKey={tableStateKey}
                initialScrollTop={restoredScrollTop}
                isInitialLoading={objectsQuery.isLoading}
                onScrollProgress={handleTableScrollProgress}
                onScrollPositionChange={saveScrollPosition}
                onOpenFolder={handleOpenFolder}
                onSelectFile={handleSelectFile}
                onDeleteFolder={(key) => setDeleteTarget({ type: "folder", key })}
                onDeleteFile={(key) => setDeleteTarget({ type: "file", key })}
                onDownloadFile={(key) => {
                  window.open(getDownloadUrl(selectedBucket, key), "_blank");
                }}
              />
              {loadedObjectsLabel ? (
                <div className="table-progress" aria-live="polite">
                  {loadedObjectsLabel}
                </div>
              ) : null}
              {searchLimitWarning ? (
                <div className="table-progress warning-text" role="status">
                  {searchLimitWarning}
                </div>
              ) : null}
              {sortWarning ? (
                <div className="table-progress warning-text" role="status">
                  {sortWarning}
                </div>
              ) : null}
              {folderLoadLimit !== null ? (
                <div className="table-progress" role="status">
                  Limited mode active: loading first {folderLoadLimit.toLocaleString()} objects.
                </div>
              ) : null}
            </>
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
              <div className="table-pagination-sentinel" aria-hidden="true" />
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

      {isPreviewVisible ? (
        <section id="object-preview" className="preview-column">
          <div className="preview-column-header">
            <h2>Preview</h2>
            <button type="button" onClick={closePreview}>
              Collapse
            </button>
          </div>
          <FilePreview
            bucket={selectedBucket}
            file={selectedObject}
            enableS3UriCopy={runtimeConfigQuery.data?.features?.enableS3UriCopy ?? false}
            onOpenPdfPreview={handleOpenPdfPreview}
          />
        </section>
      ) : null}

      {pendingLargeFolderKey ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>Large folder warning</h3>
            <p>
              This bucket is estimated at{" "}
              {(bucketSizeQuery.data?.objectCount ?? loadedObjectCount).toLocaleString()} objects.
              Loading all objects may be slow.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  const promptedKey = buildPromptedFolderKey(selectedBucket, pendingLargeFolderKey);
                  promptedFolderKeysRef.current.add(promptedKey);
                  promptedFolderLoadLimitsRef.current.set(promptedKey, 1000);
                  setFolderLoadLimit(1000);
                  navigateToPrefix(pendingLargeFolderKey);
                  setPendingLargeFolderKey(null);
                }}
              >
                Load first 1,000
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const promptedKey = buildPromptedFolderKey(selectedBucket, pendingLargeFolderKey);
                  promptedFolderKeysRef.current.add(promptedKey);
                  promptedFolderLoadLimitsRef.current.set(promptedKey, null);
                  setFolderLoadLimit(null);
                  navigateToPrefix(pendingLargeFolderKey);
                  setPendingLargeFolderKey(null);
                }}
              >
                Load all
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingLargeFolderKey(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

      {pdfPreviewTarget ? (
        <Suspense
          fallback={
            <div
              className="modal-overlay pdf-preview-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pdf-preview-loading-title"
            >
              <div className="modal-card pdf-preview-dialog">
                <div
                  className="center-feedback status-banner pdf-preview-loading-shell"
                  aria-live="polite"
                >
                  <span className="spinner" aria-hidden="true" />
                  <p id="pdf-preview-loading-title">Loading PDF viewer...</p>
                </div>
              </div>
            </div>
          }
        >
          <PdfPreview
            key={pdfPreviewTarget.fileKey}
            bucket={pdfPreviewTarget.bucket}
            fileKey={pdfPreviewTarget.fileKey}
            fileName={pdfPreviewTarget.fileName}
            onClose={() => {
              setPdfPreviewTarget(null);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
};
