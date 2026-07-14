# Personal Book Collection Server OSS

自分の持っているサーバ上で、本のコレクションを自分用にサーブするOSS。

## 確定した技術選定

| 領域              | 採用技術                                        | メモ                                                                           |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Package manager   | pnpm workspace                                  | `apps/*`と`packages/*`をworkspaceとして管理する。                              |
| Backend API       | Hono                                            | TypeScript製の軽量Web framework。Node.js runtimeでの運用を第一候補にする。     |
| Database          | SQLite                                          | 個人用・セルフホスト用途として、単一ファイルDBを中心に考える。                 |
| ORM / migration   | Drizzle ORM / Drizzle Kit                       | schema定義、型推論、migration生成に使う。                                      |
| Auth              | Better Auth                                     | password loginを提供する。username/passwordはTauri appで初期設定する。         |
| Job queue         | SQLite-backed job table / p-queue               | job状態はSQLiteに保存し、実行制御はin-process workerで行う。                   |
| Frontend          | Nuxt 最新版                                     | Nuxt 4系を前提にする。                                                         |
| Book viewer       | Custom Nuxt/Vue implementation / VueUse helpers | 読書体験は自前実装を第一候補にし、補助にVueUse等を使う。                       |
| Desktop manager   | Tauri                                           | 初期設定UI、対象フォルダー設定、ローカルserver起動、OS別の自動起動設定を担う。 |
| macOS daemon      | launchd                                         | MacではTauri desktop appからLaunchAgentまたはservice登録を行う。               |
| Windows autostart | Tauri autostart                                 | Windowsではservice化せず、ユーザーログイン時にTauri desktop appを起動する。    |
| Linux operation   | config file / manual daemon                     | Linuxではdesktop appは任意。設定ファイル編集とserver直接起動を基本にする。     |

2026-07-09時点のnpm registry確認値:

| package                        | version   |
| ------------------------------ | --------- |
| `pnpm`                         | `11.10.0` |
| `nuxt`                         | `4.4.8`   |
| `hono`                         | `4.12.28` |
| `drizzle-orm`                  | `0.45.2`  |
| `drizzle-kit`                  | `0.31.10` |
| `better-auth`                  | `1.6.23`  |
| `p-queue`                      | `9.3.1`   |
| `@vueuse/core`                 | `14.3.0`  |
| `photoswipe`                   | `5.4.4`   |
| `openseadragon`                | `6.0.2`   |
| `@tauri-apps/cli`              | `2.11.4`  |
| `@tauri-apps/api`              | `2.11.1`  |
| `@tauri-apps/plugin-shell`     | `2.3.5`   |
| `@tauri-apps/plugin-autostart` | `2.5.1`   |
| `@yao-pkg/pkg`                 | `6.21.0`  |

## 初期アーキテクチャ案

- HonoをAPI serverとして立てる。
- repositoryはpnpm workspaceで管理する。
- root scriptはpnpm recursive commandを使い、`dev`、`build`、`test`、`lint`、`format`、`typecheck`を提供する。
- Nuxtは開発時にはfrontend appとして立て、Hono APIを呼び出す。
- 配布時のNuxtは静的frontend assetsとしてbuild/generateし、Hono serverが同一originで配信する。
- Hono serverは`/api/*`でbackend APIを提供し、それ以外のrouteではNuxtの生成物を静的ファイルとして配信する。
- client-side routingに必要なfallbackとして、存在しないfrontend routeは`index.html`または`200.html`を返す。
- DB schemaはDrizzleでTypeScriptから定義する。
- DB schemaは正式リリースまでは破壊的変更を許容し、機能を考えながら合理的に決定する。
- migrationはDrizzle Kitで生成し、SQLiteに適用する。
- frontendからのデータ取得はNuxtの`useFetch`または`$fetch`ベースにする。
- Nuxt側のAPI baseは配布時に同一originの`/api`を使う。
- APIのrequest validationはHono middlewareとschema validation libraryを組み合わせる。
- API routeは先に固定しすぎず、機能から合理的に設計する。
- 認証はBetter Authでpassword loginを提供する。
- username/passwordはTauri appの初期設定画面で設定する。
- 初回セットアップ完了前だけsetup modeを有効にし、初期user作成後はsetup APIを無効化する。
- 初期状態のbind addressは`127.0.0.1`にする。
- LAN公開はpassword login設定後に明示設定で有効化する。
- APIテストはHonoの`app.request()`を優先する。
- 本の実体ファイルはserver側で解析し、frontendにはページ単位の画像として提供する。
- 本のビューワーはプロダクト中核として`apps/web`で自前実装を第一候補にする。
- 形式ごとの差異はformat adapterで吸収する。
- 指定された複数のコレクションフォルダーをスキャンし、本として認識できるものをSQLite databaseに登録する。
- サムネイルはユーザーオプションで保存有無を切り替える。
- scan、thumbnail生成、format変換などの重い処理はjob queueで扱う。
- Tauri desktop appを初期設定用のmanager appとして提供する。
- 初回ユーザーはTauri desktop appを起動し、解析対象フォルダー群、DB保存先、server port、認証設定などを入力する。
- Tauri desktop appからHono serverを起動できるようにする。
- Hono serverは`@yao-pkg/pkg`のEnhanced SEAでhost native binaryにし、Tauri sidecarとして同梱する。
- macOSではTauri desktop appが`launchd`用の設定を作成し、ログイン時または常駐serverとして起動できるようにする。
- WindowsではTauri desktop appがHono serverを起動する。
- Windowsではservice化を扱わず、Tauri desktop appに「ユーザーログイン時に起動する」オプションを提供する。
- Windowsユーザーがログインしている間は、Tauri desktop appと、そのappが起動したHono serverによってサービスを提供する。
- LinuxではTauri desktop appは使っても使わなくてもよい。
- Linuxでは利用者が設定ファイルを編集できる前提で、Hono serverを直接起動する運用を基本にする。
- Linuxのdaemon化は利用者が`systemd`などで自分で設定する方針にする。

## 決定した初期実装方針

- repositoryはpnpm workspaceで管理する。
- 開発時は`apps/server`と`apps/web`を別portで起動する。
- 配布時は`apps/web`の静的成果物を`apps/server`配下の配信用directoryへコピーし、Hono serverから配信する。
- root scriptは`dev`、`build`、`test`、`lint`、`format`、`typecheck`を用意する。
- `dev`は`apps/server`と`apps/web`を別portで起動する。
- `build`はworkspace全体をbuildし、最後に`apps/web`の静的成果物を`apps/server`の配信用directoryへコピーする。
- `test`、`lint`、`format`はpnpm recursive commandでworkspace全体に対して実行する。
- `typecheck`は共有packageを先にbuildして`dist`の型定義を更新してから、workspace全体に対して実行する。
- 設定ファイル形式、path解決、既定値は`packages/config`に集約し、Tauri appとHono serverで共有する。
- 初回セットアップ完了前だけsetup modeを有効にする。
- setup modeではTauri appからusername/password、data directory、server portなどを設定する。
- 初期user作成後はsetup APIを無効化する。
- 初期状態のbind addressは`127.0.0.1`にする。
- LAN公開はpassword login設定後に明示設定で有効化する。
- DB schemaは機能設計の進行に合わせて決める。
- 正式リリースまではDB schemaの破壊的変更を許容する。
- APIは機能から合理的に設計し、初期段階でroute一覧を固定しすぎない。
- scan pipelineは`detect -> fingerprint -> parse -> persist -> thumbnail job -> scan report`を基本単位にする。
- NuxtはSSR serverとして常駐させず、静的frontend assetsとして配布する。
- Hono serverはbackend APIとNuxt静的frontend assets配信を同じprocessで担う。
- 対応予定の入力formatはすべて実装対象にする。ただし、形式ごとのライブラリまたは外部ツール調査spikeで実装順序を決める。
- data directoryはOSのユーザーディレクトリ配下を優先し、利用できない場合は設定で明示指定する。
- アプリが永続的に持つ派生画像はthumbnailのみとする。
- preview画像や変換済みページ画像は初期実装では保存しない。
- thumbnailに容量上限や手動削除UIは設けない。
- 認証はBetter Authのpassword loginを使う。
- username/passwordはTauri appで設定する。
- scanやthumbnail生成などのbackground処理はjob queueで扱う。
- job状態はSQLiteに保存し、workerはHono server process内で実行する。
- ファイル同一性と更新判定は初期実装では`path + size + mtime`を基本にする。
- hash計算は必要になった場合だけ追加する。
- format実装順は`画像フォルダー -> zip/cbz -> PDF -> EPUB -> rar/cbr/7z -> その他`を基本にする。
- Hono APIのテストはserver processを起動せず、`app.request()`を使う。
- Drizzle schema、scan pipeline、Hono APIはTDDを基本に小さい単位で追加する。

## pnpm workspace構成

```txt
BookCafe/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.base.json

  apps/
    server/
    web/
    desktop/

  packages/
    core/
    contracts/
    db/
    config/
    scanner/
    format-adapters/

  fixtures/
    books/

  docs/
    research/
    architecture/
    spikes/
```

`pnpm-workspace.yaml`の初期案:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "!**/dist/**"
  - "!**/.output/**"
```

workspace package名の初期指定:

| workspace      | package name       | 役割                                                          |
| -------------- | ------------------ | ------------------------------------------------------------- |
| `apps/server`  | `@bookcafe/server` | Hono API server。Nuxt静的assetsも配信する。                   |
| `apps/web`     | `@bookcafe/web`    | Nuxt frontend。配布時は静的assetsとして出力する。             |
| `apps/desktop` | `@bookcafe/app`    | Tauri manager app。初期設定、server起動、自動起動設定を担う。 |

共有packageの初期案:

| workspace                  | package name候補            | 役割                                |
| -------------------------- | --------------------------- | ----------------------------------- |
| `packages/core`            | `@bookcafe/core`            | domain型、共通ロジック。            |
| `packages/contracts`       | `@bookcafe/contracts`       | API request/response schema、DTO。  |
| `packages/db`              | `@bookcafe/db`              | Drizzle schema、migration、DB接続。 |
| `packages/config`          | `@bookcafe/config`          | config読込、path解決、既定値。      |
| `packages/scanner`         | `@bookcafe/scanner`         | scan pipeline。                     |
| `packages/format-adapters` | `@bookcafe/format-adapters` | format adapter群。                  |

workspace内依存は`workspace:*`を使う。

## workspace script方針

root `package.json`には以下のscriptを用意する。

| script      | 方針                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------- |
| `dev`       | `apps/server`と`apps/web`を別portで起動する。                                                |
| `build`     | workspace全体をbuildし、`apps/web`の静的成果物を`apps/server`の配信用directoryへコピーする。 |
| `test`      | pnpm recursive commandで各workspaceのtestを実行する。                                        |
| `lint`      | pnpm recursive commandで各workspaceのlintを実行する。                                        |
| `format`    | pnpm recursive commandで各workspaceのformatを実行する。                                      |
| `typecheck` | 共有packageを先にbuildし、各workspaceのtypecheckを実行する。                                 |

開発サーバーなど長時間起動するcommandは、作業時に`timeout`またはPID管理を行う。

## Frontend配布方針

NuxtはSSR serverとして常駐させず、静的frontend assetsとしてbuild/generateする。

Hono serverは`/api/*`でbackend APIを提供し、それ以外のrouteではNuxtの生成物を静的ファイルとして配信する。client-side routingに必要なfallbackとして、存在しないfrontend routeは`index.html`または`200.html`を返す。

この方針により、配布時に起動するserver processをHonoに一本化する。Nuxt側は同一originの`/api`を呼び出す。

## Web UI方針

- Web UIの主要なメニューとアプリ全体のnavigationは、基本的にサイドバーとして配置する。
- 上部headerはbrand、認証状態、補助的な短い操作に限定し、主要画面への遷移や管理系メニューを増やさない。
- サイドバーにはLibrary、Setup、collection管理、job確認、将来のimport/exportや設定画面への導線を集約する。
- 狭い画面ではサイドバーを折りたたみ、drawerとして開閉できる形にする。
- 読書画面では本文表示を優先し、サイドバーは既定で隠すか、読書操作を妨げない表示にする。

実装済みのWeb UI navigation:

- desktopではLibrary、Collections、Jobs、Setupへの主要navigationを常設サイドバーに配置する。
- 狭い画面では主要navigationをnative dialogのdrawerとして開き、Escape、背景クリック、close button、遷移完了で閉じられる。
- drawerをmodal表示している間はbrowser標準のfocus管理と外側contentのinert化を利用する。
- CollectionsとJobsはLibrary画面内の対応sectionへ直接移動できる。
- 読書画面では画面幅にかかわらずサイドバーを隠し、menu buttonから必要な場合だけdrawerを開ける。
- keyboard利用者が反復navigationを飛ばせるよう、main contentへのskip linkを提供する。

## 本ビューワー方針

本のビューワーはプロダクト体験の中核なので、外部ライブラリに読書体験全体を預けず、`apps/web`で自前実装することを第一候補にする。

自前実装では、既存の有名なreaderの挙動を参照実装として選定し、操作体系と機能仕様を近づける。ただし、proprietary UIやbranding、assetsの完全コピーは避ける。OSS実装を参照する場合もlicenseを確認し、code copyはcompatible licenseの範囲でのみ行う。

参照実装:

- Komga Webreader: MIT license。複数reading modeを持つため、参照実装として固定する。
- Kavita reader: GPL-3.0 license。必要に応じて機能やUXの参考にはするが、code copyは行わない。

初期ビューワー機能:

- 画像ページをHono APIからページ単位で取得して表示する。
- 初期表示modeはpagedにする。
- paged mode、vertical/webtoon modeを提供し、Web UI上の設定で切り替えられるようにする。
- single page表示と見開き表示を提供する。
- 初期の読書方向は日本の漫画と同じright-to-leftにする。
- left-to-right、right-to-leftの読書方向をWeb UI上の設定で切り替えられるようにする。
- keyboard、touch swipe、mouse wheel、button操作で前後ページ移動できるようにする。
- mouse wheelはページ送りに使う。
- zoomはpinch操作を基本にする。
- fit width、fit height、actual size相当の表示modeを持つ。
- zoom時のpanは必要だが、最初は読書体験に必要な最小範囲で実装する。
- 読書状態として保存するのはcurrent pageのみとする。
- 表示mode、読書方向、scaleは初期実装では読書状態としてDB保存しない。

実装済みの初期ビューワー機能:

- `apps/web` の `ReaderView` で paged mode と vertical mode を提供する。
- paged modeではsingle page表示と見開き表示を切り替えられる。
- 見開き表示ではcover pageを単独表示し、2ページ目以降を2ページ単位で表示する。
- 読書方向は right-to-left / left-to-right を画面上で切り替えられる。
- current page は `PATCH /api/books/:bookId/progress` でSQLiteへ保存する。
- ユーザー操作による再スキャンで同じ本を更新しても、保存済みcurrent pageは保持する。
- keyboard、touch swipe、mouse wheel、Prev/Next buttonでページ移動できる。
- keyboard shortcutは読書方向に従い、`ArrowLeft` / `ArrowRight`で前後ページへ移動する。
- `PageDown` / `Space`で次ページ、`PageUp` / `Shift+Space`で前ページへ移動する。
- `Home`で先頭ページ、`End`で最終ページへ移動する。
- `+` / `=`で拡大、`-`で縮小、`0`で100%へ戻す。
- shortcutはinput、textarea、select、button、link、editable領域の操作中は無効にする。
- ページ番号入力で直接ページ移動できる。
- pinch gesture、zoom buttonで1xから3xまで拡大縮小できる。
- fit page、fit width、fit height、actual size相当の表示modeを選べる。
- paged modeでは現在ページを高優先度で読み込み、前後ページを`<link rel="preload">`で低優先度に事前取得する。
- vertical modeでは`content-visibility: auto`とlazy loadingを使い、現在ページ以外の画像読み込みを抑える。
- current pageの保存に失敗した場合は、reader上に`aria-live`付きのstatus messageを表示する。
- 元ファイルまたはページ画像を読めない場合は、reader上に復旧向けのnoticeを表示する。

ビューワー実装で使う候補ライブラリ:

| library         | license      | 扱い                                                                            |
| --------------- | ------------ | ------------------------------------------------------------------------------- |
| `@vueuse/core`  | MIT          | keyboard、swipe、element size、local storageなどの補助に使う候補。              |
| `photoswipe`    | MIT          | zoom/panの調査候補。book reader全体の主実装にはしない。                         |
| `openseadragon` | BSD-3-Clause | tiled high-resolution画像が必要になった場合の調査候補。初期実装では採用しない。 |

ビューワーの性能・アクセシビリティ方針:

- 画像には幅、高さ、またはaspect ratioを持たせ、読み込み後のlayout shiftを抑える。
- 現在ページと前後数ページだけを優先読み込みする。
- 長いvertical modeでは、初期viewport外の重いページに`content-visibility: auto`を使う候補にする。
- 読書再開時は対象ページへ即時スクロールできるようにし、必要に応じて`scrollIntoView()` fallbackを使う。
- 操作ボタンはnative `button`を使い、keyboard操作とfocus表示を保証する。
- 自動で流れるanimationやpage curl演出は初期実装では入れない。

## 認証方針

- 認証はBetter Authを使う。
- Hono serverはBetter Auth handlerを`/api/auth/*`にmountする。
- login方式はpassword loginにする。
- username loginにはBetter Authのusername pluginを使う候補にする。
- username/passwordはTauri appの初期設定画面で設定する。
- Better Auth側でemail fieldが必須になるかは実装前の小さなspikeで確認する。
- 初回セットアップ完了前だけsetup modeを有効にする。
- setup modeではTauri appからusername/password、data directory、server portなどを設定する。
- 初期user作成後はsetup APIを無効化する。
- Tauri appは設定完了時に、Hono serverまたは共有設定処理を通じて初期userを作成する。
- Nuxt frontendはBetter Auth clientを使ってsessionを扱う。
- API routeはBetter Auth sessionを確認し、未認証requestを拒否する。
- 初期状態で外部social providerは扱わない。

## 公開範囲方針

- 初期状態のbind addressは`127.0.0.1`にする。
- LAN公開はpassword login設定後に明示設定で有効化する。
- LAN公開を有効化する場合も、未認証requestはBetter Auth sessionで拒否する。
- Tauri appはbind address、port、LAN公開設定を管理画面で表示・変更できるようにする。

実装済みの公開範囲関連機能:

- configの`host`は`127.0.0.1`または`0.0.0.0`のみを受け付ける。
- 初回setup APIは`host`と`port`を保存し、Hono server起動時のbind addressに使える。
- Web setup画面では、初期設定時にLocalまたはLANのbind addressを選択できる。
- setup status APIは現在の`host`と`port`を返す。
- 認証済みsettings APIとWeb setup画面から、初期設定後の`host`と`port`を変更できる。
- 起動中serverのbind addressとportは即時変更せず、保存値が変わった場合は再起動が必要であることをAPI responseとWeb UIで示す。

## Tauri appとserverの責務境界

- Tauri appは初期設定、設定ファイル作成、server起動・停止・状態確認、自動起動設定を担う。
- Hono serverは設定検証、DB migration、Better Auth、API提供、Nuxt静的assets配信、job workerを担う。
- 設定ファイル形式、path解決、既定値、validationは`packages/config`へ集約し、Tauri appとHono serverで共有する。
- Tauri appはdomain logicやscan pipelineを直接実行しない。

## データ保存場所方針

- SQLite database、thumbnail、log、configはアプリ管理下のdata directoryに保存する。
- アプリが永続的に持つ派生画像はthumbnailのみとする。
- preview画像や変換済みページ画像は初期実装では保存しない。
- data directoryはOSのユーザーディレクトリ配下を優先する。
- OSのユーザーディレクトリを利用できない場合、Tauri appまたは設定ファイルで明示指定する。
- コレクションルート配下にはDB、thumbnail、logを保存しない。
- 元ファイルや元フォルダーはユーザー管理のまま扱い、serverは原則として読み取りと解析だけを行う。
- data directoryのpath解決、既定値、validationは`packages/config`に集約する。

## Job queue方針

- scan、thumbnail生成、format変換、重いmetadata解析はjob queueで扱う。
- job状態はSQLite databaseに保存する。
- workerはHono server process内で起動するin-process workerにする。
- in-process workerの並行数制御には`p-queue`を使う候補にする。
- server再起動後、未完了または中断状態のjobをSQLiteから復元して再実行または失敗扱いにできるようにする。
- job APIは機能実装に合わせて設計するが、frontendが進捗、成功、失敗、キャンセル可否を表示できる状態を返す。
- 外部queue serviceやRedis前提のqueueは初期構成では採用しない。

実装済みのjob cancellation:

- job responseは`queued`または`running`のときだけ`canCancel: true`を返す。
- 認証済みの`DELETE /api/jobs/:jobId`で、待機中または実行中のscan jobを`cancelled`へ変更できる。
- 待機中jobは`p-queue`へ渡した`AbortSignal`でqueueから除去し、scan処理を開始しない。
- 実行中jobはscanner、book persist、thumbnail、missing判定などの協調停止境界で中断する。
- `cancelled`は終端状態とし、遅れて完了したworkerがprogress、payload、`completed`、`failed`で上書きしないよう、SQLiteの状態条件付き更新を使う。
- キャンセル前に永続化を完了した本はrollbackせず、以降の本とmissing判定を停止するbest-effort cancellationとする。
- archive展開、PDF解析、EPUB解析、画像変換など中断APIを持たない処理は、その処理が戻った次の協調停止境界で終了する。
- Library画面とSetup画面はキャンセル可能なjobだけにCancel buttonを表示し、結果をjob listへ反映する。

## Tauri desktop appの役割

- 初期設定画面を提供する。
- 解析対象フォルダーを複数選択・保存する。
- SQLite databaseの保存先を設定する。
- username/passwordを設定する。
- Hono serverの起動・停止・状態確認を行う。
- macOSの自動起動設定を作成・更新・解除する。
- Windowsのログイン時起動設定を作成・更新・解除する。
- serverが起動している場合、Nuxt frontendまたは管理画面を開く導線を提供する。

実装済みのdesktop manager支援機能:

- `apps/desktop`で初期設定draftを正規化し、Hono初期setup API用request bodyへ変換できる。
- `apps/desktop`の初期設定draftでthumbnail保存の有効・無効をHono初期setup APIへ渡せる。
- desktop managerからserver UIを開くため、`host`と`port`からbrowser向けURLを生成できる。
- `0.0.0.0`でbindする場合も、desktop appが開くURLは`127.0.0.1`へ正規化する。
- `packages/config`でbind host正規化とserver URL生成を共有し、Hono auth設定とdesktop managerが同じ規則を使う。
- desktop managerから`/api/health`を読んで、server状態を`reachable`、`unreachable`、`invalid-response`に分類できる。
- HTTP error responseを接続失敗と区別し、外部processのport競合とmanaged processの異常応答を別状態として表示できる。
- Hono server entrypointは`--config <path>`を受け取り、Tauri sidecarや外部起動から明示config pathを渡せる。
- desktop managerはTauri sidecarとしてHono serverを起動するためのcommand name、`--config` args、browser URL、health URL、`shell:allow-spawn` permissionを副作用なしで生成できる。
- desktop managerはserver healthと既知のsidecar child processから、`stopped`、`starting`、`running`、`port-conflict`、`unhealthy`のlifecycle状態を判定し、二重起動を避けるstart planと既知のchildだけを対象にするstop planを生成できる。
- macOS向けにHono server sidecar用LaunchAgentのplist model、plist XML、保存先pathを生成できる。
- macOS向けLaunchAgentの現在plistをexpected plistと比較し、作成、更新、削除、変更なしの操作planを副作用なしで生成できる。
- Windows向けにTauri autostart pluginの有効状態から、ログイン時起動の有効化、無効化、変更なしの操作planと必要permissionを副作用なしで生成できる。
- desktop managerは現在起動中のserverからsetup statusを取得し、初期setup requestを送信して、responseを共有contractで検証できる。送信先は現在のserver port、保存対象はsetup draftの新しいportとして分離する。
- sidecar起動、既知child停止、browser URL open、LaunchAgent plist読取・書込・削除、Windows autostart状態確認・切替を、注入されたTauriまたはOS adapter経由で実行する操作層を提供する。
- 操作planが変更なしの場合はadapterを呼ばず、sidecar起動結果のPIDが正の整数でなければmanaged childとして保持しない。
- `apps/desktop`の共有planning・operation codeはNode.js runtime APIへ依存せず、Tauri WebView bundleから利用できる。
- Tauri pluginの実runtime adapterはsidecar child handleを保持し、生成元が既知のprocessだけを停止する。
- Tauri Rust commandはnative path解決、config読取、macOS LaunchAgent plistのatomic更新、`launchctl`登録・解除を行う。
- desktop manager UIはserver状態、初期account、data directory、複数collection root、network、thumbnail、自動起動を単一画面で管理する。
- Windowsではmanager起動時に停止中のsidecarを起動し、autostartを有効にした場合も同じ起動経路を使う。
- 初期setupとcollection root追加は、collection root配下へdatabase、thumbnail、logを置くdata directory構成を拒否する。
- server package、Nuxt静的assets、PDF.js resources、libarchive WASM、native addonをEnhanced SEAへ収録するasset宣言を持つ。
- Tauri `externalBin`とshell capabilityは`binaries/bookcafe-server`という固定名でsidecarへ接続する。
- Tauri bundleは`dev.bookcafe.desktop`をidentifierに使い、共通SVGから生成したmacOS、Windows、PNG iconを収録する。
- desktop UIが利用するWebView/CSS機能に合わせ、macOS bundleの最低対応版を13.0とする。
- 実binaryの生成、native addonとWASMのsmoke test、Tauri bundleの検証は配布前にbuild hostごとに実行する。

## Desktop sidecarのbuild

sidecarはbuild hostと同じOS・CPU向けに生成する。Enhanced SEAとnative addonのABIを合わせるため、repositoryで指定したNode.js 24.xとRust toolchainを必要とする。Node.js 24以外ではbuildを拒否する。

```sh
pnpm --filter @bookcafe/app sidecar:build
pnpm --filter @bookcafe/app tauri:dev
pnpm --filter @bookcafe/app tauri:build
```

`sidecar:build`は共有package、Nuxt静的assets、Hono serverを先にbuildする。次に`pnpm deploy --prod --legacy`で隔離したstaging treeを作り、pnpm virtual storeのpackage linkをstaging内だけで実体化してからEnhanced SEAへ収録する。source workspaceのpnpm stateは退避・復元し、staging treeはbuildの成否にかかわらず削除する。

生成するbinaryは`rustc -vV`のhost tripleを名前に持ち、`apps/desktop/src-tauri/binaries/`へ配置する。このdirectoryは生成物としてGit管理しない。配布前には実binaryで初期設定と認証を行い、画像フォルダー、7z、PDFのscan、page配信、thumbnail配信を確認する。macOSでは`cargo test`、`cargo clippy -- -D warnings`、`.app`/DMG生成、DMG checksum、LaunchAgentの登録・解除も確認する。

## 常駐化・自動起動の初期方針

- macOSでは`launchd`を使い、Tauri desktop appからLaunchAgentまたはservice設定を扱う。
- macOSの自動起動対象はdesktop app本体ではなく、Hono server sidecarを優先候補にする。
- Windowsではservice化を扱わない。
- WindowsではTauri desktop appにログイン時起動オプションを提供する。
- Windowsの自動起動対象はTauri desktop app本体にする。
- WindowsではTauri desktop app起動後にHono serverを起動し、desktop appが動作している間にサービスを提供する。
- Tauri desktop appはOS別の自動起動設定の作成、削除、現在状態の確認を行う。
- Linuxではdesktop appによるdaemon設定は扱わない。
- Linuxでは設定ファイルを編集してserverを直接起動する運用を標準にする。
- Linuxのdaemon化は利用者が`systemd`などで自分で設定する。

## 対応する本の入力フォーマット

以下のformatはすべて実装対象にする。ただし、実装順序と利用するライブラリまたは外部ツールは形式ごとの調査spikeで決める。

- 画像ファイルがそのまま入っているフォルダー。
- 各種圧縮ファイル。
- PDF。
- EPUB。
- ロックのかかっていない電子書籍ファイル。

DRMやロックの解除は扱わない。読めない保護付きファイルは未対応として扱う。

実装順序は`画像フォルダー -> zip/cbz -> PDF -> EPUB -> rar/cbr/7z -> その他`を基本にする。

実装済みのformat対応:

- 画像フォルダーを自然順ソートしたページ一覧として検出できる。
- `zip` / `cbz`内の画像entryを自然順ソートしたページ一覧として検出できる。
- PDFのページ数とページサイズを取得し、ページ画像をPNGとして返せる。
- 破損したXRefを持つPDFは該当候補をerrorとして扱い、PDF.jsのsecondary rejectionでserver processを落とさない。
- EPUBのspineと基本metadataを解析し、初期実装の固定viewport画像として返せる。
- `rar` / `cbr` / `7z`内の画像entryをlibarchive-backed adapterで検出できる。
- 拡張子がないファイルでも、対応できる範囲でmagic numberからformatを判定できる。

## 本データの解析方針

- 入力元はフォルダーまたはファイルとして登録する。
- 拡張子だけに依存せず、可能な範囲でmagic numberやmetadataを見てformatを判定する。
- formatごとにadapterを用意し、共通の`BookSource`、`PageAsset`、`Metadata`へ変換する。
- 画像フォルダーや画像だけの圧縮ファイルは、自然順ソートした画像一覧をページとして扱う。
- PDF、EPUB、その他の電子書籍ファイルは、解析または変換によってページ画像を生成・抽出する。
- 解析に必要な処理は、既存ライブラリまたは外部ツールが利用できる場合はそれを優先する。
- 必要なツールがない形式は、自前実装する前に形式ごとの調査spikeを行う。
- frontendには元形式ではなく、Hono APIから画像、サムネイル、ページ数、metadataを返す。
- 初期実装ではpreview画像や変換済みページ画像を保存せず、必要になるまで元画像またはformat adapterの出力画像をそのまま返す。

## コレクションフォルダーのスキャン方針

- ユーザーが指定した複数のフォルダーをコレクションルートとして扱う。
- コレクションルートごとに個別スキャンできる。
- Web UIから全コレクションルートのスキャンjobをまとめて投入できる。
- serverは指定されたコレクションルート配下を走査し、本として認識できるファイルまたはフォルダーを検出する。
- 全コレクションルートをまとめてスキャンする操作は、登録済みrootごとに独立した`scan-collection-root` jobを作成する。
- 検出した本はSQLite databaseに登録する。
- 既に登録済みの本は、初期実装では`path + size + mtime`で同一性と更新有無を判定する。
- hash計算は必要になった場合だけ追加する。
- 削除された本、移動された本、読み取り不能になった本のDB状態更新は、ユーザー操作によるスキャン時だけ行う。
- ファイル移動・リネームは初期実装では同じ本として追跡せず、旧pathはアクセス不能または削除扱い、新pathは新しい本として扱う。
- スキャンは常にユーザー操作で開始する。
- 自動で別のコレクションルートをついでにスキャンしない。
- ファイル監視、自動差分スキャン、自動サブスキャンは行わない。
- 閲覧時に元ファイルへアクセスできない場合、serverは自動スキャンやDB更新を行わず、frontendがマイクロインタラクションとして表示できるエラーだけ返す。

実装済みのコレクションスキャン関連機能:

- Library画面からcollection rootを登録できる。
- Library画面と設定画面から、スキャン済み本が紐づいていないcollection rootを削除できる。
- スキャン済み本が紐づいているcollection rootの削除は409として拒否し、元ファイルや既存metadataを暗黙に削除しない。
- Library画面から個別collection rootのscan jobを投入できる。
- Library画面から全collection rootのscan jobをまとめて投入できる。
- Library画面でbackground jobの状態、進捗、対象pathを確認できる。
- 完了したscan jobは検出冊数とmissing化した冊数をpayloadに残し、Library画面のJobsで確認できる。
- 実行中jobがある間だけjob状態を自動更新し、完了後に本一覧を更新できる。
- collection root登録時に、実在する読み取り可能なdirectoryだけを受け付ける。
- scannerはdotfile、dot directory、AppleDouble、`__MACOSX`、`Thumbs.db`、`desktop.ini`を本候補やページ候補から除外する。
- scannerは外部ボリューム上の大きいコレクションでも過剰な並列I/OやPDF解析を起こしにくいよう、scan単位で並行数を制限できる。
- scan時に`path + size + mtime`から作るfingerprintをSQLiteへ保存する。
- 同一pathの本を再スキャンした場合はページ一覧、ページ数、format、size、mtime、fingerprintをscan結果で更新する。
- 同一pathの再スキャンでは、手動編集済みmetadataとcurrent pageを保持する。
- 再スキャンでページ数が減った場合、current pageは新しいページ数の範囲内へ丸める。
- Library、詳細、Reader画面で`missing`、`error`、`scanning`のsource状態を説明付きで表示する。
- 読めない本のReadリンクは`aria-disabled`付きで到達可能にしつつ、readerへの遷移を抑止する。
- Reader画面では読めないsource状態のとき、ページ移動、jump、zoom、wheel、pinch操作を停止する。

## SQLiteに保存する情報の初期案

- コレクションルート一覧。
- 本が属するコレクションルート。
- 本の元ファイルまたは元フォルダーのパス。
- format種別。
- 認識状態。
- ページ数。
- タイトル、著者、出版社、ISBNなど、抽出できたmetadata。
- 表紙ページまたは代表ページ。
- 読書状態としてのcurrent page。
- サムネイル保存を有効にした場合のthumbnail path。
- 元ファイルのmtime、size、fingerprintなどの再解析判定用情報。
- 最終スキャン日時、最終解析日時。

元ファイルやサムネイル画像そのものはSQLiteに直接保存せず、DBにはファイル参照とmetadataを保存する。

## サムネイル方針

- サムネイル生成・保存はユーザーオプションにする。
- サムネイルを保存する場合、アプリが管理するデータフォルダー配下に小さな画像として保存する。
- サムネイルの保存先はコレクションルートとは分ける。
- SQLite databaseにはthumbnail path、生成日時、元になったページ番号、画像サイズを保存する。
- サムネイルには容量上限や手動削除UIを設けない。
- サムネイル生成を無効にした場合、serverは一覧表示のためのオンデマンド生成を行わない。
- サムネイルがない本は、frontendでplaceholderまたはサムネイルなし表示にする。
- サムネイル生成が有効で、ユーザー操作によるスキャンで元ファイル更新を検出した場合、既存サムネイルは再生成対象にする。
- サムネイルが無効で、かつ元ファイルへアクセスできない場合も、serverは自動復旧や自動スキャンを行わず、frontendに表示用エラーを返す。

実装済みのサムネイル関連機能:

- configはthumbnail保存の有効・無効を保持し、未指定の既存configでは有効を既定値にする。
- 初回setup APIとWeb setup画面で、thumbnail保存の有効・無効を設定できる。
- 認証済みsettings APIとWeb setup画面で、初期設定後のthumbnail保存設定を変更できる。
- thumbnail保存が無効な場合、scan jobはthumbnail生成をスキップする。
- サムネイルがある本はライブラリ一覧で保存済みthumbnailを表示する。
- サムネイルがない本は、タイトルから作った短い印字、format、page countを持つ固定比率のplaceholder coverを表示する。
- cover画像リンクには読書画面へ移動するためのaccessible nameを付ける。
- thumbnail保存を無効にした後の再スキャンでも、既に保存済みのthumbnail参照は保持する。

## 将来検討事項: preview image optimization

大きすぎる画像をserver側で適切な表示サイズへ変換し、快適なpreview体験を提供する機能は便利そうだが、保存先や容量管理の検討事項が多いため、初期実装では行わない。

- 大きな画像を表示用サイズへ縮小し、preview用画像として提供する。
- 初期実装ではpreview画像を保存しない。
- 将来実装する場合も、thumbnailとは別機能として扱う。
- 将来保存する場合は、preview画像のサイズ、format、quality、DPI、ページ単位保存粒度を決める必要がある。
- 初期実装では、必要になるまで元画像またはformat adapterの出力画像をそのまま返す。
- 初期実装ではpreview cache、cache容量上限、手動cache削除UIは持たない。

## 検討事項: Web UI upload

Web UIから画像コレクションや本ファイルをアップロードして登録する機能は便利そうだが、保存先、容量、セキュリティ、既存のフォルダースキャンとの関係を決める必要があるため、現時点では確定機能にしない。

- Web UIから画像フォルダー相当の複数画像、圧縮ファイル、PDF、EPUBなどをアップロードできるようにする案。
- アップロードした元ファイルをアプリ管理下のstorageに保存するか、ユーザー指定のコレクションルートへ配置するかを決める必要がある。
- アップロードされた本を通常のスキャン結果と同じDB schemaで扱うか、upload由来として別管理するかを決める必要がある。
- 大きなファイルや複数ファイルアップロードに対して、容量上限、進捗表示、中断、再試行、失敗時の掃除が必要になる。
- アップロードを許可する場合、認証、CSRF、Content-Type検証、拡張子偽装、zip bomb対策、path traversal対策が必要になる。
- ローカル利用前提でも、serverをLANや外部に公開する可能性があるため、upload機能は初期状態で無効にする案も候補にする。

## 検討事項: metadata edit and file rename

Web UI上で本のタイトル、作者などのmetadataを編集したとき、実際のファイル名またはフォルダー名も変更するかどうかは検討事項にする。

初期実装では、metadata編集はSQLite database上の情報更新だけに留め、実ファイル名またはフォルダー名は変更しない。
手動編集済みのタイトルと作者は、同一pathの再スキャンでは上書きしない。
読書状態は`unread`、`reading`、`finished`の3状態で始める。
タグ、出版社、ISBN、購入日、メモはSQLite上の任意metadataとして扱う。

実装済みのmetadata編集関連機能:

- 本の詳細画面でタイトル、作者、出版社、ISBN、購入日、読書状態、タグ、メモを編集できる。
- Library画面で読書状態による本一覧の絞り込みができる。
- Library画面で本の状態（ready、missing、error、scanning）による本一覧の絞り込みができる。
- metadata編集はSQLite database上の情報更新だけに留め、実ファイル名またはフォルダー名は変更しない。
- 手動編集済みのタイトルと作者は、同一pathの再スキャンでは上書きしない。
- metadata保存に失敗した場合、APIが返した具体的なエラーメッセージを画面に表示する。

- metadata編集はSQLite database上の情報更新だけに留める案。
- metadata編集に合わせて、元ファイル名または元フォルダー名もリネームする案。
- リネームする場合、ユーザーに明示確認を出す必要がある。
- ファイル名に使えない文字、OSごとの予約名、文字コード、拡張子維持、同名衝突への対応が必要になる。
- リネームに失敗した場合、DB更新だけ成功した状態を許すか、全体をrollbackするかを決める必要がある。
- リネーム後はDB上のpath、thumbnail pathとの参照整合性を更新する必要がある。
- 複数コレクションルートや外付けディスク上のファイルでは、権限、マウント状態、移動不可状態を考慮する必要がある。
- 初期実装では、metadata編集はDBだけ更新し、実ファイル名変更は行わない方針も候補にする。

## 検索方針

初期実装はSQLiteの`LIKE`検索で始める。
必要になったらSQLite FTSへ移行する。

実装済みの検索関連機能:

- `GET /api/books?q=...`で本一覧を検索できる。
- Library画面で検索語、読書状態、本の状態を組み合わせて絞り込める。
- 検索条件はroute queryに保存し、reloadや共有URLで同じ一覧状態を復元できる。
- 検索結果件数と有効な検索条件をLibrary画面に表示する。
- 永続化済み本の検索対象はtitle、author metadata、source path、tagにする。
- sample library fallbackではtitle、author、format、book status、reading status、tagを検索対象にする。

## import/export方針

初期実装では、まずJSON exportを提供する。
importは、上書き範囲、衝突時の扱い、source pathが存在しない場合の扱いを決めてから追加する。

JSON exportは`schemaVersion: 1`、`exportedAt`、`collectionRoots`、`books`を含む。
`books`には既存のbook detailと同じ範囲のmetadataを入れる。
具体的には、title、authors、format、status、reading status、tags、page count、current page、thumbnail URL、source path、reading direction、publisher、ISBN、purchase date、notesを含める。

実装済みのimport/export関連機能:

- `GET /api/library/export`で認証済みlibrary metadataをJSONとして取得できる。
- export responseには`Content-Disposition: attachment`と`Cache-Control: no-store`を付与する。
- Library画面からJSON exportを実行し、`bookcafe-library-YYYYMMDDTHHMMSSZ.json`として保存できる。
- export対象はSQLiteに永続化済みのcollection rootとbook metadataに限定する。
- 元画像、サムネイル画像、PDF、EPUB、archive本体はexport JSONに含めない。

## format adapter案

| 入力               | adapterの責務                                                      | frontendへの提供                           |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------ |
| 画像フォルダー     | 対象画像の列挙、自然順ソート、metadata抽出                         | 元画像または変換済み画像                   |
| 圧縮ファイル       | archive展開またはstream読み込み、画像抽出、順序決定                | 抽出画像                                   |
| PDF                | ページ数取得、各ページの画像化、サムネイル生成                     | ページ画像                                 |
| EPUB               | spine/manifest解析、metadata抽出、ページ画像化または表示用画像生成 | ページ画像または固定viewportで生成した画像 |
| ロックなし電子書籍 | 形式判定、利用可能なparser/toolで画像化                            | ページ画像                                 |

EPUBはreflowable formatのため、どのviewport・フォント・余白で画像化するかを別途決める必要がある。

## 残る主な検討事項

- 本のデータ項目: タイトル、著者、出版社、ISBN、購入日、読了状態、タグ、メモ、表紙画像など。
- 表紙画像の扱い: 外部URL参照、ローカル保存、アップロード対応のどれにするか。
- import: JSON、CSV、ISBNリストなど、初期投入方法をどうするか。
- server processの監視方法、異常終了時の復旧方針。
- WindowsでTauri desktop appを閉じたときの扱い: serverも停止するか、tray常駐で継続するか。
- Windowsログイン時起動のUI: 初期設定時に有効化するか、後から設定画面で切り替えるか。
- Linux向けドキュメント: 設定ファイル例、server起動コマンド例、`systemd` unit例をどこまで同梱するか。
- 対応するロックなし電子書籍形式: EPUB以外に何を初期対応するか。
- PDF/EPUB/電子書籍の画像化に使うライブラリまたは外部ツール。
- Web UI uploadを実装するか。
- uploadされた元ファイルの保存先、容量上限、削除方針。
- upload機能を初期状態で有効にするか、明示的な設定で有効化するか。
- metadata編集時に実ファイル名またはフォルダー名も変更するか。
- 実ファイル名変更を行う場合の確認UI、命名ルール、失敗時rollback方針。
- EPUBを画像化する場合のviewport、font、theme、ページ分割ルール。

## 参照した資料

- [Similar OSS Research](./similar-oss-research.md)
- pnpm workspace: https://pnpm.io/workspaces
- pnpm workspace config: https://pnpm.io/pnpm-workspace_yaml
- Hono docs: https://hono.dev/docs
- Hono Node.js getting started: https://hono.dev/docs/getting-started/nodejs
- Better Auth docs: https://www.better-auth.com/docs
- Better Auth Hono integration: https://www.better-auth.com/docs/integrations/hono
- Better Auth username plugin: https://www.better-auth.com/docs/plugins/username
- Nuxt 4 docs: https://nuxt.com/docs/4.x
- Nuxt `useFetch`: https://nuxt.com/docs/4.x/api/composables/use-fetch
- Nuxt prerendering: https://nuxt.com/docs/4.x/getting-started/prerendering
- Nuxt deployment: https://nuxt.com/docs/4.x/getting-started/deployment
- Nuxt rendering: https://nuxt.com/docs/4.x/guide/concepts/rendering
- VueUse docs: https://vueuse.org/
- PDF.js examples: https://mozilla.github.io/pdf.js/examples/
- PDF.js API: https://mozilla.github.io/pdf.js/api/
- PhotoSwipe docs: https://photoswipe.com/
- OpenSeadragon: https://openseadragon.github.io/
- Komga repository: https://github.com/gotson/komga
- Kavita repository: https://github.com/Kareadita/Kavita
- Modern Web Guidance: https://github.com/GoogleChrome/modern-web-guidance
- Drizzle SQLite overview: https://orm.drizzle.team/docs/get-started/sqlite-new
- Drizzle config file: https://orm.drizzle.team/docs/drizzle-config-file
- p-queue: https://github.com/sindresorhus/p-queue
- Tauri v2 docs: https://v2.tauri.app/
- Tauri sidecar docs: https://v2.tauri.app/develop/sidecar/
- Tauri autostart plugin docs: https://v2.tauri.app/plugin/autostart/
