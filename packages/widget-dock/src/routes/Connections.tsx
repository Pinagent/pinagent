// SPDX-License-Identifier: Apache-2.0
/**
 * Connections — GitHub + Anthropic credential management. Reads live
 * state from `GET /__pinagent/connections`; set/clear flow through
 * `PUT/DELETE /__pinagent/connections/<kind>` and rolls connect-time
 * validation (GitHub `/user`, Anthropic `/v1/messages`) so bad tokens
 * fail at form-submit, not at first composer run.
 *
 * The spec calls for an OAuth popup. Local dev-server doesn't have a
 * realistic place for OAuth (no callback URL, no Marketplace app); the
 * pragmatic local-dev path is a PAT entry form. OAuth lives in the
 * hosted dashboard (spec §13) when standalone deployment ships.
 */

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button, buttonVariants } from '@pinagent/ui/components/ui/button';
import { Input } from '@pinagent/ui/components/ui/input';
import { cn } from '@pinagent/ui/lib/utils';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Puzzle,
  Sparkles,
} from 'lucide-react';
import { type ComponentType, type ReactNode, type SVGAttributes, useState } from 'react';
import {
  useClearAnthropicConnection,
  useClearGithubConnection,
  useConnections,
  useSetAnthropicConnection,
  useSetGithubConnection,
} from '../hooks/useConnections';
import { useExtensionStatus } from '../hooks/useExtensionStatus';
import {
  EXTENSION_INSTALL,
  primaryInstallAction,
  VSIX_CLI_COMMAND,
} from '../lib/extension-install';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { useTransport } from '../transport';

const GH_PAT_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=pinagent%20dock';
const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';

export function Connections() {
  const transport = useTransport();
  const connectionsQuery = useConnections();

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Connections</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Local dev uses personal access tokens; OAuth flow lives in the hosted dashboard.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Editor bridge — presence comes from the WS handshake, not the
            connections HTTP query, so it renders independently of load state. */}
        <VSCodeExtensionCard />

        {connectionsQuery.isLoading && <LoadingState rows={2} />}
        {connectionsQuery.isError && (
          <ErrorState
            title="Couldn't load connection state"
            description="The dock couldn't reach the local pinagent dev-server. Start your host app with the pinagent plugin, or append ?fixtures=on for the demo dataset."
            onRetry={() => connectionsQuery.refetch()}
          />
        )}
        {connectionsQuery.isSuccess && (
          <>
            <GitHubCard
              connected={connectionsQuery.data.github.connected}
              login={connectionsQuery.data.github.login}
              isMock={transport.kind === 'mock'}
            />
            <AnthropicCard
              keySet={connectionsQuery.data.anthropic.keySet}
              isMock={transport.kind === 'mock'}
            />
          </>
        )}
      </div>
    </div>
  );
}

function VSCodeExtensionCard() {
  const { present, version, known } = useExtensionStatus();
  const [copied, setCopied] = useState(false);
  const action = primaryInstallAction();

  const copyCli = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(VSIX_CLI_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can reject when the iframe isn't focused — the command
      // is visible below for manual copy, so there's nothing to recover.
    }
  };

  const status = present ? (
    <Badge
      variant="outline"
      className="border-status-landed-border bg-status-landed-bg text-status-landed-fg"
    >
      <Check className="h-3 w-3" />
      Installed
    </Badge>
  ) : known ? (
    <Badge variant="outline" className="text-muted-foreground">
      Not installed
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Checking…
    </Badge>
  );

  return (
    <ConnectionCard
      Icon={Puzzle}
      title="VS Code extension"
      status={status}
      description={
        present ? (
          <>
            Clicks in the dock open Claude Code and jump to files in VS Code
            {version ? (
              <>
                {' · '}
                <span className="font-mono">v{version}</span>
              </>
            ) : null}
            .
          </>
        ) : (
          <>
            Install the editor bridge so clicks in the dock open Claude Code and jump straight to
            the file you clicked.
          </>
        )
      }
    >
      {!present && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <a
              href={action.href}
              {...(action.kind === 'vsix' ? { download: action.download } : {})}
              className={cn(buttonVariants({ variant: 'accent', size: 'sm' }), 'h-7 text-xs')}
            >
              {action.kind === 'vsix' ? (
                <Download className="h-3 w-3" />
              ) : (
                <ExternalLink className="h-3 w-3" />
              )}
              {action.label}
            </a>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={copyCli}
              disabled={EXTENSION_INSTALL.published}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy CLI command'}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {action.kind === 'vsix' ? (
              <>
                Then run <code className="font-mono">Extensions: Install from VSIX…</code> in VS
                Code, or paste the copied command into a terminal.
              </>
            ) : (
              <>Opens the extension's Marketplace page inside VS Code.</>
            )}
          </p>
        </div>
      )}
    </ConnectionCard>
  );
}

function GitHubMark(props: SVGAttributes<SVGSVGElement>) {
  // Lucide dropped brand icons in 1.x — inline the GitHub mark so the
  // Connections card stays visually distinct without a brand-icon dep.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="GitHub" {...props}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-2.06c-3.2.7-3.87-1.35-3.87-1.35-.52-1.34-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.06 11.06 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.05.78 2.12v3.14c0 .3.21.66.79.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function ConnectionCard({
  Icon,
  title,
  status,
  description,
  action,
  children,
}: {
  Icon: ComponentType<SVGAttributes<SVGSVGElement>>;
  title: string;
  status: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-start gap-3 px-3 py-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {status}
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
        {action}
      </header>
      {children && <div className="border-t border-border px-3 py-2.5">{children}</div>}
    </section>
  );
}

function GitHubCard({
  connected,
  login,
  isMock,
}: {
  connected: boolean;
  login: string | null;
  isMock: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const setMutation = useSetGithubConnection();
  const clearMutation = useClearGithubConnection();

  const startEditing = (): void => {
    setMutation.reset();
    setEditing(true);
  };
  const onSet = async (token: string): Promise<void> => {
    await setMutation.mutateAsync(token);
    setEditing(false);
  };

  return (
    <ConnectionCard
      Icon={GitHubMark}
      title="GitHub"
      status={
        connected ? (
          <Badge
            variant="outline"
            className="border-status-landed-border bg-status-landed-bg text-status-landed-fg"
          >
            <Check className="h-3 w-3" />
            Connected
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not connected
          </Badge>
        )
      }
      description={
        connected ? (
          <>
            Authorized as <span className="font-mono">@{login}</span>. PRs from the composer open
            under this account.
          </>
        ) : (
          <>
            Add a personal access token with <code className="font-mono">repo</code> scope so the PR
            composer can open PRs against your remote.
          </>
        )
      }
      action={
        editing ? undefined : connected ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            {clearMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        ) : (
          <Button size="sm" variant="accent" className="h-7 text-xs" onClick={startEditing}>
            Add token
          </Button>
        )
      }
    >
      {!editing && connected && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 -ml-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={startEditing}
        >
          Replace token
        </Button>
      )}
      {editing && (
        <TokenForm
          label="Personal access token"
          placeholder="ghp_…"
          helpUrl={GH_PAT_URL}
          helpLabel={
            isMock
              ? 'Mock mode — any 4+ char string works.'
              : 'Needs repo scope. Click to create one in GitHub settings.'
          }
          submitLabel="Save token"
          isPending={setMutation.isPending}
          error={setMutation.error?.message ?? null}
          onCancel={() => setEditing(false)}
          onSubmit={onSet}
        />
      )}
    </ConnectionCard>
  );
}

function AnthropicCard({ keySet, isMock }: { keySet: boolean; isMock: boolean }) {
  const [editing, setEditing] = useState(false);
  const setMutation = useSetAnthropicConnection();
  const clearMutation = useClearAnthropicConnection();

  const startEditing = (): void => {
    setMutation.reset();
    setEditing(true);
  };
  const onSet = async (key: string): Promise<void> => {
    await setMutation.mutateAsync(key);
    setEditing(false);
  };

  return (
    <ConnectionCard
      Icon={keySet ? Sparkles : KeyRound}
      title="Anthropic"
      status={
        keySet ? (
          <Badge
            variant="outline"
            className="border-status-landed-border bg-status-landed-bg text-status-landed-fg"
          >
            <Check className="h-3 w-3" />
            Key set
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not set
          </Badge>
        )
      }
      description={
        keySet
          ? 'Stored at .pinagent/secrets.json (gitignored). Injected into agent spawns so the SDK uses your account.'
          : 'Add an Anthropic API key so spawned agents run on your account instead of relying on env vars.'
      }
      action={
        editing ? undefined : keySet ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            {clearMutation.isPending ? 'Clearing…' : 'Clear'}
          </Button>
        ) : (
          <Button size="sm" variant="accent" className="h-7 text-xs" onClick={startEditing}>
            Add key
          </Button>
        )
      }
    >
      {!editing && keySet && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 -ml-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={startEditing}
        >
          Replace key
        </Button>
      )}
      {editing && (
        <TokenForm
          label="API key"
          placeholder="sk-ant-…"
          helpUrl={ANTHROPIC_KEYS_URL}
          helpLabel={
            isMock
              ? 'Mock mode — any 4+ char string works.'
              : "Validated by calling Anthropic's API once before storing."
          }
          submitLabel="Save key"
          isPending={setMutation.isPending}
          error={setMutation.error?.message ?? null}
          onCancel={() => setEditing(false)}
          onSubmit={onSet}
        />
      )}
    </ConnectionCard>
  );
}

interface TokenFormProps {
  label: string;
  placeholder: string;
  helpUrl: string;
  helpLabel: string;
  submitLabel: string;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: string) => void | Promise<void>;
}

function TokenForm({
  label,
  placeholder,
  helpUrl,
  helpLabel,
  submitLabel,
  isPending,
  error,
  onCancel,
  onSubmit,
}: TokenFormProps) {
  const [value, setValue] = useState('');
  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    void onSubmit(trimmed);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <a
          href={helpUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={cn(
            'inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded',
          )}
        >
          <ExternalLink className="h-3 w-3" />
          Get one
        </a>
      </div>
      <Input
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="h-8 font-mono text-xs"
        disabled={isPending}
      />
      <p className="text-[11px] text-muted-foreground">{helpLabel}</p>
      {error && (
        <div className="flex items-start gap-1.5 rounded-md border border-status-error-border bg-status-error-bg px-2 py-1.5 text-[11px] text-status-error-fg">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="accent"
          className="h-7 text-xs"
          onClick={submit}
          disabled={isPending || value.trim().length === 0}
        >
          {isPending ? 'Validating…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
