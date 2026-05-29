// SPDX-License-Identifier: Apache-2.0
/**
 * Bridge for the widget's running-agents tray. When the user clicks
 * "Open" on an agent row, the widget posts an `open-dock-conversation`
 * frame to this iframe; we open the dock and navigate to that
 * conversation's detail view.
 *
 * Mirrors the host→dock `toggle-dock` / `close-dock` bridge (handled in
 * useDockMode) and reuses the same open+navigate sequence the `g c`
 * keyboard chord uses (see useKeyboardShortcuts) plus the `?id=` detail
 * param the Conversations route reads.
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
      if (data.source !== 'pinagent-host' || data.type !== 'open-dock-conversation') return;
      if (typeof data.feedbackId !== 'string' || data.feedbackId.length === 0) return;
      open();
      void navigate({ to: ROUTE_PATHS.conversations, search: { id: data.feedbackId } });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, navigate]);
}
