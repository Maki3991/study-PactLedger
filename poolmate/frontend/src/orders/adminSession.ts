const ADMIN_SESSION_KEY = "poolmate.admin-api-key";

export function readAdminSessionKey(): string {
  try {
    return window.sessionStorage.getItem(ADMIN_SESSION_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeAdminSessionKey(value: string): void {
  window.sessionStorage.setItem(ADMIN_SESSION_KEY, value.trim());
}

export function clearAdminSessionKey(): void {
  window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
}
