// SPDX-License-Identifier: Apache-2.0
/**
 * First-time empty state — shown when the dock loads and the project
 * has zero conversations on record. Routes use it instead of the
 * generic `EmptyState` to walk a new user through the widget → dock
 * loop they're about to discover.
 *
 * The numbered steps are the spec's §11 recommendation made concrete:
 * "explain how to open one (point at the widget UI)". Each step also
 * surfaces a relevant keyboard shortcut so the doc + dock-README
 * material doesn't have to be the only place the shortcuts live.
 */
import { PinMark } from '@pinagent/ui/components/pin-mark';
import { cn } from '@pinagent/ui/lib/utils';
import { CheckCircle2, GitBranch, MessageSquare, Sparkles } from 'lucide-react';
import type { ComponentType, ReactNode, SVGAttributes } from 'react';

export interface OnboardingStateProps {
  /**
   * Override the leading title — useful when the same component is
   * reused outside Overview (e.g. on Conversations + Changes routes,
   * where the title should match the surface).
   */
  title?: string;
  /**
   * Optional intro line. Defaults to a short framing of the loop.
   */
  intro?: ReactNode;
  className?: string;
}

interface OnboardingStep {
  Icon: ComponentType<SVGAttributes<SVGSVGElement>>;
  title: string;
  body: string;
  hotkey?: string;
}

const STEPS: readonly OnboardingStep[] = [
  {
    Icon: PinMark as unknown as ComponentType<SVGAttributes<SVGSVGElement>>,
    title: 'Click the pin in your host app',
    body: 'The per-element picker drops on any DOM node. The pin floats on a corner of the viewport; click it, then click the thing you want to change.',
  },
  {
    Icon: MessageSquare,
    title: 'Leave a comment',
    body: 'Type what you want the agent to do, hit send. A worktree spins up; the agent works in there so your main branch stays clean.',
  },
  {
    Icon: GitBranch,
    title: 'Watch progress in this dock',
    body: "Conversations stream their progress here. Land or discard from the detail view; bulk-archive what you don't need anymore.",
    hotkey: 'Cmd/Ctrl+Shift+P',
  },
  {
    Icon: CheckCircle2,
    title: 'Land the change',
    body: "When you're happy, Land merges the worktree onto your project's HEAD branch. Or compose multiple conversations into one PR from Changes.",
  },
];

export function OnboardingState({
  title = 'Welcome to Pinagent',
  intro,
  className,
}: OnboardingStateProps) {
  return (
    <div className={cn('flex flex-1 flex-col items-center px-6 py-10 text-center', className)}>
      <div
        aria-hidden
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/20"
      >
        <Sparkles className="h-6 w-6 text-accent-foreground" />
      </div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-[44ch] text-xs text-muted-foreground leading-relaxed">
        {intro ?? (
          <>
            Click an element on your host app, leave a comment, and an agent picks it up in a
            worktree. The dock shows you what's happening, lets you review the diff, and lands (or
            discards) the change.
          </>
        )}
      </p>

      <ol className="mt-6 w-full max-w-md space-y-2.5 text-left">
        {STEPS.map((step, idx) => {
          const StepIcon = step.Icon;
          return (
            <li
              key={step.title}
              className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground"
              >
                <StepIcon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-xs font-semibold text-foreground">{step.title}</h3>
                  {step.hotkey && (
                    <kbd className="ml-auto rounded border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {step.hotkey}
                    </kbd>
                  )}
                </div>
                <p className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed">
                  {step.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 max-w-[44ch] text-[11px] text-muted-foreground italic">
        Don't see the pin? Check that <code className="font-mono">dock: true</code> is on your
        host's vite-plugin / next-plugin options.
      </p>
    </div>
  );
}
