# Changelog

## [1.0.9] - 2026-04-01

### Changed
- Updated README image to use HTML tag for better npm display compatibility
- Added npm keywords for improved package discoverability
- Added Related Pi Extensions cross-linking section to README

## [1.0.8] - 2026-04-01

### Changed
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to ^0.64.0

## [1.0.7] - 2026-03-23

### Changed
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to ^0.62.0

## [1.0.6] - 2026-03-12

### Changed
- Updated AWS SDK client-bedrock-runtime to 3.1005.0

## [1.0.5] - 2026-03-12

### Changed
- Updated AWS SDK client-bedrock-runtime to 3.1005.0

## [1.0.4] - 2026-03-07

### Added
- Added Linux clipboard image support via `wl-paste` and `xclip` fallback readers.
- Added Linux and macOS default recent-image discovery locations so the recent picker works beyond Windows.
- Added non-Windows image paste shortcuts including `Ctrl+V` in addition to the existing alternate bindings.

### Changed
- Updated README documentation to reflect current cross-platform support, clipboard backends, recent-image discovery behavior, and inline preview details.

### Fixed
- Removed the Windows-only extension gate so supported non-Windows platforms can register commands and shortcuts.
- Preserved Kitty and iTerm inline image protocol rows during preview width fitting, alongside the existing Sixel-safe handling.
- Improved clipboard reader error handling so unsupported environments report missing backends more clearly.

## [1.0.3] - 2026-03-04

### Fixed
- Use absolute GitHub raw URL for README image to fix npm display

## [1.0.2] - 2026-03-04

### Changed
- Rewrote README.md with professional documentation standards
- Added comprehensive feature documentation, configuration reference, and usage examples

## 1.0.1

- Included `asset/` in the npm package whitelist so README image assets ship in the tarball.

## 1.0.0

- Standardized repository layout to `src/` + root shim entrypoint.
- Added TypeScript/Bundler project config, package metadata, and publish whitelist.
- Added standard docs, license, and config template/runtime placeholder files.
