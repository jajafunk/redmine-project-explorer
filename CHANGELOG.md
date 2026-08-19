
## v3.4.7 (2026-08-19)
- Flowchart preview now supports Redmine live-preview DOM (`<p>` + `<br>`) in addition to `<pre>`.
- Fixes flowchart/graph source remaining as plain text in issue and Wiki previews.
## 3.4.6 - 2026-08-19

- Redmine画面用のフローチャート描画処理を `sequence_diagram.js` に同梱
- 新規 `flowchart.js` が `public/plugin_assets` へ反映されない環境でもフローチャートを表示できるよう修正
- Redmine画面では `sequence_diagram.js` 1本だけを読み込み、二重描画を防止
- `flowchart TD/TB/BT/LR/RL` / `graph TD/TB/BT/LR/RL` を引き続きオフライン描画

## 3.4.5 - 2026-08-19

- RedmineのRBPDFがSVG画像を直接描画できないため、PDF用シーケンス図をSVGからPNGへローカル変換して埋め込む方式へ変更。
- ImageMagick 7の `magick` コマンドをシェルを介さず実行し、SVG→PNGを完全ローカルで変換。
- ITCPDFの画像解決パッチをPNG専用に変更し、`tmp/redmine_project_explorer_pdf` 配下の生成PNGのみ許可。
- PDFログに `rasterized SVG to PNG` / `using local PNG` を出力し、変換経路を確認可能にした。
- CDN・外部API・外部レンダリングサーバーは使用しない。

## 3.4.4 - 2026-08-19

- PDF用パッチを `Rails.configuration.to_prepare` のみへ依存せず、プラグイン初期化時に即時適用する方式へ修正。
- `Redmine::Export::PDF::IssuesPdfHelper` / `IssuesHelper` / `ITCPDF` への `prepend` を冪等な `PdfPatchInstaller.apply!` に集約。
- 開発時リロード用に `to_prepare` も残し、即時適用と再適用の両方に対応。
- `rails runner` で確認された「PDFパッチの ancestors が空」の原因に対応。

## 3.4.3 - 2026-08-19

- PDF出力のMermaidシーケンス図変換パッチを、IssuesHelperだけでなくRedmine::Export::PDF::IssuesPdfHelper本体にも適用。
- PDF生成時のローカルSVG解決を強化し、適用状況をRedmineログへ記録。
- v3.4.2でPDFにMermaidコードが残る問題を修正。

## 3.4.2 - 2026-08-19

- Fix Redmine issue PDF export so `sequenceDiagram` blocks render as SVG diagrams instead of source code.
- Patch `IssuesHelper` directly to avoid PDF helper load-order differences.
- Resolve generated SVG through Redmine ITCPDF using a local, restricted cache under `tmp/redmine_project_explorer_pdf`.
- No CDN, external API, or external rendering server is used.

# 3.4.1 - 2026-08-19

- チケットツリーHTML書き出しの個別チケットHTMLでもMermaid図をローカル描画するよう修正
- HTML書き出しZIPへ `sequence_diagram.js` / `flowchart.js` / `sequence_diagram.css` を同梱し、オフラインで描画
- 書き出したHTMLをブラウザからPDF保存した場合も、コードではなく描画済み図を印刷
- Redmine標準のチケットPDF出力で `sequenceDiagram` コードブロックをSVG画像へ変換して出力するPDF用パッチを追加
- PDF変換は外部サーバー・CDNを使用せずRedmine内で完結

# 3.4.0 - 2026-08-19

- Redmineチケット本文・WikiへMermaidフローチャート表示を追加
- `flowchart` / `graph` の TD/TB/BT/LR/RL をサポート
- 基本ノード形状、基本エッジ、エッジラベルに対応
- v3.3.7のズーム・縦横スクロール・Mermaidコード表示・PNG/JPEG/SVG保存UIをフローチャートにも適用
- 実行時に外部ネットワークを使用しない完全オフライン実装

# 3.3.7 - 2026-08-18

- 「スクロール表示を有効にする（縦・横）」チェックを削除
- ズーム100%では内部スクロールバーを表示しない仕様へ変更
- 100%以外のズーム時はプレビューオプション表示状態に関係なく縦・横スクロールバーを表示
- プレビューオプションの表示/非表示でズーム倍率を変更しないよう修正
- ズーム倍率は手動変更または「画面表示をリセット」でのみ100%へ戻る仕様に変更
- 手動で100%へ戻した場合は縦・横スクロールバーを自動的に非表示

# 3.3.6 - 2026-08-18

- 「スクロール表示を有効にする（縦・横）」がOFFのとき、ズーム表示を非表示に変更
- スクロール表示をOFFにした時点でズーム倍率を自動的に100%へ戻すよう変更
- スクロール表示OFF時は図の表示位置を左上へ戻し、ズーム状態を解除
- ズーム操作はスクロール表示ON時のみ使用可能な仕様に整理

# 3.3.5 - 2026-08-18

- プレビューオプション内のボタン文字を上下中央揃えに修正
- 「スクロール表示を有効にする（縦・横）」を追加し、ON時は図領域内に縦・横スクロールバーを表示
- スクロール表示OFF時もズームは利用可能とし、内部スクロールバーは表示しない仕様に整理
- ズームとスクロール表示を独立した機能として扱うよう画面表示仕様を整理
- 画面表示リセットでズーム100%・スクロールOFF・表示位置左上へ戻す仕様を明確化

# 3.3.4 - 2026-08-18

- Redmine標準CSSのlabel/float指定によるプレビューオプションの文字崩れを修正
- ズーム操作を常時表示（− / 100% / ＋ / 100%）し、クリック時に自動でズーム表示を有効化
- 画像保存に「画像保存を初期化」ボタンを追加
- 画像保存初期化で幅・高さを現在の表示サイズ、背景色を白、JPEG品質を90%、縦横比固定ONへ戻す
- 右サイドパネル幅と各入力欄のレイアウトを調整

# 3.3.3 - 2026-08-18

- Mermaidコード表示時の配置を「コード上／シーケンス図下」に変更
- 右側プレビューオプション内の重複した「その他」ボタンを削除
- ズーム操作（− / 100% / ＋ / 100%に戻す）を右側プレビューオプション内に表示
- 「表示を初期化」を「画面表示をリセット」に改称し、ズーム・スクロールのみ初期化する仕様に整理
- 画面表示のリセットで画像保存設定を変更しないよう修正
- 右側パネル内のズーム／スクロールラベルの折り返し崩れを修正

# 3.3.1 - 2026-08-18

- 新規チケット `/issues/new` のプレビューをシーケンス図表示対象へ追加
- RedmineのAjaxプレビュー更新後に追加されたMermaidコードをMutationObserverで自動検出し再描画
- 既存チケット・Wikiの表示仕様、PNG/JPEG/SVG保存仕様は3.3.0から変更なし

# 3.3.0 - 2026-08-18

- チケット本文とWikiのMermaid `sequenceDiagram` を見やすいSVGシーケンス図として表示
- 通常表示は本文幅いっぱい、プレビューオプションは初期非表示
- 「その他」メニューからプレビューオプションとMermaidコード表示を切替
- オプションでズーム／スクロール表示を有効化
- PNG / JPEG / SVG 保存を追加
- PNG/JPEGの保存解像度を幅・高さ(px)で指定可能（初期値は画面表示サイズ）
- JPEG品質と背景色の指定に対応

# Changelog

## 3.2.0 - 2026-08-10

- Project Explorerの「終了・却下を表示」をHTML書き出しにも反映
- ステータスフィルターをHTML書き出しにも反映
- 優先度フィルターをHTML書き出しにも反映
- フィルター対象外チケットの個別HTML・添付ファイルをZIPから除外
- 「子チケット数を表示」を表示設定メニューへ追加
- 子チケット数は現在表示中の子孫（子・孫・曾孫…）を集計
- 子チケット数表示のON/OFFをLocalStorageへ保存
- HTML書き出しにも子チケット数表示設定を反映

## v3.3.2 - 2026-08-18
- シーケンス図の左端（participant / alt / else ラベル）が欠ける問題を修正
- `-->>` メッセージの送信元ID末尾に `-` が混入し、不要なparticipantが生成される解析不具合を修正
- プレビューオプションを図下部から右側のstickyサイドパネルへ変更
- サイドパネルにも「その他」メニューを追加し、長い図の途中でも表示/非表示を切り替え可能に変更
- PNG / JPEG / SVG保存でも修正後のviewBoxを使用
