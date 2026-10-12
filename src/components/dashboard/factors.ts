import type { FactorId } from "@/lib/interviews/scorecard.types";

/** How each factor of the overall score is named and explained to recruiters. */
export const FACTOR_META: Record<
  FactorId,
  { name: string; short: string; explains: string; bar: string }
> = {
  answers: {
    name: "Answer quality",
    short: "Answers",
    explains: "How well each planned question was answered, against the rating scale for the role.",
    bar: "bg-accent",
  },
  resume: {
    name: "Resume match",
    short: "Resume",
    explains: "Whether what the candidate said agrees with the projects and claims on their resume.",
    bar: "bg-accent",
  },
  authenticity: {
    name: "Own answers",
    short: "Own answers",
    explains:
      "Signs in the wording and timing that answers were the candidate's own, not read out or prompted.",
    bar: "bg-candidate",
  },
  video: {
    name: "On-camera behaviour",
    short: "On camera",
    explains:
      "Whether the candidate kept returning to the same spot off the screen while answering, plus anything else in the recording worth watching.",
    bar: "bg-amber-500",
  },
};
