import { describe, it, expect } from "vitest";
import { AppError, toErrorMessage } from "../src/server/errors.js";

describe("errors", () => {
  describe("AppError", () => {
    it("should create an error with default statusCode and exposeDetails", () => {
      const error = new AppError("Test error");

      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(500);
      expect(error.exposeDetails).toBe(false);
    });

    it("should create an error with custom statusCode", () => {
      const error = new AppError("Not found", 404);

      expect(error.message).toBe("Not found");
      expect(error.statusCode).toBe(404);
      expect(error.exposeDetails).toBe(false);
    });

    it("should create an error with exposeDetails enabled", () => {
      const error = new AppError("Bad request", 400, true);

      expect(error.message).toBe("Bad request");
      expect(error.statusCode).toBe(400);
      expect(error.exposeDetails).toBe(true);
    });

    it("should be an instance of Error", () => {
      const error = new AppError("Test error");

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe("toErrorMessage", () => {
    it("should extract message from Error instance", () => {
      const error = new Error("Something went wrong");
      const message = toErrorMessage(error);

      expect(message).toBe("Something went wrong");
    });

    it("should extract message from AppError instance", () => {
      const error = new AppError("Custom error", 400);
      const message = toErrorMessage(error);

      expect(message).toBe("Custom error");
    });

    it("should return 'Unknown error' for non-Error values", () => {
      expect(toErrorMessage("string error")).toBe("Unknown error");
      expect(toErrorMessage(42)).toBe("Unknown error");
      expect(toErrorMessage(null)).toBe("Unknown error");
      expect(toErrorMessage(undefined)).toBe("Unknown error");
      expect(toErrorMessage({ code: "ERR" })).toBe("Unknown error");
    });
  });
});
