// The student join page: which failures are shown as the one human, non-revealing sentence.
// An expired, revoked, unknown or not-yet-open link all end here; the page must not say which reason applied.
/** True for the refusals the database gives for a link that cannot be used (invalid, forbidden, not found). Outages and rate limits keep their own message. */
export function linkIsUnusable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 400 || status === 403 || status === 404;
}
