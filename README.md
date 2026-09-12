# 馬術部サイト

北海道大学馬術部の当番・手入れ・大会人員表の画面。**GitHub Pages に置く静的サイト**。

## なぜ Apps Script の外に出したか（2026-09-12）

`script.google.com` にある画面は、ブラウザの Google セッションが必ず付く。
**2つ以上のアカウントに同時ログインしていると「現在、ファイルを開くことができません」になる。**
公開設定を「全員（匿名含む）」にしても避けられなかった（実測で確認）。

| 確かめたこと | 結果 |
|---|---|
| ログアウト状態の `curl` | すべて 200 |
| デプロイを作り直す | 変わらず |
| `/a/gmail.com/` を挟む | 効かない（ブラウザ側で `/u/1/` に飛ばされる） |
| シークレットウィンドウ | 開ける |

つまりアプリではなく**開く側のログイン状態**の問題。
別ドメインに置いた画面からの `fetch` は Cookie を送らないので、この振り分け自体が起きない。

## 作り

```
build.js      GASのHTMLから docs/ を組み立てる
mypage.js     入口（マイページ）の中身。build.js が焼き込む
mypage.css    そのぶんの見た目
tests/        検査いろいろ
docs/         GitHub Pages が配るもの
```

**原本は GAS のプロジェクトのまま**（`Documents/当番・手入れシステム_GAS` と `Documents/人員表システム_GAS`）。
ここでは組み立てるだけなので、二重管理にならない。`build.js` がやるのは4つ。

1. `<?!= include('style') ?>` を `style.html` の中身に差し替える
2. `call()` を GAS の画面用の呼び出しから `fetch` に差し替える
3. 入口ページは `コード.gs` の `入口の中身()` を**実際に動かして**中身を焼き込む
4. 検索避けを入れる（`docs/robots.txt` と、各ページの `<meta name="robots" content="noindex, nofollow">`）
5. 入口に `mypage.js` と `mypage.css` を差し込み、2本のAPIのURLを渡す

スプレッドシートと Apps Script はそのまま残る。変わったのは**画面の置き場所と、呼び方だけ**。

### 呼び方

```
POST <ウェブアプリのURL>/exec
Content-Type: text/plain;charset=UTF-8
{"fn":"関数名","args":[...]}
  → {"ok":true,"value":...} か {"ok":false,"error":"..."}
```

`text/plain` にしているのは、`application/json` だとブラウザが事前確認（preflight の `OPTIONS`）を
投げるが、Apps Script がそれを受けられないため。

**呼べる関数は `コード.gs` の `外から呼べる関数` にあるものだけ。**
`google.script.run` と違い、ここは誰でも叩けるただのURLなので、初期設定やパスワード変更まで
届かないように名前で絞ってある。

## 直すとき

```
node build.js           # GASのHTMLから組み立て直す
node tests/apicheck.js  # 本物のウェブアプリに通してみる
```

画面の中身を直すときは **GAS 側の HTML を直してから `build.js`**。`docs/` を直接いじらない。

検査（`tests/`。どれも `node tests/〇〇.js`）:

| | 見ているもの | 件数 |
|---|---|---|
| `apitest.js` | `外から呼べる関数` が画面側の `call()`・入口の `mypage.js`・`コード.gs` の実体とずれていないか | 10 |
| `toubantest.js` | 当番・手入れ・休みの中身（Nodeの模擬スプレッドシートで `コード.gs` を動かす） | 254 |
| `synctest.js` | 人員表システムとの名簿の同期 | 36 |
| `apicheck.js` | 本物のウェブアプリへの往復（Cookieなし。マイページまで） | 14 |

Apps Script は続けて叩くと、たまにJSONではなくHTMLのエラーページを返す。
`apicheck.js` は間を置いて1度だけ試し直すので、そこで落ちたときは本当に壊れている。

## ページ

| ファイル | 中身 | どこの |
|---|---|---|
| `index.html` | 入口。`?role=chieflinks` / `?role=admlinks` で切り替え | 当番・手入れ |
| `touban.html` | 当番の希望を出す | 当番・手入れ |
| `teire.html` | 手入れの希望を出す | 当番・手入れ |
| `touban-admin.html` | 当番をまとめる（副将パスワード） | 当番・手入れ |
| `teire-chief.html` | 手入れをまとめる（チーフパスワード） | 当番・手入れ |
| `yasumi.html` | 休みを申し込む | 当番・手入れ |
| `yasumi-admin.html` | 休みをまとめる（副将パスワード） | 当番・手入れ |
| `taikai.html` | 大会の出欠を出す | 人員表 |
| `taikai-admin.html` | 人員表をまとめる（管理者パスワード） | 人員表 |

入口は**マイページ**。名前を選ぶと、その人の「これから」「まだ出していないもの」「毎週」
「サブの馬・有給の残り」が出て、その下に上の一覧が並ぶ。中身は2つの `getMyPage(名前)` を
並列で呼んで作る（開いてから出るまでおよそ6秒。Apps Script は元からこれくらいかかる）。

**覚えるのは名前**。当番・手入れ（`m_xxxxxxxxxx`）と大会人員表（`m_001`）で部員IDの体系が違い、
画面が全部おなじドメインに並んでいるので、IDのまま覚えると画面を移るたびに当てが外れる。

入口から中へは**同じフォルダの相対リンク**なので、置き場所を変えても付いていく。

## 配るURL

```
部員   https://hokudaiequestrian-design.github.io/
チーフ https://hokudaiequestrian-design.github.io/?role=chieflinks
副将   https://hokudaiequestrian-design.github.io/?role=admlinks
```

入口の `?role=` だけで切り替わる。中のページへは入口から入る。

## 検索避け

GitHub Pages を無料で使うにはリポジトリが public でなければならないので、**このURLは誰でも読める**。
出欠と休みの画面はパスワードなしで開ける作りなので、URLを見つけた人は**部員の名前を取れる**。
そのぶんを少しでも狭めるため、`docs/robots.txt` でクロールを止め、各ページにも `noindex` を入れてある。

それでも「知っている人だけが開ける」程度の守りでしかない。もっと絞るなら、
部員共通の合言葉を出欠・休みの画面にもかけることになる（作りの変更が要る）。
