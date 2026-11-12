"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechAlternative {
  transcript: string;
}

interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative;
}

interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}

interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}

interface SpeechErrorEvent {
  readonly error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function joinText(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function voiceErrorMessage(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Microphone permission was blocked. Allow it in the browser and try again.";
  }
  if (code === "no-speech") return "I did not hear anything. Try again.";
  if (code === "audio-capture") return "No microphone was found.";
  if (code === "network") return "Voice input needs a network connection.";
  return "Voice input stopped. Try again.";
}

/**
 * Dictates into the assistant composer with the browser's speech recognition.
 * Text is shown live and left in the input for the recruiter to review, so a
 * spoken question is never sent automatically.
 */
export function useSpeechInput({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");
  const activeRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSupported(getSpeechRecognitionConstructor() !== null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      activeRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    recognitionRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    activeRef.current = false;
    finalRef.current = "";
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback((base: string) => {
    const Constructor = getSpeechRecognitionConstructor();
    if (!Constructor) {
      setError("Voice input is not supported in this browser.");
      return;
    }
    if (activeRef.current) {
      recognitionRef.current?.stop();
      return;
    }

    setError(null);
    baseRef.current = base.trim();
    finalRef.current = "";

    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event) => {
      let finalText = finalRef.current;
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (!transcript) continue;
        if (result.isFinal) finalText = joinText(finalText, transcript);
        else interimText = joinText(interimText, transcript);
      }
      finalRef.current = finalText;
      onTranscriptRef.current(joinText(baseRef.current, finalText, interimText));
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      setError(voiceErrorMessage(event.error));
      activeRef.current = false;
      setListening(false);
    };

    recognition.onend = () => {
      activeRef.current = false;
      setListening(false);
      recognitionRef.current = null;
      const finalText = finalRef.current.trim();
      if (finalText) onTranscriptRef.current(joinText(baseRef.current, finalText));
    };

    recognitionRef.current = recognition;
    activeRef.current = true;
    setListening(true);
    try {
      recognition.start();
    } catch {
      activeRef.current = false;
      setListening(false);
      recognitionRef.current = null;
      setError("Voice input could not start. Try again.");
    }
  }, []);

  return {
    supported,
    listening,
    error,
    start,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}
