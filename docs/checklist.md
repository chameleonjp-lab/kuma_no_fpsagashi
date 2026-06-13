# 受け入れチェックリスト（依頼書 §13 ＋ kit項目）

判定: OK / NG / 要実機。最終監査日 2026-06-13（メインセッション）。
検証手段の凡例: [H]=tools/core-harness.mjs / [S]=spec-verify（直接シミュレート）/ [D]=DOMモック結合テスト / [G]=grep / [R]=コード精読。

## 依頼書 §13

| # | 項目 | 判定 | 根拠 |
|---|---|---|---|
| 1 | iPhone SE相当（375×667）で横スクロールが出ず、全UIが収まる | OK(要実機) | [R][G] 100vw不使用・html/body overflow:hidden・app max-width480・固定幅は最大360(モーダル)で375内・controls試算252px。実機最終確認は納品後依頼 |
| 2 | ダブルタップ拡大・長押し・選択・ピンチズームが盤面/ボタンで発生しない | OK(要実機) | [R][G] viewport(user-scalable=no,maximum-scale=1)・touch-action:none・gesturestart/dblclick/contextmenu抑止・user-select:none |
| 3 | ダンジョンが毎回ランダム生成され下り階段へ必ず到達可能 | OK | [H] 2000回生成で連結性・部屋4-7・階段/初期位置分離を全件検証 |
| 4 | 階段降下で階数更新・深い階ほど強く（B16以深補正含む） | OK | [H][S] deepScale=ceil(基礎×(1+0.1×(階−15)))をHP/攻/防/exp全適用・B16〜B31で検証・B15以前は素通し |
| 5 | 死亡・あきらめ両方で結果画面・スコア＝最深到達階が正しい | OK | [D] endRun→B◯F表示・死因併記/あきらめ文言・自動プレイで遷移確認 |
| 6 | 独り言20秒間隔・41行一字一句正・連続しない・メニュー/結果で出ない | OK | [H][S][D] 41行バイト一致＋三点リーダ非混入・タイマー11項目（20s/4s/停止/累積維持/連続非重複/全41出現） |
| 7 | 音が一切鳴らない（Audio関連コードなし） | OK | [G] audio/AudioContext/oscillator/<audio>/new Audio いずれも実コードゼロ（コメント1件のみ） |
| 8 | 送信が「送信中→成功/失敗」表示・二重送信不可・失敗時のみ再試行 | OK | [D] fetchモック15項目（二重送信ブロック・状態表示・失敗時再試行・成功後ボタン無効） |
| 9 | 上位10件 score降順・到達階「B◯F」形式 | OK | [D][R] get_best_score_ranking(p_limit=100)→上位10件・`B${score}F`・順位はRPCのrank_no（同率対応）。降順はRPC側 |
| 10 | service_role key・パスワード類がHTMLに無い | OK | [G] service_role/secret/password/private_key いずれもゼロ。anon(publishable)のみ |
| 11 | 満腹度0でHP減・食料で回復 | OK | [H][S] 10ターンで1減・0で毎ターンHP-1・はちみつ+50/鮭+100&HP5・上限切り捨て |
| 12 | 全敵・全アイテム・全罠が仕様どおりの数値・挙動 | OK | [H][S] 敵6種/アイテム12種/罠3種の数値一致＋ヤマアラシ反撃(近接のみ)/ヘビ眠り20%実測/イノシシ2マス突進/しびれ麻痺 |
| 13 | もう一度・ホームへ・シェア・実験場へが機能 | OK | [R][D] btnAgain→newRun・btnHome→home・シェアWeb Share API+クリップボード fallback・実験場aタグ=LAB_URL |

## kit追加項目

| 項目 | 判定 | 根拠 |
|---|---|---|
| 古いタイトル・説明・文言・不要コードが残っていない | OK | [G] 旧仕様語彙(周回制/到達回数)なし・プレースホルダコメント除去済・TODO/未実装残骸なし |
| console.log が残っていない（warnはSupabase失敗時のみ許容） | OK | [G] console.log実呼び出しゼロ・console.warnは送信失敗の1件のみ |
| シェア文にURLが含まれる | OK | [R] doShareがtext+location.hrefを付与（共有/コピー両経路） |
| ランキング0件でも表示が壊れない | OK | [D] 0件は「まだ記録がありません」 |
| 名前未入力でも既定値「ななしのくま」で進行 | OK | [R] btnGoでtrim後空なら CONFIG.DEFAULT_NAME |
| 全操作ボタンが44×44px以上 | OK | [G] dpad48/攻撃64×80/足踏み・メニュー44/使う置く44/投擲56/タブ44/リンク44 |
| tools/core-harness.mjs 全テスト合格 | OK | [H] data/mono/formulas/items/gen/bot 合格569 不合格0 スキップ0（bot最深B22-29F） |

## 総合判定

**条件付きOK（リリース可）**。コード根拠・自動検証では全項目合格。残る条件は次の2点（実機/運用での最終確認）:
1. iPhone SE実機での横スクロール無・タッチ抑止・操作性の目視確認（§13-1,2）。本環境にブラウザが無いためコード根拠で判定。
2. Supabase `games` 登録SQL実行と実験場ページ反映（§9.5・P9で手順提供）。RPC `submit_score`/`get_best_score_ranking` は既存共通スキーマを使用（本環境からsupabase.coへ到達不可のため実通信は未確認）。
