/**
 * The origin used in links created outside a request: background jobs and the
 * scheduler have no request headers to read, so they fall back to the pinned
 * value or the local listener.
 */
export function configuredOrigin(): string {
  return (
    process.env.INTERVIA_PUBLIC_ORIGIN?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    process.env.INTERVIA_WEB_URL?.trim() ||
    `http://localhost:${process.env.PORT || 3000}`
  );
}
