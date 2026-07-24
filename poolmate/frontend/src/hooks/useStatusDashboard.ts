import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConfigStatusResponse,
  HealthResponse
} from "@poolmate/shared";
import {
  ApiRequestError,
  createStatusApi,
  type StatusApi
} from "../api/statusApi";

export type ResourceState<T> =
  | { state: "loading"; data?: T }
  | { state: "ready"; data: T }
  | { state: "error"; data?: T; error: ApiRequestError };

export interface StatusDashboardState {
  health: ResourceState<HealthResponse>;
  config: ResourceState<ConfigStatusResponse>;
  refresh(): void;
  isRefreshing: boolean;
}

function normalizeError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError
    ? error
    : new ApiRequestError("Unable to load runtime status.", "UNKNOWN_ERROR");
}

export function useStatusDashboard(api?: StatusApi): StatusDashboardState {
  const statusApi = useMemo(() => api ?? createStatusApi(), [api]);
  const [revision, setRevision] = useState(0);
  const [health, setHealth] = useState<ResourceState<HealthResponse>>({
    state: "loading"
  });
  const [config, setConfig] = useState<ResourceState<ConfigStatusResponse>>({
    state: "loading"
  });

  useEffect(() => {
    const controller = new AbortController();

    setHealth((current) => ({ state: "loading", data: current.data }));
    setConfig((current) => ({ state: "loading", data: current.data }));

    void statusApi
      .getHealth(controller.signal)
      .then((data) => setHealth({ state: "ready", data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setHealth((current) => ({
            state: "error",
            data: current.data,
            error: normalizeError(error)
          }));
        }
      });

    void statusApi
      .getConfigStatus(controller.signal)
      .then((data) => setConfig({ state: "ready", data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setConfig((current) => ({
            state: "error",
            data: current.data,
            error: normalizeError(error)
          }));
        }
      });

    return () => controller.abort();
  }, [revision, statusApi]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  return {
    health,
    config,
    refresh,
    isRefreshing: health.state === "loading" || config.state === "loading"
  };
}
