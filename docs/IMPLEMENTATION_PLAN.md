# 熊のFP探し 実装計画書

作成日: 2026-06-12 ／ 対象仕様: docs/game-spec.md（依頼書v1.1）

## 1. 成果物（依頼書 §12）

1. `index.html`（公開正本・単一ファイル・外部アセットなし・音声なし）
2. Supabaseセットアップ用SQL（チャット提示。ファイル化しない）
3. 動作確認報告（§13チェックリスト → docs/checklist.md）
4. 実験場側の反映が必要である旨の報告（§9.5）
5. 依頼書と異なる実装の一覧と理由（docs/decisions.md に集約）

## 2. 事前調査の結果（確定事項）

- kit（chameleonjp_browser_game_kit）、実運用ゲーム johba、実験場リポジトリ chameleonjp_lab を精読済み。
- **実験場URL**: `https://chameleonjp.codeberg.page/chameleonjp_lab/`（kit docs/lab-integration.md で定義。依頼書§4.1の【要記入】に充当・要確認）
- **Supabase接続値**（kit docs/ranking-spec.md「公開してよい値」）:
  - URL: `https://mlpnjgezrnhdxsxolyzj.supabase.co`
  - Publishable key: `sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM`
- **ランキング作法の正本**: johba index.html の SUPABASE セクション。
  - RESTを直接fetch（supabase-js不使用）。ヘッダ apikey + Authorization Bearer + Content-Type。8秒タイムアウト（AbortController）。
  - 送信RPC `submit_score {p_display_name, p_game_slug, p_score, p_client_version}`
  - 取得RPC `get_best_score_ranking {p_game_slug, p_limit}` → `[{rank_no, display_name, score}, ...]`
  - 表示は textContent のみで構築（display_name は外部データ、XSS対策）。
- **実験場の最新方針**: 表示ゲームの正は Supabase `public.games`（is_active=true, display_order asc）。
  旧来の `GAMES` 固定配列はフォールバックとして残存しうる → 納品時に「games行の登録＋実験場側ページの確認」を報告（§9.5）。
- 依頼書 §9.2 の専用テーブル `kuma_fp_scores` 案は **使わない**（§0.3「雛形優先」により共通スキーマ＝games登録＋RPCへ差し替え。差分は decisions.md に記録し納品時報告）。

## 3. アーキテクチャ

### 3.1 ファイル構成

- `index.html` … 公開正本（HTML+CSS+JS 一体）
- `docs/` … game-spec.md（正式仕様）/ 本計画書 / decisions.md / checklist.md
- `tools/core-harness.mjs` … CORE層のヘッドレス検証（開発用。公開物ではない）

### 3.2 index.html セクションマップ（実装順に並べる）

```
<head>  viewport(user-scalable=no, maximum-scale=1, viewport-fit=cover), CSS
<body>  #screenHome / #screenName / #screenGame(HUD, canvas+minimap, log, controls) /
        #screenResult(結果, スコア, 送信UI, ランキング, ボタン群) /
        #ruleModal / #menuModal / #confirmDialog / #dirOverlay
<script>
  // ==== SECTION: CONFIG ====      Supabase値, LAB_URL, 全バランス定数（仕様§参照コメント付き）
  // ==== SECTION: DATA ====        敵6種/アイテム12種/罠3種テーブル, MONOLOGUE_LINES(41行)
  // ==== CORE-BEGIN ====           ※DOM/Canvas非依存。node抽出で検証
  // ==== SECTION: UTIL ====        乱数ヘルパ等
  // ==== SECTION: DUNGEON-GEN ===  フロア生成＋BFS連結検証＋配置
  // ==== SECTION: TURN-CORE ====   移動判定/戦闘式/敵AI/ターン解決/満腹・回復/罠/状態異常/経験値/湧き
  // ==== CORE-END ====
  // ==== SECTION: RENDER ====      カメラ/タイル/絵文字スプライト/視界減光/吹き出し/ミニマップ
  // ==== SECTION: HUD-LOG ====     HUD更新/メッセージログ(直近3行)
  // ==== SECTION: INPUT ====       8方向パッド(長押し160ms連続)/攻撃/足踏み/メニュー/キーボード/方向選択
  // ==== SECTION: MENU ====        持ち物(使う/置く)/装備/状態/あきらめる
  // ==== SECTION: MONOLOGUE ====   シャッフルバッグ/20秒タイマー(停止対応)/4秒吹き出し
  // ==== SECTION: UI-SCREENS ====  画面遷移/名前入力+localStorage/シェア/結果画面
  // ==== SECTION: SUPABASE ====    RPCヘルパ/手動送信+二重送信防止/上位10件+あなた◯位
  // ==== SECTION: BOOT ====
```

### 3.3 状態モデル

グローバルはゲーム状態オブジェクト `G` 1つに集約（依頼書§11）。
`G = { screen, playerName, run: { floor, deepest, turn, player{x,y,hp,maxHp,lv,xp,atk基礎,def基礎,satiety,inv[],weapon,shield,facing,sleep}, map{tiles32x20,rooms[]}, explored, enemies[], items[], traps[], stairs, spawnTick, deathCause, submitted, msgs[], mono{bag,pos,acc,showUntil,line} } }`

### 3.4 ダンジョン生成（依頼書§6.1の実装定義）

1. 32×20を4列×2行=8セクションに分割。4〜7セクションを無作為に選び、各内部に部屋（幅3〜6,高3〜6。仕様上限8×6の範囲内）を配置。
2. 隣接セクションの部屋同士をL字通路で接続：全域木＋確率で冗長辺を追加。
3. 全床タイルをBFSし、全部屋＋階段の到達可能性を**必ず検証**。不合格は再生成（上限つきループ）。
4. 階段とプレイヤー初期位置は別部屋。アイテム2〜4個、罠 rand(2..4)+floor((階-1)/6) 個（上限8、部屋床のみ）、敵3〜5体を配置。
5. 視界: 部屋内=部屋全体可視／通路=周囲1タイル。踏破タイルはミニマップへ（階段は視認後のみ）。

### 3.5 検証ハーネス（tools/core-harness.mjs）

CORE層を node で抽出実行し、以下を自動検証：
- フロア生成2,000回: 連結性・部屋数4〜7・階段/初期位置の分離・配置数・罠数上限
- ダメージ式 `max(1, atk−def+rand(−1..+1))`・必要経験値 `ceil(10×1.4^(n−1))`・B16以深係数 `ceil(基礎×(1+0.1×(階−15)))`
- 独り言41行が docs/game-spec.md のコードブロックとバイト一致・シャッフルで直前重複なし
- ランダム入力ボットで複数フロア自動プレイし例外ゼロ（クラッシュ検出）

## 4. フェーズ計画（担当と受け入れ基準）

| # | 内容 | 担当 | 受け入れ基準（抜粋） |
|---|---|---|---|
| P1 | リポジトリ骨格・本計画・規約類のコミット | メイン | 本書・decisions・checklist・CLAUDE.md が main 設計と一致 |
| P2 | 画面シェル：HTML/CSS/4画面遷移/名前入力+localStorage/シェア/ルール説明/タッチ抑止/操作UIのDOM | Sonnet | 375px幅で横スクロールなし・全ボタン44px+・遷移が機能（ゲームはスタブ） |
| P3 | ダンジョン生成＋描画：CORE生成器/視界/カメラ/タイル+絵文字描画/ミニマップ/ハーネス初版 | Opus | ハーネス生成テスト合格・B1が描画され熊が見える |
| P4 | ターンエンジン：移動/攻撃/敵AI6種/湧き/満腹・回復/罠/状態異常/階段降下/死亡/深層補正 | Opus | ハーネスのボット自動プレイ合格・§7/§8の数値どおり |
| P5 | アイテム＆メニュー：拾得/持ち物10/使う・置く/装備/投擲方向UI/あきらめる | Sonnet | 12アイテム全効果・装備1ターン・満杯時メッセージ |
| P6 | 独り言＋結果画面＋HUD仕上げ（41行はメインが厳密注入） | Sonnet→メイン | バイト一致テスト合格・20秒間隔/4秒表示/停止条件 |
| P7 | Supabaseランキング（johba作法・手動送信・二重送信防止・上位10＋あなた◯位） | Sonnet | 送信中→成功/失敗表示・失敗時のみ再試行・B◯F表示 |
| P8 | 総監査：ハーネス全テスト・§13全項目・kitレビュー観点（mobile/ranking/balance）・console.log除去 | メイン(+レビューsubagent) | checklist.md 全項目判定・残課題ゼロまたは明記 |
| P9 | 納品：最終コミット/push・SQL・報告書 | メイン | §12の5点が揃う |

各フェーズ完了ごとにコミットし `claude/beautiful-allen-ub85cz` へ push（コンテナ揮発対策）。
subagent への指示書は自己完結（仕様該当章の要約＋設計契約＋受け入れ基準を明記し、当人に依頼書全文を読ませない）。

## 5. §13チェックリストとの対応

§13の1,2 → P2+P8（レイアウト/タッチ抑止）／3,4 → P3+P4＋ハーネス／5 → P4+P6／6 → P6＋バイト一致テスト／7 → P8 grep（Audio系ゼロ）／8,9,10 → P7+P8／11,12 → P4+P5＋ハーネス／13 → P2+P6+P8。

## 6. リスクと対応

- **RPC `get_best_score_ranking` の戻り値詳細が実環境未確認**（本環境から supabase.co へ接続不可）
  → johba実装と同一の呼び出し・防御的フィールド参照（rank_no ?? rank）で実装し、取得失敗時は「ランキングを取得できませんでした」でゲームを妨げない（§9.4）。納品時に実機確認を依頼。
- **「あなた：◯位」**: 共通RPCはプレイヤー毎ベスト集計のため、p_limit=100で取得し display_name 一致行の rank_no を表示。同名衝突・100位圏外の限界を decisions.md に明記。
- **単一ファイルへの多人数(多agent)編集の競合** → フェーズは直列実行。並行編集はしない。
- **iPhone SE実機の最終確認は本環境から不可** → 納品報告に手動確認手順を明記。

## 7. 要確認（依頼者へ・納品報告に再掲）

1. 実験場URLは kit 定義値で充当した（§4.1【要記入】）。変更があれば CONFIG の `LAB_URL` 1箇所を修正。
2. game_slug=`kuma_no_fpsagashi`・公開URL=`https://chameleonjp.codeberg.page/kuma_no_fpsagashi/` 想定の妥当性。
3. games行の display_order・description・share_text の文言。
4. §9.2専用テーブル案→共通スキーマ（games+RPC）への差し替え承認（§0.3に基づく既定動作）。
