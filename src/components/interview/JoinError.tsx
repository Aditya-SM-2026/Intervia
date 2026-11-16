import { CircleCheck, Clock, Link2Off, MailX, RotateCcw, ServerCrash, type LucideIcon } from "lucide-react";
import { StatusScreen } from "@/components/ui/StatusScreen";

interface JoinErrorProps {
  code: "ROOM_NOT_FOUND" | "ROOM_EXPIRED" | "ROOM_UNAVAILABLE" | "EMAIL_MISMATCH" | "SERVER_ERROR";
  message: string;
  /** The interview already took place: thank the candidate, offer no retry. */
  finished?: boolean;
}

const VIEWS: Record<JoinErrorProps["code"], { title: string; icon: LucideIcon; tone: "neutral" | "warn" | "bad"; retry?: boolean }> = {
  ROOM_NOT_FOUND: { title: "This link doesn't work", icon: Link2Off, tone: "neutral" },
  ROOM_EXPIRED: { title: "This interview link has expired", icon: Clock, tone: "warn" },
  ROOM_UNAVAILABLE: { title: "This interview isn't available", icon: Link2Off, tone: "neutral" },
  EMAIL_MISMATCH: { title: "This link is for someone else", icon: MailX, tone: "bad" },
  SERVER_ERROR: { title: "We couldn't load your interview", icon: ServerCrash, tone: "bad", retry: true },
};

/** Shown to a candidate whose interview link cannot be opened. */
export function JoinError({ code, message, finished }: JoinErrorProps) {
  if (finished) {
    return (
      <StatusScreen
        icon={CircleCheck}
        tone="good"
        title="Your interview is complete"
        message={message}
        steps={[
          { label: "Interview recorded", done: true },
          { label: "The hiring team reviews it" },
          { label: "They contact you about next steps" },
        ]}
        reason={code}
      />
    );
  }
  const view = VIEWS[code];
  return (
    <StatusScreen
      icon={view.icon}
      tone={view.tone}
      title={view.title}
      message={message}
      reason={code}
      action={view.retry ? { href: "", label: "Try again", icon: RotateCcw, reload: true } : undefined}
    />
  );
}
