# Publish to the VS Code Marketplace

Publish **two separate extensions**:

| Package | Marketplace role | Install location |
| --- | --- | --- |
| `opencode-notifications` | Main extension; sufficient for local Linux use | Local desktop |
| `opencode-notification-bridge` | Companion required only for Remote SSH | Linux SSH host |

The main extension intentionally does not declare the companion as an automatic dependency: local users do not need it, and SSH users need it installed on a different extension host.

## 1. Set your publisher ID

Select **Nyren** in the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage). Both manifests use `"publisher": "Nyren"`, which must exactly match the publisher selected for upload. The manifests are:

- `extensions/local/package.json`
- `extensions/bridge/package.json`

The Settings command uses the installed extension's identifier automatically. Extension names plus publisher ID form the permanent Marketplace identifiers.

## 2. Build the upload packages

From the repository root:

```sh
npm ci
npm run package
```

This synchronizes the embedded local bridge, runs type/syntax checks and tests, and builds:

- `dist/opencode-notifications-0.2.1.vsix`
- `dist/opencode-notification-bridge-0.2.1.vsix`

Each extension has its own Marketplace description and README. The main README explains the one-extension local setup and two-extension Remote SSH setup; the companion README prominently states it is only required for Remote SSH.

## 3. Upload

1. Open [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage) and select your publisher.
2. Choose **New extension → Visual Studio Code**, upload the main VSIX, and publish it.
3. Repeat with the bridge VSIX as a **second extension**.
4. Verify that both listings are visible and show the correct install instructions.

For each release with changes, increase the version in the extension manifest before building; do not overwrite artifacts from a previously built version. Keep the local and bridge extension versions aligned. Rebuild and upload using the existing extension's update action. A version already published cannot be reused.

## 4. Desktop acceptance

- **Local Linux:** install only the main extension, install its plugin through the Command Palette, enable terminal titles, and start OpenCode in a new terminal. Check working/completed status, sounds, interruption, independent volumes, and playback regardless of focus.
- **Remote SSH:** install the main extension locally and the bridge on the SSH host. Repeat setup in the SSH window and verify that audio plays on the local computer.

Automated checks cover both activation routes, state transitions, transport, settings, and audio-player arguments. They do not replace actual desktop playback and Remote SSH acceptance checks.
