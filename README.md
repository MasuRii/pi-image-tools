# 🖼️ pi-image-tools

[![npm version](https://img.shields.io/npm/v/pi-image-tools?style=flat-square)](https://www.npmjs.com/package/pi-image-tools) [![License](https://img.shields.io/github/license/MasuRii/pi-image-tools?style=flat-square)](LICENSE)

Image attachment and preview extension for the **Pi coding agent**.

`pi-image-tools` lets you attach clipboard images or recent screenshots to your next user message, then preview them inline in the TUI before the message is sent.

<img width="1360" height="752" alt="image" src="https://github.com/user-attachments/assets/c7b462c4-6316-495e-a3fa-5a7e22edd91f" />


## Features

- **Clipboard image attach** with `/paste-image` and keyboard shortcuts
- **Recent image picker** for screenshots and cached clipboard images
- **Inline preview rendering** in the TUI chat before the message is sent
- **Cross-platform recent image discovery** for Windows, Linux, and macOS
- **Multiple clipboard backends** with platform-specific fallbacks
- **Recent-cache persistence** so clipboard images also appear in the recent picker
- **Terminal image safety** that preserves inline image protocol rows during width fitting

## Platform support

| Platform | Clipboard paste | Recent image picker | Notes |
|----------|-----------------|---------------------|-------|
| Windows | Yes | Yes | Uses native clipboard module first, then PowerShell fallback |
| Linux | Yes | Yes | Requires a graphical session; uses `wl-paste` or `xclip`, then native module fallback |
| macOS | Yes* | Yes | Clipboard paste depends on `@mariozechner/clipboard` being available |
| Termux / headless Linux | No | Limited | Clipboard image paste is disabled without a graphical session |

\* macOS clipboard image support relies on the optional native clipboard module.

## Installation

### Extension folder

Place this folder in one of these locations:

| Scope | Path |
|-------|------|
| Global default | `~/.pi/agent/extensions/pi-image-tools` (respects `PI_CODING_AGENT_DIR`) |
| Project | `.pi/extensions/pi-image-tools` |

Pi auto-discovers extensions in those paths.

### Via npm

```bash
pi install npm:pi-image-tools
```

### Via Git

```bash
pi install git:github.com/MasuRii/pi-image-tools
```

## Usage

### Commands

#### Paste from clipboard

```text
/paste-image clipboard
```

or simply:

```text
/paste-image
```

This reads an image from your clipboard and queues it for attachment. A marker (`[󰈟 Image Attached]`) is inserted into your draft. When you send the message, the marker is removed and the image payload is attached.

> Remove all markers from the draft before sending if you want to discard pending images.

#### Paste from recent images

```text
/paste-image recent
```

This opens an interactive picker showing recent screenshots and cached clipboard images.

Example entry:

```text
01. Screenshot 2026-03-02 142233.png • 2m ago • 412 KB • C:\Users\...\Pictures\Screenshots\...
```

Selecting an entry queues that image for your next message.

### Keyboard shortcuts

| Platform | Shortcuts |
|----------|-----------|
| Windows | `Ctrl+Alt+V`; `Alt+V` when Pi's built-in `app.clipboard.pasteImage` shortcut is disabled or rebound |
| Linux / macOS | `Alt+V`, `Ctrl+Alt+V`; `Ctrl+V` when Pi's built-in `app.clipboard.pasteImage` shortcut is disabled or rebound |

Pi's built-in image paste shortcut is not overridden by default. To keep the previous primary shortcut behavior without startup conflict warnings, disable the built-in binding manually in `~/.pi/agent/keybindings.json`:

```json
{
  "app.clipboard.pasteImage": []
}
```

## Configuration

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_IMAGE_TOOLS_RECENT_DIRS` | Semicolon-separated directories to search for recent images | Platform defaults listed below |
| `PI_IMAGE_TOOLS_RECENT_CACHE_DIR` | Custom cache directory for clipboard-pasted images | OS temp dir + `pi-image-tools/recent-cache` |
| `PI_IMAGE_TOOLS_MAX_IMAGE_BYTES` | Maximum accepted image payload size before attachment, recent-cache writes, and preview conversion | `20971520` (20 MB) |

Example:

```powershell
$env:PI_IMAGE_TOOLS_RECENT_DIRS = "C:\Users\me\Pictures\Screenshots;D:\Shares\Screens"
```

### Runtime config

A config file can be placed at:

```text
Default global path: ~/.pi/agent/extensions/pi-image-tools/config.json
Actual global path: $PI_CODING_AGENT_DIR/extensions/pi-image-tools/config.json when PI_CODING_AGENT_DIR is set
```

Starter template:

```json
{
  "debug": false,
  "shortcuts": {
    "pasteImage": ["ctrl+alt+v"],
    "avoidBuiltinConflicts": true,
    "suppressBuiltinConflictWarnings": true
  }
}
```

See `config/config.example.json` for the same template.

#### Debug logging

Debug logging is disabled by default. Set `debug` to `true` to append debug events to `debug/debug.log` inside the extension directory:

```json
{
  "debug": true,
  "shortcuts": {
    "pasteImage": ["ctrl+alt+v"],
    "avoidBuiltinConflicts": true,
    "suppressBuiltinConflictWarnings": true
  }
}
```

When `debug` is `false` or omitted, no debug log file is opened or written.

#### Custom shortcuts

Set `shortcuts.pasteImage` to choose the exact shortcuts registered by `pi-image-tools`. The value can be a single shortcut string or an array of shortcut strings. Add multiple entries when you want several key combinations to run the same paste-image action:

```json
{
  "debug": false,
  "shortcuts": {
    "pasteImage": ["ctrl+alt+v", "alt+v", "ctrl+shift+v"],
    "avoidBuiltinConflicts": true,
    "suppressBuiltinConflictWarnings": true
  }
}
```

A single shortcut is also valid:

```json
{
  "debug": false,
  "shortcuts": {
    "pasteImage": "ctrl+alt+v",
    "avoidBuiltinConflicts": true,
    "suppressBuiltinConflictWarnings": true
  }
}
```

Config changes are applied the next time the extension loads, so restart Pi or reload extensions after editing `config.json`.

Not every terminal can transmit every key combination to Pi. Triple-modifier shortcuts such as `ctrl+shift+alt+v` may be intercepted by the OS, terminal, shell, SSH, or tmux before Pi can see them. If a configured shortcut does not work, try a simpler shortcut such as `ctrl+alt+v`, `ctrl+shift+v`, `alt+p`, `f8`, or another function key.

Keep `shortcuts.avoidBuiltinConflicts` set to `true` to skip configured paste-image shortcuts that overlap any effective Pi built-in shortcut. Keep `shortcuts.suppressBuiltinConflictWarnings` set to `true` when your goal is specifically to remove Pi's startup conflict warning noise. Both options use the same safe mechanism: `pi-image-tools` does not register the overlapping shortcut, so Pi has nothing to warn about. For example, `ctrl+p` is skipped because Pi uses it for built-in model/session actions.

If both options are `false`, Pi handles conflicts itself. Non-reserved built-in conflicts may be taken over by `pi-image-tools`, but Pi can still print a startup warning. Reserved built-in shortcuts cannot be stolen through the extension shortcut API; Pi skips those registrations before `pi-image-tools` can handle them. To use a reserved Pi shortcut, rebind or disable the relevant built-in action in `~/.pi/agent/keybindings.json`, then restart Pi or reload extensions.

Use an empty array to disable the extension's paste-image shortcuts while keeping `/paste-image` available:

```json
{
  "debug": false,
  "shortcuts": {
    "pasteImage": [],
    "avoidBuiltinConflicts": true,
    "suppressBuiltinConflictWarnings": true
  }
}
```

If `shortcuts.pasteImage` is omitted, `pi-image-tools` uses non-conflicting defaults and automatically restores the previous primary shortcut when Pi's built-in `app.clipboard.pasteImage` binding is disabled or rebound.

## Default recent-image search locations

### Windows

1. Cache directory for clipboard-pasted images
2. `~/Pictures/Screenshots`
3. `~/OneDrive/Pictures/Screenshots`
4. `~/Desktop` filtered to screenshot-like names

### Linux

1. Cache directory for clipboard-pasted images
2. `~/Pictures/Screenshots`
3. `~/Pictures` filtered to screenshot-like names
4. `~/Downloads` filtered to screenshot-like names
5. `~/Desktop` filtered to screenshot-like names

### macOS

1. Cache directory for clipboard-pasted images
2. `~/Desktop` filtered to screenshot-like names
3. `~/Downloads` filtered to screenshot-like names
4. `~/Pictures/Screenshots`
5. `~/Pictures` filtered to screenshot-like names

Supported image formats:
- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.gif`
- `.bmp`

## Rendering details

### Inline user preview

When you queue one or more images, the extension renders an inline preview inside the user message area.

Preview behavior:
- up to **3 images** are previewed per message
- Sixel rendering is attempted on Windows when the PowerShell `Sixel` module is already installed
- no PowerShell modules are installed automatically at runtime
- native TUI image rendering is used as the fallback
- image payloads over `PI_IMAGE_TOOLS_MAX_IMAGE_BYTES` are rejected before attachment, recent-cache writes, or Sixel conversion
- inline width fitting now preserves Sixel, Kitty, and iTerm image protocol rows instead of truncating them like plain text

### Clipboard readers

`pi-image-tools` uses the first available clipboard backend for the current platform:

- **Windows**
  - `@mariozechner/clipboard`
  - PowerShell `System.Windows.Forms.Clipboard`
- **Linux**
  - `wl-paste` (`wl-clipboard`) in Wayland sessions
  - `xclip` in X11 sessions
  - `@mariozechner/clipboard` fallback
- **macOS**
  - `@mariozechner/clipboard`

If a platform-specific reader exists but no image is currently on the clipboard, the command returns a normal “No image found in clipboard” message. If no usable reader exists at all, the extension surfaces a setup-oriented error.

## Project structure

```text
pi-image-tools/
├── index.ts                    # Root entrypoint for Pi auto-discovery
├── src/
│   ├── index.ts                # Extension bootstrap and message flow
│   ├── commands.ts             # /paste-image command registration
│   ├── clipboard.ts            # Cross-platform clipboard image reading
│   ├── config.ts               # Runtime config loading and validation
│   ├── debug-logger.ts         # File-based debug logging
│   ├── errors.ts               # Shared error normalization
│   ├── image-mime.ts           # Shared image MIME and extension mapping
│   ├── image-size.ts           # Shared image byte-size limits
│   ├── recent-images.ts        # Recent image discovery and cache management
│   ├── image-preview.ts        # Preview building and Sixel/native rendering
│   ├── inline-user-preview.ts  # Inline preview patching for user messages
│   ├── keybindings.ts          # Keyboard shortcut registration
│   ├── powershell.ts           # Shared PowerShell command runner
│   ├── sixel-protocol.ts       # Sixel protocol normalization and render lines
│   ├── terminal-image-width.ts # Terminal image width settings resolution
│   └── types.ts                # Shared TypeScript types
└── config/
    └── config.example.json     # Starter runtime config
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `No image found in clipboard` | Confirm you copied an actual image, not text or a file path |
| Linux clipboard paste fails | Make sure you are in a graphical session and install `wl-clipboard` or `xclip` |
| Recent picker is empty | Add directories via `PI_IMAGE_TOOLS_RECENT_DIRS` or paste images from clipboard first so they enter the recent cache |
| `/paste-image recent` says it requires interactive mode | Run Pi in interactive TUI mode |
| Sixel preview warning appears | On Windows, install the PowerShell `Sixel` module and restart Pi |

Manual Sixel installation:

```powershell
Install-Module -Name Sixel -Scope CurrentUser -Force -AllowClobber
```

## Development

```bash
# Type-check
npm run build

# Run tests
npm run test

# Full verification
npm run check
```

## Related Pi Extensions

- [pi-tool-display](https://github.com/MasuRii/pi-tool-display) — Compact tool rendering and diff visualization
- [pi-hide-messages](https://github.com/MasuRii/pi-hide-messages) — Hide older chat messages without losing context
- [pi-startup-redraw-fix](https://github.com/MasuRii/pi-startup-redraw-fix) — Fix terminal redraw glitches on startup
- [pi-smart-voice-notify](https://github.com/MasuRii/pi-smart-voice-notify) — Multi-channel TTS and sound notifications

## License

MIT
