// ─────────────────────────────────────────────────────────────────
// Real-time streaming hook — characters appear as they're generated
// Handles reconnection, abort, and error states
// Updated: carries PresenceStreamMetadata (verification + forecast)
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from "react";
import type { ChatMessage, SourceRecord, StreamMetadata } from "@/lib/presence-ai/types";
import type { PresenceStreamMetadata } from "@/lib/ask-presence.functions";
import { useServerFn } from "@tanstack/react-start";
import { askPresence } from "@/lib/ask-presence.functions";

export interface PresenceMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceRecord[];
  metadata?: PresenceStreamMetadata;
  isStreaming?: boolean;
  error?: boolean;
}

export interface UsePresenceStreamReturn {
  messages: PresenceMessage[];
  isStreaming: boolean;
  isLoading: boolean;
  rateLimitRemaining: number | null;
  sendMessage: (question: string) => Promise<void>;
  clearHistory: () => void;
  abort: () => void;
}

export function usePresenceStream(): UsePresenceStreamReturn {
  const askFn = useServerFn(askPresence);
  const [messages, setMessages] = useState<PresenceMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rateLimitRemaining, setRateLimitRemaining] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(
    async (question: string) => {
      if (isStreaming) return;

      // Abort any in-flight request
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();
      currentMessageIdRef.current = assistantMessageId;

      // Optimistic user message
      const userMsg: PresenceMessage = {
        id: userMessageId,
        role: "user",
        content: question,
      };

      // Build conversation history from current messages
      const history: ChatMessage[] = messages
        .filter((m) => !m.error)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          isStreaming: true,
        },
      ]);

      setIsLoading(true);
      setIsStreaming(false);

      try {
        // Use the server function directly (TanStack Start handles serialization)
        const result = await askFn({
          data: { question, conversationHistory: history },
        });

        if (abortController.signal.aborted) return;

        // Update rate limit display
        if (result.metadata?.rateLimitRemaining != null) {
          setRateLimitRemaining(result.metadata.rateLimitRemaining);
        }

        // Simulate streaming for cached/rule-based responses
        const words = result.answer.split(" ");
        let accumulated = "";

        setIsLoading(false);
        setIsStreaming(true);

        for (const word of words) {
          if (abortController.signal.aborted) break;
          accumulated += (accumulated ? " " : "") + word;

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId ? { ...m, content: accumulated, isStreaming: true } : m,
            ),
          );

          // Realistic typing speed: 20-50ms per word
          await new Promise((r) => setTimeout(r, Math.random() * 30 + 20));
        }

        // Finalize with all metadata
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: result.answer,
                  sources: result.sources,
                  metadata: result.metadata as PresenceStreamMetadata,
                  isStreaming: false,
                }
              : m,
          ),
        );
      } catch (err: any) {
        if (abortController.signal.aborted) return;

        const errorMessage = err.message?.includes("Rate limit")
          ? err.message
          : err.message || "Something went wrong. Please try again.";

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: errorMessage,
                  isStreaming: false,
                  error: true,
                }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
      }
    },
    [askFn, messages, isStreaming],
  );

  const clearHistory = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setIsStreaming(false);
    setIsLoading(false);
  }, []);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setIsLoading(false);

    // Mark current message as complete
    if (currentMessageIdRef.current) {
      const id = currentMessageIdRef.current;
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)));
    }
  }, []);

  return {
    messages,
    isStreaming,
    isLoading,
    rateLimitRemaining,
    sendMessage,
    clearHistory,
    abort,
  };
}
