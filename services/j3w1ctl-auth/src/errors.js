export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) =>
  new AppError(400, code, message, details);

export const unauthorized = (message = "Authentication is required.") =>
  new AppError(401, "unauthorized", message);

export const forbidden = (message = "This identity is not authorized.") =>
  new AppError(403, "forbidden", message);

export const notFound = (message = "The requested content does not exist.") =>
  new AppError(404, "not_found", message);

export const conflict = (message = "The remote content changed. Reload before publishing again.") =>
  new AppError(409, "content_conflict", message);

export const preconditionRequired = () =>
  new AppError(428, "precondition_required", "A current content version is required.");

export const unavailable = (message = "The service is not configured.") =>
  new AppError(503, "service_unconfigured", message);

export const dependencyUnavailable = (code, message) =>
  new AppError(503, code, message);

export const publicationUnknown = () =>
  new AppError(503, "publication_unknown", "The publication result could not be proven. No retry was attempted.");
