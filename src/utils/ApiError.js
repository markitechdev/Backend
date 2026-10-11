export class ApiError extends Error {
  constructor(status, message, details = null, code = null) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code || ApiError.defaultCode(status);
  }

  static defaultCode(status) {
    switch (status) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 422: return 'UNPROCESSABLE_ENTITY';
      case 429: return 'TOO_MANY_REQUESTS';
      default:  return 'INTERNAL_SERVER_ERROR';
    }
  }

  static badRequest(msg, details, code) { return new ApiError(400, msg, details, code || 'BAD_REQUEST'); }
  static unauthorized(msg = 'Not authenticated', details, code) { return new ApiError(401, msg, details, code || 'UNAUTHORIZED'); }
  static forbidden(msg = 'You do not have permission to perform this action', details, code) { return new ApiError(403, msg, details, code || 'FORBIDDEN'); }
  static notFound(msg = 'Resource not found', details, code) { return new ApiError(404, msg, details, code || 'NOT_FOUND'); }
  static conflict(msg, details, code) { return new ApiError(409, msg, details, code || 'CONFLICT'); }
}
