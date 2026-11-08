import type { FactorId } from "@/lib/interviews/scorecard.types";

/** How each factor of the overall score is named and explained to recruiters. */
export const FACTOR_META: Record<
  FactorId,
  { name: string; short: string; explains: string; bar: string }
> = {
  answers: {
    name: "Answer quality",
    short: "Answers",
    explains:
      "Whether each question was answered: on the question asked, with the candidate's own concrete detail, correct, and with depth. Definitions alone score low.",
    bar: "bg-accent",
  },
  resume: {
    name: "Resume depth",
    short: "Resume",
    explains:
      "Whether the candidate could explain the projects and skills on their resume in depth: how it works, their part, a problem they solved. Naming a project is not enough.",
    bar: "bg-accent",
  },
  authenticity: {
    name: "Own answers",
    short: "Own answers",
    explains:
      "Whether the answers were the candidate's own words, counted only as far as the answers were good: an original but off-topic or weak answer earns little.",
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
