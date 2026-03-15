import { createElement, useEffect, useMemo, useRef, useState } from "react";
import "pdfjs-viewer-element";
import { getDownloadUrl } from "../app/lib/api";

type PdfPreviewProps = {
  bucket: string;
  fileKey: string;
  fileName: string;
  onClose: () => void;
};

type ViewerStatus = "loading" | "ready" | "error";

type ViewerEventBus = {
  on?: (eventName: string, listener: (event?: unknown) => void) => void;
  off?: (eventName: string, listener: (event?: unknown) => void) => void;
};

type PdfjsViewerElementInstance = HTMLElement & {
  initPromise: Promise<{
    viewerApp?: {
      eventBus?: ViewerEventBus;
    };
  }>;
};

const getErrorMessage = (event: unknown): string => {
  if (event instanceof Error && event.message) {
    return event.message;
  }

  if (
    typeof event === "object" &&
    event !== null &&
    "message" in event &&
    typeof event.message === "string" &&
    event.message
  ) {
    return event.message;
  }

  if (
    typeof event === "object" &&
    event !== null &&
    "source" in event &&
    typeof event.source === "object" &&
    event.source !== null &&
    "message" in event.source &&
    typeof event.source.message === "string" &&
    event.source.message
  ) {
    return event.source.message;
  }

  return "Failed to load PDF preview.";
};

export const PdfPreview = ({ bucket, fileKey, fileName, onClose }: PdfPreviewProps) => {
  const viewerRef = useRef<PdfjsViewerElementInstance | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const viewerSrc = useMemo(() => getDownloadUrl(bucket, fileKey, true), [bucket, fileKey]);
  const downloadUrl = useMemo(() => getDownloadUrl(bucket, fileKey), [bucket, fileKey]);

  useEffect(() => {
    setStatus("loading");
    setError(null);
  }, [viewerSrc]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    let isCancelled = false;
    let cleanup = () => {};

    const bindViewerEvents = async () => {
      try {
        const { viewerApp } = await viewer.initPromise;
        if (isCancelled) {
          return;
        }

        const eventBus = viewerApp?.eventBus as ViewerEventBus | undefined;
        if (!eventBus?.on || !eventBus.off) {
          setStatus("ready");
          return;
        }

        const handleReady = () => {
          if (isCancelled) {
            return;
          }

          setStatus("ready");
          setError(null);
        };

        const handleError = (event?: unknown) => {
          if (isCancelled) {
            return;
          }

          setStatus("error");
          setError(getErrorMessage(event));
        };

        const handlePasswordPrompt = () => {
          if (isCancelled) {
            return;
          }

          setStatus("ready");
          setError(null);
        };

        eventBus.on("documentloaded", handleReady);
        eventBus.on("pagesloaded", handleReady);
        eventBus.on("documenterror", handleError);
        eventBus.on("passwordrequired", handlePasswordPrompt);
        cleanup = () => {
          eventBus.off?.("documentloaded", handleReady);
          eventBus.off?.("pagesloaded", handleReady);
          eventBus.off?.("documenterror", handleError);
          eventBus.off?.("passwordrequired", handlePasswordPrompt);
        };
      } catch (viewerError) {
        if (isCancelled) {
          return;
        }

        setStatus("error");
        setError(getErrorMessage(viewerError));
      }
    };

    void bindViewerEvents();

    return () => {
      isCancelled = true;
      cleanup();
    };
  }, [viewerSrc]);

  return (
    <div
      className="modal-overlay pdf-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-preview-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card pdf-preview-dialog">
        <div className="pdf-preview-header">
          <div>
            <h3 id="pdf-preview-title">{fileName}</h3>
            <p className="pdf-preview-subtitle">
              PDF preview uses the bundled PDF.js viewer. Password-protected files are supported on
              a best-effort basis.
            </p>
          </div>
          <div className="pdf-preview-actions">
            <button
              type="button"
              onClick={() => {
                window.location.assign(downloadUrl);
              }}
            >
              Download PDF
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="pdf-preview-shell">
          {status === "loading" ? (
            <div
              className="center-feedback status-banner pdf-preview-overlay-card"
              aria-live="polite"
            >
              <span className="spinner" aria-hidden="true" />
              <p>Loading PDF preview...</p>
            </div>
          ) : null}
          {status === "error" ? (
            <div className="center-feedback error-banner pdf-preview-overlay-card" role="alert">
              <p>{error}</p>
            </div>
          ) : null}
          {createElement("pdfjs-viewer-element", {
            ref: viewerRef,
            src: viewerSrc,
            zoom: "page-width",
            pagemode: "thumbs",
            "iframe-title": `PDF preview for ${fileName}`,
            className: "pdf-preview-viewer",
            style: { display: "initial" },
          })}
        </div>
      </div>
    </div>
  );
};
