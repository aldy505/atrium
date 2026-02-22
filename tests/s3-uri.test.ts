import { afterEach, describe, expect, it, vi } from "vitest";
import { buildS3Uri, copyTextToClipboard } from "../src/app/lib/s3-uri.js";
import type { FileEntry, FolderEntry } from "../src/app/lib/types.js";

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;

const restoreGlobal = (key: "navigator" | "document", value: unknown) => {
  if (typeof value === "undefined") {
    Reflect.deleteProperty(globalThis, key);
    return;
  }

  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
  });
};

afterEach(() => {
  restoreGlobal("navigator", originalNavigator);
  restoreGlobal("document", originalDocument);
  vi.restoreAllMocks();
});

describe("buildS3Uri", () => {
  it("builds URI for nested files without trailing slash", () => {
    const file: FileEntry = {
      type: "file",
      key: "folder/subfolder/file.txt",
      name: "file.txt",
      size: 1,
    };

    expect(buildS3Uri("my-bucket", file)).toBe("s3://my-bucket/folder/subfolder/file.txt");
  });

  it("builds URI for folders with trailing slash", () => {
    const folder: FolderEntry = {
      type: "folder",
      key: "folder/subfolder",
      name: "subfolder",
    };

    expect(buildS3Uri("my-bucket", folder)).toBe("s3://my-bucket/folder/subfolder/");
  });
});

describe("copyTextToClipboard", () => {
  it("uses Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });

    await copyTextToClipboard("s3://my-bucket/file.txt");
    expect(writeText).toHaveBeenCalledWith("s3://my-bucket/file.txt");
  });

  it("falls back to execCommand when Clipboard API is unavailable", async () => {
    const textarea = {
      value: "",
      setAttribute: vi.fn(),
      style: {} as Record<string, string>,
      select: vi.fn(),
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);

    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: vi.fn().mockReturnValue(textarea),
        body: { appendChild, removeChild },
        execCommand,
      },
      configurable: true,
    });

    await copyTextToClipboard("s3://my-bucket/folder/");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });
});
