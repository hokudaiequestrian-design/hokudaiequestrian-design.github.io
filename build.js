/**
 * 馬術部の画面を、GASのHTMLから静的サイトに組み立てる。
 *
 * なぜ外に出すか（2026-09-12）：
 * script.google.com にある画面はブラウザのGoogleセッションが必ず付く。
 * 2つ以上のアカウントに同時ログインしていると「現在、ファイルを開くことができません」になり、
 * 公開設定を「全員（匿名含む）」にしても避けられなかった（実測）。
 * 別ドメインに置いた画面からの fetch はCookieを送らないので、その振り分け自体が起きない。
 *
 * 原本はGASのプロジェクトのまま。ここでは組み立てるだけなので、二重管理にならない。
 *   1. <?!= include('style') ?> を style.html の中身に差し替える
 *   2. call() を google.script.run から fetch に差し替える
 *   3. 入口ページは コード.gs の 入口の中身() を実際に動かして中身を焼き込む
 *
 * 使い方: node build.js
 */
const fs = require('fs');
const path = require('path');
const NL = String.fromCharCode(10);

/*
  原本は改行を LF にそろえてから読む（2026-09-13）。
  このリポジトリは git の autocrlf が効いていて、チェックアウトすると原本が CRLF になる。
  下の 元のcall などの突き合わせは LF で書いてあるので、そろえないと「call() の形が原本と違う」で止まる。
*/
const 読む = (p) => fs.readFileSync(p, 'utf8').split(String.fromCharCode(13) + NL).join(NL);

/*
  画面の原本は、このリポジトリの 画面/ にある（2026-09-13、Apps Script から Cloudflare へ移すときに写した）。
  前は2つの GAS プロジェクトの HTML を直に読んでいた。GAS 側は切り替えまでの控えとしてもう触らない。
  入口の中身（入口の中身()）は、API の原本 馬術部API/src/touban.gs から読む。
*/
const 当番 = path.join(__dirname, '画面', '当番');
const 人員表 = path.join(__dirname, '画面', '人員表');
const 当番のコード = 'C:/Users/minuu/Documents/馬術部API/src/touban.gs';
const 出す先 = path.join(__dirname, 'docs');

/*
  呼び先は Cloudflare の API（馬術部API/worker）。呼び方は Apps Script のときと同じ
  （POST・text/plain・{fn,args}）なので、画面の call() から先はそのまま動く。
  前は表示を速くするための「写し」（bajutsubu-cache）も読んでいたが、API そのものが速くなったので使わない。
*/
const API元 = 'https://bajutsubu-api.hokudai-equestrian.workers.dev';
const API = {
  当番: API元 + '/touban',
  人員表: API元 + '/jinin',
};

// 出す先のファイル名。入口ページからは、この名前で相対リンクを張る。
const ページ = [
  { 出す: 'touban.html', 元: 当番 + '/member.html', api: API.当番, 題: '当番の希望を出す' },
  { 出す: 'teire.html', 元: 当番 + '/teire.html', api: API.当番, 題: '手入れの希望を出す' },
  { 出す: 'touban-admin.html', 元: 当番 + '/admin.html', api: API.当番, 題: '当番をまとめる' },
  { 出す: 'teire-chief.html', 元: 当番 + '/chief.html', api: API.当番, 題: '手入れをまとめる' },
  // 全部の馬のサブを1つの表で直す（2026-09-13）
  { 出す: 'teire-subs.html', 元: 当番 + '/subs.html', api: API.当番, 題: '手入れのサブをまとめて直す' },
  { 出す: 'yasumi.html', 元: 当番 + '/yasumi.html', api: API.当番, 題: '休みを申し込む' },
  { 出す: 'yasumi-admin.html', 元: 当番 + '/yasumiadmin.html', api: API.当番, 題: '休みをまとめる' },
  // みんなのカレンダー（手入れ・休み）。入口のマイページから入る（2026-09-13）
  { 出す: 'calendar.html', 元: 当番 + '/calendar.html', api: API.当番, 題: 'カレンダーを見る' },
  { 出す: 'taikai.html', 元: 人員表 + '/member.html', api: API.人員表, 題: '大会の出欠を出す' },
  { 出す: 'taikai-admin.html', 元: 人員表 + '/admin.html', api: API.人員表, 題: '人員表をまとめる' },
];

// ===== 1. include('style') を差し替える =====
function スタイルを埋める(html, プロジェクト) {
  const style = 読む(プロジェクト + '/style.html');
  const 印 = "<?!= include('style') ?>";
  if (html.indexOf(印) < 0) throw new Error('include(style) が見つからない');
  return html.split(印).join(style.trim());
}

// ===== 検索避け =====
// 部員の名前が出る画面なので、検索結果には出さない。GitHub Pages は public のリポジトリしか
// 配れないので、URLは誰でも読める。robots.txt でクロールを止めたうえで、
// どこかからリンクをたどられたときのために各ページにも noindex を入れる。
function 検索避けを入れる(html) {
  const 印 = '<base target="_top">';
  if (html.indexOf(印) < 0) throw new Error('<base target="_top"> が見つからない');
  return html.split(印).join(印 + NL + '<meta name="robots" content="noindex, nofollow">');
}

// ===== 2. call() を fetch に差し替える =====
// この build.js 自身が CRLF で置かれることがあるので、**中に書いた見本も LF にそろえてから**使う
// 原本の call() は google.script.run を Promise に包んだだけのもの。
// 呼び出し側（call('login', ...) など）はそのまま使えるように、名前も引数も返りも合わせる。
const 元のcall = `function call(fn) {
  const args = Array.prototype.slice.call(arguments, 1);
  busy(true);
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((r) => { busy(false); resolve(r); })
      .withFailureHandler((e) => { busy(false); reject(e); })[fn].apply(null, args);
  });
}`.split(String.fromCharCode(13) + NL).join(NL);

const 新しいcall = (api) => `const API = '${api}';

/**
 * サーバ（Apps Script）を呼ぶ。
 *
 * この画面は script.google.com の外に置いてあるので、GASの画面用の呼び出し口は使えない。
 * かわりに fetch で叩く。**別オリジンなのでCookieが飛ばない**ぶん、
 * 複数のGoogleアカウントに同時ログインしていても「ファイルを開くことができません」にならない。
 * 画面を外に出したのはそのため。
 *
 * Content-Type を text/plain にしているのは、application/json にすると
 * ブラウザが事前確認（preflight の OPTIONS）を投げ、Apps Script がそれを受けられないため。
 *
 * 通信のせいで失敗したとき（つながらない・HTMLのエラーページが返った）は、エラーに 通信: true を付ける。
 * サーバが断ったとき（入力の誤りなど）と分けて、送り直してよいかを画面が判断できるようにするため。
 *
 * **送信（submitResponse）だけは keepalive で送る。** 押してすぐ画面を閉じたり
 * マイページへ戻ったりしても、ブラウザが最後まで届けてくれる。keepalive で失敗したときは
 * 普通の送り方でもう一度だけ試す（出欠の送信は同じ中身で何度送っても結果が変わらない）。
 */
const 閉じても届ける = ['submitResponse'];

function call(fn) {
  const args = Array.prototype.slice.call(arguments, 1);
  busy(true);
  const 本文 = JSON.stringify({ fn: fn, args: args });
  const 送る = (keepalive) => fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: 本文,
    keepalive: keepalive,
  });
  const 届ける = 閉じても届ける.indexOf(fn) >= 0 && 本文.length < 60000;
  return (届ける ? 送る(true).catch(() => 送る(false)) : 送る(false)).then((res) => {
    if (!res.ok) throw new Error('つながりませんでした（' + res.status + '）。少し待ってから開き直してください。');
    return res.json();
  }).catch((e) => {
    const err = /^つながりませんでした/.test((e && e.message) || '') ? e
      : new Error('つながりませんでした。電波の良いところで、少し待ってから開き直してください。');
    err.通信 = true;
    throw err;
  }).then((r) => {
    if (!r.ok) throw new Error(r.error || '不明なエラーが起きました。');
    return r.value;
  }).finally(() => { busy(false); });
}`;

// ===== 2.2 Cloudflare の写しから読む =====
/**
 * 出欠の画面に「写しから読む(名前)」を差し込む。**原本（GASの画面）には無い**ので、
 * 画面は typeof で有無を見て、無ければ今までどおり Apps Script に聞く。
 * 5秒で返ってこなければ諦めて Apps Script に聞く（写しの窓口が止まっていても画面は動く）。
 */
const 写しの読み口 = (url) => `<script>
const 写しのURL = '${url}';
function 写しから読む(名) {
  const 止める = typeof AbortController === 'function' ? new AbortController() : null;
  const 時間切れ = setTimeout(() => { if (止める) 止める.abort(); }, 5000);
  return fetch(写しのURL + '/jinin/taikai?name=' + encodeURIComponent(名 || ''), {
    cache: 'no-store', signal: 止める ? 止める.signal : undefined,
  }).then((res) => {
    if (!res.ok) throw new Error('写しを読めませんでした（' + res.status + '）');
    return res.json();
  }).then((r) => {
    if (!r.ok) throw new Error(r.error || '写しを読めませんでした');
    return r.value;
  }).finally(() => clearTimeout(時間切れ));
}
<` + `/script>`;

function 写しを足す(html, url) {
  if (html.indexOf('</head>') < 0) throw new Error('</head> が見つからない');
  return html.replace('</head>', 写しの読み口(url) + NL + '</head>');
}

// 原本には call() の上に「google.script.run をPromiseで扱えるようにする」という
// 説明が付いているファイルがある。差し替えたあとに残ると嘘になるので、そこも消す。
function callを差し替える(html, api) {
  html = html.split('// google.script.run をPromiseで扱えるようにする' + String.fromCharCode(10)).join('');
  if (html.indexOf(元のcall) < 0) {
    throw new Error('call() の形が原本と違う。build.js の 元のcall を合わせ直すこと');
  }
  return html.split(元のcall).join(新しいcall(api));
}

// ===== 2.5 「マイページに戻る」 =====
/**
 * 入口（マイページ）へ戻るリンクを、各ページの見出し帯に足す。
 *
 * **原本（GASの画面）には入れない。** 入口ページは静的サイトにしか無く、
 * script.google.com 側に置くと行き先の無いリンクになるため、ここで足す。
 *
 * 立場（部員／チーフ／副将）は入口が localStorage に覚えるので、戻り先にも付け直す。
 * 覚えていなければただの index.html（＝部員用）に戻る。
 */
const 戻るの印 = /<header class="appbar([^"]*)">/;
const 戻るリンク = '<a class="backhome" href="index.html">← マイページ</a>';
const 戻るのCSS = `<style>
/* 「マイページに戻る」は**いつでも左上**に出す（2026-09-13にユーザーが決めた）。
   見出し帯ごと貼り付けておけば、下まで読んでいる途中でも戻れる。 */
header.appbar { position: sticky; top: 0; z-index: var(--z-sticky); }
header.appbar > span { margin-right: auto; }   /* 題が伸びて、ほかのリンクは右に寄る */
header.appbar a.backhome {
  border: 1px solid rgba(255, 255, 255, 0.75); border-radius: var(--radius-pill);
  padding: 4px 14px; text-decoration: none; font-weight: 700;
}
header.appbar a.backhome:hover { background: rgba(255, 255, 255, 0.15); }

/* 出し終わったときに、知らせの下に出すボタン（2026-09-13にユーザーが決めた）。
   出したあとは次の画面へ移ることが多いので、帯まで戻らなくても押せるところに置く。 */
a.donehome {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: var(--tap); margin-top: var(--space-sm); padding: var(--space-xs) var(--space-lg);
  background: var(--accent); color: #fff; font-size: var(--text-base); font-weight: 700;
  border-radius: var(--radius-input); text-decoration: none;
}
a.donehome:hover { background: var(--accent-dark); }
</style>`;
const 戻るのJS = `<script>
/*
  入口（マイページ）へ戻る道を2つ用意する。どちらも静的サイトだけのもの。
    1. 見出し帯の「← マイページ」…… いつでも左上に見えている
    2. 出し終わったときのボタン …… 送信できた知らせの下に足す

  2は、知らせを出すところが画面ごとにバラバラ（show() だったり innerHTML だったり）なので、
  **出てきた「成功の知らせ」を見つけて足す**形にしてある。そのぶん画面側は触らずに済む。
*/
(function () {
  let 戻り先 = 'index.html';
  try {
    const 立場 = localStorage.getItem('role');
    if (立場 && 立場 !== 'links') 戻り先 = 'index.html?role=' + encodeURIComponent(立場);
  } catch (e) { /* 保存できない設定でも、部員用の入口には戻れる */ }
  document.querySelectorAll('a.backhome').forEach((a) => { a.href = 戻り先; });

  // 「前回の回答を読み込みました」のような成功の知らせもあるので、**出し終わった知らせだけ**に付ける
  const 出し終わった = /(送信しました|出しました|申し込みました|受け付けました|登録しました|保存しました)/;

  const 足す = (el) => {
    if (!el || el.dataset.home === '1' || !出し終わった.test(el.textContent || '')) return;
    el.dataset.home = '1';
    // マイページが、サーバの返事を待たずに「まだ出していないもの」から消せるようにしておく
    try {
      localStorage.setItem('mypage:出したところ', JSON.stringify({
        url: location.pathname.split('/').pop(), 時刻: Date.now(),
      }));
    } catch (e) { /* 保存できない設定なら、次に読んだときに正しくなる */ }
    const a = document.createElement('a');
    a.className = 'donehome';
    a.href = 戻り先;
    a.textContent = 'マイページに戻る';
    el.insertAdjacentElement('afterend', a);
  };
  const 見る = (根) => {
    if (!根 || 根.querySelectorAll === undefined) return;
    if (根.classList && 根.classList.contains('msg') && 根.classList.contains('success')) 足す(根);
    根.querySelectorAll('.msg.success').forEach(足す);
  };
  new MutationObserver((記録) => {
    記録.forEach((m) => m.addedNodes.forEach(見る));
  }).observe(document.body, { childList: true, subtree: true });
  見る(document.body);
})();
<` + `/script>`;

function 戻るを足す(html) {
  if (!戻るの印.test(html)) throw new Error('見出し帯（<header class="appbar">）が見つからない');
  // 帯のいちばん**前**に入れる。題より左＝画面の左上に出したいため
  html = html.replace(戻るの印, (帯) => 帯 + NL + '  ' + 戻るリンク);
  if (html.indexOf('</head>') < 0) throw new Error('</head> が見つからない');
  html = html.replace('</head>', 戻るのCSS + NL + '</head>');
  if (html.indexOf('</body>') < 0) throw new Error('</body> が見つからない');
  return html.replace('</body>', 戻るのJS + NL + '</body>');
}

// ===== 3. 入口ページ =====
// コード.gs の 入口の中身() をそのまま動かして、題や説明を焼き込む。
// URLだけは、同じフォルダに並ぶ静的ページへの相対リンクに差し替える。
function 入口の中身たち() {
  const src = 読む(当番のコード);
  const lines = src.split(NL);
  const grab = (name) => {
    const head = 'function ' + name + '(';
    const i = lines.findIndex((l) => l.indexOf(head) === 0);
    if (i < 0) throw new Error('見つからない: ' + name);
    let j = i + 1;
    while (j < lines.length && lines[j] !== '}') j++;
    return lines.slice(i, j + 1).join(NL);
  };
  // URLを返すところだけ、こちらのファイル名に置き換える
  const 配るURL一覧 = () => ({
    当番_部員: 'touban.html',
    当番_副将: 'touban-admin.html',
    手入れ_部員: 'teire.html',
    手入れ_チーフ: 'teire-chief.html',
    手入れ_サブ: 'teire-subs.html',
    休み_部員: 'yasumi.html',
    休み_副将: 'yasumi-admin.html',
  });
  const 人員表URL = (page) => (page === 'admin' ? 'taikai-admin.html' : 'taikai.html');
  const 入口の中身 = eval('(' + grab('入口の中身').replace('function 入口の中身(', 'function (') + ')');
  return {
    links: 入口の中身('links'),
    chieflinks: 入口の中身('chieflinks'),
    admlinks: 入口の中身('admlinks'),
  };
}

/**
 * hub.html から、静的な入口ページを作る。
 * 見た目（CSS・SVGの印・「開かないときは」）は原本のまま使い、
 * スクリプトレットで組んでいたところだけ、焼き込んだ中身から画面側で組み立てる。
 */
function 入口を作る() {
  const src = 読む(当番 + '/hub.html');
  let html = スタイルを埋める(src, 当番);
  html = 検索避けを入れる(html);

  // マイページぶんのCSS。hub.html 自身の <style> の末尾に足す
  const 印 = '</style>' + NL + '</head>';
  if (html.indexOf(印) < 0) throw new Error('入口の </style></head> が見つからない');
  html = html.split(印).join(読む(path.join(__dirname, 'mypage.css')) + 印);

  // 色はスクリプトレットで入っていたので、CSS変数に逃がして画面側から差す
  html = html.split('background: <?= 中身.色 ?>;').join('background: var(--hub-color, var(--accent));');

  // <header> と <main> の中の、スクリプトレットで組んでいた部分を差し替える
  const 頭 = html.indexOf('<header class="hub-head">');
  const 尻 = html.indexOf('<p class="hint">このページをブックマークしておくと');
  if (頭 < 0 || 尻 < 0) throw new Error('入口ページの差し替え位置が見つからない');

  const 入れ替え = `<header class="hub-head">
  <h1>北海道大学馬術部　当番・手入れ</h1>
  <p id="hub-role"></p>
</header>

<main>
  <!-- マイページ。静的サイトでだけ動く（GASの画面からは別プロジェクトの人員表APIを呼べない）。
       名前を選ぶのが先で、そのあとに下のリンクへ入る。 -->
  <section class="me-pick">
    <label for="meSelect">あなたの名前</label>
    <select id="meSelect"><option value="">読み込んでいます…</option></select>
    <p class="hint">選ぶと、あなたのぶんをここに出します。次からは覚えているので選び直さなくて済みます。</p>
  </section>
  <div id="meBody"></div>

  <div id="hub-groups"></div>

  `;
  html = html.slice(0, 頭) + 入れ替え + html.slice(尻);

  const 中身 = 入口の中身たち();
  const 組み立て = `
<script>
/*
  入口の中身は、当番・手入れシステムの コード.gs の 入口の中身() を
  build.js が実際に動かして焼き込んだもの。題や説明を直すときは向こうを直して組み直す。
  リンクは同じフォルダのページを指す相対リンクなので、置き場所を変えても付いていく。
*/
const HUB = ${JSON.stringify(中身, null, 2)};

const 立場 = new URLSearchParams(location.search).get('role') || 'links';
// 中のページの「マイページに戻る」が、同じ立場の入口に戻れるように覚えておく
try { localStorage.setItem('role', 立場); } catch (e) { /* 保存できない設定でも、部員用には戻れる */ }
const 中身 = HUB[立場] || HUB.links;

document.documentElement.style.setProperty('--hub-color', 中身.色);
document.getElementById('hub-role').textContent = 中身.題;
document.title = '馬術部 当番・手入れ（' + 中身.題 + '）';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

document.getElementById('hub-groups').innerHTML = 中身.groups.map((g) => (
  '<section class="hub-group">' +
    '<h2>' + esc(g.題) + '</h2>' +
    (g.説明 ? '<p class="note hint">' + esc(g.説明) + '</p>' : '') +
    '<div class="hub-list">' +
      g.links.map((x) => (
        '<a class="hub-link" href="' + esc(x.url) + '">' +
          '<span class="mark"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<use href="#i-' + esc(x.印) + '"/></svg></span>' +
          '<span class="body">' +
            '<span class="t">' + esc(x.題) + '</span>' +
            '<span class="d">' + esc(x.説明) + '</span>' +
            (x.鍵 ? '<span class="key">鍵 ' + esc(x.鍵) + '</span>' : '') +
          '</span>' +
          '<span class="go"><svg viewBox="0 0 10 16" aria-hidden="true" focusable="false">' +
            '<use href="#i-go"/></svg></span>' +
        '</a>'
      )).join('') +
    '</div>' +
  '</section>'
)).join('');
</script>
`;
  // マイページの中身。API の2本をここで渡す（mypage.js から見えるようにする）
  const マイページ = '<script>' + NL +
    'const API = ' + JSON.stringify(API, null, 2) + ';' + NL +
    読む(path.join(__dirname, 'mypage.js')) + NL +
    '<' + '/script>' + NL;

  html = html.split('</main>').join('</main>' + 組み立て + マイページ);
  return html;
}

// ===== 組み立てる =====
fs.mkdirSync(出す先, { recursive: true });

let 件 = 0;
ページ.forEach((p) => {
  const プロジェクト = path.dirname(p.元);
  let html = 読む(p.元);
  html = スタイルを埋める(html, プロジェクト);
  html = 検索避けを入れる(html);
  html = callを差し替える(html, p.api);
  if (p.写し) html = 写しを足す(html, API.写し);
  html = 戻るを足す(html);
  if (html.indexOf('google.script.run') >= 0) {
    throw new Error(p.出す + ' に google.script.run が残っている');
  }
  fs.writeFileSync(path.join(出す先, p.出す), html, 'utf8');
  console.log('  ' + p.出す + '  ← ' + path.basename(プロジェクト) + '/' + path.basename(p.元));
  件++;
});

fs.writeFileSync(path.join(出す先, 'index.html'), 入口を作る(), 'utf8');
console.log('  index.html  ← 当番/hub.html（?role=chieflinks / admlinks で切り替え）');
件++;

// 検索避け。noindex は各ページにも入れてあるが、そもそもクロールさせない。
fs.writeFileSync(path.join(出す先, 'robots.txt'), 'User-agent: *' + NL + 'Disallow: /' + NL, 'utf8');

// GitHub Pages に Jekyll の処理をさせない（_ で始まるファイルなどを触らせない）
fs.writeFileSync(path.join(出す先, '.nojekyll'), '', 'utf8');

console.log(件 + 'ページ組み立てました → ' + 出す先);
