/**
 * The organisation candidates deal with. Shown wherever a candidate sees who
 * invited them (never an internal login name like "Admin") and in emails,
 * reports and file names.
 */
export const ORGANIZATION_NAME = process.env.NEXT_PUBLIC_ORGANIZATION_NAME?.trim() || "Medhas Academy";

/** Lower-case, dash-separated, for file names. */
export const ORGANIZATION_SLUG = ORGANIZATION_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
