import { z } from 'zod';
import { ApiError } from '../utils/ApiError.js';

/** Validates req.body against a zod schema and replaces it with the parsed value. */
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || 'body',
      message: i.message,
    }));
    return next(ApiError.badRequest('Validation failed: Invalid request body', details));
  }
  req.body = result.data;
  next();
};

/** Validates req.query against a zod schema. */
export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || 'query',
      message: i.message,
    }));
    return next(ApiError.badRequest('Validation failed: Invalid query parameters', details));
  }
  req.validatedQuery = result.data;
  next();
};

/** Validates req.params against a zod schema. */
export const validateParams = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || 'params',
      message: i.message,
    }));
    return next(ApiError.badRequest('Validation failed: Invalid route parameters', details));
  }
  req.params = result.data;
  next();
};

export const uuidParamSchema = z.object({
  id: z.string().uuid('ID must be a valid UUID format'),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer'),
});

export const productIdParamSchema = z.object({
  productId: z.coerce.number().int().positive('Product ID must be a positive integer'),
});
