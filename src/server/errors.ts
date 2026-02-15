export class AppError extends Error {
  statusCode: number;
  exposeDetails: boolean;

  constructor(message: string, statusCode = 500, exposeDetails = false) {
    super(message);
    this.statusCode = statusCode;
    this.exposeDetails = exposeDetails;
  }
}

export const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
};
