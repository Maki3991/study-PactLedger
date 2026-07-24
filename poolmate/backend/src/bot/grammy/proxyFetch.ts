import {
  fetch as undiciFetch,
  ProxyAgent,
  type RequestInit as UndiciRequestInit
} from "undici";

export function createProxyFetch(
  proxyUrl: string | undefined
): typeof globalThis.fetch | undefined {
  const normalized = proxyUrl?.trim();
  if (!normalized) return undefined;
  const dispatcher = new ProxyAgent(normalized);

  return async (input, init) => {
    // grammY accepts a standard fetch implementation; only the dispatcher is transport-specific.
    return undiciFetch(input as never, {
      ...(init as UndiciRequestInit),
      dispatcher
    }) as unknown as Promise<Response>;
  };
}
