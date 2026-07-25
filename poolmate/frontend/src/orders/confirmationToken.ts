export function consumeConfirmationTokenFromLocation(): string | undefined {
  if (!/^\/confirm\/?$/.test(window.location.pathname)) return undefined;
  const token = new URLSearchParams(window.location.hash.slice(1))
    .get("token")
    ?.trim();
  if (window.location.hash) {
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${window.location.search}`
    );
  }
  return token || undefined;
}
