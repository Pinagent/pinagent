// SPDX-License-Identifier: Apache-2.0
/**
 * Dock app entry. Phase 3 is just the skeleton — Phase 4 lands the real
 * shell (FAB, panel modes, chrome, nav) and Phase 5 adds the mocked
 * fixture-driven screens.
 */
import { PinMark } from '@pinagent/ui/components/pin-mark';

export function App() {
  return (
    <div className="min-h-svh bg-background text-foreground antialiased flex items-center justify-center font-sans">
      <div className="flex flex-col items-center gap-4">
        <PinMark size="xl" tone="ink" />
        <h1 className="text-2xl font-semibold tracking-tight">Pinagent Dock</h1>
        <p className="text-sm text-muted-foreground">
          Skeleton ready. Shell, screens, and fixtures arrive in later phases.
        </p>
      </div>
    </div>
  );
}
