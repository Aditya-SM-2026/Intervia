"use client";

import { useState } from "react";
import { CandidateEndScreen, ConnectingOrb, JoinScreen } from "@/components/interview/CandidateScreens";
import { CandidateMessage } from "@/components/interview/CandidateShell";
import { LiveRoom } from "@/components/interview/LiveRoom";
import type { AiUiState } from "@/components/interview/AiStatus";

const STAGES = ["verify", "devices", "connecting", "live", "ended", "left", "error"] as const;
type PreviewStage = (typeof STAGES)[number];

const TRANSCRIPT = [
  { id: "1", role: "interviewer" as const, text: "Hi Priya, thanks for joining. Shall we begin?" },
  { id: "2", role: "candidate" as const, text: "Yes, ready." },
  { id: "3", role: "interviewer" as const, text: "Walk me through how you tested the retrieval step in your last project." },
];

export function InterviewPreview() {
  const [stage, setStage] = useState<PreviewStage>("verify");
  const [ai, setAi] = useState<AiUiState>("speaking");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [conversation, setConversation] = useState(false);
  const [hr, setHr] = useState(false);
  const common = { roomId: "preview", roomTitle: "AI Developer", candidateName: "Priya Raman", recruiterName: "Admin", durationMinutes: 30 };

  let screen;
  if (stage === "verify" || stage === "devices") {
    screen = <JoinScreen key={stage} {...common} startVerified={stage === "devices"} onVerified={() => {}} onProceed={() => {}} />;
  } else if (stage === "connecting") {
    screen = (
      <CandidateMessage icon={<ConnectingOrb />} title="Connecting you to your interviewer">
        <p>This takes a few seconds. Keep this tab open.</p>
      </CandidateMessage>
    );
  } else if (stage === "live") {
    screen = (
      <LiveRoom
        {...common}
        elapsedSeconds={252}
        connectionStage="connected"
        aiState={ai}
        aiDetail={null}
        interviewerTrack={null}
        microphoneTrack={null}
        videoTrack={null}
        muted={muted}
        cameraOff={cameraOff}
        transcript={TRANSCRIPT}
        showConversation={conversation}
        audioBlocked={false}
        hrNotice={false}
        hrPresent={hr}
        hrTrack={null}
        onToggleConversation={() => setConversation((value) => !value)}
        onToggleMute={() => setMuted((value) => !value)}
        onToggleCamera={() => setCameraOff((value) => !value)}
        onLeave={() => setStage("left")}
        onEnableAudio={() => {}}
      />
    );
  } else {
    screen = <CandidateEndScreen kind={stage} candidateName="Priya Raman" recruiterName="Admin" failure={null} onRetry={() => setStage("verify")} />;
  }

  return (
    <>
      {screen}
      <div className="fixed left-2 top-1/2 z-50 grid -translate-y-1/2 gap-1 rounded-lg bg-black/70 p-1.5 text-[11px] text-white" data-preview-switcher>
        {STAGES.map((item) => (
          <button key={item} type="button" onClick={() => setStage(item)} className={`rounded px-2 py-1 text-left ${stage === item ? "bg-white text-black" : ""}`}>
            {item}
          </button>
        ))}
        {(["speaking", "listening", "processing"] as const).map((item) => (
          <button key={item} type="button" onClick={() => setAi(item)} className={`rounded px-2 py-1 text-left ${ai === item ? "bg-white/30" : ""}`}>
            ai: {item}
          </button>
        ))}
        <button type="button" onClick={() => setHr((value) => !value)} className={`rounded px-2 py-1 text-left ${hr ? "bg-white/30" : ""}`}>
          hr: {hr ? "on" : "off"}
        </button>
      </div>
    </>
  );
}
