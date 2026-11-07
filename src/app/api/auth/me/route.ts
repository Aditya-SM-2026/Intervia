import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { accountDisplayName } from "@/lib/auth/session";

/** The signed-in account's display name, for the top bar. */
export async function GET() {
  const denied = await requireRecruiter();
  if (denied) return denied;
  return NextResponse.json({ name: accountDisplayName() });
}
