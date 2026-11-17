# Bunkobank

Bunkobank is a self-hosted application for organizing and reading digital books
from a web browser.

> [!WARNING]
> Bunkobank is under active development. Its database format and behavior may
> change before the first stable release.

## Features

- Manage multiple libraries from the Web UI
- Read books in paged, spread, or vertical layouts
- Track reading progress for each user
- Search, sort, archive, and restore books
- Organize books into manual, library-scoped collections
- Run and monitor library scans
- Use the optional Desktop Manager to monitor the server

## Supported platforms and formats

The Web UI and server run on macOS, Windows, and Linux. The Desktop Manager is
available for macOS and Windows.

Supported book formats:

- Image directories
- ZIP and CBZ
- PDF
- EPUB
- RAR and CBR
- 7z

Linux installations use the Web UI and server without the Desktop Manager.

## Installation

### macOS

The latest release, [v2.0.3](https://github.com/nekobato/Bunkobank/releases/tag/v2.0.3), provides these signed and notarized installers for macOS 13 or later:

| Mac | Download |
| --- | --- |
| Apple Silicon | [Bunkobank_2.0.3_aarch64.dmg](https://github.com/nekobato/Bunkobank/releases/download/v2.0.3/Bunkobank_2.0.3_aarch64.dmg) |
| Intel | [Bunkobank_2.0.3_x64.dmg](https://github.com/nekobato/Bunkobank/releases/download/v2.0.3/Bunkobank_2.0.3_x64.dmg) |

Open the DMG and install Bunkobank. If upgrading from BookCafe, back up your data first:
the old data directory and macOS LaunchAgent are not migrated automatically. See the
[release notes](https://github.com/nekobato/Bunkobank/releases/tag/v2.0.3) before upgrading.

### Windows and Linux

Release v2.0.3 does not include Windows or Linux binaries. To run the Web UI and
server from source, clone this repository and follow [Quick start](#quick-start)
below. Linux uses the Web UI and server without the Desktop Manager.

For the Windows Desktop Manager, the source-build command is
`pnpm --filter @bunkobank/app tauri:build` after installing the dependencies and
Tauri's Rust and Windows build prerequisites. This is a source-build path, not a
published Windows installer or a claim of verified Windows operation.

## Quick start

### Requirements

- Node.js 26.12.1 or a later 26.x release for development and Enhanced SEA sidecar packaging (sidecars embed Node.js 26.12.1)
- pnpm 11

### Run Bunkobank

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000` and follow the setup screen to create the initial
user, add a library, and start a scan.

The development servers use these addresses:

- Web UI: `http://127.0.0.1:3000`
- API server: `http://127.0.0.1:4510`

## Configuration and data

Bunkobank stores its configuration, SQLite database, thumbnails, cache, and logs
in a platform-specific state directory.

| Platform | Default state directory                                  |
| -------- | -------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Bunkobank`                |
| Windows  | `%APPDATA%/Bunkobank`                                    |
| Linux    | `$XDG_DATA_HOME/bunkobank` or `~/.local/share/bunkobank` |

Set `BUNKOBANK_STATE_DIR` to use a different location.

Bunkobank does not delete original book files when a library is removed or a book
is archived.

## Development

Run the project checks from the repository root:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm format
pnpm build
```

To run the Desktop Manager in development mode:

```bash
pnpm --filter @bunkobank/app tauri:dev
```

Desktop development additionally requires the Rust and platform tooling needed
by Tauri. The first run may take some time while the native sidecar is built.

## Contributing

Issues and pull requests are welcome. Please keep changes focused and run the
relevant project checks before submitting a pull request.

## License

MIT
