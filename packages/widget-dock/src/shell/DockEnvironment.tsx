// SPDX-License-Identifier: Apache-2.0
/**
 * Per-entry context for shell-wide flags that don't belong on the
 * router: whether the dock is rendering inside the host's iframe
 * (`embedded`), whether the chrome should pretend the WS link is down
 * for design review (`forcedDisconnected`). Each entry point — embedded
 * or standalone — supplies these once at mount.
 *
 * Kept separate from `TransportProvider` so swapping transports doesn't
 * force shell consumers to re-render and vice-versa.
 */
import { createContext, type ReactNode, useContext } from 'react';

export interface DockEnvironment {
  /** True when the dock is loaded inside the host page's iframe. */
  embedded: boolean;
  /** Force the chrome's disconnected indicator (design review only). */
  forcedDisconnected: boolean;
}

const DockEnvironmentContext = createContext<DockEnvironment | null>(null);

export interface DockEnvironmentProviderProps extends DockEnvironment {
  children: ReactNode;
}

export function DockEnvironmentProvider({
  embedded,
  forcedDisconnected,
  children,
}: DockEnvironmentProviderProps) {
  return (
    <DockEnvironmentContext.Provider value={{ embedded, forcedDisconnected }}>
      {children}
    </DockEnvironmentContext.Provider>
  );
}

export function useDockEnvironment(): DockEnvironment {
  const env = useContext(DockEnvironmentContext);
  if (!env) {
    throw new Error('useDockEnvironment must be used within a <DockEnvironmentProvider>');
  }
  return env;
}
