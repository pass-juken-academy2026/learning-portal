# ④ 補強・再設計・検証：実施記録（2026-10-28）

## 目的と判定基準

対象は11リポジトリ。設問データの構造、正答キーと説明の整合、重複、試験形式、UI/レスポンシブ、修正後CIを確認した。構造テストの合格は、すべての事実・正答・解説を独立に証明したことを意味しない。

## 今回反映した改善

| 対象 | 実施内容 | 反映・検証 |
|---|---|---|
| 中学数学 | 9問から13問へ増補。確率の解説にあった矛盾文を修正。6分野の最低問題数を検査 | [PR #16](https://github.com/pass-juken-academy2026/math-juken-saitama/pull/16) main反映、静的検証/UI監査成功 |
| 中学国語 | 8問から12問へ増補。漢字・語彙を追加。実際に回答を書く記述式ページを追加 | [PR #13](https://github.com/pass-juken-academy2026/junior-japanese/pull/13)、[PR #14](https://github.com/pass-juken-academy2026/junior-japanese/pull/14) main反映、静的検証/UI監査成功 |
| 中学理科 | 8問から13問へ増補。化学・生物・地学・計算・実験条件の問題を追加 | [PR #14](https://github.com/pass-juken-academy2026/junior-science/pull/14) main反映、静的検証/UI監査成功 |
| 中学社会 | 8問から13問へ増補。統計・経済・記述の問題を追加。実際に回答を書く記述式ページを追加 | [PR #13](https://github.com/pass-juken-academy2026/junior-social-studies/pull/13)、[PR #14](https://github.com/pass-juken-academy2026/junior-social-studies/pull/14) main反映、静的検証/UI監査成功 |
| 高校国語 | 全47問について、問題文・4択・正答インデックス・解説・正規化重複を検査するCIチェックを追加 | [PR #38](https://github.com/pass-juken-academy2026/highschool-japanese/pull/38) main反映、静的検証/UI監査成功 |
| 高校数学 | 円の中心間距離dの条件を明確化。二項分布の標準偏差式の閉じ括弧を修正 | [PR #36](https://github.com/pass-juken-academy2026/highschool-math/pull/36) main反映、静的検証/UI監査成功 |
| 高校理科 | 生物の同一刺激文内にあった意味的重複を、30℃から40℃への反応速度変化を問う問題に置換 | [PR #39](https://github.com/pass-juken-academy2026/highschool-biology/pull/39) main反映、静的検証/UI監査成功 |
| 高校社会 | 地理データの重複説明、12箇所の混在表記「hazard」、統合分野の同一イベントを比較する行を修正。重複文・自己比較の検査を追加 | [PR #53](https://github.com/pass-juken-academy2026/highschool-social-studies/pull/53) main反映、PR上の静的検証/UI監査成功。mainのUI監査は確認中 |
| 英語 | リスニング30問の台本・正答・解説・計算整合を確認。既存監査でリーディング60問・リスニング30問の構造を検査 | [既存の検証実行](https://github.com/pass-juken-academy2026/english-study/actions/runs/40618184404)、[UI監査](https://github.com/pass-juken-academy2026/english-study/actions/runs/40618184371)成功 |
| 高校情報 | 20問の平均・中央値・配列処理・セキュリティ問題の正答と解説を確認 | [検証実行](https://github.com/pass-juken-academy2026/highschool-information/actions/runs/40617746229)、[UI監査](https://github.com/pass-juken-academy2026/highschool-information/actions/runs/40617746173)成功 |

## 内容面の重点確認

- 高校数学：Math I/A 23問、Math II/B/C 31問について、主要な計算・式変形・解説を確認。
- 高校理科：生物・化学・物理・地学各25問の資料と計算、正答キー、解説を確認。
- 高校社会：練習ページ20問の人口比率、アンケート比率、予算計算、資料読解を確認。6トラックの36ケース・168小問と大規模学習バンクは構造・重複・形式検査を確認。
- 高校国語：47問の選択肢・正答キー・解説の構造を検査し、主な本文と設問・解説の対応を確認。
- 中学4科目：追加した各13問について、問題文・選択肢・正答・解説を確認。
- 英語：リスニング30問の台本に基づく正答・説明と計算問題を確認。リーディング全60問の独立した英文精読は完了証明なし。

## 公式形式の参照

- 大学入試センター「令和8年度 本試験の問題」：https://www.dnc.ac.jp/kyotsu/kakomondai/r8/r8_honshiken_mondai.html
- 文部科学省「令和8年度大学入学共通テスト 出題教科・科目の出題方法等」：https://www.mext.go.jp/content/20250828-mxt-daigakuc02-000044252_07.pdf

公開資料にある時間設定を照合：国語90分、数学Ⅰ・Aと数学Ⅱ・B・C各70分、英語リーディング80分、英語リスニング60分（解答時間30分）、情報Ⅰ60分。理科・地歴公民の科目別時間も参照資料で確認。英語リスニングは公式音声ではなくブラウザ合成音声である点を表示。

## ④を「全件完了」と断定できない残項目

1. 高校社会の全学習バンク（数千件）について、すべての事実内容を人手で独立検証すること。
2. 全11リポジトリのすべての解説を独立に再計算・再読解すること。
3. 全問題の意味的重複（表現を変えた重複を含む）を全件検出すること。
4. 公式の令和8年度本試験と、各設問の刺激文・設問数・難度・出題意図を一問ずつ照合すること。
5. 全ページ・全リンク・すべての操作経路について、深いリンク監査を完了すること。
6. 高校社会の修正をmainへ反映した後のUI監査が完了すること。

したがって、今回の④は複数の修正・検証を反映したが、上記の全件確認が残っているため、まだ「④全完了」とは判定しない。未検証の内容を合格扱いにしない。
