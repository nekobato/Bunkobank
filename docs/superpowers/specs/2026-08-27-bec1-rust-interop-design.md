# BEC1 Rust 独立実装の理想状態

## 決定概要

Bunkobank Encrypted Container Version 1（BEC1）の相互運用性は、既存の TypeScript 実装と、製品本体から独立した Rust 実装の二系統で検証する。

Rust 実装は BEC1 仕様書と公開 test vector だけを format contract として参照し、TypeScript の source code、生成物、型定義、暗号処理を import または link しない。

Rust 実装は repository 内の検証用 tool として恒久配置し、製品の runtime dependency や配布物には含めない。

検証は byte-for-byte の test vector 一致、双方向の復号、破損 container の拒否を機械的に判定する。

## 成果と対象範囲

利用者から見た Bunkobank の挙動は変更しない。

開発者は単一の command で TypeScript と Rust の相互運用性を再検証できる。

検証対象は次の処理とする。

- descriptor の parse と geometry 検証
- Argon2id version 1.3 による Recovery KEK 導出
- RFC 3394 AES-256-KW による key unwrap
- RFC 5869 HKDF-SHA-256 による subkey 導出
- HMAC-SHA-256 による descriptor 認証
- AES-256-GCM による manifest と chunk の認証付き暗号処理
- RFC 8949 に従う deterministic CBOR manifest
- mirror descriptor の選択と回復
- 公開 test vector に基づく deterministic container 生成
- password 認証付き inspect と plaintext 復旧

次の項目は対象外とする。

- Bunkobank server、Web UI、scanner、database への BEC1 統合
- SQLite database の暗号化
- Rust 実装の製品配布
- 新しい BEC1 format version または cryptographic suite の設計
- 外部組織による security review
- 組織的に独立した第三者実装の調達

## 根拠と制約台帳

| 項目                                                  | 分類               | 根拠                                               | 設計への帰結                                                        |
| ----------------------------------------------------- | ------------------ | -------------------------------------------------- | ------------------------------------------------------------------- |
| BEC1 byte format は仕様書を normative contract とする | Hard constraint    | `docs/bec1.md` の Status と各 layout 定義          | 二実装は仕様書に従い、相互の source code を contract にしない       |
| format 安定化前に二つの独立実装で test vector を通す  | Hard constraint    | `docs/bec1.md` の Status                           | Rust 実装は公開 vector を独立に再現する                             |
| password を command-line value として受け取らない     | Hard constraint    | `docs/bec1.md` の Recovery and compatibility       | password は file または検証専用の公開 vector から読む               |
| 復旧 tool は database を開かずに動作する              | Hard constraint    | `docs/bec1.md` の Recovery and compatibility       | Rust CLI は `.bbec` と password 以外の Bunkobank state を参照しない |
| Rust 実装と暗号 crate の恒久追加を認める              | Hard constraint    | 2026-08-27 の利用者承認                            | 独立した `Cargo.toml` と `Cargo.lock` を repository に置く          |
| 検証完了まで実施する                                  | Hard constraint    | 2026-08-27 の利用者要求                            | 実装完了ではなく相互運用 evidence の取得を終了条件とする            |
| TypeScript 実装は既に test vector を生成できる        | Current-state fact | `packages/encrypted-container/src/vectors.test.ts` | Rust 側の出力と既存 expected digest を比較できる                    |
| repository は Node.js 24 と pnpm 11 を使用する        | Current-state fact | root `package.json`                                | orchestration は既存 Node.js runtime で実行できる                   |
| 開発環境には Rust 1.96.1 がある                       | Current-state fact | 2026-08-27 の toolchain 確認                       | 独立 CLI を現在の環境で build して検証できる                        |
| BEC1 は product runtime に未統合である                | Current-state fact | BEC1 package 外からの参照が存在しない              | Rust tool も product dependency にしない                            |
| 外部 security review は未実施である                   | Current-state fact | `docs/bec1.md` の Status                           | 相互運用成功だけを根拠に format の安全性や安定性を宣言しない        |
| Rust 実装は repository 内に置く                       | Preference         | 再現性と保守性に関する利用者承認済みの提案         | 別 repository より弱い組織的独立性を受け入れる                      |

## 定常状態の設計

### 実装境界

既存の `@bunkobank/encrypted-container` は Bunkobank の TypeScript reference implementation を所有する。

新しい Rust crate は BEC1 recovery reader と deterministic vector writer を所有する。

Rust crate は独立した binary として build され、Node.js module、workspace package、Tauri crate のいずれにも link しない。

相互運用 harness は両実装を別 process として起動し、temporary file と JSON output だけを交換する。

dependency は `TypeScript implementation <- file contract -> Rust implementation` の形とし、二実装間の code dependency を設けない。

### Rust CLI contract

Rust CLI は次の command を提供する。

```text
bec1-interop inspect <container> [--password-file <path>]
bec1-interop decrypt <container> <output> --password-file <path>
bec1-interop emit-vector <vector-json> <output>
```

`inspect` は password なしでは公開 geometry だけを JSON で返す。

`inspect` は password ありでは descriptor と manifest を認証し、recovery metadata を JSON で返す。

`decrypt` はすべての chunk を認証してから plaintext を file に書き、既存 output を上書きしない。

`emit-vector` は公開 vector に固定された password、key、salt、nonce、metadata を使い、expected container を deterministic に生成する。

CLI の error は分類可能な stable code と非機密の説明を stderr に出し、失敗時には非 zero status で終了する。

### 暗号処理

Argon2id、AES-GCM、AES-KW、HKDF、HMAC、SHA-256、Unicode NFC、CBOR は、それぞれ独立した Rust crate の API を利用する。

cryptographic key と password byte buffer は使用後に zeroize する。

descriptor の untrusted length と KDF parameter は、KDF 実行または allocation の前に仕様上の上下限を検証する。

descriptor は primary と mirror を別々に parse し、password 認証に成功した候補のうち最大 generation を選ぶ。

chunk plaintext は AES-GCM tag の検証が完了するまで output に公開しない。

manifest decoder は definite-length CBOR、最短 integer encoding、昇順の unsigned integer key、重複 key の不在を検証する。

### 検証 harness

root package は `verify:bec1-interop` command を公開する。

harness は Rust binary の build、fixture 作成、両実装の実行、digest と JSON の比較、異常系の mutation を順に実施する。

harness は repository 内に container や plaintext fixture を残さず、temporary directory を終了時に削除する。

検証結果は各 case の pass または fail と、期待値に対する差分を標準出力へ出す。

通常の Web UI test や Playwright test には統合しない。

### failure semantics

wrong password、descriptor HMAC 不一致、manifest tag 不一致、chunk tag 不一致は authentication failure として扱う。

magic、version、suite、flags、reserved bytes、geometry、KDF bounds、file size の不一致は invalid container または unsupported version として扱う。

primary descriptor だけが破損している場合、mirror descriptor が認証できれば処理を継続する。

両 descriptor が無効な場合、plaintext と recovery metadata を返さない。

### security claim

この仕組みが証明するのは、仕様書に基づく二つの code path が同じ byte format を解釈し、公開 vector と相互運用 case に合格することである。

この仕組みは cryptographic construction の安全性、side-channel 耐性、第三者 archive 向け安定性を証明しない。

外部 security review が完了するまで、仕様書の pre-release status を維持する。

### 廃止される経路

同一 Node.js runtime 内に第2実装を作る案は残さない。

TypeScript の内部 helper を Rust 向け fixture generator として共有する adapter は残さない。

手作業で digest を転記して合否を判断する検証手順は残さない。

## 不変条件と品質基準

| 性質                   | 必要な挙動または基準                                                                        | 失敗の証拠                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 実装独立性             | Rust crate の build graph と source import に Bunkobank TypeScript package が含まれない     | `cargo metadata` または source scan で参照が見つかる    |
| vector 一致            | container、descriptor、first chunk、final chunk の SHA-256 が公開 expected value と一致する | 一つでも digest が異なる                                |
| 双方向互換性           | TypeScript 生成 container を Rust が復旧し、Rust 生成 container を TypeScript が開ける      | 一方向でも plaintext または manifest が一致しない       |
| password normalization | decomposed password と NFC normalized byte sequence が公開 vector と一致する                | Recovery KEK または vector digest が異なる              |
| 認証優先               | tag 検証前の plaintext を file または stdout に出さない                                     | 改ざん case で部分 plaintext が残る                     |
| descriptor recovery    | primary 破損時に認証済み mirror から復旧する                                                | 有効な mirror がある container を拒否する               |
| fail closed            | wrong password、改ざん、truncation を成功として扱わない                                     | 非 zero status にならない、または output が残る         |
| output 保護            | 既存 output file を上書きしない                                                             | 既存内容が変更される                                    |
| resource bounds        | KDF と allocation の前に仕様上の上限を検証する                                              | forged length または KDF value に従って過大処理を始める |
| secret handling        | password と key buffer を不要になった時点で zeroize する                                    | secret buffer の所有期間が処理全体まで残る              |
| claim の限定           | 相互運用成功後も external review 完了前は pre-release と記載する                            | stable または security reviewed と記載する              |
| 再現性                 | 一つの command が temporary fixture を作成し、同じ判定を再実行できる                        | 手作業または repository 外の fixture が必要になる       |

## 候補比較

| 基準             | Clean-slate target                                                     | Best brownfield target                                  | Minimal-change alternative                          |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| 構成             | 別 repository で Rust 実装を管理する                                   | 同一 repository 内の独立 Rust crate と process harness  | Node.js の独立 script を追加する                    |
| 定常状態への適合 | 組織的独立性は最も強い                                                 | code path と toolchain の独立性を保ち、検証を再現できる | runtime と暗号 API が共通で独立性が弱い             |
| 制約充足         | 仕様上の二実装を満たす                                                 | 仕様上の二実装を満たす                                  | 実装の独立性に疑義が残る                            |
| 保守性           | version と fixture の同期に別運用が必要                                | 仕様変更と vector 更新を一つの変更として review できる  | code は小さいが誤解を共有しやすい                   |
| 導入 risk        | 別 repository の作成と release 管理が必要                              | Rust dependency と build 時間が増える                   | 導入は軽い                                          |
| 検証力           | 最も強い                                                               | 強い                                                    | 弱い                                                |
| 推奨判断         | 将来の第三者実装には適するが、今回の再現可能な検証には運用負担が大きい | 推奨する                                                | Best brownfield target に検証力で劣るため採用しない |

Minimal-change alternative は導入 cost 以外の主要基準で Best brownfield target に劣るため、採用しない。

Clean-slate target は組織的独立性で優れるが、今回の hard constraint は別組織による実装を要求しておらず、継続的な同期 cost を正当化できない。

## 譲歩台帳

| Clean-slate target からの譲歩                    | 必要とする制約または tradeoff                             | 根拠                                     | 定常状態の cost                                  | 恒久性または撤去条件                                   |
| ------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Rust 実装を同一 repository に置く                | test vector と仕様変更を同期し、単一 command で再検証する | 利用者が恒久配置を承認した               | 組織的独立性は別 repository より弱い             | 恒久。第三者実装を得ても、回帰検証 tool として維持する |
| Rust 実装を recovery と vector writer に限定する | BEC1 全機能の再実装は相互運用 gate に不要                 | 仕様書が recovery tool に求める contract | password rewrap API の相互運用は直接検証しない   | 恒久。format contract が拡大した場合だけ再評価する     |
| product runtime とは別に Rust dependency を持つ  | 異なる toolchain による独立実装が必要                     | 利用者承認と候補比較                     | dependency 更新と security advisory 対応が増える | Rust tool を撤去するまで恒久                           |

## 未知事項と技術検証

| 未知事項                                                             | 限定した問い                                                                                  | 反証可能な結果                                        | 採用条件                                                   | 破棄条件                                                         | 解放される判断        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | --------------------- |
| 選定した Rust crate の現在 API が BEC1 の byte layout を再現できるか | 公開 vector の Recovery KEK、wrapped key、GCM ciphertext、HMAC、CBOR を個別に一致させられるか | 一つ以上の primitive が expected bytes を生成できない | 全 primitive の intermediate value が一致する              | 仕様準拠の設定を表現できない crate は別の一次実装へ置換する      | dependency の最終選定 |
| CBOR library が非 deterministic encoding を受理するか                | decode 後の構造検査と再 encode 比較で禁止表現を拒否できるか                                   | forged manifest を正規形として受理する                | key 順序、重複、definite length、最短 integer を判定できる | 判定できなければ小さな strict decoder を Rust crate 内に実装する | CBOR decoder の境界   |

これらの未知事項は internal dependency の選択を変えるが、Rust CLI と process harness からなる target state は変えない。

## 検証対応表

| Target-state claim                       | 検証方法                                                                       | 期待する証拠                                                    | 検証時期       |
| ---------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------- |
| Rust 実装が TypeScript code に依存しない | `cargo metadata` と source scan                                                | Node.js package、workspace link、TypeScript import が存在しない | 実装時と収束時 |
| 公開 vector を独立に再現する             | Rust `emit-vector` と SHA-256 比較                                             | 四つの expected digest がすべて一致する                         | 実装時と収束時 |
| TypeScript から Rust へ互換である        | TypeScript が random container を生成し、Rust が inspect と decrypt を実行する | plaintext、manifest、geometry が一致する                        | 収束時         |
| Rust から TypeScript へ互換である        | Rust が vector container を生成し、TypeScript が open と decrypt を実行する    | plaintext と manifest が一致する                                | 収束時         |
| mirror recovery が働く                   | primary descriptor の一 byte を変更して Rust と TypeScript で開く              | 双方が mirror を選び plaintext を返す                           | 収束時         |
| 改ざんを拒否する                         | password、chunk、manifest、file length を変えた case を実行する                | 双方が分類済み error で失敗し plaintext を残さない              | 収束時         |
| output を保護する                        | 既存 output に対して decrypt を実行する                                        | 非 zero status で既存内容が不変                                 | 収束時         |
| Rust code quality を満たす               | `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test` | 全 command が成功する                                           | 実装時と収束時 |
| repository checks を維持する             | format、lint、typecheck、既存 test、build                                      | 登録済み command が成功する                                     | 収束時         |
| pre-release claim を維持する             | documentation inspection                                                       | external review 未完了の記述が残る                              | 収束時         |

## ゲート判定

PASS

Hard constraint にはすべて根拠があり、候補比較で選定した Best brownfield target は他候補に支配されていない。

外部 security review と組織的に独立した第三者実装は明示的な非対象であり、相互運用成功から security claim を導かない。

実装方式を変更する未解決事項はなく、primitive crate と CBOR decoder の選択は限定した技術検証で決定できる。
