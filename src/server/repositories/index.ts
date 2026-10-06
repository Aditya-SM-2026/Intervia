import "server-only";
import type { InterviewRepository } from "@/lib/interviews/interview.types";
import { getInMemoryInterviewRepository } from "./in-memory-interview-repository";
import { getPostgresInterviewRepository } from "./postgres-interview-repository";

/**
 * Storage selector: Postgres when DATABASE_URL is configured (Cloud SQL in
 * production), in-memory otherwise so local development stays zero-setup.
 */
export function getInterviewRepository(): InterviewRepository {
  if (process.env.DATABASE_URL?.trim()) {
    return getPostgresInterviewRepository();
  }
  return getInMemoryInterviewRepository();
}