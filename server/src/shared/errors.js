export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function errorHandler(error, _req, res, _next) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    success: false,
    message: status === 500 ? "An unexpected server error occurred" : error.message,
    ...(error.details ? { errors: error.details } : {})
  });
}
