import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "../api/apiClient";

export type ApiResource<T> =
  | { state: "idle" }
  | { state: "loading"; data?: T }
  | { state: "ready"; data: T }
  | { state: "error"; data?: T; error: ApiRequestError };

function normalizeError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError
    ? error
    : new ApiRequestError("Unable to load PoolMate data.", "UNKNOWN_ERROR");
}

export function useApiResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
  enabled = true
): { resource: ApiResource<T>; reload(): void } {
  const [revision, setRevision] = useState(0);
  const [resource, setResource] = useState<ApiResource<T>>(
    enabled ? { state: "loading" } : { state: "idle" }
  );
  const previousKey = useRef(key);

  useEffect(() => {
    if (!enabled) {
      setResource({ state: "idle" });
      return;
    }
    const controller = new AbortController();
    const keyChanged = previousKey.current !== key;
    previousKey.current = key;
    setResource((current) => ({
      state: "loading",
      ...(!keyChanged && current.state !== "idle" && current.data
        ? { data: current.data }
        : {})
    }));
    void load(controller.signal)
      .then((data) => setResource({ state: "ready", data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResource((current) => ({
            state: "error",
            ...(current.state !== "idle" && current.data
              ? { data: current.data }
              : {}),
            error: normalizeError(error)
          }));
        }
      });
    return () => controller.abort();
  }, [enabled, key, load, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { resource, reload };
}
