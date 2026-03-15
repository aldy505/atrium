import { describe, expect, it } from "vitest";
import {
  getPreviewKind,
  getPreviewPresentation,
  isPdfContentType,
} from "../src/components/preview-mode";

describe("preview mode helpers", () => {
  it("keeps image previews inline", () => {
    expect(getPreviewKind("diagram.png")).toBe("image");
    expect(getPreviewPresentation("image")).toBe("inline");
  });

  it("treats PDFs as modal-trigger previews", () => {
    expect(getPreviewKind("brochure.pdf")).toBe("pdf");
    expect(getPreviewPresentation("pdf")).toBe("modal-trigger");
  });

  it("uses content type to recognize PDFs without relying on extension", () => {
    expect(isPdfContentType("application/pdf; charset=binary")).toBe(true);
    expect(getPreviewKind("download.bin", "application/pdf")).toBe("pdf");
  });

  it("lets PDF content type override text-like filenames", () => {
    expect(getPreviewKind("report.txt", "application/pdf")).toBe("pdf");
  });

  it("keeps text and generic files on inline preview paths", () => {
    expect(getPreviewKind("notes.md")).toBe("text");
    expect(getPreviewPresentation("text")).toBe("inline");
    expect(getPreviewKind("archive.zip")).toBe("generic");
    expect(getPreviewPresentation("generic")).toBe("inline");
  });
});
