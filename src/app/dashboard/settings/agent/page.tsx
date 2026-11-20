import type { Metadata } from "next";
import { AdminOnly, SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { AgentBehaviourForm } from "@/components/settings/AgentBehaviourForm";
import { readAgentPersonalityForSettings } from "@/lib/agent/personality.service";
import { isAdmin } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";

export const metadata: Metadata = {
  title: "Agent behaviour",
};

// Reads the saved personality, so it must render per request, never at build.
export const dynamic = "force-dynamic";

/**
 * The editable interviewer instructions: persona, conduct and per-difficulty
 * style. Admin only: it changes how every interview behaves.
 */
export default async function AgentBehaviourPage() {
  if (!isAdmin(await getActor())) {
    return (
      <>
        <SettingsPageHeader
          title="Behaviour"
          tip="The interviewer's instructions, editable without a code change. Each part is optional: leave it empty to keep the built-in text."
        />
        <AdminOnly />
      </>
    );
  }

  const { personality, available } = await readAgentPersonalityForSettings();

  return (
    <>
        <SettingsPageHeader
          title="Behaviour"
          tip="The interviewer's instructions, editable without a code change. Each part is optional: leave it empty to keep the built-in text."
        />
        {!available && (
          <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            The saved behaviour could not be loaded just now, so the boxes show the built-in
            personality. Saving will overwrite it, so check the values before you save.
          </p>
        )}
        <AgentBehaviourForm initial={personality} />
    </>
  );
}
