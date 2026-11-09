# OpenCode Notifications

Visible terminal status and **two independent custom local sounds** for OpenCode in VS Code, including Remote SSH.

## Which extension do I need?

| Where do you run OpenCode? | Install on your local computer | Install on the SSH host |
| --- | --- | --- |
| **Your own Linux machine** | **OpenCode Notifications** only | Nothing — no separate bridge needed |
| **A Linux host through Remote SSH** | **OpenCode Notifications** | **OpenCode Notification Bridge** (required) |

**Local use needs just this extension. Remote SSH needs both extensions:** the main extension plays sounds on your own computer, and **OpenCode Notification Bridge** detects OpenCode events on the SSH host. The bridge alone does not play sounds.

- **Completion sound** when a running prompt finishes.
- **Attention sound** for each new question or permission request.
- English terminal status titles: `⏳ OpenCode — Working`, `✓ OpenCode — Completed`, `? OpenCode — Waiting for input`, and error/disconnection states.
- A status-bar spinner while working and a question/check indicator for other states.
- Separate enable/disable settings, file pickers, and test commands for both sounds.
- Independent completion/attention volumes from 1–10 and a persistent **Toggle Sounds** command. Automatic sounds play regardless of window or terminal focus.
- Interrupting a prompt returns to `Ready` silently; genuine failures still show `Error`.
- Structured questions and permission requests from root sessions, subagents, and nested subagents all trigger attention and keep their owning root waiting until resolved. Child activity/completion stays silent; duplicate idle events do not trigger duplicate completion sounds.

## Requirements

- VS Code 1.96 or later (desktop).
- A **Linux host running OpenCode**, either local or accessed through VS Code Remote SSH.
- Linux Mint is the primary local audio target. `paplay` is tried first, then `pw-play`, `ffplay`, and `aplay` (WAV only). Install `pulseaudio-utils` or `ffmpeg` on your **local computer** if needed.
- Windows local audio is implemented through PowerShell `System.Media.SoundPlayer` and requires **WAV** files; this path has not been tested on Windows. The SSH/OpenCode host must still be Linux.
- OpenCode's plugin `event` hook with `session.status`, `session.idle`, `question.asked/replied/rejected`, and `permission.asked/replied` events, and the plugin SDK's `client.session.get({ path: { id } })` method. This targets the documented OpenCode plugin event API; future API variants may require adaptation.

WAV is the most portable audio format. Linux MP3/M4A playback may require `ffplay`; the player falls back automatically when another player cannot decode a file.

## Install on your own machine (Linux)

1. Install **OpenCode Notifications** from the VS Code Marketplace. **You do not need OpenCode Notification Bridge for local use**: the main extension includes local event detection.
2. Run **Developer: Reload Window**.
3. Complete the setup commands below in your local VS Code window.

## Install with Remote SSH

1. Install **OpenCode Notifications** **locally** in VS Code. This extension plays audio on your own computer (`ui` extension).
2. Connect to your Linux host using **Remote SSH**.
3. Search the Marketplace for **OpenCode Notification Bridge** and select **Install in SSH: your-host**. This additional extension is **required for Remote SSH support** and runs on the SSH host (`workspace` extension).
4. Check the Extensions view: the main extension should be installed locally and the bridge on **SSH: your-host**.
5. Run **Developer: Reload Window**, then complete the setup commands below in your SSH-connected window.

### Setup commands (both installation types)

1. Run **OpenCode Notifications: Install OpenCode Plugin on This Host** from the Command Palette. This installs the bundled dependency-free plugin into `~/.config/opencode/plugins/opencode-notifications.js` on the machine running OpenCode (or under `$XDG_CONFIG_HOME`). An existing different plugin asks before being replaced.
2. Run **OpenCode Notifications: Enable Terminal Status Titles**. This explicitly sets `terminal.integrated.tabs.title` to `${sequence}` so application-supplied titles appear in terminal tabs. It applies to all terminals; you can restore the previous setting in VS Code Settings.
3. **Quit OpenCode and open a NEW VS Code terminal**, then type `opencode`. Newly created terminals inherit the connection variables. Existing terminals may offer a relaunch action; a fresh terminal is the simplest route.
4. Optionally use **Terminal: Move Terminal into Editor Area** to show terminal tabs in the editor area.

### Manual install / upgrade

The `dist/` directory contains `opencode-notifications-0.2.1.vsix` (main extension) and `opencode-notification-bridge-0.2.1.vsix` (Remote SSH companion). Use **Extensions → … → Install from VSIX…** and install in the locations described above. For local use, install only the main VSIX.

When upgrading, update the main extension and, if using Remote SSH, the bridge as well. Reload the window, run **Install OpenCode Plugin on This Host** again and accept replacement, then restart OpenCode in a new terminal. If you previously installed the bridge locally, you can uninstall that local copy; local detection is now included in the main extension.

## Choose your custom sounds

Run these Command Palette commands:

- **OpenCode Notifications: Choose Completion Sound**
- **OpenCode Notifications: Choose Attention Sound**
- **OpenCode Notifications: Test Completion Sound**
- **OpenCode Notifications: Test Attention Sound**
- **OpenCode Notifications: Toggle Sounds**
- **OpenCode Notifications: Open Settings**

Each picker selects a file on your **local computer**, even while working over SSH, and previews it immediately. Test commands play even when the corresponding automatic sound is disabled. Empty paths use two different built-in chimes.

Example local User Settings on Linux Mint:

```json
{
  "opencodeNotifications.completion.enabled": true,
  "opencodeNotifications.completion.path": "/home/you/Sounds/completed.wav",
  "opencodeNotifications.completion.volume": 4,
  "opencodeNotifications.attention.enabled": true,
  "opencodeNotifications.attention.path": "/home/you/Sounds/attention.wav",
  "opencodeNotifications.attention.volume": 8,
  "opencodeNotifications.soundsEnabled": true,
  "opencodeNotifications.volume": 10,
  "opencodeNotifications.showNotifications": true
}
```

These are application-level settings, shared across workspaces. VS Code toast notifications can be disabled separately from sounds. The attention sound is emitted once per new request; waiting for an answer is not completion. Audio is queued to avoid overlapping sounds.

### Independent volumes and the master switch

- **Shared volume** (`opencodeNotifications.volume`): integer from **1** (quiet) to **10** (full volume), default **10**. Used for either sound when its own volume is unset or `null`, preserving existing shared-volume choices.
- **Completion volume** (`opencodeNotifications.completion.volume`) and **Attention volume** (`opencodeNotifications.attention.volume`): independent integers from **1–10**, each defaulting to `null`. Set a number to override the shared volume for that sound; leave unset or set `null` to inherit it. The effective volume applies consistently to automatic sounds, picker previews, and tests without changing your original audio files or system volume.
- **Toggle Sounds** (`opencodeNotifications.toggleSounds`): switches `opencodeNotifications.soundsEnabled` on/off persistently. This master switch preserves the separate completion/attention choices. You can assign the command a keyboard shortcut.
- Automatic sounds depend only on the master and per-sound enable settings, never window or terminal focus.
- Manual test commands and picker previews bypass the master and per-sound switches, using that sound's effective volume.
- Popup notifications remain independently controlled by `opencodeNotifications.showNotifications`.

Linux and macOS use per-player volume controls. Windows and the Linux `aplay` fallback use a temporary, quieter WAV copy for volumes below 10; this requires PCM or float WAV audio. Temporary files are removed after playback.

## Terminal icon limitation

VS Code's public API cannot dynamically change the icon of an existing terminal. Its built-in **Change Icon** command opens an interactive picker. This version therefore places the status symbol and label **in the tab title**, and uses a dynamic icon/spinner in the **status bar**. It does not replace the terminal's original tab icon.

The Linux bridge writes OSC title sequences to the matched terminal's `/dev/pts` device every 1.2 seconds, because OpenCode can also update its title. Status changes can take roughly 1–2 seconds to appear. Avoid manually renaming the terminal: a fixed user-assigned name overrides application title sequences.

## Connection behavior and troubleshooting

- **No session detected:** for local use, check that the main extension is enabled. For Remote SSH, check that the main extension is enabled locally **and** the bridge is installed on the SSH host. Install the plugin and restart OpenCode in a **new** terminal. OpenCode configuration/plugins load at startup.
- **Disconnected:** a missing heartbeat marks a session disconnected after about 16 seconds. Following a VS Code reload or remote extension-host restart, start a new terminal and restart OpenCode to inherit the new bridge endpoint.
- **Several sessions:** root sessions are tracked separately and terminal/status-bar displays prioritize waiting for input, then working. Completed sessions do not override a working session. Closing a terminal removes its tracked instances.
- **Subagent input:** requests are deduplicated by source session, request kind, and ID. Answering or deleting one subagent cannot clear a sibling's or root's requests. Child failure/abort/deletion silently clears that child's subtree of pending input; root failure/abort/deletion clears the whole root. If session ancestry cannot be looked up, that event is skipped rather than assigned to an unrelated root; later events retry the lookup.
- **No sound:** run a Test Sound command. The local **OpenCode Notifications** output channel logs playback failures. Check the local audio output and installed players. The bridge's own output channel logs terminal association.
- **Questions in ordinary assistant text:** the attention event covers OpenCode's structured question tool and permission prompts. A question written only in an assistant's final text is a completed response and uses the completion sound.
- **tmux, detached servers, and `opencode attach`:** automatic association targets OpenCode started directly in a VS Code integrated terminal; detached processes are outside this version's scope.
- The first connection/reconnection establishes a baseline without replaying old sounds. Notifications generated while the local extension is disconnected are not replayed.
- Heartbeats and session identifiers travel through an authenticated loopback-only HTTP endpoint on the OpenCode host. With Remote SSH, VS Code's command bridge delivers statuses to the local extension. No prompt text, tool output, or sound files are transferred.

## Development and verification

```sh
npm ci
npm run check
npm test
npm run package
```

The extensions have no runtime npm dependencies. `npm run check` synchronizes the bridge sources into the main extension's ignored `bridge/` directory so local use shares the same implementation as Remote SSH. Packaging copies this README into the main extension, preserves the companion's own Marketplace README, copies LICENSE into both, and produces both VSIX files in `dist/`. See `PUBLISHING.md` for Marketplace publishing instructions.

Automated checks exercise state transitions, source-aware attention deduplication, subtree cleanup, failure handling, session isolation, the authenticated HTTP transport, real plugin-to-UI delivery of root/child/nested input in local and mocked SSH modes, suppression settings, reconnect no-replay, and audio-player selection/fallback. They do not prove actual desktop audio or VS Code Remote SSH rendering.

### Desktop acceptance check

1. Test each custom local sound independently, including a path containing spaces.
2. Submit a real prompt over SSH: verify `Working`, then `Completed` and one completion sound.
3. Have OpenCode use its question tool: verify `Waiting for input`, one attention sound, and no completion sound until the resumed prompt finishes.
4. Repeat with a permission request; verify the same behavior.
   Repeat both structured request types from a subagent and a nested subagent. Keep multiple requests pending: answering one must leave the waiting indicator until the others resolve, and child completion/failure must not announce root completion.
5. Start two terminals, keep one working, and finish the other: verify correct per-terminal titles and aggregate status.
6. Disable each sound separately, then check an error and disconnect/reconnect. A failed prompt should not play the completion sound.
7. Reload VS Code and follow the new-terminal restart procedure; verify events resume without old sounds replaying.
8. Interrupt a working prompt (also while waiting for input): verify `Ready`, no warning or completion sound, then submit another prompt and verify it completes normally.
9. With automatic sounds enabled, verify both sounds play with this window focused and unfocused/minimized, whether or not the OpenCode terminal is active. Popup settings should remain independent.
10. Set different completion/attention volumes (including 1 and 10) and verify automatic sounds, picker previews, and tests use each sound's volume. Clear each override or set it to `null` and verify it follows the shared volume. Toggle sounds off/on via the Command Palette, reload to check persistence, and confirm individual sound choices are preserved. Manual tests and previews should still work while automatic sounds are off.
11. In a local Linux window with only the main extension installed, run the setup commands and verify status and sounds. In a Remote SSH window, repeat with the main extension installed locally and the companion installed only on the SSH host.
