export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class StatusUnavailableError extends ApiError {
  constructor() {
    super(503, "status_unavailable", "Official case status is temporarily unavailable.");
  }
}

export class ConflictError extends ApiError {
  constructor(message = "This record changed. Refresh and try again.") {
    super(409, "version_conflict", message);
  }
}
