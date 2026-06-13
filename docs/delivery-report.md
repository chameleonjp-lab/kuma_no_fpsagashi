# 納品報告：熊のFP探し（kuma_no_fpsagashi）

作成日 2026-06-13 ／ 対象仕様 docs/game-spec.md（依頼書v1.1）

## 1. 納品物（依頼書§12）

1. `index.html` … 公開正本・単一ファイル（HTML+CSS+JS一体・外部アセットなし・音声なし）
2. Supabase `games` 登録SQL … 本書 §4（納品チャットにもコピペ形式で提示）
3. 動作確認報告 … `docs/checklist.md`（§13全項目＋kit項目の判定）
4. 実験場への反映が必要である旨の報告 … 本書 §5
5. 依頼書と異なる実装の一覧と理由 … 本書 §6（詳細は `docs/decisions.md`）

## 2. 実装サマリ

- Vanilla JS + Canvas 2D の単一HTML。フレームワーク・ビルド・外部CDN・画像/音声アセットなし。
- 画面遷移：ホーム → 名前入力 → ゲーム → 結果（kit標準）。
- ダンジョン：32×20・4〜7部屋・L字通路・BFS連結保証・エンドレス・B16以深で敵補正。
- ターン制：8方向移動（角抜け禁止）・攻撃・足踏み・アイテム・階段降下。敵6種AI・追加湧き・満腹度・自然回復・状態異常（眠り/しびれ）・罠3種。
- アイテム12種（食料/回復/投擲/武器/盾）・装備・置く・8方向投擲。
- 独り言：20秒ごと4秒・頭上吹き出し・41行シャッフルバッグ・メニュー/結果/ホームで停止。
- ランキング：Supabase REST直fetch・手動送信・二重送信防止・上位10件・「あなた◯位」・XSS対策（textContent）。
- スマホ：iPhone SE前提・横スクロール無・ピンチズーム/長押し/ダブルタップ拡大抑止・全ボタン44px以上・safe-area対応・横持ち案内。

## 3. 検証

- `tools/core-harness.mjs`（開発用・非公開）でCORE層をnode抽出し自動検証：合格569／不合格0／スキップ0（bot自動プレイ最深B22〜29F・例外ゼロ）。
- 追加でDOMモック結合テスト（画面遷移・メニュー・投擲・ランキング送信・独り言タイマー）を実施し全合格。詳細は `docs/checklist.md`。
- 本環境からは Codeberg Pages・Supabase へネットワーク到達不可のため、実機ブラウザ表示とSupabase実通信のみ未確認（納品後の確認を依頼）。

## 4. Supabase セットアップSQL

ランキングは依頼書§9.2の専用テーブル案ではなく、kit/実運用共通の **`public.games` 登録＋共通RPC（submit_score / get_best_score_ranking）** 方式を採用（§0.3「雛形優先」）。
共通の得点テーブルとRPCは既存プロジェクトに既設（johba等と共用）のため、本ゲーム固有のセットアップは **`games` への1行登録のみ**。Supabase SQL Editor に貼り付けて実行する：

```sql
insert into public.games (
  display_order, game_slug, title, game_url, description, share_text,
  is_active, top_ranking_type, score_order, score_unit, score_scale, score_decimals,
  score_label, first_score_label, best_score_label, release_date
) values (
  50,
  'kuma_no_fpsagashi',
  '熊のFP探し',
  'https://chameleonjp.codeberg.page/kuma_no_fpsagashi/',
  'FP＝ファーストパートナーを探して、熊はどこまでも深いダンジョンへ潜っていく。ターン制ローグライク。スコアは最深到達階。',
  '『熊のFP探し』FPを探して底なしダンジョンへ。どこまで潜れる？',
  true,
  'best',
  'desc',
  '階',
  1,
  0,
  '到達階',
  '初回到達階',
  '最高到達階',
  current_date
)
on conflict (game_slug) do update set
  display_order   = excluded.display_order,
  title           = excluded.title,
  game_url        = excluded.game_url,
  description     = excluded.description,
  share_text      = excluded.share_text,
  is_active       = excluded.is_active,
  top_ranking_type= excluded.top_ranking_type,
  score_order     = excluded.score_order,
  score_unit      = excluded.score_unit,
  score_scale     = excluded.score_scale,
  score_decimals  = excluded.score_decimals,
  score_label     = excluded.score_label,
  first_score_label = excluded.first_score_label,
  best_score_label  = excluded.best_score_label,
  release_date    = excluded.release_date;
```

- `display_order`(50)・`description`・`share_text` の最終文言は依頼者の好みに合わせて調整可（要確認）。
- 万一このSupabaseプロジェクトに共通の得点テーブル・RPCが未設置だった場合は、その共通スキーマSQL（johba等と同一）が別途必要。kit/実運用の既設前提のため本書には含めない。

## 5. 実験場連携（依頼書§9.5・要対応）

実験場（chameleonjp_lab）の最新方針では、表示ゲームの正は Supabase `public.games`（is_active=true）。上記SQL実行で実験場トップ・詳細ランキングに反映される想定。
ただし実験場トップ/詳細ページに旧来の `GAMES` 固定配列が残っている場合は、Supabase登録だけでは一覧に出ないため、同じ `game_slug`・タイトル・URL・説明・スコア設定を**固定配列にも追加**する必要がある（配列編集は依頼者側の作業）。
納品後、次を確認のこと：
- 実験場トップに「熊のFP探し」が表示される／カードが開く／遊ぶボタンが game_url へ飛ぶ。
- 詳細ランキング `ranking.html?game=kuma_no_fpsagashi` が開く・0件でも壊れない。
- ゲーム内ランキングは「B◯F」表示、実験場側の汎用表示は「◯階」表示（プレフィックスBの有無の差。実験場側仕様）。

## 6. 依頼書と異なる実装（§12-5・理由は docs/decisions.md に詳細）

| 箇所 | 依頼書 | 実装 | 理由 |
|---|---|---|---|
| ランキングのDB | §9.2 専用テーブル `kuma_fp_scores`＋RLS | 共通 `games` 登録＋共通RPC | §0.3「リポジトリ雛形を優先」。kit/実運用の共通スキーマに統一 |
| 送信RPC | （表に明記なし） | `submit_score`（p_display_name/p_game_slug/p_score/p_client_version） | kit ranking-spec・johba作法 |
| 取得・順位 | created_atタイブレーク | `get_best_score_ranking` の `rank_no`（同率順位対応）をそのまま表示 | 同上。RPCが順位を返す |
| 接続方式 | supabase-js or REST（採用を報告） | **REST直接fetch**（apikey+Authorization Bearer） | 単一ファイル・外部CDN回避。kit/johba一致 |
| 実験場URL | §4.1【要記入】 | kit定義の `https://chameleonjp.codeberg.page/chameleonjp_lab/` | 依頼書未記入のため既定値を採用（要確認・CONFIG.LAB_URL1箇所で変更可） |
| 「あなた◯位」 | 欄外に正確な順位 | p_limit=100取得から同名一致の rank_no を表示（100位圏外は明示） | 共通RPCはプレイヤー毎ベスト集計のため近似 |

## 7. 要確認事項（依頼者へ）

1. 実験場URL（CONFIG.LAB_URL）— kit既定値で実装。変更があれば連絡を。
2. game_slug=`kuma_no_fpsagashi`／公開URL=`https://chameleonjp.codeberg.page/kuma_no_fpsagashi/` で問題ないか。
3. `games` 登録の display_order・description・share_text 文言。
4. §9.2専用テーブル案→共通スキーマ方式への差し替え承認（§0.3に基づく既定動作）。
5. iPhone SE実機での表示・操作（本環境にブラウザなし）。

## 8. 手動確認手順（依頼者向け）

1. `index.html` をスマホSafariで開く（またはCodeberg Pagesへ配置）。
2. ホーム→名前入力→ゲーム開始。8方向パッドで移動、敵に隣接して「こうげき」、メニューから持ち物使用・装備。
3. 下り階段に乗ると確認ダイアログ→降りて階数(B◯F)が増えるのを確認。
4. 倒れる/あきらめるで結果画面→スコア(B◯F)・死因/あきらめ文言を確認。
5. 上記SQLを実行後、結果画面「ランキングに登録」→「送信中→送信しました」、再読込で順位表示を確認。連打で二重送信されないこと。
6. 横画面にして「縦にしてください」が出ること、ピンチズーム/長押し選択が起きないこと。
