# BookCafe

BookCafeは、サーバー上の本をブラウザーで管理・閲覧する個人向けアプリケーションです。

現在は開発中です。データベース形式は正式リリースまで変更される場合があります。

## 対応環境

- Web server: macOS、Windows、Linux
- Desktop Manager: macOS（Apple Silicon／Intel）、Windows
- Native sidecar: macOS（Apple Silicon／Intel）、Windows

Linux向けのDesktop Managerとnative sidecarは提供しません。Linuxでは利用者が`config.json`を編集し、Hono serverを`systemd --user`などでdaemon化して運用します。

## 保存構成

認証情報、セッション、ライブラリ、蔵書、ページ、読書位置、ジョブは、一つの`bookcafe.sqlite`へ保存します。

状態ディレクトリの既定値は次のとおりです。

| OS      | StateDir                                 |
| ------- | ---------------------------------------- |
| macOS   | `~/Library/Application Support/BookCafe` |
| Windows | `%APPDATA%/BookCafe`                     |
| Linux   | `$XDG_DATA_HOME/bookcafe`                |
| Linux   | `~/.local/share/bookcafe`（XDG未設定時） |

```text
StateDir/
├─ config.json
├─ bookcafe.sqlite
├─ thumbnails/
├─ cache/
└─ logs/
```

`BOOKCAFE_STATE_DIR`でStateDirを変更できます。互換目的で、`BOOKCAFE_STATE_DIR`がない場合だけ`BOOKCAFE_DATA_DIR`も受け付けます。

本の対象ディレクトリには、BookCafeのデータベース、サムネイル、キャッシュ、マーカーファイルを作成しません。

## ライブラリ

一つのライブラリは、名前と一つの対象ディレクトリを持ちます。Web UIの設定画面から複数のライブラリを登録し、ヘッダーで切り替えます。

本とページは対象ディレクトリからの相対パスでSQLiteへ保存します。対象ディレクトリ自体を移動またはリネームした場合は、ライブラリ設定のパスを更新してから再スキャンします。

ライブラリを削除すると、そのライブラリのSQLite内データとStateDir内のサムネイルを削除します。対象ディレクトリと原本ファイルは削除しません。

## 本のアーカイブ

本に削除操作はありません。

本をアーカイブすると、通常一覧、検索、スキャン、分類対象から除外します。書誌情報、ページ、読書位置、タグ、サムネイルは保持し、アーカイブ一覧から元に戻せます。

対象ディレクトリ内で本を移動またはリネームした場合、次回スキャンでは新しい本として検出します。移動前後の本を自動的に関連付ける機能はありません。

## 対応形式

- 画像フォルダー
- ZIP／CBZ
- PDF
- EPUB
- RAR／CBR
- 7z

## 開発

Node.js 24とpnpm 11を使用します。

```bash
pnpm install
pnpm dev
```

`pnpm dev`はHono serverとWeb UIを起動します。

- Web UI: `http://127.0.0.1:3000`
- Hono server: `http://127.0.0.1:4510`

Desktop ManagerのGUIを開く場合は、Viteだけを起動する`apps/desktop`の`pnpm dev`ではなく、Tauriを起動します。

```bash
pnpm --filter @bookcafe/app tauri:dev
```

`tauri:dev`はnative sidecarの準備を含むため、初回は時間がかかります。

検証コマンド:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm format
pnpm build
```

## Linux

LinuxではWeb UIとHono serverだけを使用します。設定例:

```json
{
  "host": "127.0.0.1",
  "port": 4510,
  "thumbnails": {
    "enabled": true
  }
}
```

設定ファイルは既定で`$XDG_DATA_HOME/bookcafe/config.json`、XDG未設定時は`~/.local/share/bookcafe/config.json`です。別の場所を使う場合は`BOOKCAFE_CONFIG`または`--config`で指定します。

```bash
BOOKCAFE_STATE_DIR=/srv/bookcafe \
BOOKCAFE_CONFIG=/etc/bookcafe/config.json \
pnpm --filter @bookcafe/server start
```

repositoryから直接実行する開発用途では次を使用します。

```bash
BOOKCAFE_STATE_DIR=/srv/bookcafe \
BOOKCAFE_CONFIG=/etc/bookcafe/config.json \
pnpm --filter @bookcafe/server dev
```

daemonの作成、再起動、ログローテーション、権限設定は利用者側で管理します。BookCafeはLinux用の`systemd` unitを自動作成しません。

## Desktop build

Desktop buildは実行ホストと同じOS／CPU向けのsidecarを生成します。

```bash
pnpm --filter @bookcafe/app tauri:build
```

macOSのApple Silicon用とIntel用は、それぞれ該当architectureのRust／Node環境でbuildします。Windows buildはWindowsのx64環境で行います。現在のsidecar buildはcross compileを行いません。

Desktop ManagerはHono serverの起動、停止、状態確認、初期ユーザー作成、自動起動設定を担当します。ライブラリ、スキャン、ネットワーク、サムネイルの設定はWeb UIで行います。
