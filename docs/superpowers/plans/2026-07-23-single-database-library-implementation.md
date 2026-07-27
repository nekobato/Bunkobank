# 単一SQLiteと名前付きライブラリの実装計画

## 目的

`docs/superpowers/specs/2026-07-23-single-database-library-design.md` を実装する。

認証・設定・ライブラリ・蔵書・ページ・ジョブを一つのSQLiteへ集約し、複数の名前付きライブラリをWeb UIから管理できるようにする。
ライブラリごとに一つの対象ディレクトリを持たせ、スキャン・蔵書・アーカイブ・読書進捗を明示的なライブラリスコープで扱う。

## 実装原則

- 既存の未コミット変更を保持し、対象外の差分を変更しない。
- TDDのRed、Green、Refactorを機能単位で繰り返す。
- 新しい依存は追加せず、既存のHono、Better Auth、better-sqlite3、Vue、Nuxt、PrimeVue、Vitestを利用する。
- TypeScriptの公開関数とモジュールにはTSDocを付ける。
- 原本ディレクトリにはBookCafe固有ファイルを書き込まない。
- SQLiteの自動レガシーマイグレーションは実装しない。
- UI文言は操作名と状態表示へ絞り、販促的・説明的なコピーを追加しない。

## Phase 1: StateDirと共有契約

### Task 1.1: StateDirの解決

対象:

- `packages/config/src/shared.ts`
- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`

Red:

- macOS、Windows、Linuxの既定StateDirを検証する。
- `BOOKCAFE_STATE_DIR` が最優先になることを検証する。
- 新環境変数がない場合だけ `BOOKCAFE_DATA_DIR` を受け入れることを検証する。
- 保存時に `dataDir` と `setupComplete` が除去されることを検証する。
- `resolveStatePaths` がSQLite、サムネイル、キャッシュ、ログの中央パスを返すことを検証する。

Green:

- `getDefaultStateDir`、`resolveStateDir`、`resolveStatePaths` を実装する。
- `AppConfig` からライブラリパスと初期設定完了フラグを除く。
- 設定読み込み時はレガシーフィールドを無視し、保存時に除去する。

Refactor:

- 旧DataDir命名の内部参照をStateDirへ置換する。
- テスト用の環境依存を引数注入できる純粋関数へ寄せる。

検証:

```sh
pnpm --filter @bookcafe/config test
pnpm --filter @bookcafe/config typecheck
```

### Task 1.2: API契約のライブラリスコープ化

対象:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/index.test.ts`

Red:

- 初期ユーザー作成リクエストが `username` と `password` だけを受理することを検証する。
- Library、Book、Page、ReadingProgress、Job、Archiveの契約を検証する。
- `libraryId` が必要なレスポンスとパラメーターを検証する。

Green:

- Library CRUD、選択中ライブラリ、スキャン、アーカイブ、復元、ページ一覧の型を定義する。
- 廃止するCollection RootとDataDirの公開契約を削除する。

Refactor:

- 共有する日時・ID・エラー型を集約する。
- APIとUIの両方から利用する型だけを公開する。

検証:

```sh
pnpm --filter @bookcafe/contracts test
pnpm --filter @bookcafe/contracts typecheck
```

## Phase 2: 単一SQLiteのドメインモデル

### Task 2.1: 新規スキーマ

対象:

- `packages/db/src/index.ts`
- `packages/db/src/index.test.ts`

Red:

- Library名の大文字小文字を区別しない一意制約を検証する。
- 同一・親子関係にあるルートパスを拒否することを検証する。
- Bookの `(library_id, relative_path)` 一意制約を検証する。
- Pageの `(book_id, page_number)` 一意制約と相対ロケーターを検証する。
- ReadingProgressの `(user_id, book_id)` 一意制約を検証する。
- Jobが必ず `library_id` を持つことを検証する。
- ユーザーの選択中ライブラリを保存・解除できることを検証する。

Green:

- `libraries`、`books`、`pages`、`reading_progress`、`jobs`、`user_preferences` を作成する。
- Libraryの作成・更新・削除・一覧・取得関数を実装する。
- Book、Page、Progress、Jobのライブラリスコープ関数を実装する。
- 既存DBに旧スキーマだけがある場合は自動変換せず、明確なエラーを返す。

Refactor:

- DBトランザクション境界を小さなドメイン関数にまとめる。
- パス比較をcanonical pathへ統一する。
- SQL行から契約型への変換を純粋関数へ分離する。

検証:

```sh
pnpm --filter @bookcafe/db test
pnpm --filter @bookcafe/db typecheck
```

### Task 2.2: 本のアーカイブと再検出

対象:

- `packages/db/src/index.ts`
- `packages/db/src/index.test.ts`

Red:

- アーカイブ済みの本が通常一覧から消えることを検証する。
- アーカイブ一覧から復元できることを検証する。
- アーカイブ中のBook、Page、Progress、タグ、サムネイル参照が残ることを検証する。
- 同じ相対パスはアーカイブ中も新規Bookとして作成されないことを検証する。
- 別の相対パスへ移動した原本は新規Bookになることを検証する。
- Library削除でメタデータが消え、原本操作が発生しないことを検証する。

Green:

- Bookの `archived_at` 更新と復元を実装する。
- スキャン向けに既存Bookの状態を効率よく取得できる関数を実装する。
- Library削除をDBトランザクションで実装する。

Refactor:

- 一覧クエリーの通常・アーカイブ条件を共通化する。

## Phase 3: スキャナーとページスナップショット

### Task 3.1: 相対パスによる検出

対象:

- `packages/scanner/src/index.ts`
- `packages/scanner/src/index.test.ts`
- `packages/format-adapters/src/index.ts`
- `packages/format-adapters/src/index.test.ts`

Red:

- スキャン結果がライブラリルートからの相対パスを返すことを検証する。
- ルート外へ解決されるパスを拒否することを検証する。
- アーカイブ済み相対パスを解析前にスキップできることを検証する。
- PDF、EPUB、CBZ、ZIPのPageが相対ロケーターを持つことを検証する。

Green:

- Scanner入力を `libraryRoot` と除外相対パス集合へ変更する。
- BookとPageの永続化用結果から絶対パスを除く。
- ファイルを読む直前だけ安全に絶対パスへ解決する。

Refactor:

- パス正規化とルート内判定を共有関数へ集約する。

検証:

```sh
pnpm --filter @bookcafe/scanner test
pnpm --filter @bookcafe/format-adapters test
pnpm --filter @bookcafe/scanner typecheck
pnpm --filter @bookcafe/format-adapters typecheck
```

### Task 3.2: 再スキャンとページ置換

対象:

- `packages/db/src/index.ts`
- `apps/server/src/scan-jobs.ts`
- `apps/server/src/scan-jobs.test.ts`

Red:

- 一冊のページ一覧がトランザクションで全置換されることを検証する。
- ページ数減少時に読書進捗が末尾へ丸められることを検証する。
- 見つからない非アーカイブ本が `missing` になることを検証する。
- アーカイブ済みの本が解析もmissing更新も受けないことを検証する。

Green:

- `persistScannedBook` をLibraryと相対パス基準へ変更する。
- Page置換と進捗補正を同一トランザクションへ入れる。
- スキャンジョブをLibrary単位へ変更する。

Refactor:

- ジョブ進捗通知とDB更新を分離し、失敗状態を一箇所で確定する。

## Phase 4: Hono API、認証、初期設定

### Task 4.1: 単一DB接続

対象:

- `apps/server/src/auth.ts`
- `apps/server/src/initialization.ts`
- `apps/server/src/main.ts`
- `apps/server/src/app.ts`
- 対応する `*.test.ts`

Red:

- Better Authと業務テーブルが同じStateDir内SQLiteを使用することを検証する。
- userが0件なら初期設定未完了、1件以上なら完了と判定することを検証する。
- 初期ユーザー作成がDataDirを要求しないことを検証する。
- 初期ユーザー作成の競合が安全に失敗することを検証する。

Green:

- Server起動時にStateDirと一つのDBパスを解決する。
- Auth、初期化判定、APIへ同じDB接続先を渡す。
- `sampleBooks` fallbackを削除する。

Refactor:

- `AppOptions` にテスト可能なStateDirまたはdatabasePath注入点を設ける。
- リクエストごとのDB再解決をやめる。

### Task 4.2: ライブラリスコープAPI

対象:

- `apps/server/src/app.ts`
- `apps/server/src/app.test.ts`
- `apps/server/src/scan-jobs.ts`
- `apps/server/src/scan-jobs.test.ts`
- `apps/server/src/thumbnails.ts`

Red:

- Library CRUD、重複名、重複・重複包含ルート、存在・可読性を検証する。
- active job中のLibrary更新・削除が `409 LIBRARY_BUSY` になることを検証する。
- Book一覧、詳細、ページ、サムネイル、進捗がLibrary境界を越えないことを検証する。
- アーカイブ一覧、アーカイブ、復元を検証する。
- Library削除後に中央サムネイルだけが消えることを検証する。
- 選択中Libraryの取得・更新・削除時解除を検証する。

Green:

- 設計書記載の `/api/libraries/:libraryId/...` ルートを実装する。
- ルート検証、エラーコード、404境界を統一する。
- Thumbnail pathをStateDir配下かつLibrary/Book ID基準へ変更する。

Refactor:

- Honoのmiddlewareまたはヘルパーで認証、DB、Library取得を共通化する。
- 入力検証とドメインエラーのHTTP変換を分離する。

検証:

```sh
pnpm --filter @bookcafe/server test
pnpm --filter @bookcafe/server typecheck
```

## Phase 5: Web UI

### Task 5.1: 選択中ライブラリ状態

対象:

- `apps/web/app/composables/useBookApi.ts`
- `apps/web/app/composables/useBookAuth.ts`
- 新規または既存のライブラリ状態composable
- 対応するテスト

Red:

- ログイン後にLibrary一覧と選択中Libraryを復元することを検証する。
- 選択がなければ先頭Libraryを選び、サーバーへ保存することを検証する。
- Libraryが0件なら蔵書APIを呼ばないことを検証する。
- Library切替時にBook・Job・Archiveのスコープが切り替わることを検証する。

Green:

- Library一覧、選択、再読込、エラー状態をcomposableへ実装する。
- 全Book APIを `libraryId` 必須へ変更する。

Refactor:

- ページ固有ロジックと共有APIクライアントを分離する。

### Task 5.2: Library管理とアーカイブUI

対象:

- `apps/web/app/app.vue`
- `apps/web/app/components/AppNavigation.vue`
- `apps/web/app/components/LibraryManager.vue`
- `apps/web/app/components/BookList.vue`
- `apps/web/app/pages/index.vue`
- `apps/web/app/pages/books/[bookId]/index.vue`
- `apps/web/app/pages/books/[bookId]/read.vue`
- `apps/web/app/pages/setup.vue`
- `apps/web/app/assets/css/base.css`
- 対応するテスト

Red:

- App shellのPrimeVue SelectでLibraryを切り替えられることを検証する。
- Library登録・名前変更・ルート変更・スキャン・削除を検証する。
- Library削除の確認とactive jobエラー表示を検証する。
- 通常一覧とアーカイブ一覧が分離され、復元できることを検証する。
- Libraryなし、蔵書なし、読み込み中、APIエラーの状態を検証する。
- 初期設定画面がユーザー名とパスワードだけを送ることを検証する。

Green:

- 既存PrimeVueコンポーネントでLibrary selectorと管理画面を実装する。
- Bookの削除操作を置かず、アーカイブ操作だけを提供する。
- 操作に必要なラベル、確認、エラーだけを表示する。

Refactor:

- Library/Book/Archiveの表示コンポーネントを責務ごとに整理する。
- keyboard focus、form label、dialog title、status messageを確認する。
- 狭い画面でselectorと主要操作が欠けないCSSへ調整する。

検証:

```sh
pnpm --filter @bookcafe/web test
pnpm --filter @bookcafe/web typecheck
```

## Phase 6: Desktop Managerとドキュメント

### Task 6.1: Desktop初期設定の簡素化

対象:

- `apps/desktop/src/App.vue`
- `apps/desktop/src/components/DesktopSetupPanel.vue`
- `apps/desktop/src/manager.ts`
- `apps/desktop/src/operations.ts`
- `apps/desktop/src/runtime.ts`
- 対応するテスト

Red:

- Desktop初期設定がユーザー名とパスワードだけを送ることを検証する。
- DataDirとCollection Root入力が存在しないことを検証する。
- server sidecarが共通StateDirを利用することを検証する。

Green:

- 廃止した入力・型・payloadを削除する。
- Library管理への導線はWeb UI側に一本化する。

Refactor:

- Desktop Managerは起動・停止・状態・Web UIを開く操作だけへ整理する。

検証:

```sh
pnpm --filter @bookcafe/app test
pnpm --filter @bookcafe/app typecheck
```

### Task 6.2: README更新

対象:

- `README.md`

実装:

- 単一SQLiteとStateDirを説明する。
- Libraryが名前と一つの対象ディレクトリを持つことを説明する。
- 原本ディレクトリにBookCafe固有ファイルを置かないことを説明する。
- 本のアーカイブとLibrary削除の違いを説明する。
- Linuxは設定ファイル変更とHono serverのユーザー管理daemon化を前提とし、native sidecar対象外であることを維持する。
- レガシーDBは自動移行せず、再スキャンすることを説明する。

## Phase 7: 統合検証

### Task 7.1: 機械検証

小さい単位から順に実行する。

```sh
pnpm --filter @bookcafe/config test
pnpm --filter @bookcafe/contracts test
pnpm --filter @bookcafe/db test
pnpm --filter @bookcafe/scanner test
pnpm --filter @bookcafe/format-adapters test
pnpm --filter @bookcafe/server test
pnpm --filter @bookcafe/web test
pnpm --filter @bookcafe/app test
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

`pnpm format` 後は、対象外ファイルに意図しない整形差分がないか確認する。

### Task 7.2: 実操作検証

- 一時StateDirと一時ライブラリルートを使ってserverを起動する。
- 初期ユーザー作成、ログイン、Library登録、スキャン、切替、アーカイブ、復元、削除を操作する。
- Library AのBookをLibrary BのURLから取得できないことを確認する。
- desktop managerからsidecarを起動し、Web UIを開けることを確認する。
- desktopとwebを標準幅・狭幅で確認する。
- 起動したserver、Vite、Nuxt、Tauriプロセスを停止し、残存ポートとPIDを確認する。

### Task 7.3: 独立レビュー

- `qa_closer` 相当のsubagentへ、仕様・テスト・差分の独立検証を委譲する。
- `ui_flow_auditor` 相当のsubagentへ、ブラウザー実操作とresponsive検証を委譲する。
- reviewerは編集せず、証拠と指摘だけを返す。
- 指摘を親agentが修正し、該当テストを再実行する。

## 完了条件

- 認証と全Libraryデータが一つのSQLiteに保存される。
- LibraryをWeb UIから複数登録・選択・更新・スキャン・削除できる。
- Book、Page、Job、Thumbnail、ProgressがLibrary境界を越えない。
- 本をアーカイブ・復元でき、削除操作が存在しない。
- 原本ディレクトリへBookCafe固有ファイルを書き込まない。
- 初期設定にDataDirとCollection Rootが存在しない。
- desktopとwebの主要フローを実操作で確認できる。
- test、typecheck、lint、format、buildが成功する。
