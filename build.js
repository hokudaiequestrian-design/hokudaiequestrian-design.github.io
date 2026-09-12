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

const 当番 = 'C:/Users/minuu/Documents/当番・手入れシステム_GAS';
const 人員表 = 'C:/Users/minuu/Documents/人員表システム_GAS';
const 出す先 = path.join(__dirname, 'docs');

// それぞれのウェブアプリ。fetch で叩くだけなので a/gmail.com は要らない
// （Cookieを送らないので、アカウントの振り分けがそもそも起きない）。
const API = {
  当番: 'https://script.google.com/macros/s/AKfycbxRymAf5iGuZfmZE-CK2fwicbnj1tE6UZKywZ3cNDTkqxZp0aBAKIb67jYWfOzYorK2Yw/exec',
  人員表: 'https://script.google.com/macros/s/AKfycbxUWCdZAA0-JIhl2Pr10KbAIZSKY4hcn7MfFwRWODjd0WQBWmmA25A-GdtVb5mcK38MTQ/exec',
};

// 出す先のファイル名。入口ページからは、この名前で相対リンクを張る。
const ページ = [
  { 出す: 'touban.html', 元: 当番 + '/member.html', api: API.当番, 題: '当番の希望を出す' },
  { 出す: 'teire.html', 元: 当番 + '/teire.html', api: API.当番, 題: '手入れの希望を出す' },
  { 出す: 'touban-admin.html', 元: 当番 + '/admin.html', api: API.当番, 題: '当番をまとめる' },
  { 出す: 'teire-chief.html', 元: 当番 + '/chief.html', api: API.当番, 題: '手入れをまとめる' },
  { 出す: 'yasumi.html', 元: 当番 + '/yasumi.html', api: API.当番, 題: '休みを申し込む' },
  { 出す: 'yasumi-admin.html', 元: 当番 + '/yasumiadmin.html', api: API.当番, 題: '休みをまとめる' },
  { 出す: 'taikai.html', 元: 人員表 + '/member.html', api: API.人員表, 題: '大会の出欠を出す' },
  { 出す: 'taikai-admin.html', 元: 人員表 + '/admin.html', api: API.人員表, 題: '人員表をまとめる' },
];

// ===== 1. include('style') を差し替える =====
function スタイルを埋める(html, プロジェクト) {
  const style = fs.readFileSync(プロジェクト + '/style.html', 'utf8');
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
}`;

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
 */
function call(fn) {
  const args = Array.prototype.slice.call(arguments, 1);
  busy(true);
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ fn: fn, args: args }),
  }).then((res) => {
    if (!res.ok) throw new Error('つながりませんでした（' + res.status + '）。少し待ってから開き直してください。');
    return res.json();
  }).then((r) => {
    if (!r.ok) throw new Error(r.error || '不明なエラーが起きました。');
    return r.value;
  }).finally(() => { busy(false); });
}`;

// 原本には call() の上に「google.script.run をPromiseで扱えるようにする」という
// 説明が付いているファイルがある。差し替えたあとに残ると嘘になるので、そこも消す。
function callを差し替える(html, api) {
  html = html.split('// google.script.run をPromiseで扱えるようにする' + String.fromCharCode(10)).join('');
  if (html.indexOf(元のcall) < 0) {
    throw new Error('call() の形が原本と違う。build.js の 元のcall を合わせ直すこと');
  }
  return html.split(元のcall).join(新しいcall(api));
}

// ===== 3. 入口ページ =====
// コード.gs の 入口の中身() をそのまま動かして、題や説明を焼き込む。
// URLだけは、同じフォルダに並ぶ静的ページへの相対リンクに差し替える。
function 入口の中身たち() {
  const src = fs.readFileSync(当番 + '/コード.gs', 'utf8');
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
  const src = fs.readFileSync(当番 + '/hub.html', 'utf8');
  let html = スタイルを埋める(src, 当番);
  html = 検索避けを入れる(html);

  // マイページぶんのCSS。hub.html 自身の <style> の末尾に足す
  const 印 = '</style>' + NL + '</head>';
  if (html.indexOf(印) < 0) throw new Error('入口の </style></head> が見つからない');
  html = html.split(印).join(fs.readFileSync(path.join(__dirname, 'mypage.css'), 'utf8') + 印);

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
    fs.readFileSync(path.join(__dirname, 'mypage.js'), 'utf8') + NL +
    '<' + '/script>' + NL;

  html = html.split('</main>').join('</main>' + 組み立て + マイページ);
  return html;
}

// ===== 組み立てる =====
fs.mkdirSync(出す先, { recursive: true });

let 件 = 0;
ページ.forEach((p) => {
  const プロジェクト = path.dirname(p.元);
  let html = fs.readFileSync(p.元, 'utf8');
  html = スタイルを埋める(html, プロジェクト);
  html = 検索避けを入れる(html);
  html = callを差し替える(html, p.api);
  if (html.indexOf('google.script.run') >= 0) {
    throw new Error(p.出す + ' に google.script.run が残っている');
  }
  fs.writeFileSync(path.join(出す先, p.出す), html, 'utf8');
  console.log('  ' + p.出す + '  ← ' + path.basename(プロジェクト) + '/' + path.basename(p.元));
  件++;
});

fs.writeFileSync(path.join(出す先, 'index.html'), 入口を作る(), 'utf8');
console.log('  index.html  ← 当番・手入れシステム_GAS/hub.html（?role=chieflinks / admlinks で切り替え）');
件++;

// 検索避け。noindex は各ページにも入れてあるが、そもそもクロールさせない。
fs.writeFileSync(path.join(出す先, 'robots.txt'), 'User-agent: *' + NL + 'Disallow: /' + NL, 'utf8');

// GitHub Pages に Jekyll の処理をさせない（_ で始まるファイルなどを触らせない）
fs.writeFileSync(path.join(出す先, '.nojekyll'), '', 'utf8');

console.log(件 + 'ページ組み立てました → ' + 出す先);
