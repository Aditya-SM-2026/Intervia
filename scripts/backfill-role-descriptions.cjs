/**
 * Fills empty role descriptions from the latest interview booked for that
 * role (matched by role_id, or by role_title for older interviews).
 *
 * Only roles with a blank description are touched, so running it twice is
 * safe. Usage:
 *   DATABASE_URL=... node scripts/backfill-role-descriptions.cjs
 */
const { Client } = require("pg");

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

(async () => {
  const client = new Client({ connectionString });
  await client.connect();

  const { rows } = await client.query(`
    SELECT r.id, r.title, src.jd_text
    FROM roles r
    JOIN LATERAL (
      SELECT i.jd_text, i.created_at
      FROM interviews i
      WHERE (
          i.role_id = r.id
          OR (i.role_id IS NULL AND lower(btrim(i.role_title)) = lower(btrim(r.title)))
        )
        AND coalesce(btrim(i.jd_text), '') <> ''
      ORDER BY i.created_at DESC
      LIMIT 1
    ) src ON true
    WHERE coalesce(btrim(r.description), '') = ''
  `);

  let updated = 0;
  for (const row of rows) {
    if (!dryRun) {
      await client.query(
        "UPDATE roles SET description = $1, updated_at = now() WHERE id = $2",
        [row.jd_text, row.id],
      );
    }
    updated += 1;
  }

  console.log(
    `${dryRun ? "Would backfill" : "Backfilled"} ${updated} role description(s) from interviews.`,
  );
  if (dryRun) {
    for (const row of rows) console.log(`- ${row.title}`);
  }
  await client.end();
})().catch((error) => {
  console.error("Backfill failed:", error.message);
  process.exit(1);
});
