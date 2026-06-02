// SPDX-License-Identifier: Apache-2.0

import { type AgentEvent, isNotionalCost, isUntrackedCost } from '@pinagent/shared';
import { Button } from '@pinagent/ui/components/ui/button';
import { Textarea } from '@pinagent/ui/components/ui/textarea';
import { cn } from '@pinagent/ui/lib/utils';
import { Check, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TimestampDot } from '../components/TimestampDot';
import type { ConversationStream, StreamItem } from '../hooks/useConversationStream';

/**
 * One locally-pushed item that hasn't come back over the WS yet. Used
 * so user actions feel instantaneous instead of waiting on the agent's
 * next bus emission. Rendered inline in the transcript next to the real
 * stream items, ordered by `receivedAt`.
 */
export type OptimisticItem =
  | { kind: 'user_message'; id: number; content: string; receivedAt: string }
  | { kind: 'ask_response'; id: number; askId: string; answer: string; receivedAt: string };

interface StreamViewProps {
  stream: ConversationStream;
  isMock: boolean;
  optimistic: OptimisticItem[];
  answeredAskIds: ReadonlySet<string>;
  onAnswerAsk: (askId: string, answer: string) => void;
  /** Disable ask-user reply input — set when the run is done or mock. */
  askDisabled: boolean;
  /** Run's credential source, so the `result` row can relabel notional cost. */
  apiKeySource?: string | null;
}

type DisplayItem =
  | { kind: 'stream'; key: string; receivedAt: string; item: StreamItem }
  | { kind: 'optimistic'; key: string; receivedAt: string; item: OptimisticItem };

/**
 * A render unit in the transcript: either a single chat row, or a
 * collapsed group of consecutive tool calls (hidden behind a tap).
 */
type RenderBlock =
  | { kind: 'single'; key: string; item: DisplayItem }
  | { kind: 'tools'; key: string; items: StreamItem[] };

/** A stream item that's a tool_use / tool_result agent event. */
function isToolItem(item: StreamItem): boolean {
  return (
    item.kind === 'event' && (item.event.type === 'tool_use' || item.event.type === 'tool_result')
  );
}

export function StreamView({
  stream,
  isMock,
  optimistic,
  answeredAskIds,
  onAnswerAsk,
  askDisabled,
  apiKeySource,
}: StreamViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Merge live + optimistic items by timestamp so user-sent messages
  // appear in-flow as soon as they're sent, before any agent echo.
  const merged = useMemo<DisplayItem[]>(() => {
    const all: DisplayItem[] = [
      ...stream.items.map(
        (item): DisplayItem => ({
          kind: 'stream',
          key: `s-${item.id}`,
          receivedAt: item.receivedAt,
          item,
        }),
      ),
      ...optimistic.map(
        (item): DisplayItem => ({
          kind: 'optimistic',
          key: `o-${item.id}`,
          receivedAt: item.receivedAt,
          item,
        }),
      ),
    ];
    return all.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }, [stream.items, optimistic]);

  // Coalesce consecutive tool events (`tool_use` / `tool_result`) into a
  // single collapsed block so the transcript reads like a chat with the
  // agent — prose, questions, and your replies — rather than a stream of
  // machine activity. The tool detail is opt-in: a tap on the block
  // reveals the individual calls. Anything that isn't a tool event breaks
  // the run, so prose and tool work stay in chronological order.
  const blocks = useMemo<RenderBlock[]>(() => {
    const out: RenderBlock[] = [];
    let bucket: StreamItem[] = [];
    const flush = (): void => {
      const first = bucket[0];
      if (!first) return;
      out.push({ kind: 'tools', key: `tg-${first.id}`, items: bucket });
      bucket = [];
    };
    for (const d of merged) {
      if (d.kind === 'stream' && isToolItem(d.item)) {
        bucket.push(d.item);
      } else {
        flush();
        out.push({ kind: 'single', key: d.key, item: d });
      }
    }
    flush();
    return out;
  }, [merged]);

  // Pin scroll to the bottom whenever new items arrive so live updates
  // stay in view without the user having to scroll. `scrollRef` points
  // at the inner row wrapper, not at a scrollable element — setting
  // `scrollTop` on it was a no-op, which is why the panel never
  // followed the stream. Call `scrollIntoView({ block: 'end' })` on
  // the last row instead and let the browser walk up to whichever
  // ancestor actually scrolls.
  const count = merged.length;
  useEffect(() => {
    if (count === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    el.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [count]);

  if (merged.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-6 text-center text-xs text-muted-foreground"
      >
        {isMock ? 'Mock mode — no live stream.' : 'Waiting for the agent to start…'}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="space-y-2">
      {blocks.map((b) =>
        b.kind === 'tools' ? (
          <ToolGroup
            key={b.key}
            items={b.items}
            answeredAskIds={answeredAskIds}
            onAnswerAsk={onAnswerAsk}
            askDisabled={askDisabled}
            apiKeySource={apiKeySource}
          />
        ) : b.item.kind === 'stream' ? (
          <StreamRow
            key={b.key}
            item={b.item.item}
            answeredAskIds={answeredAskIds}
            onAnswerAsk={onAnswerAsk}
            askDisabled={askDisabled}
            apiKeySource={apiKeySource}
          />
        ) : (
          <OptimisticRow key={b.key} item={b.item.item} />
        ),
      )}
    </div>
  );
}

interface ToolGroupProps {
  items: StreamItem[];
  answeredAskIds: ReadonlySet<string>;
  onAnswerAsk: (askId: string, answer: string) => void;
  askDisabled: boolean;
  apiKeySource?: string | null;
}

/**
 * Collapsed run of tool calls. Default state is a single quiet line
 * (`▸ N tool calls`) so the transcript stays conversational; tapping it
 * expands the individual `tool_use` / `tool_result` rows for the curious.
 * Surfacing the detail is opt-in, per the "chat, not activity log" intent.
 */
function ToolGroup({
  items,
  answeredAskIds,
  onAnswerAsk,
  askDisabled,
  apiKeySource,
}: ToolGroupProps) {
  const [open, setOpen] = useState(false);
  const callCount = items.filter(
    (it) => it.kind === 'event' && it.event.type === 'tool_use',
  ).length;
  const n = callCount || items.length;
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        <span className="font-mono">
          {n} tool call{n === 1 ? '' : 's'}
        </span>
        {!open && <span className="text-muted-foreground/60">· tap to view</span>}
      </button>
      {open && (
        <div className="space-y-1.5 border-l border-dashed border-border pl-2.5">
          {items.map((it) => (
            <StreamRow
              key={it.id}
              item={it}
              answeredAskIds={answeredAskIds}
              onAnswerAsk={onAnswerAsk}
              askDisabled={askDisabled}
              apiKeySource={apiKeySource}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OptimisticRow({ item }: { item: OptimisticItem }) {
  // Both kinds render as "you said this" — keeps the transcript honest
  // about who spoke without forcing the user to wait for the agent to
  // echo their message back over the bus.
  return (
    <RowFrame speaker={item.kind === 'ask_response' ? 'You (answer)' : 'You'} at={item.receivedAt}>
      <p className="text-foreground whitespace-pre-wrap break-words">
        {item.kind === 'user_message' ? item.content : item.answer}
      </p>
      <p className="mt-1 flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <Check className="h-3 w-3" />
        Sent · waiting for the agent to reply.
      </p>
    </RowFrame>
  );
}

interface StreamRowProps {
  item: StreamItem;
  answeredAskIds: ReadonlySet<string>;
  onAnswerAsk: (askId: string, answer: string) => void;
  askDisabled: boolean;
  apiKeySource?: string | null;
}

function StreamRow({
  item,
  answeredAskIds,
  onAnswerAsk,
  askDisabled,
  apiKeySource,
}: StreamRowProps) {
  if (item.kind === 'error') {
    return (
      <div className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-fg">
        {item.message}
      </div>
    );
  }
  return (
    <EventRow
      event={item.event}
      at={item.receivedAt}
      answeredAskIds={answeredAskIds}
      onAnswerAsk={onAnswerAsk}
      disabled={askDisabled}
      apiKeySource={apiKeySource}
    />
  );
}

interface EventRowProps {
  event: AgentEvent;
  at: string;
  answeredAskIds: ReadonlySet<string>;
  onAnswerAsk: (askId: string, answer: string) => void;
  disabled: boolean;
  apiKeySource?: string | null;
}

function EventRow({
  event,
  at,
  answeredAskIds,
  onAnswerAsk,
  disabled,
  apiKeySource,
}: EventRowProps) {
  switch (event.type) {
    case 'init':
      return (
        <RowFrame speaker="Agent" at={at} tone="meta">
          <p className="text-foreground/80 text-[12px]">
            Session started · model <code className="font-mono text-[11px]">{event.model}</code> ·{' '}
            {event.permissionMode}
          </p>
        </RowFrame>
      );
    case 'text':
      return (
        <RowFrame speaker="Agent" at={at}>
          <p className="text-foreground whitespace-pre-wrap break-words">{event.text}</p>
        </RowFrame>
      );
    case 'tool_use':
      return (
        <RowFrame speaker="Tool" at={at} tone="meta">
          <span className="font-mono text-[11px]">
            <span className="font-semibold">{event.name}</span>{' '}
            <span className="text-muted-foreground">{event.summary}</span>
          </span>
        </RowFrame>
      );
    case 'tool_result':
      return (
        <div
          className={cn(
            'rounded-md border px-2.5 py-1 text-[10.5px] font-mono',
            event.ok
              ? 'border-status-ready-border bg-status-ready-bg text-status-ready-fg'
              : 'border-status-error-border bg-status-error-bg text-status-error-fg',
          )}
        >
          {event.ok ? '✓ tool ok' : '✗ tool error'}
        </div>
      );
    case 'ask_user':
      return (
        <RowFrame speaker="Agent" at={at} tone="ask">
          <p className="font-medium text-status-awaiting-fg whitespace-pre-wrap">
            {event.question}
          </p>
          {event.context && (
            <p className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap">
              {event.context}
            </p>
          )}
          <AskUserReply
            askId={event.askId}
            options={event.options}
            answered={answeredAskIds.has(event.askId)}
            disabled={disabled}
            onAnswer={(answer) => onAnswerAsk(event.askId, answer)}
          />
        </RowFrame>
      );
    case 'error':
      return (
        <div className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-fg">
          {event.message}
        </div>
      );
    case 'result': {
      // OAuth/subscription runs report notional cost; BYO-CLI runs don't
      // report cost at all. Relabel both rather than printing a dollar
      // amount, matching the list/detail CostChip and the widget footer.
      const costLabel = isUntrackedCost(apiKeySource)
        ? 'cost not tracked'
        : isNotionalCost(apiKeySource)
          ? `subscription (≈ $${event.totalCostUsd.toFixed(4)} API-equivalent)`
          : `$${event.totalCostUsd.toFixed(4)}`;
      return (
        <RowFrame speaker="Agent" at={at} tone="meta">
          <p className="text-foreground/70 text-[11px]">
            Result · {event.numTurns} turn{event.numTurns === 1 ? '' : 's'} · {event.durationMs}ms ·{' '}
            {costLabel}
          </p>
        </RowFrame>
      );
    }
    case 'status_changed':
      return (
        <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-[10.5px] text-muted-foreground">
          Status → <span className="font-semibold text-foreground">{event.status}</span>
        </div>
      );
    case 'progress':
      // Transient live-turn signal — no transcript row.
      return null;
  }
}

function RowFrame({
  speaker,
  at,
  tone,
  children,
}: {
  speaker: string;
  at: string;
  tone?: 'meta' | 'ask';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed',
        tone === 'meta'
          ? 'border-dashed border-border bg-secondary/20'
          : tone === 'ask'
            ? 'border-status-awaiting-border bg-status-awaiting-bg'
            : 'border-border bg-card shadow-[0_1px_2px_rgba(32,27,33,0.04)]',
      )}
    >
      <div className="flex items-center gap-2 mb-1 text-[10.5px] uppercase tracking-wider text-muted-foreground">
        <span className="font-semibold text-foreground/80">{speaker}</span>
        <TimestampDot iso={at} className="ml-auto" />
      </div>
      {children}
    </div>
  );
}

interface AskUserReplyProps {
  askId: string;
  options?: string[];
  answered: boolean;
  disabled: boolean;
  onAnswer: (answer: string) => void;
}

/**
 * Inline reply form for an `ask_user` event. Renders a quick-pick row
 * when the agent supplies `options`, otherwise a small textarea. Once
 * answered, the form collapses to a confirmation so the user can scroll
 * back and see what they replied without losing the question context.
 */
function AskUserReply({ askId, options, answered, disabled, onAnswer }: AskUserReplyProps) {
  const [draft, setDraft] = useState('');

  if (answered) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground italic">
        Reply sent · the agent will continue on its next turn.
      </p>
    );
  }

  if (options && options.length > 0) {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <Button
            key={`${askId}-${opt}`}
            size="sm"
            variant="outline"
            disabled={disabled}
            className="h-7 text-xs"
            onClick={() => onAnswer(opt)}
          >
            {opt}
          </Button>
        ))}
      </div>
    );
  }

  const submit = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAnswer(trimmed);
    setDraft('');
  };

  return (
    <div className="mt-2 space-y-1.5">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Answer the agent…"
        disabled={disabled}
        className="min-h-[48px] resize-y text-xs bg-card/70"
      />
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={disabled || !draft.trim()}
          onClick={submit}
        >
          Answer
        </Button>
      </div>
    </div>
  );
}
