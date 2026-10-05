import { AiStatus, type AiUiState } from "./AiStatus";

interface AiAgentVideoProps {
  state: AiUiState;
  detail: string | null;
}

export function AiAgentVideo({ state, detail }: AiAgentVideoProps) {
  return (
    <div
      role="group"
      aria-label="Intervia AI interviewer"
      className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl border border-border bg-[#101827] text-white"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse at 50% 42%, rgba(59,130,246,.3), transparent 43%), radial-gradient(ellipse at 50% 100%, rgba(99,102,241,.18), transparent 55%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-4">
        <div
          className={`grid size-24 place-items-center rounded-full border border-blue-300/30 bg-blue-400/10 shadow-[0_0_60px_rgba(59,130,246,0.2)] sm:size-28 ${
            state === "speaking" ? "animate-pulse" : ""
          }`}
        >
          <div className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 text-2xl font-semibold tracking-tight shadow-inner sm:size-20 sm:text-3xl">
            AI
          </div>
        </div>
        <div className="flex h-5 items-center gap-1" aria-hidden="true">
          {[2, 3, 4, 3, 5, 2, 4, 3, 2].map((height, index) => (
            <span
              key={index}
              className={`w-1 rounded-full bg-blue-300/80 ${
                state === "speaking" ? "animate-pulse" : ""
              }`}
              style={{ height: `${height * 4}px`, animationDelay: `${index * 80}ms` }}
            />
          ))}
        </div>
        <div className="text-center">
          <p className="font-medium">Intervia AI</p>
          <p className="mt-1 text-xs text-slate-300">Your AI interviewer</p>
        </div>
        <AiStatus state={state} detail={detail} />
      </div>
      <span className="absolute left-3 top-3 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white/80">
        AI interviewer
      </span>
    </div>
  );
}
