/**
 * Validates a redirect path is same-origin to prevent open redirect attacks.
 * Resolves against a dummy base — if the resulting origin differs, it's external.
 */
export function isSafeRedirect(path: string | null): path is string {
  if (!path) return false;
  try {
    const url = new URL(path, "https://localhost");
    return url.origin === "https://localhost";
  } catch {
    return false;
  }
}
