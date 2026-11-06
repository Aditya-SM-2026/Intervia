"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUp,
  ArrowUpRight,
  CheckCircle2,
  History,
  Loader2,
  Plus,
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
} from "@/lib/interviews/assistant.types";

type JumpToSection = (sectionId: string, quote?: string) => void;

interface CandidateAssistantProps {
  roomId: string;
  candidateName: string;
  open: boolean;
  onClose: () => void;
  onJumpToTurn?: (seq: number) => void;
  onJumpToReportSection?: JumpToSection;
}

const SUGGESTIONS = [
  "What are the strongest technical answers?",
  "What score would you give for their top skill?",
  "Is this candidate better than another candidate?",
  "Who scored highest in this role?",
];


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

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close Ask AI"
          onClick={onClose}
          className="fixed inset-x-0 bottom-0 top-16 z-30 bg-black/25 backdrop-blur-[2px] xl:hidden"
        />
      )}

      <aside
        aria-label="Ask AI about this candidate"
        className={`fixed bottom-0 right-0 top-16 z-40 w-full flex-col overflow-hidden border-l border-border bg-surface shadow-2xl shadow-black/15 sm:w-[460px] xl:sticky xl:bottom-auto xl:right-auto xl:top-20 xl:z-10 xl:h-[calc(100dvh-6rem)] xl:w-[400px] xl:shrink-0 xl:rounded-2xl xl:border xl:shadow-sm xl:shadow-black/[0.03] ${
          open ? "flex animate-pop-in" : "hidden"
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        {/* Header */}
        <div className="relative flex items-center gap-3 border-b border-border px-4 py-3">
          <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Ask AI</h2>
            <p className="truncate text-xs text-muted">About {candidateName || "this candidate"}, with sources</p>
          </div>
          <button
            type="button"
            onClick={startNewChat}
            title="New chat"
            aria-label="New chat"
            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen((value) => !value)}
            aria-expanded={historyOpen}
            title="Earlier chats"
            aria-label="Earlier chats"
            className={`relative grid size-8 place-items-center rounded-lg transition hover:bg-foreground/[0.06] hover:text-foreground ${
              historyOpen ? "bg-foreground/[0.06] text-foreground" : "text-muted"
            }`}
          >
            <History className="size-4" aria-hidden />
            {conversations.length > 0 && (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Ask AI"
            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>

          {historyOpen && (
            <div className="animate-pop-in absolute inset-x-3 top-[calc(100%+6px)] z-20 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl shadow-black/10">
              <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted">Earlier chats</p>
              {conversations.length === 0 ? (
                <p className="px-2.5 pb-3 pt-1 text-sm text-muted">Nothing yet. Questions you ask are saved here.</p>
              ) : (
                conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className={`group flex items-center gap-1 rounded-lg ${
                      conversation.id === conversationId ? "bg-accent-soft" : "hover:bg-foreground/[0.04]"
                    }`}
                  >
                    {pendingDelete === conversation.id ? (
                      <div className="flex flex-1 items-center justify-between gap-2 px-2.5 py-2 text-sm">
                        <span>Delete this chat?</span>
                        <span className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="rounded-md px-2 py-1 text-xs text-muted hover:bg-foreground/[0.06]"
                          >
                            Keep
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDelete(null);
                              void deleteConversation(conversation.id);
                            }}
                            className="rounded-md bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700"
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void openConversation(conversation.id)}
                          className="min-w-0 flex-1 px-2.5 py-2 text-left"
                        >
                          <span className="block truncate text-sm font-medium">{conversation.title}</span>
                          <span className="block text-xs text-muted">{formatRelative(conversation.updatedAt)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(conversation.id)}
                          aria-label={`Delete ${conversation.title}`}
                          className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted opacity-100 transition hover:bg-rose-500/10 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-5">
          {messages.length === 0 && !loading && !error ? (
            <div className="flex h-full flex-col justify-end">
              <p className="text-[15px] font-medium">What do you want to know about {candidateName || "this candidate"}?</p>
              <p className="mt-1 text-sm leading-6 text-muted">
                Answers come only from their resume, interview and scores, and every claim links to where it came from.
              </p>
              <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendQuestion(suggestion)}
                    className="group flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-sm transition hover:bg-foreground/[0.03]"
                  >
                    <span>{suggestion}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted transition group-hover:text-accent" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-6">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground/[0.06] px-3.5 py-2.5 text-sm leading-6">
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
                <p className="text-shimmer flex items-center gap-2 text-sm">
                  <Sparkles className="size-3.5 text-accent" aria-hidden />
                  Reading the interview and checking quotes…
                </p>
              )}
              {error && (
                <p role="alert" className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="p-3 pt-0">
          <div className="rounded-2xl border border-border bg-background/60 p-1.5 transition focus-within:border-accent focus-within:bg-surface focus-within:ring-4 focus-within:ring-accent/10">
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
              placeholder="Ask about this candidate, or compare them with someone"
              className="max-h-32 min-h-11 w-full resize-none bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted"
            />
            <div className="flex items-center justify-between gap-2 pl-2.5">
              <span className="text-[11px] text-muted">Enter to send, Shift + Enter for a new line</span>
              <button
                type="button"
                onClick={() => void sendQuestion(input)}
                disabled={loading || input.trim().length < 2}
                aria-label="Send"
                className="grid size-8 place-items-center rounded-xl bg-accent text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-foreground/15"
              >
                {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
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
  onJumpToSection?: JumpToSection;
  onFollowUp: (question: string) => void;
}) {
  const answer = message.answer;
  return (
    <div className="min-w-0 text-sm leading-6 text-foreground/90">
      {answer ? (
        <AnswerBody answer={answer} onJumpToTurn={onJumpToTurn} onJumpToSection={onJumpToSection} onFollowUp={onFollowUp} />
      ) : (
        <p className="whitespace-pre-wrap">{message.content}</p>
      )}
      <p className="mt-2 text-[11px] text-muted">{formatTime(message.createdAt)}</p>
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
  onJumpToSection?: JumpToSection;
  onFollowUp: (question: string) => void;
}) {
  if (answer.kind === "general") return <GeneralAnswerCard answer={answer} />;
  if (answer.kind === "candidate") {
    return <CandidateAnswerCard answer={answer} onJumpToTurn={onJumpToTurn} onJumpToSection={onJumpToSection} />;
  }
  if (answer.kind === "comparison") return <ComparisonAnswerCard answer={answer} onJumpToTurn={onJumpToTurn} />;
  if (answer.kind === "portfolio") return <PortfolioAnswerCard answer={answer} />;
  return <NoticeAnswerCard answer={answer} onFollowUp={onFollowUp} />;
}

function CandidateAnswerCard({
  answer,
  onJumpToTurn,
  onJumpToSection,
}: {
  answer: AssistantCandidateAnswer;
  onJumpToTurn?: (seq: number) => void;
  onJumpToSection?: JumpToSection;
}) {
  const citations = answer.citations && answer.citations.length > 0 ? answer.citations : legacyCitations(answer);
  return (
    <div className="grid gap-3">
      <AnswerText text={answer.assessment} citations={citations} onJumpToTurn={onJumpToTurn} onJumpToSection={onJumpToSection} />
      {citations.length > 0 && (
        <CitationSources citations={citations} onJumpToTurn={onJumpToTurn} onJumpToSection={onJumpToSection} />
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
  onJumpToSection?: JumpToSection;
}) {
  const byIndex = new Map(citations.map((citation) => [citation.index, citation]));
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-line">
      {parts.map((part, index) => {
        const match = /^\[(\d+)\]$/.exec(part);
        if (!match) return <span key={`text-${index}`}>{part}</span>;
        const citation = byIndex.get(Number(match[1]));
        if (!citation) return null;
        const target = citation.kind === "transcript" ? citation.turnSeq !== undefined : Boolean(citation.sectionId);
        return (
          <button
            key={`cite-${index}`}
            type="button"
            disabled={!target}
            onClick={() => jumpCitation(citation, onJumpToTurn, onJumpToSection)}
            title={citation.quote || citation.label}
            className="mx-0.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-md bg-accent-soft px-1 align-[0.1em] text-[10px] font-semibold tabular-nums text-accent transition hover:bg-accent hover:text-white disabled:cursor-default"
          >
            {citation.index}
          </button>
        );
      })}
    </p>
  );
}

function CitationSources({
  citations,
  onJumpToTurn,
  onJumpToSection,
}: {
  citations: AssistantCitation[];
  onJumpToTurn?: (seq: number) => void;
  onJumpToSection?: JumpToSection;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">Sources</p>
      <ol className="mt-1.5 divide-y divide-border rounded-xl border border-border">
        {citations.map((citation) => {
          const target = citation.kind === "transcript" ? citation.turnSeq !== undefined : Boolean(citation.sectionId);
          const where = citation.kind === "transcript" ? `Answer at turn ${citation.turnSeq}` : citation.label;
          return (
            <li key={`${citation.kind}-${citation.index}`}>
              <button
                type="button"
                disabled={!target}
                onClick={() => jumpCitation(citation, onJumpToTurn, onJumpToSection)}
                className="group flex w-full items-start gap-2.5 px-3 py-2 text-left transition hover:bg-foreground/[0.03] disabled:cursor-default"
              >
                <span className="mt-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-md bg-foreground/[0.06] text-[10px] font-semibold tabular-nums">
                  {citation.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium group-hover:text-accent">{where}</span>
                  {citation.quote && (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted">“{citationSnippet(citation.quote, 160)}”</span>
                  )}
                </span>
                {target && <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted group-hover:text-accent" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function citationSnippet(quote: string | undefined, limit: number): string {
  const text = quote?.trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function jumpCitation(citation: AssistantCitation, onTurn?: (turn: number) => void, onSection?: JumpToSection) {
  if (citation.kind === "transcript") {
    if (citation.turnSeq !== undefined) onTurn?.(citation.turnSeq);
    return;
  }
  if (citation.sectionId) onSection?.(citation.sectionId, citation.quote);
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
    <div className="grid gap-1.5">
      <p className="text-xs text-muted">General knowledge, not from this interview</p>
      <p>{answer.answer}</p>
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
    <div className="grid gap-4">
      <p className="whitespace-pre-line">{answer.assessment}</p>
      <div className="divide-y divide-border rounded-xl border border-border">
        {answer.candidates.map((candidate) => (
          <div key={candidate.roomId} className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{candidate.name}</p>
                <p className="truncate text-xs text-muted">{candidate.role}</p>
              </div>
              <Score value={candidate.metrics.overall} large />
            </div>
            <dl className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
              <Metric label="Answers" value={candidate.metrics.answers} />
              <Metric label="Resume" value={candidate.metrics.resume} />
              <Metric label="Originality" value={candidate.metrics.authenticity} />
            </dl>
            <p className="mt-2.5 text-[13px] leading-5 text-foreground/80">{candidate.assessment}</p>
            {candidate.interviewEvidence.slice(0, 2).map((item) => (
              <button
                key={`${candidate.roomId}-${item.turnSeq}`}
                type="button"
                onClick={() => onJumpToTurn?.(item.turnSeq)}
                className="mt-2 block w-full border-l-2 border-border pl-2.5 text-left text-xs text-muted transition hover:border-accent hover:text-foreground"
              >
                “{citationSnippet(item.quote, 140)}”
              </button>
            ))}
          </div>
        ))}
      </div>
      {answer.dimensions.length > 0 && (
        <ul className="grid gap-1.5 text-[13px]">
          {answer.dimensions.map((dimension) => {
            const leader = answer.candidates.find((candidate) => candidate.roomId === dimension.leaderRoomId);
            return (
              <li key={dimension.label} className="flex gap-2">
                <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="font-medium">{dimension.label}:</span> {dimension.note}
                  {leader ? <span className="text-muted"> ({leader.name})</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {answer.verdict && <p className="border-l-2 border-accent pl-3 font-medium">{answer.verdict}</p>}
      <Confidence confidence={answer.confidence} reason={answer.confidenceReason} caveats={answer.caveats} />
    </div>
  );
}

function PortfolioAnswerCard({ answer }: { answer: AssistantPortfolioAnswer }) {
  return (
    <div className="grid gap-3">
      <p className="whitespace-pre-line">{answer.answer}</p>
      <div>
        <p className="text-xs text-muted">
          {answer.metricLabel}
          {answer.role ? ` for ${answer.role}` : ""}
        </p>
        <ol className="mt-1.5 divide-y divide-border rounded-xl border border-border">
          {answer.rows.map((row, index) => (
            <li key={row.roomId}>
              <Link
                href={`/dashboard/${row.roomId}`}
                className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-foreground/[0.03]"
              >
                <span className="w-4 text-xs tabular-nums text-muted">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  <span className="block truncate text-xs text-muted">{row.role}</span>
                </span>
                <Score value={row.metricValue} />
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <Confidence confidence={answer.confidence} reason={answer.confidenceReason} caveats={answer.caveats} />
    </div>
  );
}

function NoticeAnswerCard({ answer, onFollowUp }: { answer: AssistantNoticeAnswer; onFollowUp: (question: string) => void }) {
  return (
    <div className="grid gap-2.5">
      <p className="whitespace-pre-line">{answer.message}</p>
      {answer.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {answer.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onFollowUp(option.split(" (")[0])}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:border-accent/40 hover:text-accent"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CONFIDENCE_DOT: Record<string, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-foreground/30",
};

function Confidence({ confidence, reason, caveats }: { confidence: string; reason: string; caveats: string[] }) {
  return (
    <div className="text-xs text-muted">
      <p className="flex items-center gap-1.5">
        <span aria-hidden className={`size-1.5 rounded-full ${CONFIDENCE_DOT[confidence] ?? CONFIDENCE_DOT.low}`} />
        <span className="font-medium capitalize text-foreground/80">{confidence} confidence</span>
        {reason && <span className="truncate">— {reason}</span>}
      </p>
      {caveats.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          {caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Score({ value, large = false }: { value: number | null; large?: boolean }) {
  if (value === null) return <span className="text-xs text-muted">No score</span>;
  const tone =
    value >= 70 ? "text-emerald-600 dark:text-emerald-400" : value >= 50 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return <span className={`font-semibold tabular-nums ${large ? "text-lg" : "text-sm"} ${tone}`}>{Math.round(value)}</span>;
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value === null ? "–" : Math.round(value)}</dd>
    </div>
  );
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
