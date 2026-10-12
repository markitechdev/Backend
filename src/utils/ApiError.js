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

  /**
   * Converts a Supabase/PostgREST/Postgres error into the right HTTP error,
   * so client mistakes (duplicate key, bad reference, bad enum value...) become
   * 4xx responses instead of opaque 500s.
   */
  static fromDb(error, fallbackMessage = 'Database request failed') {
    if (!error) return new ApiError(500, fallbackMessage);
    switch (error.code) {
      case '23505': return ApiError.conflict('A record with that unique value already exists.');
      case '23503': return ApiError.badRequest('A related record does not exist or is still in use.');
      case '22P02':
      case '22007':
      case '22008': return ApiError.badRequest('One of the values has an invalid format.');
      case '23514':
      case '23502': return ApiError.badRequest('The submitted values violate a data rule.');
      case 'P0001': return ApiError.badRequest(error.message);
      case 'PGRST116': return ApiError.notFound('Requested resource was not found.');
      default: return new ApiError(500, error.message || fallbackMessage);
    }
  }
}
