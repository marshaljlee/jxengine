export interface StandardApiError {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | number | null;
  };
}

export class JXEngineError extends Error {
  public statusCode: number;
  public errorType: string;
  public errorCode?: string | number;

  constructor(message: string, statusCode = 500, errorType = "api_error", errorCode?: string | number) {
    super(message);
    this.name = "JXEngineError";
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.errorCode = errorCode;
  }

  toResponse(): StandardApiError {
    return {
      error: {
        message: this.message,
        type: this.errorType,
        param: null,
        code: this.errorCode || this.statusCode,
      },
    };
  }
}

export class ModelNotFoundError extends JXEngineError {
  constructor(modelId: string) {
    super(`Model not found: '${modelId}'`, 404, "not_found_error", "model_not_found");
  }
}

export class InsufficientMemoryError extends JXEngineError {
  public requiredGb: number;
  public availableGb: number;

  constructor(requiredGb: number, availableGb: number) {
    super(
      `Insufficient RAM reservation. Requires ~${requiredGb} GB, but only ${availableGb} GB is available. Free up memory or reduce context length.`,
      400,
      "insufficient_quota",
      "insufficient_memory"
    );
    this.requiredGb = requiredGb;
    this.availableGb = availableGb;
  }
}

export class NoActiveModelError extends JXEngineError {
  constructor() {
    super("No model is currently loaded or running. Visit /panel or invoke /api/load first.", 503, "service_unavailable", "no_active_model");
  }
}

export class InvalidRequestError extends JXEngineError {
  constructor(message: string) {
    super(message, 400, "invalid_request_error", "bad_request");
  }
}

export function formatApiError(err: any): { statusCode: number; payload: StandardApiError } {
  if (err instanceof JXEngineError) {
    return { statusCode: err.statusCode, payload: err.toResponse() };
  }
  const message = err?.message || String(err) || "Internal server error";
  return {
    statusCode: 500,
    payload: {
      error: {
        message,
        type: "api_error",
        param: null,
        code: "internal_error",
      },
    },
  };
}
