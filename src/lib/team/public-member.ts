import type { MemberRecord } from "@/server/repositories/accounts-repository";

/** A member as the Team page shows them; the password hash never leaves the server. */
export function publicMember(member: MemberRecord) {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    active: member.active,
    createdAt: member.createdAt,
    lastSignInAt: member.lastSignInAt,
  };
}

export type PublicMember = ReturnType<typeof publicMember>;
