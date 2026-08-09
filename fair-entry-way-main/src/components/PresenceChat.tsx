// ─────────────────────────────────────────────────────────────────
// Production-ready chat UI — World-class edition
//
// New in this version:
//   • Forecast banner — live attendance status at top of chat
//   • Verification badge — ✓ Live data verified / ⚠ AI inferred
//   • Thumbs up/down feedback on every AI response
//   • Memory indicator — shows when AI remembers you
//   • Proactive suggestion chips based on risk level
// ─────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react';
import { usePresenceStream } from '@/hooks/usePresenceStream';
import type { PresenceMessage } from '@/hooks/usePresenceStream';
import type { PresenceStreamMetadata } from '@/lib/ask-presence.functions';
// saveFeedback is called via dynamic import at call-time to keep client bundle clean

// ── Helpers ────────────────────────────────────────────────────────

function StreamingCursor() {
  return (
    <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
  );
}

// ── Forecast Banner ────────────────────────────────────────────────

function ForecastBanner({ forecast }: { forecast: NonNullable<PresenceStreamMetadata['forecast']> }) {
  const colours: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    safe:     { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' },
    warning:  { bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-200',   dot: 'bg-amber-500' },
    critical: { bg: 'bg-red-50',     text: 'text-red-800',     border: 'border-red-200',     dot: 'bg-red-500' },
    failed:   { bg: 'bg-red-100',    text: 'text-red-900',     border: 'border-red-400',     dot: 'bg-red-600' },
  };
  const c = colours[forecast.riskLevel] ?? colours.safe;
  const pct = (forecast.currentRate * 100).toFixed(1);

  return (
    <div className={`mx-4 mt-3 mb-1 p-3 rounded-xl border ${c.bg} ${c.border}`}>
      <div className="flex items-start gap-2">
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${c.dot}`} />
        <div className="min-w-0">
          <p className={`text-xs font-semibold ${c.text}`}>{forecast.headline}</p>
          {forecast.sessionsNeededToRecover > 0 && (
            <p className={`text-xs mt-0.5 ${c.text} opacity-80`}>
              Attend {forecast.sessionsNeededToRecover} more sessions to be safe
            </p>
          )}
          {forecast.nextSessionMinutes !== null && forecast.nextSessionMinutes <= 60 && (
            <p className={`text-xs mt-0.5 font-medium ${c.text}`}>
              ⏰ Next session starts in {forecast.nextSessionMinutes} min — don't miss it
            </p>
          )}
        </div>
        <div className={`text-right flex-shrink-0 ${c.text}`}>
          <span className="text-sm font-bold">{pct}%</span>
          <p className="text-xs opacity-60">/ 75% min</p>
        </div>
      </div>
    </div>
  );
}

// ── Verification Badge ─────────────────────────────────────────────

function VerificationBadge({ badge }: { badge: NonNullable<PresenceStreamMetadata['verificationBadge']> }) {
  const styles: Record<string, string> = {
    verified:  'text-emerald-600 bg-emerald-50',
    inferred:  'text-blue-500 bg-blue-50',
    corrected: 'text-amber-600 bg-amber-50',
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${styles[badge.variant] ?? styles.inferred}`}>
      {badge.label}
    </span>
  );
}

// ── Source Badges ─────────────────────────────────────────────────

function SourceBadges({ sources }: { sources: NonNullable<PresenceMessage['sources']> }) {
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {sources.slice(0, 5).map((s) => (
        <span
          key={s.id}
          className={`
            text-xs px-2 py-0.5 rounded-full font-medium
            ${s.decision === 'present'
              ? 'bg-green-100 text-green-700'
              : s.decision === 'absent'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
            }
          `}
        >
          {s.date} · {s.decision} · {s.trustScore ?? '?'}/100
        </span>
      ))}
    </div>
  );
}

// ── Feedback Buttons ──────────────────────────────────────────────

function FeedbackButtons({
  messageId,
  question,
  answer,
  onFeedback,
}: {
  messageId: string;
  question: string;
  answer: string;
  onFeedback: (helpful: boolean) => void;
}) {
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);

  const handleVote = async (helpful: boolean) => {
    if (voted) return;
    setVoted(helpful ? 'up' : 'down');
    onFeedback(helpful);
    // Persist via server function — fire-and-forget
    try {
      const { saveFeedback: save } = await import('@/lib/presence-ai/feedback.functions');
      await save({ data: { question, answer, wasHelpful: helpful } });
    } catch {
      // Non-fatal — feedback failure never interrupts the user
    }
  };

  return (
    <div className="flex items-center gap-1 mt-2">
      <span className="text-[10px] text-gray-400 mr-1">Helpful?</span>
      <button
        onClick={() => handleVote(true)}
        disabled={!!voted}
        className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
          voted === 'up'
            ? 'bg-emerald-100 text-emerald-600'
            : voted
            ? 'text-gray-300'
            : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'
        }`}
        title="Helpful"
        aria-label="Mark as helpful"
      >
        👍
      </button>
      <button
        onClick={() => handleVote(false)}
        disabled={!!voted}
        className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
          voted === 'down'
            ? 'bg-red-100 text-red-500'
            : voted
            ? 'text-gray-300'
            : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'
        }`}
        title="Not helpful"
        aria-label="Mark as not helpful"
      >
        👎
      </button>
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────

function MessageBubble({
  message,
  previousUserMessage,
}: {
  message: PresenceMessage;
  previousUserMessage?: string;
}) {
  const isUser = message.role === 'user';
  const meta = message.metadata as PresenceStreamMetadata | undefined;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold mr-2 flex-shrink-0 mt-1">
          P
        </div>
      )}

      <div
        className={`
          max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed
          ${isUser
            ? 'bg-blue-600 text-white rounded-tr-sm'
            : message.error
              ? 'bg-red-50 border border-red-200 text-red-800 rounded-tl-sm'
              : 'bg-gray-100 text-gray-900 rounded-tl-sm'
          }
        `}
      >
        {/* Content with streaming cursor */}
        <span className="whitespace-pre-wrap">
          {message.content}
          {message.isStreaming && <StreamingCursor />}
        </span>

        {/* Sources */}
        {!isUser && message.sources && !message.isStreaming && (
          <SourceBadges sources={message.sources} />
        )}

        {/* Bottom row: model info + verification badge + memory indicator */}
        {!isUser && meta && !message.isStreaming && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">
              {meta.model} · {meta.ragRecordsUsed} records
              {meta.cached && ' · cached'}
              {meta.memoryActive && ' · 🧠 memory active'}
            </span>
            {meta.verificationBadge && (
              <VerificationBadge badge={meta.verificationBadge} />
            )}
          </div>
        )}

        {/* Feedback buttons */}
        {!isUser && !message.isStreaming && !message.error && message.content && (
          <FeedbackButtons
            messageId={message.id}
            question={previousUserMessage ?? ''}
            answer={message.content}
            onFeedback={(helpful) => {
              // Logged internally — no UI change needed beyond the vote indicator
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Main Chat Component ───────────────────────────────────────────

export function PresenceChat() {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages,
    isStreaming,
    isLoading,
    rateLimitRemaining,
    sendMessage,
    clearHistory,
    abort,
  } = usePresenceStream();

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || isStreaming || isLoading) return;
    setInput('');
    await sendMessage(q);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Get latest forecast from most recent assistant message
  const latestForecast = [...messages]
    .reverse()
    .find(m => m.role === 'assistant' && (m.metadata as PresenceStreamMetadata)?.forecast)
    ?.metadata?.forecast as PresenceStreamMetadata['forecast'] | undefined;

  // Dynamic suggestions based on risk level
  const riskLevel = latestForecast?.riskLevel;
  const suggestions = riskLevel === 'critical' || riskLevel === 'failed'
    ? [
        '⚠️ Will I fail due to attendance?',
        'How many sessions must I attend?',
        'What happens if I miss tomorrow?',
        'Can my instructor override my attendance?',
      ]
    : riskLevel === 'warning'
    ? [
        'How many more sessions can I miss?',
        'Will I fail if I miss this week?',
        "What's my attendance percentage?",
        'Why was I marked absent last session?',
      ]
    : [
        'Why was I marked absent last session?',
        "What's my attendance percentage?",
        'Explain my trust score',
        'Which gate failed in my last check-in?',
      ];

  // Find previous user message for a given assistant message index
  const getPreviousUserMessage = (idx: number): string | undefined => {
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return undefined;
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-bold">P</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Presence AI</p>
            <p className="text-xs text-gray-500">Presence Attendance Assistant · Proactive</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rateLimitRemaining != null && (
            <span className="text-xs text-gray-400">
              {rateLimitRemaining} queries left
            </span>
          )}
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Forecast Banner (shows after first AI response) */}
      {latestForecast && !isStreaming && (
        <ForecastBanner forecast={latestForecast} />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
              <span className="text-3xl">📋</span>
            </div>
            <h3 className="text-gray-800 font-semibold mb-1">
              Ask about your attendance
            </h3>
            <p className="text-gray-500 text-sm mb-6">
              I know your records, remember your past issues, and can predict your future trajectory.
            </p>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-left text-sm px-3 py-2 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => (
            <MessageBubble
              key={m.id}
              message={m}
              previousUserMessage={m.role === 'assistant' ? getPreviousUserMessage(idx) : undefined}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your attendance..."
            rows={1}
            maxLength={500}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
            style={{ maxHeight: '120px' }}
            disabled={isStreaming || isLoading}
          />

          {isStreaming ? (
            <button
              onClick={abort}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
              title="Stop generating"
            >
              <span className="w-3 h-3 bg-white rounded-sm" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          )}
        </div>

        {input.length > 400 && (
          <p className="text-xs text-amber-500 mt-1 text-right">
            {500 - input.length} characters remaining
          </p>
        )}
      </div>
    </div>
  );
}
