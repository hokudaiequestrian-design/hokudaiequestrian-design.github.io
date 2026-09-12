// 外から呼べる関数の一覧が、画面側の call() と コード.gs の実体とずれていないか見張る。
// 一覧が足りないと画面が動かず、多すぎると誰でも叩けるURLに要らない関数が生える。
const fs = require('fs');
const NL = String.fromCharCode(10);

const プロジェクト = [
  { 名: '当番・手入れ', dir: 'C:/Users/minuu/Documents/当番・手入れシステム_GAS' },
  { 名: '人員表', dir: 'C:/Users/minuu/Documents/人員表システム_GAS' },
];

// 入口（マイページ）はGASプロジェクトの外、馬術部サイトの mypage.js にあって、
// 当番・手入れと人員表の両方の getMyPage を呼ぶ。ここだけ別に拾う。
const 入口 = __dirname.split(String.fromCharCode(92)).join('/').replace(/[/]tests$/, '') + '/mypage.js';
const 入口が呼ぶ = new Set();
if (fs.existsSync(入口)) {
  const src = fs.readFileSync(入口, 'utf8');
  (src.match(/呼ぶ[(]API[.][^,]+, *'[a-zA-Z0-9_]+'/g) || []).forEach((x) => {
    入口が呼ぶ.add(x.match(/'([a-zA-Z0-9_]+)'/)[1]);
  });
}

// 画面から呼ばれていないが、一覧に入れておいてよいもの（いまは無し）
const 例外 = {};

let ng = 0, 件 = 0;
const 確認 = (名, 実, 期待) => {
  件++;
  const a = JSON.stringify(実), b = JSON.stringify(期待);
  if (a !== b) { ng++; console.log('NG ' + 名 + NL + '  実 ' + a + NL + '  期 ' + b); }
};

プロジェクト.forEach((p) => {
  const src = fs.readFileSync(p.dir + '/コード.gs', 'utf8');

  // 一覧を取り出す
  const i = src.indexOf('const 外から呼べる関数 = [');
  if (i < 0) { ng++; console.log('NG ' + p.名 + '：一覧が見つからない'); return; }
  const j = src.indexOf('];', i);
  const 一覧 = src.slice(i, j).split(NL).join(' ')
    .split("'").filter((x, k) => k % 2 === 1);

  // 画面が呼んでいる関数を集める
  const 呼ばれる = new Set();
  fs.readdirSync(p.dir).filter((f) => f.endsWith('.html')).forEach((f) => {
    const h = fs.readFileSync(p.dir + '/' + f, 'utf8');
    const m = h.match(/call\('[a-zA-Z0-9_]+'/g) || [];
    m.forEach((x) => 呼ばれる.add(x.slice(6, -1)));
  });
  // 入口は馬術部サイト側にあるので、ここで足す
  入口が呼ぶ.forEach((n) => 呼ばれる.add(n));

  // コード.gs にある関数名を集める
  const ある = new Set();
  src.split(NL).forEach((l) => {
    const m = l.match(/^function ([a-zA-Z0-9_]+)\(/);
    if (m) ある.add(m[1]);
  });

  const 足りない = [...呼ばれる].filter((n) => 一覧.indexOf(n) < 0).sort();
  const 余分 = 一覧.filter((n) => !呼ばれる.has(n) && !(例外[p.名] || []).includes(n)).sort();
  const 実体なし = 一覧.filter((n) => !ある.has(n)).sort();

  確認(p.名 + '：画面が呼ぶのに一覧に無い関数', 足りない, []);
  確認(p.名 + '：一覧にあるのに画面が呼ばない関数', 余分, []);
  確認(p.名 + '：一覧にあるのに実体が無い関数', 実体なし, []);
  確認(p.名 + '：doPost がある', /^function doPost\(/m.test(src), true);

  // 危ないものが混ざっていないこと（メニューから実行する前提の関数）
  const 入れてはいけない = ['setupSheets', 'setAdminPassword', 'setChiefPassword',
    'showShareUrl', 'editShareUrl', 'editJininUrl', 'syncFromJinin', 'onOpen', 'doGet', 'doPost'];
  確認(p.名 + '：メニュー用の関数が混ざっていない',
    一覧.filter((n) => 入れてはいけない.includes(n)), []);

  console.log('  ' + p.名 + '：一覧 ' + 一覧.length + '件／画面が呼ぶ ' + 呼ばれる.size + '件');
});

console.log(ng ? ng + '件 失敗' : 件 + '件 すべて通過');
process.exit(ng ? 1 : 0);
