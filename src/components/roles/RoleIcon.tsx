import {
  BarChart3,
  Briefcase,
  BrainCircuit,
  Cloud,
  Code2,
  Database,
  Megaphone,
  Palette,
  ShieldCheck,
  Smartphone,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * A small tinted icon tile for a role, picked from words in its title so
 * similar roles share a look. Falls back to a briefcase.
 */
const MATCHERS: { pattern: RegExp; icon: LucideIcon; tint: string }[] = [
  { pattern: /\b(ai|ml|machine learning|llm|nlp|data scien|deep learning|genai)\b/i, icon: BrainCircuit, tint: "bg-violet-500/10 text-violet-600 dark:text-violet-300" },
  { pattern: /\b(sap|bw|hana|abap|erp|database|dba|sql|data engineer|etl|warehouse)\b/i, icon: Database, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-300" },
  { pattern: /\b(analyst|analytics|bi|power bi|tableau|finance)\b/i, icon: BarChart3, tint: "bg-teal-500/10 text-teal-600 dark:text-teal-300" },
  { pattern: /\b(cloud|devops|sre|aws|azure|gcp|infra|platform)\b/i, icon: Cloud, tint: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300" },
  { pattern: /\b(security|cyber|soc|pentest)\b/i, icon: ShieldCheck, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-300" },
  { pattern: /\b(android|ios|mobile|flutter|react native)\b/i, icon: Smartphone, tint: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300" },
  { pattern: /\b(design|designer|ui|ux|figma)\b/i, icon: Palette, tint: "bg-pink-500/10 text-pink-600 dark:text-pink-300" },
  { pattern: /\b(marketing|sales|growth|seo|content)\b/i, icon: Megaphone, tint: "bg-orange-500/10 text-orange-600 dark:text-orange-300" },
  { pattern: /\b(hr|recruit|talent|people)\b/i, icon: Users, tint: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  { pattern: /\b(qa|test|tester|support|technician|mechanical|electrical)\b/i, icon: Wrench, tint: "bg-lime-500/10 text-lime-700 dark:text-lime-300" },
  { pattern: /\b(developer|engineer|backend|frontend|full ?stack|software|programmer|java|python|node)\b/i, icon: Code2, tint: "bg-accent/10 text-accent" },
];

export function RoleIcon({ title, className }: { title: string; className?: string }) {
  const match = MATCHERS.find(({ pattern }) => pattern.test(title));
  const Icon = match?.icon ?? Briefcase;
  const tint = match?.tint ?? "bg-foreground/[0.06] text-foreground/70";
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-xl ring-1 ring-inset ring-black/[0.04] dark:ring-white/10 ${tint} ${className ?? "size-11"}`}>
      <Icon className="size-5" />
    </span>
  );
}
