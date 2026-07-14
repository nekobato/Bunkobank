# Similar OSS Research

調査日: 2026-07-09

対象:

- Komga
- Kavita
- Calibre / Calibre-Web
- LANraragi
- Mango
- Stump

## Summary

類似OSSは大きく2系統に分かれる。

1. ファイルシステムを正とし、サーバーはスキャン・解析・DB登録を行う。
   - Komga、Kavita、LANraragi、Mango、Stumpが近い。
   - 元ファイルは基本的にユーザー管理で、サーバーは読み取り・解析・キャッシュ生成を行う。
2. アプリがライブラリフォルダーを所有し、ファイル配置も管理する。
   - Calibreが代表例。
   - metadata変更に合わせてファイルの保存場所や名前も管理する。

この企画は「複数の既存フォルダーを対象にし、ユーザー操作でスキャンする」方針なので、基本は1の系統に近い。
ただし、metadataに応じた実ファイル名変更を行う場合はCalibre型の所有モデルに近づくため、初期実装ではDB metadataだけ更新する方が安全。

## 検討事項: preview image optimization

### Komga

Komgaはスキャン後の分析でメディア特性を取得し、画像形式やページ寸法を把握する。
ブラウザーが表示できない形式、たとえばWEBP非対応環境では、サーバー側でJPEGへ変換して読めるようにする設計が説明されている。

また、分析時に本の先頭ページからデフォルト artwork を取得する。
ライブラリ設定ではページ寸法の分析を有効にできるが、リソース消費が大きいと明記されている。

示唆:

- 変換は「常に最適化」ではなく、クライアント互換性や表示体験に必要な場合に限定する設計がよい。
- ページ寸法取得やハッシュ計算のような重い処理は、設定で明示的に有効化できる方がよい。
- preview cacheを入れる場合、CPU/ディスク消費をUI上で説明する必要がある。

Source:

- [Komga: Scanning, Analyzing and Refreshing Metadata](https://komga.org/docs/guides/scan-analysis-refresh/)
- [Komga: Libraries](https://komga.org/docs/guides/libraries/)

### Kavita

Kavitaはcover生成や画像処理にNetVipsを使っている。
FAQでは、NetVipsが画像処理タスクを担うこと、CPUのSSE4.2要件によりcover生成に問題が出る場合があることが説明されている。

示唆:

- 画像処理ライブラリを採用する場合、OS/CPU依存や配布時のバイナリ互換性を考える必要がある。
- Tauri sidecarや同梱serverで配るなら、画像処理依存のサイズ・互換性・fallbackを事前に確認する。

Source:

- [Kavita FAQ](https://wiki.kavitareader.com/troubleshooting/faq/)

### LANraragi

LANraragiはcontent folderとthumbnail folderを持つ。
thumbnail folderはcontent folderから分離でき、SSDへ移す、あるいはcontent folderをread-onlyに保つ用途が想定されている。
一方で、thumbnail folder移動時の自動移行はなく、手動移動が必要とされている。

Archive APIでは、thumbnailがない場合はplaceholderを返し、必要ならbackground jobとしてthumbnail生成をqueueできる。
また、archive展開は一時フォルダーを使い、既存cacheが残っている場合は再展開中でもcacheが使われ得る。
ページごとのthumbnail生成もbackground jobとして扱われる。

示唆:

- thumbnail/preview cacheはcontent folderから分離できるようにする価値がある。
- cache folderを後から移すなら、移行機能または「手動移動が必要」という明確な仕様が必要。
- preview生成は同期処理ではなくjob化し、生成中はplaceholderや既存cacheを返す設計が有効。
- cache容量上限と手動削除UIは初期から検討した方がよい。

Source:

- [LANraragi: Getting Started](https://sugoi.gitbook.io/lanraragi/dev/basic-operations/first-steps)
- [LANraragi: Archive API](https://sugoi.gitbook.io/lanraragi/api-documentation/archive-api)

### Mango

Mangoは設定で`thumbnail_generation_interval_hours`を持ち、`0`で無効化できる。
また、`cache_enabled`、`cache_size_mbs`によりmetadata cacheの容量を調整できる。

示唆:

- 定期生成やcacheは、容量上限と無効化設定を持たせるのがよい。
- この企画では自動スキャンをしない方針なので、定期生成よりもユーザー操作または閲覧時jobの方が整合しやすい。

Source:

- [Mango README](https://github.com/getmango/Mango)

## 検討事項: Web UI upload

### Komga

Komgaは既存ライブラリ外のフォルダーをscanし、import対象の本を選び、destination seriesを指定してimportできる。
import時には、元ファイルをmoveするか、hardlink/copyするかを選べる。
既存の同番号本がある場合はupgradeとして既存ファイルを置き換える導線もある。

示唆:

- Web UI uploadを直接ライブラリへ入れるより、まず「import staging」へ置き、ユーザーにdestinationを確認させる方が安全。
- move/copy/hardlinkのように、元ファイルを消すか残すかを明示するUIが必要。
- 既存本の置き換えは、詳細比較と明示確認を必須にした方がよい。

Source:

- [Komga: Import Books](https://komga.org/docs/guides/import-books/)

### Calibre-Web

Calibre-WebはCalibre databaseを使うWebアプリで、READMEのfeatureとして各種formatの新規book upload、metadata編集、metadata download、cover抽出、Calibre binaryによる変換を挙げている。
ただしCalibre-WebはCalibre libraryを前提にするため、uploadは「アプリが管理するCalibre libraryへ取り込む」モデルに近い。

示唆:

- upload機能を入れるなら、ユーザー指定の任意フォルダーへ直接書くより、アプリ管理下のimport/storageへ保存するモデルが扱いやすい。
- 既存フォルダーを読むモデルとupload storageモデルを混ぜる場合、DB上でsource typeを分けた方がよい。

Source:

- [Calibre-Web README](https://github.com/janeczku/calibre-web)

### LANraragi

LANraragiはcontent folderへファイルをコピーする方法と、built-in uploader toolの両方を持つ。
uploadされたarchiveは自動でindexされ、設定済みならmetadata pluginも実行される。
APIではmultipart uploadを提供し、SHA1 checksumを渡すと転送中の整合性検証ができる。
重複、未対応形式、checksum mismatchなどのstatusも分かれている。

示唆:

- upload APIにはchecksum検証、重複検出、未対応形式エラーを入れるとよい。
- upload完了後に同じ解析pipelineへ流す設計がよい。
- upload後の自動indexは便利だが、この企画の「自動スキャンしない」方針と衝突するため、upload完了後だけ明示的なimport jobとして扱うのがよい。

Source:

- [LANraragi: Getting Started](https://sugoi.gitbook.io/lanraragi/dev/basic-operations/first-steps)
- [LANraragi: Archive API](https://sugoi.gitbook.io/lanraragi/api-documentation/archive-api)

### Kavita

Kavitaはfilesystem上のライブラリをスキャンする思想が強い。
公式Wiki上でもscannerとファイル配置が中心に説明されており、Web UIから通常の本ファイルを直接uploadする導線は主要導線として見当たらない。
GitHub DiscussionsにはWeb UI uploadの要望があり、ユーザーが「ファイルシステムへ置く必要がある」ことを課題として述べている。

示唆:

- self-hosted用途でも、Web UI uploadはユーザー体験上の需要がある。
- ただし、uploadはセキュリティ・容量・保存先の問題が大きいため、初期状態では無効、または管理者のみ有効化が妥当。

Source:

- [Kavita: Library Scanner](https://wiki.kavitareader.com/guides/scanner/)
- [Kavita Discussion: Upload files from web](https://github.com/Kareadita/Kavita/discussions/2668)

## 検討事項: metadata edit and file rename

### Komga

KomgaはWeb UIでmetadataを編集できる。
編集した項目はlockされ、metadata refreshで上書きされないようにできる。
一方、metadata refreshの入力元は`ComicInfo.xml`、EPUB metadata、local media assetsであり、ドキュメント上は「Web UI編集をarchive内metadataへ書き戻す」導線は中心ではない。
FAQでは、EPUBやComicInfo metadataがファイル名/フォルダー名より優先されると説明されている。

示唆:

- metadata編集はDB上の表示情報として扱い、元ファイル名は変更しない方が安全。
- 外部metadataを再読み込みする場合に備えて、ユーザー編集値にはlock/overrideの概念があるとよい。
- ファイル名よりmetadataを優先する場合、UI上で「表示名と実ファイル名は一致しないことがある」と説明する必要がある。

Source:

- [Komga: Edit Metadata](https://komga.org/docs/guides/edit-metadata/)
- [Komga FAQ](https://komga.org/docs/faq/)
- [Komga: Scanning, Analyzing and Refreshing Metadata](https://komga.org/docs/guides/scan-analysis-refresh/)

### Kavita

Kavitaはファイル名と内部metadataを解析に使うが、フォルダー構造をそのまま反映する設計ではない。
KavitaのWikiでは、Kavita用にmetadataとファイル配置を整えるためにCalibreの`Save to Disk` templateを使う手順が紹介されている。
つまり、metadataを元にファイル名やフォルダー名を整える作業は、Kavita本体ではなくCalibreなど外部ツールに寄せる運用が示されている。

示唆:

- server本体がファイル名を変えない方針は十分あり得る。
- 実ファイル名を整理したいユーザー向けには、外部ツール連携やexport/import手順を用意する方が安全。

Source:

- [Kavita: Naming convention / File Structure](https://wiki.kavitareader.com/guides/scanner/managefiles/)
- [Kavita: Calibre external tool guide](https://wiki.kavitareader.com/guides/external-tools/calibre/)

### Calibre

Calibreはアプリがlibrary folderを所有し、book追加時にファイルをlibrary folderへコピーする。
フォルダー内のbookはAuthor/Titleのサブフォルダーへ整理される。
公式FAQは、library folderを手動で変更しないよう警告している。
また、metadata編集でtitle/authorが変わると、Calibreは対応するファイルを適切なフォルダーへ移動する。

示唆:

- metadataに応じた実ファイル名変更を安全に行うには、Calibreのようにアプリがlibrary folderを所有する必要がある。
- この企画のように任意の既存フォルダーを読む場合、自動renameは危険。
- もし実装するなら、対象を「アプリ管理下にupload/importされた本」に限定するのが現実的。

Source:

- [Calibre FAQ: Where are the book files stored?](https://manual.calibre-ebook.com/faq.html)
- [Calibre: Editing e-book metadata](https://manual.calibre-ebook.com/metadata.html)

### LANraragi

LANraragiのAPIはarchive metadataのtitle、tags、summary更新を提供する。
metadata APIの更新対象はmetadataであり、filenameはmetadata取得レスポンスに含まれるが、metadata updateの対象には含まれていない。
delete APIはmetadataとserver上のfileの両方を削除するため、ファイル破壊操作では明示確認を求める設計が示されている。

示唆:

- metadata編集と実ファイル操作は分けるのがよい。
- ファイル削除やrenameのような破壊的操作は、通常のmetadata editとは別の明示操作にする。

Source:

- [LANraragi: Archive API](https://sugoi.gitbook.io/lanraragi/api-documentation/archive-api)

### Ubooquity

UbooquityはOSSではないが、同種のセルフホスト本/コミックサーバーとして参考になる。
公式サポート上で「ユーザーのfilesを変更しない」という強い設計原則が述べられている。

示唆:

- 読み取り中心サーバーでは「元ファイルを変更しない」は明確な価値になる。
- この企画でも初期方針として採用しやすい。

Source:

- [Ubooquity UserEcho: write read states to metadata files](https://ubooquity.userecho.com/communities/1/topics/99-write-read-states-to-metadata-files-comic-and-books-alike)

## 補足: スキャンと自動化

Komgaはlibraryごとにscan intervalを持ち、`disabled`も選べる。
Kavitaはfolder watchingを設定でき、変更検知からscan queueへつなげる。
Mangoもscan intervalを`0`で無効化できる。

この企画は「自動スキャンしない」方針なので、類似OSSの自動化機能をそのまま採用しない。
ただし、手動scanのUI、scan結果のエラー表示、除外パターン、hash/mtimeによる更新判定はKomgaに近い設計が参考になる。

Source:

- [Komga: Libraries](https://komga.org/docs/guides/libraries/)
- [Kavita: Server Settings - General](https://wiki.kavitareader.com/guides/admin-settings/general/)
- [Mango README](https://github.com/getmango/Mango)

## この企画への推奨

### 1. preview image optimization

初期実装では確定機能にしない。
実装する場合は、以下を最低条件にする。

- アプリ管理下の専用`preview-cache`に保存する。
- 元ファイルとは分離する。
- SQLiteにはcache key、source fingerprint、width、height、format、created_atだけを保存する。
- 容量上限を設定できる。
- 手動cache削除UIを用意する。
- 生成はbackground jobにし、生成中はplaceholderまたは元画像を返す。

### 2. Web UI upload

初期実装では無効または未実装が妥当。
実装する場合は、既存コレクションルートへ直接書き込まず、`uploads`または`import-staging`へ保存する。

必要な仕様:

- 管理者だけが有効化できる。
- ファイルサイズ上限、総容量上限を持つ。
- checksum検証を任意で持つ。
- path traversal、zip bomb、Content-Type偽装への対策を入れる。
- upload後は通常のformat adapterと同じpipelineで解析する。
- 既存本へmerge/replaceする場合は明示確認する。

### 3. metadata edit and file rename

初期実装ではDB metadataだけを変更し、元ファイル名または元フォルダー名は変更しない。

理由:

- この企画は既存フォルダーを読むモデルであり、アプリがlibrary folderを所有しない。
- 外付けディスク、NAS、read-only mount、OSごとの命名制約が絡む。
- rename失敗時のDB整合性、thumbnail/cache参照更新、rollbackが複雑。

将来実装するなら、通常のmetadata editとは別に「実ファイル名をmetadataから変更する」専用操作を作る。
その場合は事前preview、dry-run、衝突検出、明示確認、操作ログ、rollback方針が必要。

## Sources

- [Komga: Libraries](https://komga.org/docs/guides/libraries/)
- [Komga: Scanning, Analyzing and Refreshing Metadata](https://komga.org/docs/guides/scan-analysis-refresh/)
- [Komga: Edit Metadata](https://komga.org/docs/guides/edit-metadata/)
- [Komga: Import Books](https://komga.org/docs/guides/import-books/)
- [Komga FAQ](https://komga.org/docs/faq/)
- [Kavita FAQ](https://wiki.kavitareader.com/troubleshooting/faq/)
- [Kavita: Naming convention / File Structure](https://wiki.kavitareader.com/guides/scanner/managefiles/)
- [Kavita: Calibre external tool guide](https://wiki.kavitareader.com/guides/external-tools/calibre/)
- [Kavita: Server Settings - General](https://wiki.kavitareader.com/guides/admin-settings/general/)
- [Kavita Discussion: Upload files from web](https://github.com/Kareadita/Kavita/discussions/2668)
- [Calibre FAQ](https://manual.calibre-ebook.com/faq.html)
- [Calibre metadata docs](https://manual.calibre-ebook.com/metadata.html)
- [Calibre-Web README](https://github.com/janeczku/calibre-web)
- [LANraragi: Getting Started](https://sugoi.gitbook.io/lanraragi/dev/basic-operations/first-steps)
- [LANraragi: Archive API](https://sugoi.gitbook.io/lanraragi/api-documentation/archive-api)
- [Mango README](https://github.com/getmango/Mango)
- [Stump docs](https://www.stumpapp.dev/docs)
- [Stump README](https://github.com/stumpapp/stump)
- [Ubooquity UserEcho: write read states to metadata files](https://ubooquity.userecho.com/communities/1/topics/99-write-read-states-to-metadata-files-comic-and-books-alike)
