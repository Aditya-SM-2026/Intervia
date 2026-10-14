/**
 * Runs once when a Next.js server instance starts. Boots the reminder
 * scheduler on the Node.js runtime only (the edge runtime has no timers here).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startReminderScheduler } = await import("./lib/emails/reminder-scheduler");
  startReminderScheduler();
}