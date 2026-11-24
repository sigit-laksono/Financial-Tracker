import type { ContentfulStatusCode } from "hono/utils/http-status";

export class DomainError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(message: string, status: ContentfulStatusCode = 400, code = "DOMAIN_ERROR") {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, code = "VALIDATION_ERROR") {
    super(message, 400, code);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, code = "NOT_FOUND") {
    super(message, 404, code);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = "CONFLICT") {
    super(message, 409, code);
  }
}
