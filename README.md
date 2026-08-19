
## v3.4.7 (2026-08-19)
- Flowchart preview now supports Redmine live-preview DOM (`<p>` + `<br>`) in addition to `<pre>`.
- Fixes flowchart/graph source remaining as plain text in issue and Wiki previews.
# Redmine Project Explorer v3.4.6

# Redmine Project Explorer

Redmine 6.0.7向けチケットツリープラグイン。

## v2.0.0
- 親子ツリー、リンク、展開・折りたたみ
- 展開状態保存、検索、並び替え
- ステータス色付きバッジ、優先度アイコン
- 担当者・進捗・更新日時
- 右クリックメニュー
- 任意の60秒自動更新
- Redmine標準権限に追従

## HTML書き出し（v3.0.0）

Project Explorerでチケットを選択し、「#番号 以下をHTML書き出し」を押すと、
選択チケットおよび配下の子孫チケットをZIP形式で保存できます。

出力内容:

- 折りたたみ可能な `index.html`
- チケットごとの詳細HTML
- 親子チケット間リンク
- コメント
- カスタムフィールド
- 添付ファイル
- ツリーへ戻るボタン


## v3.2.0
- 表示設定の「終了・却下を表示」、ステータス、優先度フィルターをHTML書き出しにも反映
- フィルターで非表示のチケットは個別HTML・添付ファイルも書き出さない
- 「子チケット数を表示」を追加（初期値OFF、ブラウザに保存）
- 子チケット数は現在表示中の子孫チケット数を表示
- HTML書き出しでも子チケット数表示設定を反映



## PDF出力（v3.4.6）

Redmine標準PDF出力では、シーケンス図を完全ローカルでPNG化して埋め込みます。

- Mermaidコードを内蔵レンダラーでSVG生成
- ローカルのImageMagick (`magick`) でSVGをPNGへ変換
- RBPDFにはPNGを渡してPDFへ埋め込み
- CDN、外部API、外部レンダリングサーバーは使用しない
- 生成キャッシュは `tmp/redmine_project_explorer_pdf` 配下のみを使用

## Mermaidシーケンス図（v3.3.0）

Redmineのチケット本文およびWikiで、`sequenceDiagram` から始まるMermaidコードブロックをシーケンス図として表示します。

- 通常は本文幅いっぱいに自動表示
- 「その他」からプレビューオプションを表示／非表示
- ズーム機能（任意）
- スクロール表示（任意）
- PNG / JPEG / SVG 保存
- PNG/JPEGは保存時の幅・高さ（px）を指定可能
- 初期保存解像度は画面上の表示サイズ
- JPEG品質・背景色を指定可能

現時点の内蔵レンダラーは `sequenceDiagram` を対象とし、participant/actor、メッセージ、Note、alt/else/end、opt/loop/par/critical/break の基本構文をサポートします。


## Mermaidシーケンス図 UI改善（v3.3.3）

- Mermaidコード表示時はコードをシーケンス図の上側に表示
- プレビューオプションは右側サイドパネルに表示し、内部の重複メニューは廃止
- ズーム有効時は右側に `− / 100% / ＋ / 100%に戻す` を表示
- 「画面表示をリセット」はズームを100%へ戻し、ズーム・スクロールをOFFにする（画像保存設定は変更しない）


## Mermaidシーケンス図 UI改善（v3.3.4）

- 右側プレビューオプションの文字崩れを修正
- ズーム操作は画面表示セクションに常時表示（50%〜300%、10%刻み）
- 画像保存設定は「画像保存を初期化」で現在表示サイズ・白背景・JPEG品質90%へ戻せます

## Mermaidシーケンス図 UI改善（v3.3.6）

- プレビューオプション表示中はズーム操作を常時表示
- ズームはスクロール表示ON/OFFに関係なく利用可能
- 「スクロール表示を有効にする（縦・横）」をONにすると図領域内へ縦・横スクロールバーを表示
- スクロール表示OFF時は図領域内のスクロールバーを出さず、通常のページ表示として閲覧
- ボタン文字を上下中央揃えに修正



### v3.3.6 画面表示仕様
- スクロール表示OFF時はズーム操作を表示しない
- スクロール表示をOFFに戻すと、図は自動的に100%表示へ戻る
- ズームはスクロール表示ON時のみ利用可能

## Mermaidシーケンス図 UI改善（v3.3.7）

- 「スクロール表示を有効にする（縦・横）」チェックを廃止
- ズーム100%では図領域内の縦・横スクロールバーを表示しない
- 100%以外へズームした場合は、プレビューオプションの表示/非表示に関係なく縦・横スクロールバーを表示
- プレビューオプションを閉じても現在のズーム倍率を維持
- ズーム倍率は手動操作または「画面表示をリセット」の実行時だけ変更
- 100%へ戻した時点で縦・横スクロールバーを自動的に消す


## Mermaidフローチャート（v3.4.0）

Redmineのチケット本文およびWikiで、`flowchart` または `graph` から始まるMermaidコードブロックをフローチャートとして表示します。

- `flowchart TD/TB/BT/LR/RL` と `graph TD/TB/BT/LR/RL` を対象
- Redmine画面ではフローチャート描画処理を `sequence_diagram.js` に同梱し、追加アセット公開に依存しません
- 基本ノード（矩形、角丸、判定、円、サブルーチン、データベース）
- 基本エッジ（`-->`, `---`, `-.->`, `==>`）とエッジラベル
- シーケンス図と同じ「その他」メニュー、Mermaidコード表示、右側プレビューオプション
- 100%以外のズーム時に縦横スクロール
- PNG / JPEG / SVG 保存、保存解像度指定、画像保存初期化
- 実行時にCDN・外部API・Mermaidサーバーへ接続しない完全オフライン方式

現段階ではフローチャートの基本構文を対象とし、Mermaid全構文（高度なsubgraph、classDef/style/click等）の完全互換を目的とはしていません。


## Mermaid書き出し対応（v3.4.1）

- チケットツリーのHTML書き出しでも、シーケンス図／フローチャートをコードのままではなく図として表示
- 書き出しZIP内に描画用JavaScript/CSSを同梱するため、外部ネットワーク不要
- 書き出したHTMLをブラウザからPDF保存する場合も図として印刷
- Redmine標準の単一チケットPDF出力では `sequenceDiagram` をサーバー内蔵SVGレンダラーで画像化して出力

### PDF export

Redmine issue PDF export renders `sequenceDiagram` blocks as locally generated SVG images. Generated SVG files are cached under `tmp/redmine_project_explorer_pdf` and are read only by the local Redmine/RBPDF process. No external network service is used.


### v3.4.3 PDF修正
PDF出力時のシーケンス図変換パッチをRedmineのPDFヘルパ本体へ直接適用し、完全ローカルで生成したSVGをPDFへ渡します。外部CDN/API/サーバーは使用しません。
