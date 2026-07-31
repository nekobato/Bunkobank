# BookCafe

BookCafe is a self-hosted application for organizing and reading digital books
from a web browser.

> [!WARNING]
> BookCafe is under active development. Its database format and behavior may
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

## Quick start

### Requirements

- Node.js 24
- pnpm 11

### Run BookCafe

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

BookCafe stores its configuration, SQLite database, thumbnails, cache, and logs
in a platform-specific state directory.

| Platform | Default state directory                                |
| -------- | ------------------------------------------------------ |
| macOS    | `~/Library/Application Support/BookCafe`               |
| Windows  | `%APPDATA%/BookCafe`                                   |
| Linux    | `$XDG_DATA_HOME/bookcafe` or `~/.local/share/bookcafe` |

Set `BOOKCAFE_STATE_DIR` to use a different location.

BookCafe does not delete original book files when a library is removed or a book
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
pnpm --filter @bookcafe/app tauri:dev
```

Desktop development additionally requires the Rust and platform tooling needed
by Tauri. The first run may take some time while the native sidecar is built.

## Contributing

Issues and pull requests are welcome. Please keep changes focused and run the
relevant project checks before submitting a pull request.

## License

MIT
