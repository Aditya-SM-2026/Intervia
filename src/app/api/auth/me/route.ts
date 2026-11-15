import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { isAdmin } from "@/lib/auth/accounts.logic";

/** The signed-in person, for the top bar and the settings pages. */
export async function GET() {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in to continue." } }, { status: 401 });
  }
  return NextResponse.json({ id: actor.id, name: actor.name, email: actor.email, admin: isAdmin(actor) });
}
