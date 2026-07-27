# ユーザー存在による初期化状態判定の設計

## 対象と目的

本設計は、BookCafeの初期セットアップ完了状態を設定ファイルの`setupComplete`から判定する方式を廃止し、Better Authのユーザーが作成済みである事実から判定する方式へ変更する。

設定ファイルとSQLiteの状態が食い違うことで、作成済みのユーザーを再作成しようとして`POST /api/setup/initial-user`が`500 Internal Server Error`になる問題を解消する。

既存のデータベースを指定した場合は、保存済みの認証情報によって利用権限を確認してから採用する。

データベースの破損や読み取り失敗を未初期化として扱わず、第三者が新しい管理者を作成できる状態へ遷移させない。

## 対象範囲

対象は次の機能である。

- アプリケーション設定からの`setupComplete`削除
- SQLite内のBetter Authユーザーによる初期化状態判定
- 初期ユーザー作成APIの処理順序とエラー応答
- 既存データベース採用時の認証
- 未初期化時の待受アドレスと初期セットアップAPIの接続元制限
- Desktop ManagerとWebのセットアップ状態表示
- 旧設定ファイルの無破壊移行

蔵書、コレクション、読書進捗、サムネイル、ライブラリスキャンのデータモデルは変更しない。

Better Authの`user`と`account`テーブル構造も本変更では変更しない。

## 状態モデル

サーバー内部では、初期化状態を次の三状態として扱う。

```ts
type InitializationState =
  | { status: "uninitialized" }
  | { status: "initialized" }
  | { status: "unavailable"; cause: unknown };
```

各状態の判定条件は次のとおりとする。

| 状態                | 条件                                                                     | 利用者に許可する操作               |
| ------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| **`uninitialized`** | DBファイルがない、Better Authの`user`テーブルがない、またはユーザーが0件 | loopback接続からの初期セットアップ |
| **`initialized`**   | Better Authの`user`テーブルに1件以上存在する                             | ログインと通常の認証済みAPI        |
| **`unavailable`**   | DBを開けない、クエリできない、またはスキーマが破損している               | 復旧に必要な状態確認だけ           |

`unavailable`を`uninitialized`へ変換するfallbackは設けない。

ユーザーにcredential accountがない場合も`initialized`と判定する。

この場合に初期ユーザーの再作成を許可するより、管理者によるデータ復旧を要求する方が安全である。

## 初期化状態リーダー

初期化状態の判定はサーバー内の一つのモジュールへ集約する。

このモジュールだけがBetter Authの`user`テーブルを直接参照し、ルートやミドルウェアからスキーマ詳細を隠蔽する。

公開する関数は、設定済みの`dataDir`または明示的なSQLiteパスを受け取り、`InitializationState`を返す境界関数とする。

SQLiteのopen、query、closeという副作用は、この関数を持つモジュール内に閉じ込める。

関数とモジュールには、責務と失敗条件を示すTSDocを付ける。

判定手順は次のとおりとする。

1. 設定からSQLiteパスを解決する。
2. DBファイルが存在しなければ`uninitialized`を返す。
3. SQLiteを読み取り目的で開く。
4. Better Authの`user`テーブルの有無を確認する。
5. テーブルがなければ`uninitialized`を返す。
6. ユーザー件数が1件以上なら`initialized`、0件なら`uninitialized`を返す。
7. SQLiteのopen、prepare、queryに失敗した場合は`unavailable`を返す。
8. 開いた接続を必ず閉じる。

エラー原因はサーバーログへ記録するが、APIレスポンスにはファイルパス、SQL、スタックトレースを含めない。

状態はDBの事実を反映する必要があるため、セットアップ処理中は再読込する。

通常のリクエストで必要になる最適化は、実測後に導入する。

## 設定モデル

`AppConfig`、既定設定、DesktopのRust側`ServerConfig`から`setupComplete`を削除する。

設定ファイルは次の種類の値だけを保持する。

- `dataDir`
- `host`
- `port`
- thumbnail設定
- その他の実行設定

初期化完了状態は保持しない。

旧`config.json`に`setupComplete`が存在しても読み込みエラーにはしない。

スキーマのparse時に未知フィールドとして無視し、次回の設定保存時に書き戻さない。

旧値が`true`か`false`かにかかわらず、実際のユーザー件数を優先する。

## セットアップ状態API

`GET /api/setup/status`は初期化状態リーダーを使用する。

既存クライアントとの互換性を保つため、レスポンスの`setupComplete`は当面維持する。

ただし、この値は保存済みフラグではなく、`status === "initialized"`から算出する。

`unavailable`の場合は`503 DATA_UNAVAILABLE`を返し、`setupComplete: false`とは返さない。

将来`setupComplete`を`initialized`へ改名する場合は、別のAPI契約変更として扱う。

## 初期ユーザー作成

`POST /api/setup/initial-user`はサーバープロセス内で直列化する。

ロックを取得した後に現在の設定先と入力された対象先を再確認し、並行リクエストによる二重作成を防ぐ。

新規データベースに対する処理順序は次のとおりとする。

1. 接続元がloopbackであることを確認する。
2. request bodyを検証する。
3. 現在の初期化状態を再取得する。
4. 対象`dataDir`の初期化状態を取得する。
5. 対象が未初期化なら、保存先と実行設定を保存する。
6. BookCafeとBetter Authのmigrationを実行する。
7. 初期設定と必要なルート情報を保存する。
8. Better Authで初期ユーザーを最後に作成する。
9. 初期化状態を再取得し、`initialized`になったことを確認する。
10. `201`を返す。

ユーザー作成を最後のcommit markerとする。

それ以前に処理が失敗した場合、ユーザーは存在せず、次のリクエストで安全に再試行できる。

ユーザー作成後の確認に失敗した場合は成功として扱わず、原因をログへ記録して`500 INTERNAL_ERROR`を返す。

後続の並行リクエストは、ロック内の再判定によって`409 ALREADY_INITIALIZED`を返す。

## 既存データベースの採用

入力された`dataDir`に1件以上のユーザーが存在する場合は、新しいユーザーを作成しない。

対象データベース用のBetter Authインスタンスを一時的に構成し、入力されたusername/passwordで`auth.api.signInUsername`を実行する。

認証が成功するまで、現在の`config.json`は変更しない。

処理順序は次のとおりとする。

1. 対象DBを読み取り、`initialized`であることを確認する。
2. 対象DBへ接続するBetter Authを構成する。
3. 入力されたusername/passwordで認証する。
4. 認証成功後に必要な互換migrationを実行する。
5. migration成功後に対象`dataDir`と実行設定を保存する。
6. `200`を返す。

認証に失敗した場合は`401 INVALID_CREDENTIALS`を返す。

usernameの存在有無はレスポンスで区別しない。

認証失敗時は設定、ユーザー、DBを変更しない。

対象DBが現在のBetter Authで認証できないスキーマの場合は、所有確認前のmigrationを行わず`503 DATA_UNAVAILABLE`を返す。

## 接続元と待受アドレス

初期ユーザー作成APIは実際の接続元がloopbackの場合だけ許可する。

`@hono/node-server/conninfo`の`getConnInfo(c).remote.address`を使用し、次を許可する。

- IPv4の`127.0.0.0/8`
- IPv6の`::1`
- IPv4-mapped IPv6のloopback

`Origin`、`Host`、`X-Forwarded-For`など、クライアントが送信できるHTTP headerは接続元判定に使用しない。

未初期化時は、設定の`host`が`0.0.0.0`やLANアドレスでも、サーバーの実効待受先を`127.0.0.1`へ強制する。

初期化済みの場合だけ設定された`host`を使用する。

Linuxで別端末から初期セットアップする場合は、SSH port forwardingなどによってサーバーからloopback接続として扱われる経路を利用する。

## APIの認証境界

APIルートは初期化状態によって次のように振る舞う。

| API             | `uninitialized`      | `initialized`     | `unavailable` |
| --------------- | -------------------- | ----------------- | ------------- |
| health          | 許可                 | 許可              | 許可          |
| setup status    | 状態を返す           | 状態を返す        | `503`         |
| initial user    | loopbackだけ許可     | `409`             | `503`         |
| auth session    | 未認証状態を返す     | Better Authへ委譲 | `503`         |
| auth sign-up    | `409 SETUP_REQUIRED` | `403`で拒否       | `503`         |
| その他の保護API | `409 SETUP_REQUIRED` | sessionを検証     | `503`         |

初期化済みでsessionがない場合は、従来どおり`401 UNAUTHORIZED`を返す。

Better Authのsign-up routeは初期化後も公開しない。
アカウント作成はloopback限定の初期ユーザー作成APIだけが実行する。

期待されるBetter Authの`APIError`は各境界で捕捉し、安全なAPIエラーへ変換する。

予期しない例外はHonoのglobal error handlerで捕捉し、`500 INTERNAL_ERROR`へ変換する。

## エラー契約

エラーレスポンスには、人間向けの`message`に加えて機械判定用の`code`を含める。

```ts
type ApiErrorResponse = {
  code:
    | "INVALID_SETUP_INPUT"
    | "INVALID_DATA_PATH"
    | "INVALID_CREDENTIALS"
    | "SETUP_LOCAL_ONLY"
    | "SETUP_REQUIRED"
    | "ALREADY_INITIALIZED"
    | "SIGN_UP_DISABLED"
    | "DATA_UNAVAILABLE"
    | "UNAUTHORIZED"
    | "INTERNAL_ERROR";
  message: string;
};
```

主なHTTP statusとの対応は次のとおりとする。

| status | code                  | 条件                           |
| ------ | --------------------- | ------------------------------ |
| `400`  | `INVALID_SETUP_INPUT` | request bodyの形式や値が不正   |
| `400`  | `INVALID_DATA_PATH`   | 保存先として使用できない       |
| `401`  | `INVALID_CREDENTIALS` | 既存DBの認証に失敗             |
| `401`  | `UNAUTHORIZED`        | 認証済みsessionがない          |
| `403`  | `SETUP_LOCAL_ONLY`    | loopback以外から初期作成を要求 |
| `409`  | `SETUP_REQUIRED`      | 未初期化状態で保護APIを要求    |
| `409`  | `ALREADY_INITIALIZED` | 作成済みの環境へ初期作成を要求 |
| `403`  | `SIGN_UP_DISABLED`    | Better Authの直接sign-upを要求 |
| `503`  | `DATA_UNAVAILABLE`    | DBを安全に読み取れない         |
| `500`  | `INTERNAL_ERROR`      | 分類できないサーバー障害       |

クライアントは`message`の文字列比較ではなく`code`で表示と遷移を決定する。

## 入力制約

初期セットアップのcontract、Desktop、Web、Better Authの入力制約を一致させる。

- username: `3`文字以上`30`文字以下
- password: `8`文字以上`128`文字以下

文字種などBetter Authの追加制約がある場合は、同じ制約を共有contractへ反映する。

Better Auth側の設定を変更する場合は、共有contractとテストも同時に変更する。

## UI

現在の設定先が`initialized`なら、DesktopとWebはセットアップ画面ではなくログイン画面または通常画面を表示する。

`uninitialized`の場合だけ初期セットアップフォームを表示する。

`unavailable`の場合は初期セットアップフォームを表示せず、DBを確認できないことと再試行操作だけを表示する。

説明文は操作に必要な内容へ限定する。

データ保存先には、蔵書フォルダーとの混同を避けるため、次の短い補足だけを表示する。

> 設定とデータベースの保存先。蔵書フォルダーは後で追加します。

既存DBの認証失敗では、usernameとpasswordのどちらが不正かを区別しない。

## TDDとテスト

実装は初期化状態リーダーとAPIの失敗テストから開始する。

### 初期化状態

- DBファイルがない場合は`uninitialized`
- DBはあるが`user`テーブルがない場合は`uninitialized`
- `user`テーブルが空の場合は`uninitialized`
- ユーザーが1件以上の場合は`initialized`
- credential accountがなくてもユーザーが存在すれば`initialized`
- DBが破損している場合は`unavailable`
- DBを読み取れない場合は`unavailable`

### 設定移行

- 旧設定の`setupComplete: false`は判定に影響しない
- 旧設定の`setupComplete: true`は判定に影響しない
- 旧設定を保存し直すと`setupComplete`が除去される
- DBにユーザーがあれば旧設定値にかかわらず初期化済みになる

### API

- fresh setupは`201`になり、直後のstatusが初期化済みになる
- ユーザー作成前の失敗後は未初期化のままで再試行できる
- 既存DBと正しい認証情報では`200`になり、ユーザー件数が増えない
- 既存DBと誤った認証情報では`401`になり、設定が変化しない
- loopback以外からの初期作成は`403`
- 同時リクエストではユーザーが1件だけ作成され、後続は`409`
- DB障害は`503`になり、セットアップを許可しない
- エラーレスポンスに内部パス、SQL、スタックトレースを含めない
- 未初期化、初期化済み、利用不能で保護APIのstatusが正しい

### 待受先

- 未初期化かつ設定が`0.0.0.0`なら実効待受先は`127.0.0.1`
- 未初期化かつ設定がLANアドレスなら実効待受先は`127.0.0.1`
- 初期化済みなら設定された`host`を使用する
- 利用不能時は外部公開せずloopbackへ制限する

### UI

- 初期化済みではセットアップ画面を表示しない
- 未初期化ではセットアップフォームを表示する
- 利用不能では新規ユーザー作成操作を表示しない
- APIエラーを`code`で分類する
- 入力制約とエラー表示がDesktopとWebで一致する

## 検証

対象パッケージの最小単位でtest、typecheck、lint、formatを実行する。

最終確認ではリポジトリに登録されたtest、lint、formatを実行する。

UI変更はDesktopとWebを実際に操作し、セットアップ、既存DB採用、ログイン、DB障害の各状態を確認する。

長時間動作する開発サーバーはPIDとログ出力先を記録し、検証後に停止を確認する。

非自明な実装が完了した時点で`qa_closer`へ独立検証を委譲する。

UIフローは`ui_flow_auditor`へ実操作検証を委譲する。

## 受け入れ条件

- `config.json`、TypeScriptの`AppConfig`、Rustの`ServerConfig`に`setupComplete`が残っていない。
- 初期化状態はBetter Authのユーザー存在だけから判定される。
- DB障害は未初期化ではなく`unavailable`として扱われる。
- 現在のDBにユーザーが存在すれば、旧`setupComplete: false`でもログインへ進める。
- 既存DBは正しいusername/passwordで認証できた場合だけ採用される。
- 認証失敗時に現在の設定と既存DBが変更されない。
- 初期ユーザー作成APIはloopbackからだけ実行できる。
- 未初期化または利用不能なサーバーが外部アドレスで待ち受けない。
- 同時リクエストで複数の初期ユーザーが作成されない。
- APIクライアントがエラー文言ではなく`code`で状態を判定する。
- DesktopとWebで余分な説明を増やさず、必要な復旧操作が分かる。
- 対象のtest、typecheck、lint、formatが成功する。
- 独立検証で重大な未解決事項がない。

## 参照資料

- [Hono ConnInfo Helper](https://hono.dev/docs/helpers/conninfo)
- [Better Auth Server API](https://www.better-auth.com/docs/concepts/api)
- [Better Auth Username Plugin](https://www.better-auth.com/docs/plugins/username)

本設計は、リポジトリで使用しているBetter Auth `1.6.23`、Hono `4.12.28`、`@hono/node-server` `1.19.14`を基準にする。
