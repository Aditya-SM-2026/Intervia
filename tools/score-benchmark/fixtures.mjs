 
// Phase 0 eval set: 13 synthetic interviews with planted ground truth.
// Ranges are [lo, hi]; the benchmark scores each model on how well its
// output lands inside them and follows the planted directions.
// Turn shape matches the production contract (seq, speaker, text, latencyMs).
// latencyMs here is expressed in ms like production (candidate answer delay).

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

let clock = -900000;
function turnSeq() {
  clock += 60000;
  return clock;
}

function makeTurns(spec) {
  return spec.map(([speaker, text, latencyMs]) => {
    const asked = iso(turnSeq());
    if (speaker === "interviewer") {
      return { seq: 0, speaker, text, askedAt: asked, answeredAt: null, latencyMs: null };
    }
    return { seq: 0, speaker, text, askedAt: null, answeredAt: iso(turnSeq() + latencyMs), latencyMs };
  }).map((t, i) => ({ ...t, seq: i + 1 }));
}

export const FIXTURES = [
  {
    id: "strong-honest",
    difficulty: "hard",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems (queues, caching, rate limiting).",
    resume: "4 years Python backend at a fintech. Led checkout queue migration. Redis rate limiting. Postgres schema design.",
    gt: { overall: [78, 95], jdMatch: [78, 95], aiRisk: [0, 20], communication: [75, 92] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Sure — four years on the payments backend at a fintech, mostly Python and Postgres. The work I'm proudest of is the checkout queue migration: we moved synchronous payment calls to an event-driven queue, which took p99 down from about 900ms to 200ms.", 4200],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "For a public API I'd start with a token bucket per API key in Redis — atomic Lua script for check-and-decrement, so it's correct under concurrency. I'd shard by key hash for scale, and return 429 with a Retry-After header. One trade-off: token bucket allows short bursts, which is usually what public API consumers want; a strict sliding window punishes them but guarantees a hard cap.", 8100],
      ["interviewer", "What breaks first when the Redis cluster degrades?"],
      ["candidate", "Honestly, the limiter fails open or closed depending on how we code it, and both are bad for different reasons. We ran into this — our fallback was local in-memory buckets, which are per-node and drift, but they bought us time to shed load deliberately instead of erroring 500s at customers.", 6600],
      ["interviewer", "How did you schema the payments table?"],
      ["candidate", "Ledger-style, append-only: money movements are rows, never updates. Balance is a materialized view maintained by the queue consumer, reconciled nightly. It made auditing trivial and deleted an entire class of concurrency bugs.", 5400],
      ["interviewer", "Anything you'd do differently now?"],
      ["candidate", "I'd version the queue events from day one. We bolted on a v2 field mid-migration and it made consumers ugly for months.", 3800],
    ]),
  },
  {
    id: "ai-assisted-full",
    difficulty: "hard",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems (queues, caching, rate limiting).",
    resume: "3 years backend. Python, REST APIs, some Docker.",
    gt: { overall: [25, 55], jdMatch: [70, 95], aiRisk: [80, 100], communication: [55, 85] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Certainly! I am a dedicated backend engineer with three years of experience specializing in Python, REST APIs, and Docker, consistently delivering high-quality, scalable solutions aligned with organizational goals.", 600],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "Great question! A robust approach is a token bucket algorithm implemented in Redis for atomicity and distributed coherence, sharded horizontally by API key to ensure scalability, with graceful degradation strategies to maintain high availability and an excellent developer experience.", 500],
      ["interviewer", "What breaks first when the Redis cluster degrades?"],
      ["candidate", "Excellent question! When Redis degrades, the primary concerns are consistency and availability trade-offs; implementing circuit breakers with exponential backoff ensures the system remains resilient while maintaining optimal user experience across all degradation scenarios.", 450],
      ["interviewer", "How would you schema a payments table?"],
      ["candidate", "Absolutely! An effective payments schema leverages an append-only ledger design with materialized views for balances, ensuring auditability, idempotency, and horizontal scalability while adhering to ACID guarantees and industry best practices.", 500],
      ["interviewer", "Let's go deeper — in your rate limiter, what exactly does the Lua script do?"],
      ["candidate", "Certainly! The Lua script ensures atomic check-and-decrement operations, providing a robust foundation for distributed rate limiting while maintaining consistency and high performance across all nodes in the cluster.", 550],
      ["interviewer", "Tell me about a time something you shipped broke in production."],
      ["candidate", "Certainly! While incidents are challenging, they present valuable learning opportunities; a systematic post-mortem process with actionable action items ensures continuous improvement and prevents recurrence.", 520],
    ]),
  },
  {
    id: "ai-assisted-partial",
    difficulty: "medium",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems.",
    resume: "2 years Python backend, internship before that.",
    gt: { overall: [45, 70], jdMatch: [55, 80], aiRisk: [45, 75], communication: [55, 80] },
    turns: makeTurns([
      ["interviewer", "Tell me about your current work."],
      ["candidate", "I'm on a small team doing internal APIs in Python — mostly CRUD services, some Postgres. It's fine, I've learned a lot about deployments.", 5200],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "A production-grade rate limiter should employ a distributed token bucket with Redis-backed atomic operations, per-key sharding for horizontal scalability, and comprehensive observability including rate-limit headers and graceful 429 handling to preserve developer experience.", 700],
      ["interviewer", "Explain that in your own words — why Redis and not just in-memory?"],
      ["candidate", "Um, in-memory only works on one server, right? If you have several API servers they'd each count separately. Redis is shared so everyone sees the same bucket. I haven't actually built one myself, we just used a library.", 7400],
      ["interviewer", "How would you debug a slow endpoint?"],
      ["candidate", "I'd reproduce it, add timing logs around the query and any external calls, check EXPLAIN on the query if it's Postgres, and look for N+1s in the ORM.", 6100],
      ["interviewer", "What's the hardest concurrency bug you've fixed?"],
      ["candidate", "Concurrency bugs represent a significant challenge in distributed systems; my approach emphasizes idempotency, careful locking strategies, and thorough testing under simulated load conditions to ensure correctness across failure modes.", 600],
      ["interviewer", "No really — an actual bug you personally fixed."],
      ["candidate", "Oh — we had a double-click issue on a payment button, two requests created two orders. Added an idempotency key from the client. That was mine, it was annoying to test.", 9000],
    ]),
  },
  {
    id: "rambler",
    difficulty: "medium",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems.",
    resume: "3 years backend, Python and some Node.",
    gt: { overall: [30, 55], jdMatch: [40, 65], aiRisk: [15, 45], communication: [8, 30] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "So yeah, I've been working for like three years now, mostly backend stuff, and before that I did a bit of frontend which I didn't really like that much, and there was this one project with Node that kind of went nowhere but I learned a lot from it honestly, and now I'm mostly doing Python which I prefer, although sometimes I miss the frontend days a bit when things were more visual, you know?", 9800],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "Right so a rate limiter, there's this thing where you count requests, and we did something like that at my last job, or maybe it was the job before, and there was Redis involved I think, or was that the caching thing, anyway the idea is you don't want people hammering your API because then the database gets slow, which happened once and it was bad, everyone was complaining, and so you need like a limit per user per minute or something, that's basically it I think.", 15200],
      ["interviewer", "Earlier you said you led the queue migration — what was your exact role?"],
      ["candidate", "Oh yeah the queue thing, so actually I wasn't leading it leading it, I was more like on the team that did it, I watched a lot of it happen, I did write one of the consumers, or part of one, but the design was mostly my lead's idea to be honest.", 11800],
      ["interviewer", "How do you test your work?"],
      ["candidate", "Testing, yeah, so we should always test, that's important, I write some unit tests when there's time, and there's CI which runs things, and staging exists, and usually it works, though sometimes things break in prod anyway which happens to everyone I guess.", 12400],
    ]),
  },
  {
    id: "terse",
    difficulty: "medium",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems.",
    resume: "2 years backend, Python.",
    gt: { overall: [10, 35], jdMatch: [20, 45], aiRisk: [0, 25], communication: [3, 20] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Two years Python backend.", 2600],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "Use Redis.", 1400],
      ["interviewer", "Can you elaborate — what would the design look like?"],
      ["candidate", "Just count requests and block if over the limit.", 1700],
      ["interviewer", "How would you schema a payments table?"],
      ["candidate", "Normal tables, with indexes.", 1500],
      ["interviewer", "What trade-offs did you consider?"],
      ["candidate", "Not sure.", 1200],
      ["interviewer", "Any questions for me?"],
      ["candidate", "No.", 900],
    ]),
  },
  {
    id: "jd-partial",
    difficulty: "medium",
    jd: "Backend engineer: strong Python and Postgres required; distributed systems experience (queues, caching, rate limiting) strongly preferred.",
    resume: "3 years Python and Postgres. No distributed systems exposure.",
    gt: { overall: [50, 72], jdMatch: [40, 65], aiRisk: [0, 25], communication: [60, 85] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Three years working with Python and Postgres, mostly building and maintaining our reporting APIs. I own a fair amount of the schema design and query tuning.", 5800],
      ["interviewer", "Your resume doesn't mention queues or caching — the role involves building a rate limiter. How would you approach that?"],
      ["candidate", "Honestly that's the part I'd be learning on the job. My instinct from reading: per-client counters in Redis with a fixed window, maybe. I know enough to know I don't know the failure modes yet — I'd want to pair with someone who's done it.", 7900],
      ["interviewer", "Tell me about your Postgres work instead."],
      ["candidate", "Happy to. We had a report endpoint taking 30 seconds; I rewrote the query, added a covering index and a materialized view refreshed every five minutes, got it to 400ms. Also designed our audit-log partitioning by month.", 8200],
      ["interviewer", "How do you handle schema migrations safely?"],
      ["candidate", "Expand-and-contract: add nullable columns first, backfill in batches, switch writes, then drop old columns in a later release. We lock less that way.", 6400],
      ["interviewer", "Would you be comfortable owning the distributed systems part here?"],
      ["candidate", "Comfortable is strong — but willing. I read a lot and I ask a lot; I'd rather say that than pretend.", 4100],
    ]),
  },
  {
    id: "jd-off-target",
    difficulty: "medium",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems.",
    resume: "Frontend developer, React and CSS, some Node scripts.",
    gt: { overall: [25, 50], jdMatch: [8, 30], aiRisk: [0, 25], communication: [55, 80] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Mostly frontend — three years of React, design systems, a lot of CSS architecture. I've written some Node scripts for tooling.", 6200],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "On the frontend side I'd handle it with interceptors — catch the 429, show a toast, retry with backoff. Server-side I'd guess some middleware counts requests, but honestly my strength is the user experience of these errors, not the counter itself.", 7400],
      ["interviewer", "How would you schema a payments table?"],
      ["candidate", "I haven't designed databases. I've consumed a lot of APIs though — if it matters, I can tell you which payment API responses were the worst to work with and why.", 6800],
      ["interviewer", "What's your experience with Postgres?"],
      ["candidate", "Writing queries in an ORM occasionally. Indexes are a backend thing I've heard about in standups.", 5900],
      ["interviewer", "Why apply for a backend role then?"],
      ["candidate", "I want to move into it. I learn fast and I'm genuinely curious about it — but I won't pretend today is day one of that journey.", 4300],
    ]),
  },
  {
    id: "contradiction",
    difficulty: "medium",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems.",
    resume: "4 years backend. Led checkout migration to event-driven queue.",
    gt: { overall: [40, 65], jdMatch: [45, 70], aiRisk: [45, 80], communication: [40, 65] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Four years backend. The headline is I led our checkout migration to an event-driven queue — designed it, drove it end to end.", 4600],
      ["interviewer", "What did 'leading' that look like day to day?"],
      ["candidate", "I owned the design doc, chose the queue tech, coordinated the three engineers, and wrote the trickiest consumer myself.", 5300],
      ["interviewer", "Which queue technology did you choose and why?"],
      ["candidate", "It was Kafka, mainly for replayability. We needed to reprocess failed payments.", 4800],
      ["interviewer", "You mentioned choosing the tech — was Kafka already in the company, or did you introduce it?"],
      ["candidate", "Honestly, Kafka was already there — the platform team ran it. I didn't introduce it, I just used it. 'Chose' is maybe strong. I picked which existing tool to build on.", 6900],
      ["interviewer", "And the design doc — reviewed by whom?"],
      ["candidate", "By my lead, mostly. I wrote it up but the architecture was already sketched before I joined the project. I filled in the details.", 7100],
      ["interviewer", "So summarizing: designed it, drove it, wrote the trickiest consumer — which parts were genuinely yours?"],
      ["candidate", "The consumer, for sure. The rest I'd call 'contributed to' more than 'led'. Fair pushback.", 5200],
    ]),
  },
  {
    id: "refusal-elaborate",
    difficulty: "medium",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems.",
    resume: "3 years backend, Python.",
    gt: { overall: [35, 60], jdMatch: [45, 70], aiRisk: [40, 75], communication: [25, 50] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Three years of Python backend work, APIs, databases, the usual. Solid experience overall.", 4400],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "I'd use a standard rate limiting approach with proper safeguards, as I mentioned — token bucket or similar, whatever fits the system best.", 1900],
      ["interviewer", "Which one would fit, and why?"],
      ["candidate", "Like I said, the standard approach. These are well-solved problems, no need to reinvent the wheel.", 1600],
      ["interviewer", "Help me understand your reasoning though — what breaks with a fixed window?"],
      ["candidate", "Nothing really breaks if you configure it right. I've covered this. Next question might be more productive.", 1500],
      ["interviewer", "Tell me about the Postgres schema you're proudest of."],
      ["candidate", "It was a well-structured schema following best practices, with appropriate indexes. It worked very well in production.", 1800],
      ["interviewer", "What made it well-structured, specifically?"],
      ["candidate", "As I said — best practices. Normalized, indexed. I think we're covering the same ground.", 1700],
    ]),
  },
  {
    id: "easy-normalized",
    difficulty: "easy",
    jd: "Junior backend engineer: basic Python, willingness to learn Postgres and APIs.",
    resume: "Bootcamp grad, 6 months internship, Python scripts and small APIs.",
    gt: { overall: [70, 90], jdMatch: [70, 90], aiRisk: [0, 22], communication: [65, 88] },
    turns: makeTurns([
      ["interviewer", "Tell me about the projects you've built."],
      ["candidate", "During my internship I built an internal tool that tracked office equipment bookings — Flask plus SQLite. Small, but it replaced a spreadsheet and people actually used it.", 6100],
      ["interviewer", "How would you check if a user's email already exists before registering them?"],
      ["candidate", "Query the users table with a WHERE clause on the email, and if a row comes back, reject the registration with a friendly message instead of hitting the unique constraint error.", 5400],
      ["interviewer", "What would go wrong if two requests did that at the same moment?"],
      ["candidate", "Both could pass the check and then one insert would fail on the unique constraint — so I'd still keep the unique constraint in the database as the real guarantee, and handle that error path.", 7800],
      ["interviewer", "How would you learn Postgres for this role?"],
      ["candidate", "I've used SQLite so far; I've started the Postgres tutorial and I'd want to get a real dev instance and break things in it. That's how the booking tool taught me the most.", 6900],
    ]),
  },
  {
    id: "same-transcript-hard",
    difficulty: "hard",
    jd: "Senior backend engineer: deep Python, Postgres internals, distributed systems design, incident leadership.",
    resume: "Bootcamp grad, 6 months internship, Python scripts and small APIs.",
    gt: { overall: [42, 62], jdMatch: [25, 50], aiRisk: [0, 22], communication: [60, 85] },
    note: "Same answers as easy-normalized; expectations drop because the bar is senior/hard.",
    turns: makeTurns([
      ["interviewer", "Tell me about the projects you've built."],
      ["candidate", "During my internship I built an internal tool that tracked office equipment bookings — Flask plus SQLite. Small, but it replaced a spreadsheet and people actually used it.", 6100],
      ["interviewer", "How would you check if a user's email already exists before registering them?"],
      ["candidate", "Query the users table with a WHERE clause on the email, and if a row comes back, reject the registration with a friendly message instead of hitting the unique constraint error.", 5400],
      ["interviewer", "What would go wrong if two requests did that at the same moment?"],
      ["candidate", "Both could pass the check and then one insert would fail on the unique constraint — so I'd still keep the unique constraint in the database as the real guarantee, and handle that error path.", 7800],
      ["interviewer", "How would you design the booking system to survive a datacenter outage?"],
      ["candidate", "I haven't dealt with anything like that. If I had to guess I'd say keep backups somewhere else, but I don't know how real systems do it yet.", 9200],
      ["interviewer", "How would you learn Postgres for this role?"],
      ["candidate", "I've used SQLite so far; I've started the Postgres tutorial and I'd want to get a real dev instance and break things in it. That's how the booking tool taught me the most.", 6900],
    ]),
  },
  {
    id: "mixed-profile",
    difficulty: "medium",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems.",
    resume: "5 years backend, deep Postgres and queueing experience.",
    gt: { overall: [50, 70], jdMatch: [75, 95], aiRisk: [0, 25], communication: [25, 50] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Five years. Postgres. Queues. Kafka, RabbitMQ, both. Partitioning. Consumer lag. That's the shape of it.", 4200],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "Token bucket. Redis. Lua for atomicity. Shard by key. 429s with headers.", 2300],
      ["interviewer", "Why token bucket over sliding window?"],
      ["candidate", "Bursts. Public APIs want bursts. Sliding window is for billing, not for this.", 3100],
      ["interviewer", "What did you monitor on your Kafka consumers?"],
      ["candidate", "Lag. Rebalance storms. Pause on overflow. We lost a weekend to a rebalance loop once — max.poll.interval was too small. Fixed it. Moved on.", 3600],
      ["interviewer", "Tell me about mentoring or working with others."],
      ["candidate", "Don't do much of that. Heads-down person. Code works, that's the job.", 2900],
      ["interviewer", "How would you explain your rate limiter design to a junior engineer?"],
      ["candidate", "Bucket. Tokens. Refill. Block when empty. It's not complicated.", 2400],
    ]),
  },
  {
    id: "noisy-genuine",
    difficulty: "medium",
    jd: "Backend engineer: Python, Postgres, API design, distributed systems.",
    resume: "3 years backend, Python and Postgres.",
    gt: { overall: [50, 72], jdMatch: [55, 80], aiRisk: [0, 22], communication: [35, 62] },
    turns: makeTurns([
      ["interviewer", "Walk me through your background."],
      ["candidate", "Yeah so, um, three years now, mostly Python, and like a lot of Postgres work, and, uh, I guess the main thing was I owned our reporting stack, kind of, for the last year?", 7800],
      ["interviewer", "How would you design a rate limiter for a public API?"],
      ["candidate", "OK so, um, I'd probably do like a token bucket thing in Redis, I remember reading about that, and, uh, you need it to be atomic because otherwise race conditions, like two requests both see one token left and both pass, so Lua or whatever for the atomic part, and then, um, return like a 429 with a retry header so clients behave.", 11400],
      ["interviewer", "What trade-offs did you consider?"],
      ["candidate", "So the, um, the burst thing — token buckets let bursts through, which for a public API is, like, good, developers hate getting blocked, but if you need a hard cap then sliding window is stricter, so it depends what the, uh, what the product wants I guess.", 9800],
      ["interviewer", "Tell me about a production incident you handled."],
      ["candidate", "Oh yeah, so our reporting DB, um, the disk filled up because a VACUUM wasn't running right, and like everything stalled, and I, uh, I cleaned up the dead tuples, fixed the autovacuum settings, and added, um, disk alerts so we'd know before it, like, died again.", 10200],
      ["interviewer", "What would you say is your biggest weakness?"],
      ["candidate", "Um, honestly I, like, talk before I've finished thinking? As you can probably tell. I've been working on writing things down first, um, for meetings and stuff.", 6400],
    ]),
  },
];

export const PLANTED_CHECKS = [
  { fixture: "ai-assisted-full", label: "aiRisk >= 75 for full AI-assisted", check: (s) => s.aiRisk.score >= 75 },
  { fixture: "strong-honest", label: "aiRisk <= 20 for honest candidate", check: (s) => s.aiRisk.score <= 20 },
  { fixture: "terse", label: "communication <= 20 for one-word answers", check: (s) => s.communication.score <= 20 },
  { fixture: "easy-normalized", label: "overall(easy) - overall(hard) >= 10 (difficulty normalization)", check: null, pairWith: "same-transcript-hard" },
];