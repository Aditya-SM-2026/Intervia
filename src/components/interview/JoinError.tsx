import Link from "next/link";

interface JoinErrorProps {
  code: "ROOM_NOT_FOUND" | "ROOM_EXPIRED" | "ROOM_UNAVAILABLE" | "SERVER_ERROR";
  message: string;
}

export function JoinError({ code, message }: JoinErrorProps) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center leading-relaxed">
        <h1 className="mb-2 text-xl font-semibold">Cannot join this interview</h1>
        <p role="alert" className="mb-4 text-sm">
          {message}
        </p>
        <p className="mb-6 text-xs text-muted">
          Reason code: {code}
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}