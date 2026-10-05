import fs from "node:fs";
import { AccessToken } from "livekit-server-sdk";
import { Room } from "@livekit/rtc-node";

function readEnv(path) {
  const entries = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    entries[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return entries;
}

async function main() {
  const env = readEnv("C:/Users/Aditya/Desktop/meeting-bot/.env");
  const res = await fetch("http://localhost:3000/api/interviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Discovery Hold", durationMinutes: 30 }),
  });
  const created = await res.json();
  const roomName = `interview-${created.room.id}`;
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: "candidate-test-fake",
    ttl: 600,
  });
  token.addGrant({ roomJoin: true, room: roomName });
  const room = new Room();
  await room.connect(env.LIVEKIT_URL, await token.toJwt());
  console.log("holding room:", roomName);
  setInterval(() => {}, 100000);
}

main().catch((e) => {
  console.error("HOLD FAILED:", e.message);
  process.exit(1);
});