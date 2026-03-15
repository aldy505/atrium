import { describe, expect, it } from "vitest";
import { buildPdfPreviewTarget, shouldClosePdfPreview } from "../src/components/pdf-preview-target";

describe("pdf preview target helpers", () => {
  it("builds a preview target from the selected bucket and file", () => {
    expect(
      buildPdfPreviewTarget("reports", {
        key: "quarterly/report.pdf",
        name: "report.pdf",
      }),
    ).toEqual({
      bucket: "reports",
      fileKey: "quarterly/report.pdf",
      fileName: "report.pdf",
    });
  });

  it("keeps the modal open for the active previewed file", () => {
    const target = buildPdfPreviewTarget("reports", {
      key: "quarterly/report.pdf",
      name: "report.pdf",
    });

    expect(shouldClosePdfPreview(target, "reports", { key: "quarterly/report.pdf" }, true)).toBe(
      false,
    );
  });

  it("closes the modal when the sidebar preview is hidden", () => {
    const target = buildPdfPreviewTarget("reports", {
      key: "quarterly/report.pdf",
      name: "report.pdf",
    });

    expect(shouldClosePdfPreview(target, "reports", { key: "quarterly/report.pdf" }, false)).toBe(
      true,
    );
  });

  it("closes the modal when the selection changes or clears", () => {
    const target = buildPdfPreviewTarget("reports", {
      key: "quarterly/report.pdf",
      name: "report.pdf",
    });

    expect(shouldClosePdfPreview(target, "reports", { key: "other.pdf" }, true)).toBe(true);
    expect(shouldClosePdfPreview(target, "reports", null, true)).toBe(true);
  });

  it("closes the modal when the bucket changes", () => {
    const target = buildPdfPreviewTarget("reports", {
      key: "quarterly/report.pdf",
      name: "report.pdf",
    });

    expect(shouldClosePdfPreview(target, "archive", { key: "quarterly/report.pdf" }, true)).toBe(
      true,
    );
  });
});
