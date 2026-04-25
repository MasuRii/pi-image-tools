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
| Windows | `Alt+V`, `Ctrl+Alt+V` |
| Linux / macOS | `Ctrl+V`, `Alt+V`, `Ctrl+Alt+V` |

## Configuration

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_IMAGE_TOOLS_RECENT_DIRS` | Semicolon-separated directories to search for recent images | Platform defaults listed below |
| `PI_IMAGE_TOOLS_RECENT_CACHE_DIR` | Custom cache directory for clipboard-pasted images | OS temp dir + `pi-image-tools/recent-cache` |

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
  "enabled": true
}
```

See `config/config.example.json` for the same template.

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
- Sixel rendering is attempted on Windows when available
- native TUI image rendering is used as the fallback
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
│   ├── recent-images.ts        # Recent image discovery and cache management
│   ├── image-preview.ts        # Preview building and Sixel/native rendering
│   ├── inline-user-preview.ts  # Inline preview patching for user messages
│   ├── keybindings.ts          # Keyboard shortcut registration
│   ├── temp-file.ts            # Temporary file management and cleanup
│   └── types.ts                # Shared TypeScript types
├── config/
│   └── config.example.json     # Starter runtime config
└── asset/
    └── pi-image-tools.png      # README preview image
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
