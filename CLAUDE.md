# Claude Code Instructions

このリポジトリ「kuma_no_fpsagashi（熊のFP探し）」は、カメレオンJPのスマホブラウザ向けターン制ローグライクです。
共通ルールは chameleonjp_browser_game_kit を継承しています（以下に転載）。

## 基本方針

- 公開ゲーム本体は、原則としてゲームごとのリポジトリで管理する。
- 公開正本は常に `index.html` とする。
- HTML、CSS、JavaScriptは原則1ファイルにまとめる。
- npm、Node、ビルドツール、フレームワークを勝手に追加しない。
- Codeberg Pagesで公開できる構成を優先する。
- ゲーム仕様を勝手に変えない。
- 不明点は断定せず、未確認または要確認と書く。

## スマホ対応

- iPhone SE級の小さい画面でも遊べることを必須にする。
- 横スクロールを出さない。
- ゲーム中の長押しメニュー、テキスト選択、ダブルタップ拡大、不要なページスクロールを抑える。
- ピンチズームを許可するか止めるかは、ゲームごとに仕様書へ明記する。
- 操作ボタンはスマホで押しやすい大きさにする。

## 画面構成

標準の画面遷移は、ホーム → 名前入力またはカウントダウン → ゲーム → 結果。

ホームには、ゲーム開始、ルール説明、ゲームをシェア、実験場へのリンクを置く。
結果画面には、結果、スコア、ランキング送信状態、もう一度、結果をシェア、ホームへ、実験場へを置く。
ランキング対応ゲームでは、仕様に応じて結果画面下部にランキングを表示する。

## Supabase

- ランキング対応ゲームではSupabase連携を基本にする。
- Publishable keyは公開HTMLへ入れてよい。
- service_role key、DBパスワード、秘密鍵は絶対にクライアント側へ入れない。
- スコア送信は二重送信を防ぐ。
- 送信中、成功、失敗を画面に表示する。
- SQLはファイルではなく、チャットにコピペできる形式で出す。

## 実験場連携

新しいゲームを公開する場合、ゲーム本体だけでなく、Supabase、実験場トップ、詳細ランキングページも確認する。
実験場側に `GAMES` 配列がある場合は、Supabase登録だけでは表示されないため、固定配列への追加も確認する。

## ファイル名

- 公開正本は `index.html`。
- 古いコード参照用の途中版は `index_v2.html`、`index_v3.html` のように名前を変える。
- 古いファイルを上書きして履歴が分からなくなる作業は避ける。

## 作業後の確認

作業後は、仕様との不一致、不具合、古い文言、不要コード、スマホ操作、ランキング送信、二重送信、ゲームバランスを確認する。

---

# kuma_no_fpsagashi 固有ルール

- 正式仕様は `docs/game-spec.md`（依頼書v1.1の全文）。本書に書かれていない仕様を勝手に追加・変更しない。
  判断が必要だった点は `docs/decisions.md` に日付つきで必ず1行残す。
- ランキング仕様は依頼書 §0.3 により kit／実運用（johba）の作法を優先する。差分は `docs/decisions.md` と納品報告に記録済み。
  - Supabase連携は supabase-js を使わず **RESTを直接fetch**（`/rest/v1/rpc/...`、apikey + Authorization Bearer の両ヘッダ必須）。
  - 送信は `submit_score`（p_display_name / p_game_slug / p_score / p_client_version）。
  - 取得は `get_best_score_ranking`（p_game_slug / p_limit）→ 行は rank_no / display_name / score。
  - `display_name` は外部データ。**必ず textContent で描画**（innerHTML禁止、XSS対策）。
- 音声は一切実装しない（BGM・効果音・Web Audio API・Audio要素すべて禁止。依頼書 §1）。
- ピンチズームは禁止（依頼書 §3 の確定事項。viewport の user-scalable=no / maximum-scale=1、touch-action、gesturestart 抑止で実装）。
- バランス調整値・Supabase接続値・実験場URLは、すべて `index.html` スクリプト先頭の `CONFIG` 定数ブロックに置き、コード内に数値を散らさない。
- ゲームロジック層（ダンジョン生成・ターン解決・戦闘・敵AI・状態異常・満腹度）は DOM / Canvas に依存させない。
  `// ==== CORE-BEGIN ====` 〜 `// ==== CORE-END ====` マーカー間を node で抽出してヘッドレス検証できる構造を保つ（`tools/core-harness.mjs` 参照。公開物ではない開発用ツール）。
- `index.html` 内は `// ==== SECTION: 名前 ====` 形式のバナーコメントで区切り、後続作業が該当箇所だけ読めるようにする。
- 独り言の41行リスト（依頼書 §8.2）は一字一句変更禁止。`tools/core-harness.mjs` のバイト一致テストを必ず通すこと。
- 受け入れ条件は `docs/checklist.md`（依頼書 §13 + kit項目）。フェーズ完了ごとに判定を更新する。
- 実装フェーズ計画は `docs/IMPLEMENTATION_PLAN.md`。

## モデルの使い分け（subagent運用）

- メインセッション：設計、subagentへの指示書作成、成果物の監査・レビュー。実装難易度が特に高い箇所
  （独り言リストの厳密注入、監査で見つかった統合バグ、subagentが2回失敗した箇所）のみ直接実装してよい。
- Sonnet subagent：定型的・分量の多い実装。画面UI、CSS、HUD、メニュー、アイテム効果、Supabase連携、決まった仕様の書き起こし。
- Opus subagent：難度中〜高の実装。ダンジョン生成、ターンエンジン、敵AI、視界・描画。
- subagentへの指示書は自己完結させる（仕様書の該当章と設計契約を渡し、リポジトリ全文を読ませない）。
- メインセッションは成果物を差分中心でレビューし、ファイル全文の読み直しを最小限にする。
