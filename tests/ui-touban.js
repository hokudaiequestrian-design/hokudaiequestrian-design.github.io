/**
 * 当番・手入れの画面（2026-09-15 の作り直し）を、本物の Chrome で確かめる。
 *
 *   node build.js && node tests/ui-touban.js
 *   SHOTS=フォルダ node tests/ui-touban.js   … 画面の写真をそこに置く
 *
 * 見るもの
 *   ・部員・馬匹管理（buin.html）… 1つの名簿、乗せた行にだけ出る直す・⋯、当番に入れない、そろえる、馬のチーフ
 *   ・当番の副将画面 … 部員・サブ整理タブが無い、アイコン・⋯、鍵が絵文字でない
 *   ・チーフ画面 … 馬を選び直させない、名前で開く
 *   ・バイト・休みをまとめる … 題、表の中の ⋯ が枠で切れない
 *   ・部員の画面 … まとめて入れるのメニュー、押した札が膨らむ、月めくりのアイコン
 *   ・入口 … 副将に部員・馬匹管理、チーフにサブのまとめ直しが無い、バイト・休みをまとめる
 * API は模擬（本物のデータには触らない）。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter((p) => fs.existsSync(p))[0];
const DOCS = path.join(__dirname, '..', 'docs');
const API元 = 'https://bajutsubu-api.hokudai-equestrian.workers.dev';
const 写真の置き場 = process.env.SHOTS || '';

let ok = 0;
const 失敗 = [];
function 確かめる(名, 条件, 補足) {
  if (条件) { ok++; console.log('  ✓ ' + 名); return; }
  失敗.push(名);
  console.log('  ✗ ' + 名 + (補足 !== undefined ? '　→ ' + 補足 : ''));
}
const 待つ = (ms) => new Promise((r) => setTimeout(r, ms));

function 配る() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(DOCS, p === '/' ? 'index.html' : p);
      if (!f.startsWith(DOCS) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' });
      res.end(fs.readFileSync(f));
    });
    srv.listen(0, () => resolve(srv));
  });
}

// ===== 模擬データ =====
const 曜日 = ['月', '火', '水', '木', '金', '土', '日'];
const 当番の部員 = [
  { id: 'm1', name: '美浦', grade: 2, joinYear: 2029, note: '', noDuty: false },
  { id: 'm2', name: '相棒', grade: 1, joinYear: 2030, note: '', noDuty: false },
];
const 名簿の人 = (name, joinYear, post, x) => Object.assign({
  name: name, joinYear: joinYear, grade: 2030 - joinYear + 1, post: post, note: '', noDuty: 2030 - joinYear + 1 >= 4,
  人員表: true, 当番: true, 入部年がずれている: false,
}, x || {});
const 模擬 = {
  呼ばれた: [],
  名簿: {
    members: [
      名簿の人('相棒', 2030, '馬匹'),
      名簿の人('美浦', 2029, '運営'),
      名簿の人('甲', 2029, '', { 人員表: false }),
      名簿の人('松尾', 2026, '会計'),
    ],
    horses: [
      { name: '北叡', active: true, chief: '美浦', note: '', 人員表: true, 当番: true, ずれている: false, 期間の数: 1 },
      { name: '北冴', active: false, chief: '', note: '引退', 人員表: true, 当番: true, ずれている: false, 期間の数: 0 },
    ],
    posts: ['運営', '箱番長', '馬匹', '会計'], academicYear: 2030, maxGrade: 6, ずれ: { 部員: 1, 馬: 0 },
  },
  送った: {},
};
const 当番の全部 = () => ({
  terms: [{ id: 't1', name: '前期', open: true }], termId: 't1',
  members: 当番の部員,
  duties: [{ id: 'd1', name: '昼当', order: 1, active: true }, { id: 'd2', name: '夕当', order: 2, active: false }],
  slots: 曜日.map((w) => ({ dutyId: 'd1', day: w, min: 1, max: 2, grades: [] })),
  votes: ['月', '火', '水', '木'].map((w, i) => ({ memberId: 'm1', dutyId: 'd1', day: w, rank: i + 1 })),
  cells: [{ dutyId: 'd1', day: '月', memberId: 'm1', rank: 1, locked: true }, { dutyId: 'd1', day: '火', memberId: 'm2', rank: 0, locked: false }],
  settings: { 個人下限: 1, 個人上限: 1, チーフ倍率: 2, 同曜日禁止: true, 連日回避: true, マル絶対: false },
  days: 曜日, 希望の数: 4, warnings: [],
});
const チーフの全部 = {
  horses: [{ id: 'h1', name: '北叡', active: true, chief: '美浦' }, { id: 'h2', name: '北冴', active: true, chief: '' }],
  plans: [{ id: 'p1', horseId: 'h1', term: '後期', mode: '曜日', from: '2030-10-01', to: '', min: 1, max: null, chiefRatio: null }],
  members: 当番の部員, 期間名: ['後期'], 既定のチーフ倍率: 2, 最新のサブ整理: null, subs: { p1: ['m1'] },
};
// チーフ画面で開く手入れの期間（カレンダー3日。1日目は美浦が × で入っている）
const 手入れの期間 = () => ({
  plan: { id: 'p1', horseId: 'h1', term: '後期', mode: 'カレンダー', from: '2030-10-01', to: '2030-10-03', min: 1, max: 1, chiefRatio: null, note: '' },
  horse: { id: 'h1', name: '北叡', active: true, chief: '美浦' },
  keys: ['2030-10-01', '2030-10-02', '2030-10-03'].map((k) => ({ key: k, label: Number(k.slice(5, 7)) + '/' + Number(k.slice(8)) })),
  keyError: '', members: 当番の部員, subs: ['m1', 'm2'], chiefMemberId: 'm1', チーフ倍率: 2, 既定のチーフ倍率: 2,
  votes: [{ memberId: 'm1', key: '2030-10-01', mark: '×' }, { memberId: 'm2', key: '2030-10-01', mark: '◎' }, { memberId: 'm1', key: '2030-10-02', mark: '○' }],
  cells: [{ key: '2030-10-01', memberId: 'm1', mark: '×', locked: false }], warnings: [],
});
const 休みの全部 = () => ({
  members: 当番の部員, year: 2030, years: [2030], from: '2030-04-01', to: '2031-03-31', today: '2030-09-15',
  kinds: ['有給休暇', 'バイト', '季節休み'], states: ['申請中', '承認', '却下', '取消'],
  leaves: [{ id: 'l1', memberId: 'm1', name: '美浦', kind: '有給休暇', from: '2030-09-20', to: '2030-09-21', days: 2, state: '申請中', reason: '帰省', memo: '' }],
  paid: { m1: { 付与: 10, 使った: 0, 待ち: 2, 残り: 8 }, m2: { 付与: 10, 使った: 0, 待ち: 0, 残り: 10 } },
  grants: [], settings: { 有給日数: 10, 年度始まり月: 4, 休みを外す: true }, maxDays: 60,
});

function 模擬で答える(req) {
  const u = req.url();
  if (u.indexOf(API元 + '/') !== 0) { req.continue().catch(() => {}); return; }
  const 本文 = JSON.parse(req.postData() || '{}');
  const a = 本文.args || [];
  const どこ = /\/jinin$/.test(u) ? '人員表' : '当番';
  模擬.呼ばれた.push(どこ + ' ' + 本文.fn);
  const 返す = (value) => setTimeout(() => req.respond({
    status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ ok: true, value: value }),
  }).catch(() => {}), 60);
  switch (本文.fn) {
    // 部員・馬匹管理
    case 'login': return 返す('a_t');
    case 'rosterLoad': return 返す(模擬.名簿);
    case 'rosterSaveMember': {
      模擬.送った.部員 = a[1];
      const m = 模擬.名簿.members.filter((x) => x.name === (a[1].oldName || a[1].name))[0];
      if (m) Object.assign(m, { name: a[1].name, note: a[1].note, post: a[1].post, noDuty: a[1].noDuty });
      else 模擬.名簿.members.push(名簿の人(a[1].name, Number(a[1].joinYear) || 2030, a[1].post, { noDuty: a[1].noDuty }));
      return 返す({ ok: true, 名簿: 模擬.名簿 });
    }
    case 'rosterSaveHorse': {
      模擬.送った.馬 = a[1];
      const h = 模擬.名簿.horses.filter((x) => x.name === a[1].oldName)[0];
      if (h) Object.assign(h, { chief: a[1].chief });
      return 返す({ ok: true, 名簿: 模擬.名簿 });
    }
    case 'rosterSync':
      模擬.名簿.members.forEach((m) => { m.人員表 = true; m.当番 = true; });
      模擬.名簿.ずれ = { 部員: 0, 馬: 0 };
      return 返す({ ok: true, 結果: { 当番へ足した: [], 人員表へ足した: ['甲'], 入部年を直した: [], 馬を足した: [], 馬を直した: [] }, 名簿: 模擬.名簿 });
    // 当番の副将
    case 'loginAndLoad': return 返す({ token: 'a_t', all: 当番の全部() });
    case 'adminLoadAll': return 返す(当番の全部());
    case 'adminShareUrl': return 返す({});
    // チーフ
    case 'chiefMeta': return 返す({ 要パスワード: false });
    case 'loginChiefAndLoad': return 返す({ token: 'c_t', base: チーフの全部 });
    case 'chiefLoadAll': return 返す(チーフの全部);
    case 'chiefSavePlanForHorses':
      模擬.送った.期間 = a.slice(1);
      return 返す({ 作った: [{ horseId: 'h1', name: '北叡', id: 'pn', サブの元: '' }], 飛ばした: [], だめ: [] });
    case 'chiefLoadPlan': return 返す(手入れの期間());
    case 'chiefSaveTable': 模擬.送った.表 = a[2]; return 返す({ ok: true, count: (a[2] || []).length, warnings: [] });
    // 休み
    case 'loginAndLoadYasumi': return 返す({ token: 'a_t', all: 休みの全部() });
    case 'yasumiLoadAll': return 返す(休みの全部());
    // 部員の画面
    case 'getCareMemberData':
      return 返す(a[0] ? { plans: [{ id: 'p1', horse: '北叡', term: '後期', mode: '曜日', chief: '美浦', keys: 曜日.map((w) => ({ key: w, label: w + '曜' })), votes: {} }] }
        : { members: 当番の部員 });
    case 'getDutyMemberData':
      return 返す({ members: 当番の部員, days: 曜日, 希望の数: 4, terms: [{ id: 't1', name: '前期', duties: [{ id: 'd1', name: '昼当', slots: 曜日.map((w) => ({ day: w, grades: [] })) }] }] });
    case 'getMyDutyVote': return 返す(null);
    case 'getYasumiMemberData':
      return 返す({ members: 当番の部員, all: [], mine: [], kinds: ['有給休暇', '季節休み'], paid: { 付与: 10, 使った: 0, 待ち: 0, 残り: 10 }, year: 2030 });
    case 'getCalendarData':
      return 返す({ 月: a[0] || '2030-09', from: (a[0] || '2030-09') + '-01', to: (a[0] || '2030-09') + '-30', 今日: '2030-09-15', 部員: [{ name: '美浦' }], 休み: [], 大会: [], 大会に出る: [], 手入れ: [], 毎週: [], 馬: [] });
    case 'getMyPage':
      return 返す(どこ === '当番'
        ? { 版: 't1', me: { name: '美浦' }, members: [{ name: '美浦' }], 今日: '2030-09-15', 当番: { 期間: [], 決まったぶん: [] }, 手入れ: [], 毎週の手入れ: [], 予定: [], 休み: [] }
        : { 版: '1', me: { id: 'm_001', name: '美浦' }, 大会: [] });
    default:
      return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ ok: false, error: '模擬に無い：' + 本文.fn }) }).catch(() => {}), 10);
  }
}

(async () => {
  if (!CHROME) { console.log('Chrome も Edge も見つからないので飛ばす'); return; }
  const srv = await 配る();
  const 元 = 'http://localhost:' + srv.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const 画面のエラー = [];
  page.on('pageerror', (e) => 画面のエラー.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.setRequestInterception(true);
  page.on('request', 模擬で答える);
  const 写す = async (名) => { if (写真の置き場) { await 待つ(300); await page.screenshot({ path: path.join(写真の置き場, 't' + 名 + '.png') }); } };
  const 見える度 = (sel) => page.$eval(sel, (el) => Number(getComputedStyle(el).opacity));
  /*
    上のほうのボタンを押す前に、画面をいちばん上へ戻す。
    保存したあとは画面が下へ動いていて、上のボタンが上に貼り付いた見出しの帯の下に隠れる。
    puppeteer は隠れていても「画面の中にある」とみなしてそのまま押すので、帯を押してしまう（人は隠れたボタンを押さない）。
  */
  const 上へ = async () => { await page.evaluate(() => window.scrollTo(0, 0)); await 待つ(150); };
  const メニューの置き場 = (sel) => page.$eval(sel, (m) => {
    const r = m.getBoundingClientRect();
    const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2));
    return { 固定: getComputedStyle(m).position === 'fixed', 中にある: !!(中 && m.contains(中)), l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight };
  });

  try {
    await page.goto(元 + '/robots.txt');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('me', '美浦'); });

    // ---------- 部員・馬匹管理 ----------
    console.log('\n== 部員・馬匹管理 ==');
    // 2026-09-15 副将は入口でだけパスワードを入れる。鍵が無いと、画面はパスワードの欄ではなく入口への案内を出す
    await page.goto(元 + '/buin.html');
    await page.waitForSelector('#loginCard a[href="index.html?role=admlinks"]', { visible: true, timeout: 10000 });
    確かめる('副将の鍵が無いと、パスワードの欄ではなく副将の入口への案内が出る', !(await page.$('#pw')));
    確かめる('題は「部員・馬匹管理（副将）」', /部員・馬匹管理（副将）/.test(await page.$eval('header.appbar', (h) => h.textContent)));
    await page.evaluate(() => sessionStorage.setItem('fukusho:touban', 'a_t'));   // 入口でログインした状態
    await page.goto(元 + '/buin.html');
    await page.waitForSelector('#memberList [data-row="美浦"]', { timeout: 10000 });
    確かめる('タブは 部員・馬とチーフ・サブ整理（サブをまとめて直すは消した）', JSON.stringify(await page.$$eval('.tabs button', (bs) => bs.map((b) => b.textContent))) ===
      JSON.stringify(['部員', '馬とチーフ', 'サブ整理']));
    確かめる('学年ごとの見出しに人数が出る', /1年\s*1人/.test(await page.$eval('#memberList', (el) => el.textContent)));
    確かめる('役職・当番に入れない・当番だけの札が出る', await page.$eval('#memberList', (el) =>
      !!el.querySelector('[data-row="美浦"] .post-tag') && /当番に入れない/.test(el.querySelector('[data-row="松尾"]').textContent) && /当番だけ/.test(el.querySelector('[data-row="甲"]').textContent)));
    確かめる('そろっていないときだけ「両方にそろえる」が出る', !!(await page.$('#syncBtn')));
    確かめる('「＋」がアイコンになっている（文字の ${plus} が残っていない）', (await page.$eval('#newMemberBtn', (b) => b.innerHTML)).indexOf('${plus}') < 0 && !!(await page.$('#newMemberBtn svg')));

    await page.mouse.move(5, 5);
    await 待つ(300);
    確かめる('乗せていない行では、直す・⋯ は見えない', (await 見える度('#memberList [data-row="相棒"] .row-actions')) === 0);
    await page.hover('#memberList [data-row="美浦"]');
    await 待つ(300);
    確かめる('乗せた行にだけ出る', (await 見える度('#memberList [data-row="美浦"] .row-actions')) === 1);
    await page.click('#memberList [data-row="美浦"] details.menu > summary');
    await 待つ(250);
    const 置き場 = await メニューの置き場('#memberList [data-row="美浦"] .menu-list');
    確かめる('⋯ のメニューは画面に対する位置で出て、はみ出さない', 置き場.固定 && 置き場.中にある && 置き場.l >= 0 && 置き場.r <= 置き場.w && 置き場.b <= 置き場.h, JSON.stringify(置き場));
    確かめる('メニューに「当番に入れない」と「名簿から消す」', /当番に入れない/.test(await page.$eval('#memberList [data-row="美浦"] .menu-list', (m) => m.textContent)) &&
      /名簿から消す/.test(await page.$eval('#memberList [data-row="美浦"] .menu-list', (m) => m.textContent)));
    await 写す('1-部員・馬匹管理-メニュー');
    await page.keyboard.press('Escape');
    確かめる('Esc で閉じる', !(await page.$('#memberList details.menu[open]')));

    // 直す
    await page.$eval('#memberList [data-row="美浦"] [data-edit]', (b) => b.click());
    確かめる('直すを押すと、その人の値が入った欄が開く', (await page.$eval('#mName', (el) => el.value)) === '美浦' && (await page.$eval('#mPost', (el) => el.value)) === '運営');
    await page.$eval('#mNote', (el) => { el.value = '寮'; });
    await page.click('#saveMemberBtn');
    await page.waitForFunction(() => /直しました/.test(document.getElementById('memberMsg').textContent), { timeout: 5000 });
    確かめる('元の名前（oldName）を付けて送る', 模擬.送った.部員 && 模擬.送った.部員.oldName === '美浦' && 模擬.送った.部員.note === '寮', JSON.stringify(模擬.送った.部員));
    確かめる('直した行が一瞬光る', await page.$eval('#memberList [data-row="美浦"]', (el) => el.classList.contains('flash')));

    // 足す（4年以上は当番に入れないが最初から付く）
    await 上へ();
    await page.click('#newMemberBtn');
    await page.type('#mName', '新四年');
    await page.type('#mYear', '2027');
    const 欄の様子 = await page.evaluate(() => ({
      名: document.getElementById('mName').value, 年: document.getElementById('mYear').value, 学年: document.getElementById('mGrade').textContent,
      入れない: document.getElementById('mNoDuty').checked, 開いている: document.getElementById('memberForm').style.display, 題: document.getElementById('memberFormTitle').textContent,
    }));
    確かめる('4年以上の入部年を入れると「当番に入れない」に最初からチェック', 欄の様子.入れない && /当番に入れない/.test(欄の様子.学年), JSON.stringify(欄の様子));
    await page.click('#saveMemberBtn');
    await page.waitForFunction(() => /足しました/.test(document.getElementById('memberMsg').textContent), { timeout: 5000 });
    確かめる('足すときは oldName なし・当番に入れないで送る', 模擬.送った.部員.oldName === '' && 模擬.送った.部員.noDuty === true, JSON.stringify(模擬.送った.部員));

    // そろえる
    await 上へ();
    await page.click('#syncBtn');
    await page.waitForFunction(() => /そろえました/.test(document.getElementById('memberMsg').textContent), { timeout: 5000 });
    確かめる('そろえると、足した人を知らせて「そろえる」の欄が消える', /人員表に足した人：甲/.test(await page.$eval('#memberMsg', (el) => el.textContent)) && !(await page.$('#syncBtn')));

    // 馬
    await 上へ();
    await page.click('.tabs [data-tab="horses"]');
    await page.waitForSelector('#horseList [data-row="北叡"]', { visible: true });
    確かめる('使っていない馬に札が出る', /使っていない/.test(await page.$eval('#horseList [data-row="北冴"]', (el) => el.textContent)));
    await page.select('#horseList [data-chief="北叡"]', '相棒');
    await page.waitForFunction(() => /チーフを 相棒/.test(document.getElementById('horseMsg').textContent), { timeout: 5000 });
    確かめる('チーフを選ぶとすぐ保存する（oldName つき）', 模擬.送った.馬 && 模擬.送った.馬.oldName === '北叡' && 模擬.送った.馬.chief === '相棒', JSON.stringify(模擬.送った.馬));
    await page.hover('#horseList [data-row="北叡"]');
    await 写す('2-部員・馬匹管理-馬とチーフ');
    確かめる('パスワードの欄は、いちばん下に畳んである', await page.$eval('#changeAdminPwBtn', (b) => { const d = b.closest('details'); return !!d && !d.open && !d.closest('[data-pane]'); }));

    // ---------- 当番の副将画面 ----------
    console.log('\n== 当番の副将画面 ==');
    await page.goto(元 + '/touban-admin.html');   // 入口の鍵があるので、パスワードは聞かれない
    await page.waitForFunction(() => document.getElementById('app').style.display === 'block', { timeout: 10000 });
    確かめる('部員・サブ整理のタブは無く、当番の設定から開く',
      !(await page.$('[data-tab="members"]')) && !(await page.$('[data-tab="subterms"]')) && (await page.$eval('.tabs button.active', (b) => b.dataset.tab)) === 'duties');
    確かめる('部員・馬匹管理へのリンクがある', !!(await page.$('a[href="buin.html"]')));
    確かめる('当番の種類の行は、文字のボタンではなくアイコン', await page.$$eval('#dutyList .list-item', (rs) => rs.every((r) => r.querySelectorAll('.icon-btn').length === 2 && !/削除/.test(r.textContent))));
    await page.click('[data-tab="table"]');
    await page.waitForSelector('#assignGrid .name-chip', { visible: true });
    確かめる('上に並ぶ文字のボタンは「作成する」だけ（ほかは ⋯）', JSON.stringify(await page.$$eval('[data-pane="table"] .card:first-child button', (bs) => bs.filter((b) => b.checkVisibility()).map((b) => b.textContent.trim()))) === '["作成する"]');
    確かめる('当番表の鍵と×はアイコン（絵文字を使わない）', (await page.$eval('#assignGrid', (el) => el.textContent)).search(/[🔒🔓×]/u) < 0 && !!(await page.$('#assignGrid .lock svg')));
    await page.hover('#assignGrid .name-chip:not(.locked)');
    await 写す('3-当番の副将画面-当番表');
    await page.click('[data-pane="table"] details.menu > summary');
    await 待つ(250);
    確かめる('⋯ に中身だけ見る・読み直す', /中身だけ見る/.test(await page.$eval('[data-pane="table"] .menu-list', (m) => m.textContent)) && /読み直す/.test(await page.$eval('[data-pane="table"] .menu-list', (m) => m.textContent)));
    await page.keyboard.press('Escape');
    await page.click('[data-tab="votes"]');
    確かめる('投票ずみの人の直す・消すはアイコン', await page.$$eval('#voteList .list-item', (rs) => rs.some((r) => r.querySelectorAll('.row-actions .icon-btn').length === 2)));

    // ---------- チーフ ----------
    console.log('\n== チーフ画面 ==');
    await page.goto(元 + '/teire-chief.html');
    await page.waitForSelector('#horseSelect option[value="h1"]', { timeout: 10000 });
    await page.select('#horseSelect', 'h1');
    確かめる('期間を開くまで「期間の編集」は出ない', await page.$eval('#planEditFold', (d) => d.hidden));
    await page.$eval('#newPlanFold', (d) => { d.open = true; });
    確かめる('期間を作る欄で馬を選び直させない（上で選んだ馬の名前が出る）', !(await page.$('#horseSheet')) && (await page.$eval('#newHorseName', (el) => el.textContent)) === '北叡');
    確かめる('期間の名前そのものを押して開く（「開く」ボタンが無い）', !!(await page.$('#planList button.linklike[data-open="p1"]')) &&
      !(await page.$$eval('#planList button', (bs) => bs.some((b) => b.textContent.trim() === '開く'))));
    確かめる('サブのまとめ直しへのリンクはもう無い', !(await page.$('a[href*="teire-subs"]')));
    await page.$eval('#fromDate', (el) => { el.value = '2030-11-01'; });
    await page.click('#newPlanBtn');
    await page.waitForFunction(() => /期間を作りました/.test(document.getElementById('termMsg').textContent), { timeout: 5000 });
    確かめる('上で選んだ馬（h1）だけの期間を作る', JSON.stringify((模擬.送った.期間 || [])[0]) === '["h1"]', JSON.stringify(模擬.送った.期間));
    await 写す('4-チーフ画面');

    // 手入れ表の編集（2026-09-15）：「編集」を押して、カレンダーの日を押すと、サブだけのプルダウン（◎→○→×）
    await page.evaluate(() => window.scrollTo(0, 0));
    // 名前ではなく、行の日付のあたりを押しても開く（2026-09-15）
    await page.$eval('#planList [data-openrow="p1"] .muted', (el) => el.click());
    await page.waitForFunction(() => document.getElementById('planPane').style.display === 'block', { timeout: 5000 });
    // 期間の編集（2026-09-15）：決まりとサブは「2. 期間を選ぶ」の中に畳んである
    確かめる('期間を開くと「2. 期間を選ぶ」に「期間の編集」が出て、決まりとサブが入っている',
      await page.$eval('#termCard', (c) => { const f = c.querySelector('#planEditFold'); return !!f && !f.hidden && !!f.querySelector('#savePlanBtn') && !!f.querySelector('#subSheet') && f.querySelector('summary').textContent.indexOf('後期') >= 0; }));
    確かめる('サブがいる期間では、期間の編集は畳んだまま', !(await page.$eval('#planEditFold', (d) => d.open)));
    確かめる('期間を開いた下には、決まり・サブのカードはもう無い（投票状況から）',
      await page.$eval('#planPane', (p) => !p.querySelector('#subSheet') && !p.querySelector('#savePlanBtn') && p.textContent.indexOf('3. 投票状況') >= 0));
    確かめる('開いている期間に印が付く', await page.$eval('#planList [data-open="p1"]', (b) => b.getAttribute('aria-current') === 'true'));
    // 名前の横の鉛筆で、期間の編集が開く
    確かめる('期間名のすぐ横に鉛筆（編集）がある', await page.$eval('#planList [data-openrow="p1"]', (r) => { const b = r.querySelector('[data-editp="p1"]'); return !!b && b.closest('span').previousElementSibling === r.querySelector('[data-open="p1"]'); }));
    await page.$eval('#planList [data-editp="p1"]', (b) => b.click());
    await page.waitForFunction(() => document.getElementById('planEditFold').open, { timeout: 3000 });
    確かめる('鉛筆を押すと「期間の編集」が開く', true);
    await page.$eval('#planEditFold', (d) => { d.scrollIntoView({ block: 'start' }); });
    await 待つ(700);
    await page.$eval('#newPlanFold', (d) => { d.open = false; });
    await page.$eval('#termCard', (c) => { c.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy(0, -90); });
    await 写す('4a-チーフ-期間の編集');
    await page.$eval('#planEditFold', (d) => { d.open = false; });
    確かめる('「担当を足す」は無く、「編集」ボタンがある', !(await page.$('#addPersonBtn')) && !!(await page.$('#editTableBtn')));
    確かめる('編集を押すまでは、日のマスは押せない', !(await page.$('#calPreview [data-editkey]')));
    await page.click('#editTableBtn');
    await page.waitForSelector('#calPreview [data-editkey="2030-10-01"]', { timeout: 3000 });
    await page.$eval('#calPreview [data-editkey="2030-10-01"]', (b) => b.click());
    await page.waitForSelector('#calPreview select.day-pick', { timeout: 3000 });
    const 並び = await page.$$eval('#calPreview select.day-pick optgroup', (gs) => gs.map((g) => g.label + '：' + Array.from(g.children).map((o) => o.textContent).join('、')));
    確かめる('日を押すと、サブだけのプルダウンが出て、◎ 入りたい → × 入れない の順に分かれている',
      並び.length === 2 && /^◎ 入りたい：◎　相棒$/.test(並び[0]) && /^× 入れない：×　美浦（チーフ）$/.test(並び[1]), JSON.stringify(並び));
    確かめる('いまの担当（美浦）がはじめから選ばれている', (await page.$eval('#calPreview select.day-pick', (s) => s.value)) === 'm1');
    await 写す('4b-チーフ-日の担当を選ぶ');
    await page.select('#calPreview select.day-pick', 'm2');
    await 待つ(150);
    const 一日 = await page.$eval('#calPreview [data-editkey="2030-10-01"]', (b) => b.textContent);
    確かめる('選ぶと、その日の担当が入れ替わる', /相棒/.test(一日) && !/美浦/.test(一日), 一日);
    確かめる('選んだ日は光り、保存していない帯が出る',
      await page.$eval('#calPreview [data-editkey="2030-10-01"]', (b) => b.classList.contains('flash')) && await page.$eval('#savingBar', (b) => b.classList.contains('on')));
    await page.$eval('#calPreview [data-editkey="2030-10-02"]', (b) => b.click());
    await page.waitForSelector('#calPreview select.day-pick', { timeout: 3000 });
    await page.select('#calPreview select.day-pick', 'm1');
    await 待つ(150);
    確かめる('空いていた日も、選ぶと担当が入る', /美浦/.test(await page.$eval('#calPreview [data-editkey="2030-10-02"]', (b) => b.textContent)));
    // 自由記述：プルダウンの「名前を書く」で、一覧にない人も入れられる
    await page.$eval('#calPreview [data-editkey="2030-10-03"]', (b) => b.click());
    await page.waitForSelector('#calPreview select.day-pick', { timeout: 3000 });
    確かめる('プルダウンに「名前を書く」がある', await page.$eval('#calPreview select.day-pick', (s) => Array.from(s.options).some((o) => o.value === '__自由')));
    await page.select('#calPreview select.day-pick', '__自由');
    await page.waitForSelector('#calPreview input.day-pick', { timeout: 3000 });
    await page.type('#calPreview input.day-pick', 'OB 佐藤');
    await page.keyboard.press('Enter');
    await 待つ(150);
    確かめる('書いた名前がその日の担当に入る', /OB 佐藤/.test(await page.$eval('#calPreview [data-editkey="2030-10-03"]', (b) => b.textContent)));
    await page.click('#saveTableBtn');
    await 待つ(200);
    確かめる('保存すると、書いた名前は「自由:名前」で送る', JSON.stringify(模擬.送った.表 || []).indexOf('"memberId":"自由:OB 佐藤"') >= 0, JSON.stringify(模擬.送った.表));
    await page.click('#editTableBtn');
    確かめる('「編集を終える」で、日のマスはまた押せなくなる', !(await page.$('#calPreview [data-editkey]')));

    // ---------- バイト・休みをまとめる ----------
    console.log('\n== バイト・休みをまとめる ==');
    await page.goto(元 + '/yasumi-admin.html');
    await page.waitForSelector('#applyTable [data-do="承認"]', { timeout: 10000 });
    確かめる('題は「バイト・休みをまとめる」', /バイト・休みをまとめる/.test(await page.$eval('header.appbar', (h) => h.textContent)));
    確かめる('見えている文字のボタンは「了承する」だけ', JSON.stringify(await page.$$eval('#applyTable button', (bs) => bs.filter((b) => b.checkVisibility()).map((b) => b.textContent.trim()))) === '["了承する"]');
    await page.click('#applyTable details.menu > summary');
    await 待つ(250);
    const 表の中 = await メニューの置き場('#applyTable .menu-list');
    確かめる('表（横にスクロールする枠）の中の ⋯ も、枠で切れずに出る', 表の中.固定 && 表の中.中にある && 表の中.b <= 表の中.h, JSON.stringify(表の中));
    確かめる('⋯ に却下・記録ごと消す', /却下する/.test(await page.$eval('#applyTable .menu-list', (m) => m.textContent)) && /記録ごと消す/.test(await page.$eval('#applyTable .menu-list', (m) => m.textContent)));
    await 写す('5-バイト・休みをまとめる');
    await page.keyboard.press('Escape');

    // ---------- 部員の画面 ----------
    console.log('\n== 部員の画面 ==');
    await page.setViewport({ width: 400, height: 860 });
    await page.goto(元 + '/teire.html');
    await page.waitForSelector('[data-card="p1"] .mk', { timeout: 10000 });
    確かめる('手入れ：まとめて入れるボタン4つはメニューにまとまっている',
      !(await page.$$eval('[data-card="p1"] button', (bs) => bs.some((b) => b.checkVisibility() && /^全部/.test(b.textContent.trim())))) && !!(await page.$('[data-card="p1"] summary.menu-text')));
    await page.click('[data-card="p1"] summary.menu-text');
    await page.click('[data-card="p1"] [data-all="p1"][data-mark="◎"]');
    await 待つ(100);
    確かめる('メニューの「全部の日を ◎」で全部の日に入る', (await page.$$('[data-card="p1"] .mk.on.m2')).length === 7);
    await page.click('[data-card="p1"] .mk[data-key="月"][data-mark="○"]');
    const 膨らんだ = await page.waitForFunction(() => { const b = document.querySelector('[data-card="p1"] .mk[data-key="月"][data-mark="○"]'); return b && b.classList.contains('just'); }, { timeout: 600 }).then(() => true, () => false);
    確かめる('押した ◎○× が少し膨らむ（描き直したあとの札に付く）', 膨らんだ);
    await 写す('6-手入れの希望-スマホ');

    await page.goto(元 + '/touban.html');
    await page.waitForSelector('#grid .pickcell', { timeout: 10000 });
    await page.click('#grid .pickcell[data-duty="d1"][data-day="月"]');
    確かめる('当番：選んだ希望の取り消しはアイコン', await page.$eval('#picked [data-remove]', (b) => b.classList.contains('icon-btn') && !!b.querySelector('svg') && !b.textContent.trim()));

    await page.goto(元 + '/yasumi.html');
    await page.waitForSelector('#calGrid .daycell', { timeout: 10000 });
    確かめる('休み：月めくりはアイコン（説明つき）', await page.$eval('#prevMonth', (b) => b.classList.contains('icon-btn') && b.getAttribute('aria-label') === '前の月'));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(元 + '/calendar.html');
    await page.waitForSelector('#view table.grid', { timeout: 10000 });
    確かめる('カレンダー：月めくりはアイコン', await page.$eval('#nextMonth', (b) => b.classList.contains('icon-btn') && !b.textContent.trim()));

    // ---------- 入口 ----------
    console.log('\n== 入口 ==');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(元 + '/?role=admlinks');
    await page.waitForSelector('#fkPw', { visible: true, timeout: 10000 });
    確かめる('副将の入口：ログインするまで、まとめるほうのリンクは隠れていて、パスワードの欄が出る',
      await page.$eval('a.hub-link[href="touban-admin.html"]', (a) => !a.checkVisibility()));
    await page.type('#fkPw', 'x');
    await page.click('#fkBtn');
    await page.waitForSelector('a.hub-link[href="touban-admin.html"]', { visible: true, timeout: 5000 });
    確かめる('ログインすると、当番・手入れと人員表の鍵をこのタブに覚えて、リンクが出る',
      await page.evaluate(() => !!sessionStorage.getItem('fukusho:touban') && !!sessionStorage.getItem('fukusho:jinin')));
    await page.click('a.hub-link[href="touban-admin.html"]');
    await page.waitForFunction(() => document.getElementById('app') && document.getElementById('app').style.display === 'block', { timeout: 10000 });
    確かめる('入口から開いた副将画面では、パスワードを聞かない', !(await page.$('#pw')) && (await page.$eval('#loginCard', (c) => c.style.display)) === 'none');
    模擬.呼ばれた = [];
    await page.goto(元 + '/teire-chief.html');
    await page.waitForSelector('#horseSelect option[value="h1"]', { timeout: 10000 });
    確かめる('手入れをまとめるも、副将の鍵で開く（チーフのパスワードを確かめに行かない）', 模擬.呼ばれた.indexOf('当番 chiefMeta') < 0, JSON.stringify(模擬.呼ばれた));
    await page.goto(元 + '/?role=admlinks');
    await page.waitForSelector('.fk-out', { visible: true, timeout: 10000 });
    確かめる('ログインしたまま入口に戻ると、パスワードの欄は出ない', !(await page.$('#fkPw')));
    const 副将の題 = await page.$$eval('#hub-groups a.hub-link .t', (ts) => ts.map((t) => t.textContent));
    確かめる('副将の入口に「部員・馬匹管理」と「バイト・休みをまとめる」', 副将の題.indexOf('部員・馬匹管理') >= 0 && 副将の題.indexOf('バイト・休みをまとめる') >= 0 && 副将の題.indexOf('休みをまとめる') < 0, JSON.stringify(副将の題));
    確かめる('部員・馬匹管理の印（アイコン）が描ける', await page.$eval('a.hub-link[href="buin.html"] use', (u) => !!document.querySelector(u.getAttribute('href'))));
    確かめる('人員表をまとめるの鍵は副将パスワード', /副将パスワード/.test(await page.$eval('a.hub-link[href="taikai-admin.html"]', (a) => a.textContent)));
    await 写す('7-副将の入口');
    await page.goto(元 + '/?role=chieflinks');
    await page.waitForSelector('#hub-groups a.hub-link', { timeout: 10000 });
    確かめる('チーフの入口に「サブをまとめて直す」は無い', !(await page.$$eval('#hub-groups a.hub-link', (as) => as.some((a) => /teire-subs|まとめて直す/.test(a.href + a.textContent)))));

    確かめる('画面のエラーなし', 画面のエラー.length === 0, 画面のエラー.join(' / '));
  } catch (e) {
    確かめる('途中で止まらない', false, e.stack);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('\n' + ok + '件通過' + (失敗.length ? '、' + 失敗.length + '件失敗：' + 失敗.join('、') : ''));
  process.exit(失敗.length ? 1 : 0);
})();
