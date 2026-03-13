import { describe, expect, it } from "vitest";
import { getExtension, isImageFile, isPdfFile, isTextFile } from "../src/components/FileIcon";

describe("FileIcon helpers", () => {
  it("normalizes extensions to lowercase", () => {
    expect(getExtension("Quarterly.Report.PDF")).toBe("pdf");
  });

  it("detects PDF files by extension", () => {
    expect(isPdfFile("brochure.pdf")).toBe(true);
    expect(isPdfFile("brochure.PDF")).toBe(true);
    expect(isPdfFile("brochure.txt")).toBe(false);
  });

  it("preserves existing image and text detection", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isTextFile("notes.md")).toBe(true);
    expect(isImageFile("notes.md")).toBe(false);
    expect(isTextFile("archive.zip")).toBe(false);
  });
});
