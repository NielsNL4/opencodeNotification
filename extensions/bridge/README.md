# OpenCode Notification Bridge

**Remote SSH companion for OpenCode Notifications. Install this extension on your SSH host, and install OpenCode Notifications on your local computer. Both are required when using Remote SSH.**

## Do I need this extension?

| Your setup | What to install |
| --- | --- |
| OpenCode runs on your own Linux machine | **OpenCode Notifications** only. You do **not** need this bridge. |
| OpenCode runs on a Linux host through VS Code Remote SSH | **OpenCode Notifications** locally **and this bridge on the SSH host**. |

The main extension already includes event detection for local use. This companion adds event detection on a remote host so the main extension can play sounds on your own computer. **This bridge does not play sounds by itself.**

## Install for Remote SSH

1. Install **OpenCode Notifications** from the Marketplace **locally** in VS Code.
2. Connect to the Linux machine running OpenCode using **Remote SSH**.
3. Install **OpenCode Notification Bridge** using **Install in SSH: your-host**. Check the Extensions view to confirm it runs on the SSH host.
4. Run **Developer: Reload Window**.
5. In the SSH-connected window, run **OpenCode Notifications: Install OpenCode Plugin on This Host**. The dependency-free plugin is installed under `~/.config/opencode/plugins/` (or `$XDG_CONFIG_HOME`). Confirm replacement when upgrading.
6. Run **OpenCode Notifications: Enable Terminal Status Titles** to show the application-supplied status in terminal tabs. This sets `terminal.integrated.tabs.title` to `${sequence}` for all terminals.
7. Quit OpenCode, open a **new integrated terminal**, then start `opencode`. Existing terminals do not automatically inherit the new connection settings.

## Features

- Detects working, completion, question/permission requests, errors, and interruptions.
- Updates terminal titles and sends status to the local main extension.
- Ignores child/subagent sessions and duplicate completion events.
- Manual interruption returns silently to `Ready`.
- Authenticated loopback-only event endpoint; prompt text, tool output, and audio files are not transferred.

Choose and test sounds, set volume (1–10), toggle automatic sounds, and configure focused-window behavior in the **main OpenCode Notifications extension**. Popup notifications are separately configurable there.

## Requirements and troubleshooting

- VS Code desktop 1.96+ and a **Linux SSH host** running OpenCode in an integrated terminal.
- A local installation of **OpenCode Notifications** with this companion on the SSH host.
- If no events appear, reinstall/update the OpenCode plugin, restart OpenCode in a **new terminal**, and inspect the **OpenCode Notification Bridge** output channel.
- After a VS Code reload or remote-host restart, use a new terminal so OpenCode receives the updated endpoint. A missing heartbeat marks the connection disconnected after about 16 seconds.
- Terminal matching uses Linux `/proc` and `/dev/pts`. Detached servers, tmux, and `opencode attach` are outside the supported setup.
- If you installed this bridge locally, you can remove that local copy: only the main extension is needed on your own Linux machine.
