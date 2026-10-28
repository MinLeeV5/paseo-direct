export type ErrorCode = "unsupported" | "version" | "host_missing" | "needs_relay" | "identity" |
  "cancelled" | "timeout" | "unreachable" | "authentication" | "connection_conflict" |
  "storage" | "preferences_invalid" | "discovery" | "active_connection" | "not_managed";

export class DirectError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = "DirectError"; }
}

/** Never surface raw transport messages or URLs, which can contain credentials. */
export function publicError(error: unknown): ErrorCode {
  if (error instanceof DirectError) return error.code;
  if (error && typeof error === "object" && "authFailureReason" in error && error.authFailureReason) return "authentication";
  return "unreachable";
}

export function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw new DirectError("cancelled");
}

export async function bounded<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  ensureActive(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const limit = new Promise<never>((_, reject) => {
    abort = () => reject(new DirectError("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => reject(new DirectError("timeout")), timeoutMs);
  });
  try { return await Promise.race([promise, limit]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
