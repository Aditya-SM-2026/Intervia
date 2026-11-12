import assert from "node:assert/strict";
import test from "node:test";
import {
  completeSections,
  normaliseForMatch,
  quoteAppears,
  verifySectionEvidence,
} from "./evidence.ts";
import { containsTerm, keywordMatch, skillTerms } from "./keywords.ts";
import {
  sanitizeWeights,
  screeningTotal,
  sectionCoverage,
  weightsAreValid,
} from "./score.ts";
import {
  DEFAULT_SCREENING_WEIGHTS,
  RESUME_SECTION_IDS,
  type ScreeningWeights,
  type SectionResult,
} from "./types.ts";

function section(
  id: SectionResult["id"],
  score: number | null,
  status: SectionResult["status"] = score === null ? "not_found" : "scored",
): SectionResult {
  return {
    id,
    status,
    score,
    rationale: `${id} judged`,
    evidence: score === null ? [] : [{ quote: `${id} evidence line from the resume` }],
  };
}

const FRESHER = [
  section("summary", 70),
  section("skills", 60),
  section("experience", null),
  section("projects", 80),
  section("certifications", null),
];

function weights(patch: Partial<ScreeningWeights> = {}): ScreeningWeights {
  return { ...DEFAULT_SCREENING_WEIGHTS, ...patch };
}

test("a fresher is scored on the sections that exist, not marked down for missing ones", () => {
  // 70*20 + 60*20 + 80*25 = 4600 over the 65 weight that was scored.
  const totals = screeningTotal(FRESHER, weights());
  assert.equal(totals.score, 4600 / 65);
  assert.equal(totals.scoredSections, 3);
  assert.equal(totals.weightedSections, 5);
  assert.equal(sectionCoverage(totals), "scored on 3 of 5 sections");
});

test("counting missing sections as zero would score the same resume lower", () => {
  const asZero = [
    ...FRESHER.map((item) =>
      item.score === null ? { ...item, status: "scored" as const, score: 0 } : item,
    ),
  ];
  const totals = screeningTotal(asZero, weights());
  assert.equal(totals.score, 46);
  assert.ok((screeningTotal(FRESHER, weights()).score ?? 0) > 46);
});

test("a section weighted zero is ignored for everyone", () => {
  const totals = screeningTotal(FRESHER, weights({ projects: 0 }));
  // 70*20 + 60*20 = 2600 over 40.
  assert.equal(totals.score, 65);
  assert.equal(totals.weightedSections, 4);
});

test("centring the weight on projects lifts a project-heavy resume", () => {
  const even = screeningTotal(FRESHER, weights()) as { score: number };
  const projects = screeningTotal(
    FRESHER,
    weights({ projects: 50, summary: 10, skills: 20, experience: 10, certifications: 10 }),
  ) as { score: number };
  assert.ok(projects.score > even.score);
});

test("no scored section gives null, never a zero", () => {
  const totals = screeningTotal(
    RESUME_SECTION_IDS.map((id) => section(id, null)),
    weights(),
  );
  assert.equal(totals.score, null);
  assert.equal(totals.scoredSections, 0);
});

test("if every remaining weight is zero, an equal mean is used", () => {
  const totals = screeningTotal(
    [section("summary", 40), section("skills", 80)],
    weights({ summary: 0, skills: 0, experience: 0, projects: 0, certifications: 0 }),
  );
  assert.equal(totals.score, 60);
});

test("weights out of an older six-section role are spread back over 100", () => {
  const legacy = sanitizeWeights({
    summary: 20,
    skills: 20,
    experience: 20,
    projects: 20,
    education: 10,
    certifications: 10,
  });
  assert.deepEqual(legacy, {
    summary: 23,
    skills: 22,
    experience: 22,
    projects: 22,
    certifications: 11,
  });
  assert.equal(weightsAreValid(legacy), true);
});

test("weights are whole, clamped percentages and the total must reach 100", () => {
  assert.deepEqual(sanitizeWeights({ summary: 30.6, skills: -5, projects: "x" }), {
    summary: 31,
    skills: 0,
    experience: 25,
    projects: 25,
    certifications: 10,
  });
  assert.equal(weightsAreValid(DEFAULT_SCREENING_WEIGHTS), true);
  assert.equal(weightsAreValid({ ...DEFAULT_SCREENING_WEIGHTS, projects: 40 }), false);
});

test("an invented quote is dropped and the section is no longer trusted", () => {
  const resume = "Ravi Kumar. Built a payments dashboard in React for 20,000 users.";
  const sections: SectionResult[] = [
    {
      id: "projects",
      status: "scored",
      score: 90,
      rationale: "strong",
      evidence: [{ quote: "led a team of eight engineers across three countries" }],
    },
    {
      id: "skills",
      status: "scored",
      score: 70,
      rationale: "solid",
      evidence: [{ quote: "built a payments dashboard in React" }],
    },
  ];
  const verified = verifySectionEvidence(sections, resume);
  assert.equal(verified.downgraded, 1);
  assert.equal(verified.removedQuotes, 1);
  assert.equal(verified.sections[0]?.status, "insufficient_evidence");
  assert.equal(verified.sections[0]?.score, null);
  assert.equal(verified.sections[1]?.status, "scored");
  assert.equal(verified.sections[1]?.score, 70);
});

test("a quote is matched across case, spacing and curly apostrophes", () => {
  const resume = "Built the ACL\u2019s  booking   flow, then tuned it.";
  assert.equal(quoteAppears("built the acl's booking flow", normaliseForMatch(resume)), true);
  assert.equal(quoteAppears("booking flow in Kubernetes", normaliseForMatch(resume)), false);
});

test("a duplicate quote is counted once", () => {
  const resume = "Deployed three services on Kubernetes for a fintech client.";
  const verified = verifySectionEvidence(
    [
      {
        id: "experience",
        status: "scored",
        score: 80,
        rationale: "strong",
        evidence: [
          { quote: "Deployed three services on Kubernetes" },
          { quote: "Deployed three services on Kubernetes" },
        ],
      },
    ],
    resume,
  );
  assert.equal(verified.sections[0]?.evidence.length, 1);
  assert.equal(verified.removedQuotes, 1);
  assert.equal(verified.sections[0]?.status, "scored");
});

test("missing sections are filled in as not found, in display order", () => {
  const completed = completeSections([section("projects", 80)], RESUME_SECTION_IDS);
  assert.equal(completed.length, 5);
  assert.deepEqual(
    completed.map((item) => item.id),
    [...RESUME_SECTION_IDS],
  );
  assert.equal(completed.find((item) => item.id === "certifications")?.status, "not_found");
});

test("AWS on the resume matches Amazon Web Services in the role, both ways", () => {
  const resume = "Worked with AWS Lambda and S3 for two years.";
  assert.deepEqual(keywordMatch(resume, ["Amazon Web Services"]).matched, ["Amazon Web Services"]);
  assert.deepEqual(keywordMatch("Strong Amazon Web Services background", ["AWS"]).matched, ["AWS"]);
  assert.deepEqual(keywordMatch(resume, ["Kubernetes"]).missing, ["Kubernetes"]);
});

test("a skill is not matched inside a longer word", () => {
  assert.equal(containsTerm(" reactive systems and laws ", "react"), false);
  assert.equal(containsTerm(" built with react and node ", "react"), true);
  assert.equal(containsTerm(" applied javascript daily ", "java"), false);
});

test("skill aliases cover the common abbreviations", () => {
  assert.ok(skillTerms("Postgres").includes("postgresql"));
  assert.ok(skillTerms("K8s").includes("kubernetes"));
  assert.ok(skillTerms("Node.js").includes("node"));
  assert.deepEqual(skillTerms("SAP BW"), ["sap bw"]);
});
