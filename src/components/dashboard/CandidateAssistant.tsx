"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  History,
  Loader2,
  MessageSquare,
  Plus,
  Quote,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  AssistantAnswer,
  AssistantCandidateAnswer,
  AssistantCitation,
  AssistantComparisonAnswer,
  AssistantConversation,
  AssistantGeneralAnswer,
  AssistantMessage,
  AssistantNoticeAnswer,
  AssistantPortfolioAnswer,
  AssistantSkillEstimate,
} from "@/lib/interviews/assistant.types";

interface CandidateAssistantProps {
  roomId: string;
  candidateName: string;
  open: boolean;
  onClose: () => void;
  onJumpToTurn?: (seq: number) => void;
  onJumpToReportSection?: (sectionId: string) => void;
}

const SUGGESTIONS = [
  "What are the strongest technical answers?",
  "What score would you give for their top skill?",
  "Is this candidate better than another candidate?",
  "Who scored highest in this role?",
];

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  medium: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  low: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
};

const BASIS_LABEL: Record<string, string> = {
  report: "From the report",
  inferred: "Inferred from the interview",
  general: "General knowledge",
  estimate: "Estimated score",
};

export function CandidateAssistant({
  roomId,
  candidateName,
  open,
  onClose,
  onJumpToTurn,
  onJumpToReportSection,
}: CandidateAssistantProps) {
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useCallback((node: HTMLTextAreaElement | null) => {
    if (open && node) window.setTimeout(() => node.focus({ preventScroll: true }), 120);
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (historyOpen) {
        setHistoryOpen(false);
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/dashboard/interviews/${roomId}/assistant`, { method: "GET" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message ?? "Could not load assistant history.");
        return body as { conversations: AssistantConversation[] };
      })
      .then(async (body) => {
        if (cancelled) return;
        setConversations(body.conversations);
        if (!conversationId && body.conversations.length > 0) {
          await openConversation(body.conversations[0].id);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load assistant history.");
      });
    return () => {
      cancelled = true;
    };
    // openConversation is stable enough for this one-shot load; adding it would
    // reload the latest thread every time the component re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roomId]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function openConversation(id: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/interviews/${roomId}/assistant/${id}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 404) {
          setConversations((previous) => previous.filter((item) => item.id !== id));
          setConversationId(null);
          setMessages([]);
          return;
        }
        throw new Error(body?.error?.message ?? "Could not load this conversation.");
      }
      setConversationId(id);
      setMessages((body as { messages: AssistantMessage[] }).messages ?? []);
      setHistoryOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this conversation.");
    } finally {
      setLoading(false);
    }
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setInput("");
    setHistoryOpen(false);
  }

  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const optimistic: AssistantMessage = {
      id: `pending-${Date.now()}`,
      conversationId: conversationId ?? "new",
      role: "user",
      content: trimmed,
      answer: null,
      scope: "candidate",
      referencedRoomIds: [],
      model: null,
      costUsd: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((previous) => [...previous, optimistic]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/dashboard/interviews/${roomId}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: trimmed,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "The assistant could not answer that.");
      }
      const result = body as { conversationId: string; message: AssistantMessage };
      setConversationId(result.conversationId);
      setMessages((previous) => [...previous, result.message]);
      const listResponse = await fetch(`/api/dashboard/interviews/${roomId}/assistant`);
      if (listResponse.ok) {
        const list = (await listResponse.json()) as { conversations: AssistantConversation[] };
        setConversations(list.conversations ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assistant could not answer that.");
      setMessages((previous) => previous.filter((message) => message.id !== optimistic.id));
      setInput(trimmed);
    } finally {
      setLoading(false);
    }
  }

  async function deleteConversation(id: string) {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    const response = await fetch(`/api/dashboard/interviews/${roomId}/assistant/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("Could not delete that conversation.");
      return;
    }
    setConversations((previous) => previous.filter((item) => item.id !== id));
    if (id === conversationId) {
      setConversationId(null);
      setMessages([]);
    }
  }

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close assistant"
          onClick={onClose}
          className="fixed inset-x-0 bottom-0 top-16 z-30 bg-slate-950/30 backdrop-blur-[2px] xl:hidden"
        />
      )}

      <aside
        aria-label="Candidate AI assistant"
        className={`fixed bottom-0 right-0 top-16 z-40 w-full flex-col overflow-hidden border-l border-slate-200/90 bg-white shadow-2xl transition-transform duration-300 dark:border-border dark:bg-surface sm:w-[480px] xl:sticky xl:bottom-auto xl:right-auto xl:top-20 xl:z-10 xl:h-[calc(100dvh-6rem)] xl:w-[380px] xl:shrink-0 xl:translate-x-0 xl:rounded-2xl xl:border xl:shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${
          open ? "flex translate-x-0" : "hidden translate-x-full pointer-events-none"
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        {/* Header */}
        <div className="border-b border-slate-200/80 bg-gradient-to-br from-blue-50 via-white to-white px-5 pb-4 pt-5 dark:border-border dark:from-blue-950/30 dark:via-surface dark:to-surface">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
                <Sparkles className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-foreground">
                  Candidate assistant
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-muted">
                  Evidence from {candidateName || "this candidate"}&apos;s resume and interview.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close assistant"
              className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900 dark:border-border dark:bg-surface dark:text-slate-300"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={startNewChat}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-xs transition hover:border-blue-300 hover:text-blue-700 dark:border-border dark:bg-surface dark:text-slate-200"
            >
              <Plus className="size-3.5" />
              New chat
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              aria-expanded={historyOpen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-xs transition hover:border-blue-300 hover:text-blue-700 dark:border-border dark:bg-surface dark:text-slate-200"
            >
              <History className="size-3.5" />
              History
              {conversations.length > 0 && (
                <span className="rounded-full bg-blue-50 px-1.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                  {conversations.length}
                </span>
              )}
              <ChevronDown className={`size-3 transition ${historyOpen ? "rotate-180" : ""}`} />
            </button>
          </div>

          {historyOpen && (
            <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-border dark:bg-surface">
              {conversations.length === 0 ? (
                <p className="px-2 py-3 text-xs text-slate-500 dark:text-muted">
                  No saved conversations yet.
                </p>
              ) : (
                conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className={`group flex items-center gap-1 rounded-lg px-1 ${
                      conversation.id === conversationId ? "bg-blue-50 dark:bg-blue-950/40" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void openConversation(conversation.id)}
                      className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left"
                    >
                      <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                        {conversation.title}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        {formatRelative(conversation.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteConversation(conversation.id)}
                      aria-label={`Delete ${conversation.title}`}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 opacity-100 transition hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !loading && !error ? (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
                <p className="flex items-center gap-2 text-xs font-bold text-blue-800 dark:text-blue-200">
                  <MessageSquare className="size-4" />
                  Ask anything about this candidate
                </p>
                <p className="mt-2 text-xs leading-relaxed text-blue-900/80 dark:text-blue-100/80">
                  I read {candidateName || "this candidate"}&apos;s report, transcript and resume, and
                  I can estimate a skill score when the report has no official one.
                </p>
              </div>
              <div className="grid gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendQuestion(suggestion)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs font-medium text-slate-700 shadow-xs transition hover:border-blue-300 hover:text-blue-700 dark:border-border dark:bg-surface dark:text-slate-200"
                  >
                    <span>{suggestion}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-sm">
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <AssistantMessageCard
                    key={message.id}
                    message={message}
                    onJumpToTurn={onJumpToTurn}
                    onJumpToSection={onJumpToReportSection}
                    onFollowUp={(question) => void sendQuestion(question)}
                  />
                ),
              )}
              {loading && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:border-border dark:bg-slate-900/40 dark:text-muted">
                  <Loader2 className="size-3.5 animate-spin text-blue-600" />
                  Reading the report and checking quotes...
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200/80 bg-white p-3 dark:border-border dark:bg-surface">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2 shadow-xs transition focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/15 dark:border-border dark:bg-slate-900/40 dark:focus-within:border-blue-500/70">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendQuestion(input);
                }
              }}
              rows={2}
              maxLength={600}
              placeholder="Ask about this candidate, or compare them with someone..."
              className="max-h-32 min-h-10 w-full resize-none bg-transparent px-1.5 py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-foreground"
            />
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[10px] text-slate-400">
                Enter sends. Shift + Enter adds a line.
              </span>
              <button
                type="button"
                onClick={() => void sendQuestion(input)}
                disabled={loading || input.trim().length < 2}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Ask
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function AssistantMessageCard({
  message,
  onJumpToTurn,
  onJumpToSection,
  onFollowUp,
}: {
  message: AssistantMessage;
  onJumpToTurn?: (seq: number) => void;
  onJumpToSection?: (sectionId: string) => void;
  onFollowUp: (question: string) => void;
}) {
  const answer = message.answer;
  return (
    <div className="flex items-start gap-2.5">
      <div className="size-8 shrink-0 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 p-[1.5px] shadow-sm">
        <div className="flex h-full w-full items-center justify-center rounded-full bg-white dark:bg-slate-900">
          <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        </div>
      </div>
      <div className="min-w-0 max-w-[calc(100%-2.5rem)] rounded-2xl rounded-tl-md bg-slate-50 px-4 py-3 text-slate-800 ring-1 ring-slate-200/80 dark:bg-slate-800/80 dark:text-slate-100 dark:ring-slate-700/80">
        {answer ? (
          <AnswerBody
            answer={answer}
            onJumpToTurn={onJumpToTurn}
            onJumpToSection={onJumpToSection}
            onFollowUp={onFollowUp}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        )}
        <p className="mt-2.5 text-[10px] text-slate-400 dark:text-slate-500">
          {formatTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

function AnswerBody({
  answer,
  onJumpToTurn,
  onJumpToSection,
  onFollowUp,
}: {
  answer: AssistantAnswer;
  onJumpToTurn?: (seq: number) => void;
  onJumpToSection?: (sectionId: string) => void;
  onFollowUp: (question: string) => void;
}) {
  if (answer.kind === "general") {
    return <GeneralAnswerCard answer={answer} />;
  }
  if (answer.kind === "candidate") {
    return (
      <CandidateAnswerCard
        answer={answer}
        onJumpToTurn={onJumpToTurn}
        onJumpToSection={onJumpToSection}
        onFollowUp={onFollowUp}
      />
    );
  }
  if (answer.kind === "comparison") {
    return <ComparisonAnswerCard answer={answer} onJumpToTurn={onJumpToTurn} />;
  }
  if (answer.kind === "portfolio") {
    return <PortfolioAnswerCard answer={answer} />;
  }
  return <NoticeAnswerCard answer={answer} onFollowUp={onFollowUp} />;
}

function CandidateAnswerCard({
  answer,
  onJumpToTurn,
  onJumpToSection,
  onFollowUp,
}: {
  answer: AssistantCandidateAnswer;
  onJumpToTurn?: (seq: number) => void;
  onJumpToSection?: (sectionId: string) => void;
  onFollowUp: (question: string) => void;
}) {
  const citations =
    answer.citations && answer.citations.length > 0
      ? answer.citations
      : legacyCitations(answer);
  const basis = answer.basis ?? "report";

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <BasisBadge basis={basis} />
        {answer.estimatedSkill && (
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              answer.estimatedSkill.official
                ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
            }`}
          >
            {answer.estimatedSkill.official ? "Report score" : "Estimate"}
          </span>
        )}
      </div>

      <AnswerText
        text={answer.assessment}
        citations={citations}
        onJumpToTurn={onJumpToTurn}
        onJumpToSection={onJumpToSection}
      />

      {answer.estimatedSkill && (
        <EstimatedSkillCard estimate={answer.estimatedSkill} onJumpToSection={onJumpToSection} />
      )}

      {citations.length > 0 && (
        <CitationSources
          citations={citations}
          onJumpToTurn={onJumpToTurn}
          onJumpToSection={onJumpToSection}
        />
      )}

      {answer.missingEvidence && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {answer.missingEvidence}
        </p>
      )}

      <ConfidencePill confidence={answer.confidence} reason={answer.confidenceReason} />

      {answer.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {answer.followUps.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onFollowUp(question)}
              className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerText({
  text,
  citations,
  onJumpToTurn,
  onJumpToSection,
}: {
  text: string;
  citations: AssistantCitation[];
  onJumpToTurn?: (seq: number) => void;
  onJumpToSection?: (sectionId: string) => void;
}) {
  const byIndex = new Map(citations.map((citation) => [citation.index, citation]));
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-line text-sm leading-relaxed">
      {parts.map((part, index) => {
        const match = /^\[(\d+)\]$/.exec(part);
        if (!match) return <span key={`text-${index}`}>{part}</span>;
        const citation = byIndex.get(Number(match[1]));
        if (!citation) return null;
        const target =
          citation.kind === "transcript"
            ? citation.turnSeq !== undefined
            : Boolean(citation.sectionId);
        return (
          <button
            key={`cite-${index}`}
            type="button"
            disabled={!target}
            onClick={() => jumpCitation(citation, onJumpToTurn, onJumpToSection)}
            title={citation.quote || citation.label}
            className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-100 px-1 align-[0.15em] text-[10px] font-semibold text-blue-700 transition hover:bg-blue-200 disabled:cursor-default dark:bg-blue-950/60 dark:text-blue-300"
          >
            {citation.index}
          </button>
        );
      })}
    </p>
  );
}

function BasisBadge({ basis }: { basis: string }) {
  const tone =
    basis === "inferred"
      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
      : basis === "general"
        ? "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        : basis === "estimate"
          ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
          : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone}`}>
      {BASIS_LABEL[basis] ?? "From the report"}
    </span>
  );
}

function EstimatedSkillCard({
  estimate,
  onJumpToSection,
}: {
  estimate: AssistantSkillEstimate;
  onJumpToSection?: (sectionId: string) => void;
}) {
  const tone = estimate.official
    ? "border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/25"
    : "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/25";
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {estimate.official ? "Official report score" : "Estimated skill score"}
          </p>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{estimate.skill}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {estimate.score}
            <span className="text-xs font-medium text-slate-400">/100</span>
          </p>
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{estimate.band}</p>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-200">
        {estimate.rationale}
      </p>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        {estimate.official
          ? "This comes from the report's scored custom parameters."
          : "Estimated from the interview and resume evidence, not an official report score."}
      </p>
      <div className="mt-2 flex gap-1.5">
        {estimate.official && (
          <button
            type="button"
            onClick={() => onJumpToSection?.("custom")}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-700 dark:border-border dark:bg-surface dark:text-slate-300"
          >
            View score details
          </button>
        )}
      </div>
    </div>
  );
}

function CitationSources({
  citations,
  onJumpToTurn,
  onJumpToSection,
}: {
  citations: AssistantCitation[];
  onJumpToTurn?: (seq: number) => void;
  onJumpToSection?: (sectionId: string) => void;
}) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white/70 dark:border-border dark:bg-slate-900/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        <span className="flex items-center gap-1.5">
          <Quote className="size-3 text-slate-400" />
          Sources
          <span className="rounded-full bg-slate-100 px-1.5 text-[9px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            {citations.length}
          </span>
        </span>
        <ChevronDown className="size-3.5 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="grid gap-1 border-t border-slate-200 p-2 dark:border-border">
        {citations.map((citation) => (
          <CitationRow
            key={`${citation.kind}-${citation.index}`}
            citation={citation}
            onJumpToTurn={onJumpToTurn}
            onJumpToSection={onJumpToSection}
          />
        ))}
      </div>
    </details>
  );
}

function CitationRow({
  citation,
  onJumpToTurn,
  onJumpToSection,
}: {
  citation: AssistantCitation;
  onJumpToTurn?: (seq: number) => void;
  onJumpToSection?: (sectionId: string) => void;
}) {
  const target =
    citation.kind === "transcript"
      ? citation.turnSeq !== undefined
      : Boolean(citation.sectionId);
  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => jumpCitation(citation, onJumpToTurn, onJumpToSection)}
      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50 disabled:cursor-default dark:hover:bg-slate-800/50"
    >
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
        {citation.index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold text-slate-700 dark:text-slate-200">
          {citation.label}
        </span>
        {citation.quote && (
          <span className="mt-0.5 line-clamp-2 block text-[10px] italic leading-relaxed text-slate-500 dark:text-slate-400">
            “{citation.quote}”
          </span>
        )}
        {citation.note && (
          <span className="mt-0.5 block text-[9px] leading-relaxed text-slate-400 dark:text-slate-500">
            {citation.note}
          </span>
        )}
      </span>
    </button>
  );
}

function jumpCitation(
  citation: AssistantCitation,
  onTurn?: (turn: number) => void,
  onSection?: (section: string) => void,
) {
  if (citation.kind === "transcript") {
    if (citation.turnSeq !== undefined) onTurn?.(citation.turnSeq);
    return;
  }
  if (citation.sectionId) onSection?.(citation.sectionId);
}

function legacyCitations(answer: AssistantCandidateAnswer): AssistantCitation[] {
  const citations: AssistantCitation[] = [];
  for (const item of answer.resumeEvidence.items) {
    citations.push({
      index: citations.length + 1,
      kind: "resume",
      label: "Resume",
      sectionId: "resume",
      quote: item.quote,
      note: item.note,
    });
  }
  for (const item of answer.interviewEvidence.items) {
    citations.push({
      index: citations.length + 1,
      kind: "transcript",
      label: `Turn ${item.turnSeq}`,
      turnSeq: item.turnSeq,
      quote: item.quote,
      note: item.note,
    });
  }
  return citations;
}

function GeneralAnswerCard({ answer }: { answer: AssistantGeneralAnswer }) {
  return (
    <div className="grid gap-2">
      <span className="w-fit rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        General knowledge
      </span>
      <p className="text-sm leading-relaxed">{answer.answer}</p>
    </div>
  );
}

function ComparisonAnswerCard({
  answer,
  onJumpToTurn,
}: {
  answer: AssistantComparisonAnswer;
  onJumpToTurn?: (seq: number) => void;
}) {
  return (
    <div className="grid gap-3">
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800 dark:text-slate-100">{answer.assessment}</p>
      <div className="grid gap-2">
        {answer.candidates.map((candidate) => (
          <div
            key={candidate.roomId}
            className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-border dark:bg-slate-900/30"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-900 dark:text-foreground">{candidate.name}</p>
                <p className="truncate text-[10px] text-slate-500 dark:text-muted">{candidate.role}</p>
              </div>
              <ScorePill value={candidate.metrics.overall} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-200">
              {candidate.assessment}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <MiniMetric label="Answers" value={candidate.metrics.answers} />
              <MiniMetric label="Resume" value={candidate.metrics.resume} />
              <MiniMetric label="Authenticity" value={candidate.metrics.authenticity} />
            </div>
            {candidate.resumeEvidence.length > 0 && (
              <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/60 px-2 py-1.5 dark:border-sky-900 dark:bg-sky-950/20">
                <p className="text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                  Resume claim
                </p>
                <p className="mt-0.5 text-[10px] italic leading-relaxed text-slate-700 dark:text-slate-200">
                  &ldquo;{candidate.resumeEvidence[0].quote}&rdquo;
                </p>
              </div>
            )}
            {candidate.interviewEvidence.length > 0 && (
              <div className="mt-2 grid gap-1.5">
                {candidate.interviewEvidence.slice(0, 2).map((item) => (
                  <EvidenceBlockRow
                    key={`${candidate.roomId}-${item.turnSeq}`}
                    turnSeq={item.turnSeq}
                    quote={item.quote}
                    note={item.note}
                    onJump={onJumpToTurn}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {answer.dimensions.length > 0 && (
        <div className="grid gap-1.5">
          {answer.dimensions.map((dimension) => {
            const leader = answer.candidates.find((candidate) => candidate.roomId === dimension.leaderRoomId);
            return (
              <div key={dimension.label} className="flex items-start gap-2 text-[11px]">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-blue-600" />
                <p className="text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{dimension.label}:</span>{" "}
                  {dimension.note}
                  {leader ? ` (${leader.name})` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {answer.verdict && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium leading-relaxed text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          {answer.verdict}
        </p>
      )}
      <ConfidencePill confidence={answer.confidence} reason={answer.confidenceReason} />
      {answer.caveats.length > 0 && (
        <ul className="grid gap-1 text-[10px] text-slate-500 dark:text-muted">
          {answer.caveats.map((caveat) => (
            <li key={caveat} className="flex gap-1.5">
              <span className="text-slate-400">•</span>
              <span>{caveat}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PortfolioAnswerCard({ answer }: { answer: AssistantPortfolioAnswer }) {
  return (
    <div className="grid gap-3">
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800 dark:text-slate-100">{answer.answer}</p>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <span>{answer.metricLabel}</span>
        {answer.role && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{answer.role}</span>}
      </div>
      <div className="grid gap-1.5">
        {answer.rows.map((row, index) => (
          <Link
            key={row.roomId}
            href={`/dashboard/${row.roomId}`}
            className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-xs transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-border dark:bg-surface"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {index + 1}
            </span>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-50 text-[10px] font-bold uppercase text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
              {initials(row.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-slate-900 dark:text-foreground">{row.name}</span>
              <span className="block truncate text-[10px] text-slate-500 dark:text-muted">{row.role}</span>
            </span>
            <span className="text-right">
              <span className="block text-xs font-bold tabular-nums text-slate-900 dark:text-foreground">
                {row.metricValue === null ? "–" : Math.round(row.metricValue)}
              </span>
              <span className="block text-[9px] text-slate-400">overall {row.overall === null ? "–" : Math.round(row.overall)}</span>
            </span>
          </Link>
        ))}
      </div>
      <ConfidencePill confidence={answer.confidence} reason={answer.confidenceReason} />
      {answer.caveats.length > 0 && (
        <ul className="grid gap-1 text-[10px] text-slate-500 dark:text-muted">
          {answer.caveats.map((caveat) => (
            <li key={caveat}>• {caveat}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoticeAnswerCard({
  answer,
  onFollowUp,
}: {
  answer: AssistantNoticeAnswer;
  onFollowUp: (question: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800 dark:text-slate-100">{answer.message}</p>
      {answer.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {answer.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onFollowUp(option.split(" (")[0])}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700 dark:border-border dark:bg-slate-900/40 dark:text-slate-200"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceBlockRow({
  turnSeq,
  quote,
  note,
  onJump,
}: {
  turnSeq: number;
  quote: string;
  note: string;
  onJump?: (seq: number) => void;
}) {
  return (
    <div className="rounded-lg bg-white/80 p-2 dark:bg-slate-900/40">
      <p className="flex gap-1.5 text-[11px] italic leading-relaxed text-slate-700 dark:text-slate-200">
        <Quote className="mt-0.5 size-3 shrink-0 text-slate-400" />
        <span>&ldquo;{quote}&rdquo;</span>
      </p>
      <div className="mt-1 flex items-center justify-between gap-2 pl-[18px]">
        <p className="text-[10px] text-slate-500 dark:text-muted">{note}</p>
        <button
          type="button"
          onClick={() => onJump?.(turnSeq)}
          className="shrink-0 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 transition hover:border-blue-300 hover:text-blue-700 dark:border-border dark:bg-surface dark:text-slate-300"
        >
          Turn {turnSeq}
        </button>
      </div>
    </div>
  );
}

function ConfidencePill({ confidence, reason }: { confidence: string; reason: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${CONFIDENCE_STYLE[confidence] ?? CONFIDENCE_STYLE.low}`}>
        {confidence} confidence
      </span>
      {reason && <span className="text-[10px] text-slate-500 dark:text-muted">{reason}</span>}
    </div>
  );
}

function ScorePill({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">no score</span>;
  }
  const tone =
    value >= 75 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : value >= 50 ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${tone}`}>{Math.round(value)}</span>;
}

function MiniMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-white px-1.5 py-1 text-center dark:bg-slate-900/50">
      <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[11px] font-bold tabular-nums text-slate-800 dark:text-slate-100">
        {value === null ? "–" : Math.round(value)}
      </p>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function formatRelative(value: string): string {
  const then = Date.parse(value);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
