# PrimeVue Shelfmark UI設計

## 対象と目的

本設計は、BookCafeのDesktop ManagerとWeb Libraryの表示層をPrimeVue 4で再構築する。

Desktop Managerはローカルサーバーの状態確認、初期設定、自動起動を扱う操作卓とする。

Web Libraryは蔵書の検索、管理、読書再開を扱う書架とする。

両アプリは同じデザイントークンと状態表現を共有するが、役割の異なる画面を同じレイアウトへ揃えない。

画面内の文言は日本語へ統一する。

コード、コマンド、URL、パス、API名、技術的な識別子は原文を維持し、利用者向けのラベルと説明だけを日本語化する。

サーバー由来のエラー詳細を表示する場合は、日本語の復旧手順を先に示し、原文を診断情報として分離する。

## 対象範囲

再構築の対象は次の表示層である。

- Desktop Managerのアプリシェル、サーバー状態、初期設定、自動起動、エラー表示
- Web Libraryのアプリシェル、ナビゲーション、ログイン、セットアップ、蔵書一覧、コレクション、ジョブ、書籍詳細
- Web Readerの操作バー、設定パネル、進捗表示、エラー表示

既存のAPI、認証、Desktop controller、Tauriコマンド、サーバー起動処理、読書本文の描画、ジェスチャー、ページ進捗の保存方法は変更しない。

バックエンドの契約変更と新機能の追加は対象外とする。

## デザイン方針

デザイン名称は**Shelfmark**とする。

Shelfmarkは冷たい鉱物色の面、濃い棚色のナビゲーション、インクブルーの主要操作、コーラルの背表紙を組み合わせる。

画面の装飾を増やすのではなく、情報階層、余白、文字の強弱、状態色によって操作の優先順位を示す。

### カラートークン

- **Deep Shelf**：`#17353C`。ナビゲーションと強い文字色に使う。
- **Fog**：`#EEF2F2`。アプリ背景に使う。
- **Paper**：`#F7F9F8`。読書画面以外の主要面に使う。
- **Ink Blue**：`#3159A8`。主要操作と選択状態に使う。
- **Spine Coral**：`#F26F4F`。注意を要する状態と署名要素に使う。
- **Patina**：`#75A59B`。完了、安定、補助状態に使う。

文字色、境界色、危険色、警告色、暗色面は上記トークンから派生させ、Web Content Accessibility Guidelinesのコントラスト要件を満たす値へ調整する。

### タイポグラフィ

追加のWebフォント依存は導入しない。

見出しは`Avenir Next`、`Hiragino Sans`、`Yu Gothic UI`、`system-ui`の順で使用し、太いウェイトと詰めた字間で階層を示す。

本文は`Inter`、`Hiragino Sans`、`Noto Sans JP`、`system-ui`の順で使用する。

ポート、パス、ジョブ識別子などのデータは`ui-monospace`を使用する。

### 署名要素

Shelfmarkの署名要素は、カード左端に置く**状態を語る背表紙**である。

背表紙は書籍の読書状態、ジョブの進行、サーバーの稼働状態を同じ規則で示す。

色だけに情報を依存させず、ラベル、アイコン、本文を併記する。

動きはサーバー状態の遷移、Drawerの開閉、Toastの出現に限定する。

`prefers-reduced-motion: reduce`では、状態理解に不要なアニメーションを停止する。

## PrimeVueの構成

両アプリへ`primevue`、`@primeuix/themes`、`primeicons`を追加する。

WebにはNuxt統合のため`@primevue/nuxt-module`を追加する。

`packages/ui`を新設し、ShelfmarkのPrimeVueテーマプリセット、共有トークン、状態トーンの対応表を配置する。

アプリ固有のコンポーネントは共有パッケージへ移さない。

DesktopとWebは`packages/ui`から同じテーマを読み込み、各アプリのエントリーポイントでPrimeVueを初期化する。

PrimeVue固有の型は表示層に閉じ込め、controller、composable、API contractへ渡さない。

## Desktop Manager

Desktop Managerは固定サイドレールと単一のメイン領域を持つ。

サイドレールはBookCafeの識別、サーバーの稼働状態、エンドポイント、主要操作への移動を担う。

メイン領域は概要、初期設定、自動起動の順に配置し、現在必要な操作を先頭へ出す。

既存の巨大なルートコンポーネントは次の単位へ分割する。

- **DesktopShell**：ランドマーク、全体レイアウト、スキップリンクを持つ。
- **ServerStatusRail**：サーバー状態、エンドポイント、開始、停止、Webを開く操作を持つ。
- **ServerOverview**：サーバー、セットアップ、自動起動の要約を持つ。
- **SetupPanel**：データ保存先、接続、認証のフォームを持つ。
- **StartupPanel**：macOSとWindowsの自動起動状態を持つ。
- **ErrorSummary**：操作失敗とフィールドエラーをまとめ、該当入力への移動を提供する。

Desktop ManagerではPrimeVueの`Button`、`Card`、`Fieldset`、`InputText`、`InputNumber`、`Password`、`RadioButton`、`ToggleSwitch`、`Tag`、`Message`、`Toast`、`Divider`を中心に使う。

OSの明暗設定に連動する既存のダークモードは保持する。

レイアウトはTauriウィンドウの最小幅`760px`で情報と操作が欠落しないようにする。

## Web Library

Web Libraryは上部バー、常設サイドバー、メイン領域を持つ。

上部バーはブランド、現在の利用者、ログアウトだけを扱う。

サイドバーはライブラリ、読書中、コレクション、ジョブ、セットアップへの移動を扱う。

狭い画面では常設サイドバーを隠し、同じナビゲーションをPrimeVueの`Drawer`で表示する。

蔵書一覧は「続きを読む」、検索と絞り込み、蔵書カードの順に配置する。

カードは表紙、タイトル、読書進捗、利用可否、主要操作を表示し、背表紙で状態を補助する。

ログイン、セットアップ、書籍詳細、コレクション、ジョブは同じフォーム、メッセージ、アクションの規則を使用する。

Web LibraryではPrimeVueの`Button`、`Drawer`、`Menu`、`Avatar`、`Card`、`DataView`、`InputText`、`Select`、`SelectButton`、`Checkbox`、`Password`、`Tag`、`Message`、`Toast`、`Skeleton`、`Dialog`を中心に使う。

Webの明色シェルはShelfmarkのPaperとFogを使用する。

レイアウトは`320px`からデスクトップ幅まで対応する。

## Web Reader

本文表示領域は暗色で静かな既存の読書キャンバスを保持する。

PrimeVueへ置き換える範囲は操作バー、ページ移動、表示モード、読書方向、ズーム、設定Drawer、進捗保存エラーである。

読書中はアプリ全体のサイドバーを表示しない。

操作バーは既定で画面を占有しすぎず、キーボード、タッチ、マウスによる既存操作を妨げない。

現在ページの保存失敗は消えるToastだけで通知せず、読書を続けながら確認できるMessageを表示する。

## 状態とデータの流れ

既存のcontrollerとcomposableがアプリケーション状態を保持する。

各画面はcomputed値で状態を表示用モデルへ変換し、そのモデルをPrimeVueコンポーネントのpropsへ渡す。

利用者の操作はコンポーネントのemitから既存のcontrollerまたはcomposableへ戻す。

表示用モデルはラベル、tone、disabled、busy、補助説明を持ち、テンプレート内の複雑な条件分岐を減らす。

状態色の決定は純粋関数へ分離し、DesktopとWebで同じ意味の状態が異なる色にならないようにする。

## 読み込み、空表示、エラー

初期読み込みには`Skeleton`または進行表示を使い、読み込み前の空表示と区別する。

蔵書が空の場合は、コレクションの追加またはスキャン開始を次の操作として示す。

ジョブが空の場合は、何も実行されていないこととジョブが作成される条件を示す。

操作成功には短い`Toast`を使用する。

入力修正または再試行が必要な失敗には、消えない`Message`とフィールド直下の説明を使用する。

フォーム送信に失敗した場合はエラー概要へフォーカスを移し、各入力の`aria-describedby`と`aria-invalid`を更新する。

既存の入力を黙って既定値へ置き換えるfallbackは追加しない。

## アクセシビリティ

Webの文書言語は`ja`とする。

DesktopとWebは`header`、`nav`、`main`、`aside`を用途に合わせて使い、メイン領域へのスキップリンクを提供する。

アイコンだけのボタンには操作を表す日本語のアクセシブルネームを付ける。

フォーカス表示は背景とのコントラストを確保し、マウス操作時だけを理由に削除しない。

主要な操作領域はおおむね`44px`を確保する。

キーボード操作、DrawerとDialogのフォーカス管理、Escapeによる閉鎖、読書ショートカットを実操作で検証する。

状態は色だけで示さず、文字またはアイコンを併記する。

## テストと検証

実装は既存のテストを保持し、表示状態を決める純粋関数のテストから始める。

テーマトークン、状態トーン、ナビゲーション選択、エラー表示モデルのテストを追加する。

対象アプリごとに`test`、`typecheck`を実行し、リポジトリの`lint`と`format`を実行する。

WebはPlaywrightでデスクトップ幅とモバイル幅を操作し、ナビゲーション、検索、フォーム、Drawer、Readerの主要操作を確認する。

DesktopはTauri開発ウィンドウまたはVite上の表示で、最小幅、入力、状態遷移、フォーカスを確認する。

実装後は最新のWeb Interface Guidelinesに照らして対象ファイルを監査する。

最終報告前に`ui_flow_auditor`が実画面のresponsive、accessibility、console、networkを確認し、`qa_closer`が要件、差分、回帰、検証結果を独立確認する。

## 受け入れ条件

- DesktopとWebが同じShelfmarkテーマを使用している。
- DesktopとWebの画面文言が日本語で統一されている。
- 既存のサーバー管理、認証、蔵書管理、読書機能が維持されている。
- Desktopの最小幅`760px`で横方向の欠落がない。
- Webの`320px`幅で主要操作へ到達できる。
- Web Readerの本文表示領域と既存ジェスチャーが維持されている。
- 読み込み、空表示、成功、失敗にそれぞれ区別できる表示がある。
- キーボードでナビゲーション、フォーム、Drawer、Dialog、Readerを操作できる。
- `prefers-reduced-motion`で不要なアニメーションが停止する。
- 対象テスト、typecheck、lint、formatが成功する。
- Playwright実操作、Web Interface Guidelines監査、独立検証で重大な未解決事項がない。
