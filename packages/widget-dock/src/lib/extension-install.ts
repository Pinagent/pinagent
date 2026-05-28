// SPDX-License-Identifier: Apache-2.0
/**
 * Single source of truth for how the dock tells a developer to install
 * the VSCode extension. The extension isn't on the Marketplace yet, so
 * the install path is "download the locally-built .vsix and install from
 * it". When it gets published, flip `published` to true: the Connections
 * card and nudge swap to a one-click `vscode:extension/...` deep link
 * with no other changes (see `primaryInstallAction`).
 */

export const EXTENSION_INSTALL = {
  /** Marketplace id (publisher.name), matched to the extension manifest. */
  marketplaceId: 'pinagent.pinagent-vscode',
  /**
   * Flip to true once the extension ships to the VSCode Marketplace /
   * Open VSX. Until then the dock offers the local .vsix download.
   */
  published: false,
  /** Dev-server route that streams the locally-built .vsix (see vite-plugin/next-plugin). */
  vsixDownloadPath: '/__pinagent/extension.vsix',
  /** Suggested filename for the downloaded artifact. */
  vsixFilename: 'pinagent-vscode.vsix',
} as const;

/** `vscode:extension/<id>` deep link that opens the Marketplace page inside VSCode. */
export function marketplaceDeepLink(): string {
  return `vscode:extension/${EXTENSION_INSTALL.marketplaceId}`;
}

/** CLI one-liner to install the downloaded .vsix from the editor command line. */
export const VSIX_CLI_COMMAND = `code --install-extension ~/Downloads/${EXTENSION_INSTALL.vsixFilename}`;

export type PrimaryInstallAction =
  | { kind: 'marketplace'; href: string; label: string }
  | { kind: 'vsix'; href: string; download: string; label: string };

/**
 * The primary install affordance, resolved from the `published` flag.
 * Components render the returned `kind` without knowing the policy —
 * publishing the extension is a one-line config change here.
 */
export function primaryInstallAction(): PrimaryInstallAction {
  if (EXTENSION_INSTALL.published) {
    return { kind: 'marketplace', href: marketplaceDeepLink(), label: 'Install in VS Code' };
  }
  return {
    kind: 'vsix',
    href: EXTENSION_INSTALL.vsixDownloadPath,
    download: EXTENSION_INSTALL.vsixFilename,
    label: 'Download .vsix',
  };
}
