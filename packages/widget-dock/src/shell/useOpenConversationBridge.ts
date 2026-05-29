// SPDX-License-Identifier: Apache-2.0
/**
 * Bridge for the widget's "open this conversation in the dock" actions.
 * Two widget entry points post the same `open-conversation` frame to this
 * iframe — the composer's "open in dock" button and the running-agents
 * tray's per-row "Open" — and we open the dock (idempotent) and navigate
 * to that conversation's detail view.
 *
 * Mirrors the host→dock `toggle-dock` / `close-dock` bridge (handled in
 * useDockMode) and reuses the `?id=` detail param the Conversations route
 * reads. `toggle-dock` itself stays in useKeyboardShortcuts; this hook
 * owns only `open-conversation`.
 */
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ROUTE_PATHS } from '../route-paths';

interface OpenConversationMessage {
  source?: string;
  type?: string;
  feedbackId?: string;
}

export function useOpenConversationBridge(open: () => void): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as OpenConversationMessage | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'pinagent-host' || data.type !== 'open-conversation') return;
      if (typeof data.feedbackId !== 'string' || data.feedbackId.length === 0) return;
      open();
      void navigate({ to: ROUTE_PATHS.conversations, search: { id: data.feedbackId } });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, navigate]);
}
