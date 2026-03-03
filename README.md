# 🖼️ pi-image-tools

Image attachment and preview extension for the **Pi coding agent**.

Quickly attach clipboard images or recent screenshots to your messages, with inline preview rendering in the TUI chat.

> ⚠️ **Windows-only:** This extension only registers commands and shortcuts on Windows (`win32`). On other platforms, it does nothing.

![pi-image-tools preview](https://raw.githubusercontent.com/MasuRii/pi-image-tools/main/asset/pi-image-tools.png)

## Features

- **Clipboard paste** – Attach images directly from your clipboard
- **Recent image picker** – Browse and select from recent screenshots
- **Keyboard shortcuts** – Fast paste with `Alt+V` or `Ctrl+Alt+V`
- **Inline preview** – See attached images rendered in the TUI (up to 3 per message)
- **Sixel rendering** – High-quality terminal graphics when available
- **Automatic caching** – Clipboard-pasted images appear in the recent picker

## Installation

### Extension Folder (Recommended)

Place this folder in one of these locations:

| Scope   | Path                                      |
|---------|-------------------------------------------|
| Global  | `~/.pi/agent/extensions/pi-image-tools`   |
| Project | `.pi/extensions/pi-image-tools`           |

Pi auto-discovers extensions in these paths.

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

#### Paste from Clipboard

```text
/paste-image clipboard
```

Or simply:

```text
/paste-image
```

This reads an image from your clipboard and queues it for attachment. A marker (`[󰈟 Image Attached]`) appears in your draft. When you send the message, the marker is removed and the image is attached.

> **Tip:** Remove all markers from your draft before sending to discard pending images.

#### Paste from Recent Images

```text
/paste-image recent
```

Opens an interactive picker showing recent screenshots and cached images:

```text
01. Screenshot 2026-03-02 142233.png • 2m ago • 412 KB • C:\Users\...\Pictures\Screenshots\...
02. IMG_20260301_120000.png • 1d ago • 1.2 MB • C:\Users\...\Desktop\...
```

Select an image to queue it for your next message.

### Keyboard Shortcuts

| Shortcut       | Action                    |
|----------------|---------------------------|
| `Alt+V`        | Paste image from clipboard|
| `Ctrl+Alt+V`   | Paste image from clipboard|

## Configuration

### Environment Variables

| Variable                         | Description                                      | Default                               |
|----------------------------------|--------------------------------------------------|---------------------------------------|
| `PI_IMAGE_TOOLS_RECENT_DIRS`     | Semicolon-separated directories to search        | See default locations below           |
| `PI_IMAGE_TOOLS_RECENT_CACHE_DIR`| Custom cache directory for clipboard images      | `%TEMP%\pi-image-tools\recent-cache`  |

**Example:**

```powershell
$env:PI_IMAGE_TOOLS_RECENT_DIRS = "C:\Users\me\Pictures\Screenshots;D:\Shares\Screens"
```

### Default Search Locations

The recent picker searches these Windows paths:

1. **Cache directory** – Images previously pasted from clipboard
2. `~/Pictures/Screenshots`
3. `~/OneDrive/Pictures/Screenshots`
4. `~/Desktop` – Only files with screenshot-like names (`Screenshot*`, `Snip*`, `IMG_*`, etc.)

### Supported Image Formats

`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`

### Runtime Config

A configuration file can be placed at:

```text
~/.pi/agent/extensions/pi-image-tools/config.json
```

See `config/config.example.json` for the template:

```json
{
  "enabled": true
}
```

## Technical Details

### Preview Rendering

When you send a message with images, the extension renders an inline preview:

| Mode   | Description                                                      |
|--------|------------------------------------------------------------------|
| Sixel  | High-quality graphics using PowerShell `Sixel` module (preferred)|
| Native | Fallback using `@mariozechner/pi-tui` Image component            |

- Maximum **3 images** previewed per message
- Warnings displayed if Sixel is unavailable

### Clipboard Access

The extension uses multiple methods to read clipboard images:

1. **Native module** – `@mariozechner/clipboard` (optional dependency)
2. **PowerShell fallback** – Uses `System.Windows.Forms.Clipboard` via PowerShell

### Sixel Module Auto-Installation

The extension attempts to install the PowerShell `Sixel` module automatically (CurrentUser scope). If blocked by policy, install manually:

```powershell
Install-Module -Name Sixel -Scope CurrentUser -Force -AllowClobber
```

### Architecture

| File                      | Purpose                                           |
|---------------------------|---------------------------------------------------|
| `index.ts`                | Root entrypoint for Pi auto-discovery             |
| `src/commands.ts`         | `/paste-image` command registration               |
| `src/keybindings.ts`      | Keyboard shortcut registration                    |
| `src/clipboard.ts`        | Clipboard image reading (native + PowerShell)     |
| `src/recent-images.ts`    | Recent image discovery and cache management       |
| `src/image-preview.ts`    | Preview building and Sixel conversion             |
| `src/inline-user-preview.ts` | TUI message patching for inline previews       |
| `src/temp-file.ts`        | Temporary file management with cleanup            |
| `src/types.ts`            | TypeScript type definitions                       |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Nothing happens on `/paste-image` | Ensure you're on Windows. This extension is Windows-only. |
| "requires interactive TUI mode" | Run Pi in interactive TUI mode to use the recent picker. |
| "No image found in clipboard" | Confirm you copied an actual image, not a file path or text. |
| Recent picker is empty | Add directories via `PI_IMAGE_TOOLS_RECENT_DIRS` or paste images from clipboard first. |
| Sixel warning shown | Install the Sixel module manually (see above) and restart Pi. |

## Development

```bash
# Type-check (build)
npm run build

# Lint
npm run lint

# Run tests
npm run test

# All checks
npm run check
```

## License

MIT
