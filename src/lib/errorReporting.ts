export type ErrorReportContext = {
  source: "react_error_boundary" | "window_error" | "unhandled_rejection" | "supabase" | string;
  action?: string;
  table?: string;
  userId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

export type ErrorReporter = (error: unknown, context?: ErrorReportContext) => void;

let reporter: ErrorReporter | null = null;

export const setErrorReporter = (fn: ErrorReporter | null) => {
  if (reporter && fn && reporter !== fn) {
    console.warn("[ErrorReporter] Overwriting existing reporter");
  }
  reporter = fn;
};

export const reportError = (error: unknown, context?: ErrorReportContext) => {
  if (!reporter) return;
  try {
    reporter(error, context);
  } catch (err) {
    console.error("[ErrorReporter] publish failed", err);
  }
};
