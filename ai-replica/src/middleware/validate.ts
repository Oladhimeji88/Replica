/**
 * Request validation. Every route that accepts input declares a Zod schema, so
 * handlers can trust their input and malformed requests get a 400 that says
 * exactly which field was wrong.
 */
import type { RequestHandler } from "express";
import type { ZodType } from "zod";

import { BadRequestError } from "../core/errors.js";

export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "(body)",
        message: issue.message,
      }));
      next(new BadRequestError("Request body failed validation", fields));
      return;
    }

    req.body = result.data;
    next();
  };
}
