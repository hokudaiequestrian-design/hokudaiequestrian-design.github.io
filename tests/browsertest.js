/**
 * 組み立てたページを本物のブラウザ（Chrome）で動かして、待たせない作りを確かめる。
 *
 *   npm install --no-save --no-package-lock puppeteer-core exceljs   （初回だけ。node_modules は .gitignore 済み）
 *   node tests/browsertest.js
 *
 * docs/ を手元で配り、API（Cloudflare の bajutsubu-api）は**模擬**で答える（本物のデータには書かない）。
 * Excel の書き出しは、本物の ExcelJS（cdnjs）を読み込んで実際にファイルを落とし、中身を読み直す。
 * 最後の1件だけ、本物の API に keepalive で読み取りを投げて、JSON が返るか見る。
 *
 * 2026-09-13 Apps Script から Cloudflare に移したときに作り直した（前は「写し」と Apps Script を模擬していた）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter((p) => fs.existsSync(p))[0];
const DOCS = path.join(__dirname, '..', 'docs');
const API元 = 'https://bajutsubu-api.hokudai-equestrian.workers.dev';

let ok = 0;
const 失敗 = [];
function 確かめる(名, 条件, 補足) {
  if (条件) { ok++; console.log('  ✓ ' + 名); return; }
  失敗.push(名);
  console.log('  ✗ ' + 名 + (補足 ? '　→ ' + 補足 : ''));
}
const 待つ = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== 手元で docs/ を配る =====
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
const DATA = {
  members: [{ id: 'm_001', name: '美浦', grade: 2 }, { id: 'm_002', name: '相棒', grade: 1 }],
  horses: ['北叡', '北冴'],
  events: [{
    id: 'e1', name: '春季大会',
    days: [
      { date: '2030-09-20', label: '9/20（金）', competitions: [{ id: 'c1', name: 'LA' }] },
      { date: '2030-09-21', label: '9/21（土）', competitions: [] },
    ],
  }],
};
const 前の返事 = { answers: [{ date: '2030-09-20', attending: true }, { date: '2030-09-21', attending: false }], comment: '前に書いた理由', entries: [] };

const 模擬 = {
  返事: 前の返事,      // getMyResponse が返すもの。送信が通ったら、送った中身に変わる（本物と同じ）
  遅れ: 300,
  送信: 'ok',          // ok / 断る / 切れる
  呼ばれた: [],
  adminの全部: null,
  // 手入れ（チーフ画面）。期間の削除を押したとき、返事を待たずに消えるかを見る
  chiefのBASE: null,
  削除: 'ok',         // ok / 断る
  削除の遅れ: 1500,
  // 休み（副将）とバイト
  baito: { jobs: [], 割当: [], 調整: {}, today: '2030-09-18' },
  yasumiの全部: () => ({
    members: DATA.members, year: 2030, years: [2030], from: '2030-04-01', to: '2031-03-31',
    today: 模擬.baito.today, kinds: ['有給休暇', 'バイト', '季節休み'], states: ['申請中', '承認', '却下', '取消'],
    leaves: [], paid: {}, grants: [], settings: { 有給日数: 10, 年度始まり月: 4, 休みを外す: true }, maxDays: 60,
  }),
};

function 答える(req, status, body, 遅れ) {
  setTimeout(() => {
    req.respond({
      status: status,
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify(body),
    }).catch(() => {});
  }, 遅れ);
}

function 模擬で答える(req) {
  const u = req.url();
  if (u.indexOf(API元 + '/') !== 0) { req.continue().catch(() => {}); return; }
  const 本文 = JSON.parse(req.postData() || '{}');
  const どこ = /\/jinin$/.test(u) ? '人員表' : '当番';
  模擬.呼ばれた.push(どこ + ' ' + 本文.fn);
  const 返す = (value) => 答える(req, 200, { ok: true, value: value }, 模擬.遅れ);
  if (どこ === '当番' && 本文.fn === 'getMyPage') {
    return 返す({ 版: 't1', me: { name: '美浦' }, members: [{ name: '美浦' }, { name: '相棒' }], 今日: '2030-09-18',
      当番: { 期間: [], 決まったぶん: [] }, 手入れ: [], 毎週の手入れ: [], 予定: [], 休み: [] });
  }
  if (本文.fn === 'getMyPage') {
    return 返す({ 版: '1000.1', me: { id: 'm_001', name: '美浦' }, 大会: [{ id: 'e1', name: '春季大会', 終わった: false, 出した: !!模擬.返事, 行けない日: [], 日: [] }] });
  }
  if (本文.fn === 'getMemberPageData') return 返す(DATA);
  if (本文.fn === 'getMyResponse') return 返す(模擬.返事);
  if (本文.fn === 'submitResponse') {
    if (模擬.送信 === '切れる') { setTimeout(() => req.abort('failed').catch(() => {}), 100); return; }
    if (模擬.送信 === '断る') return 答える(req, 200, { ok: false, error: '大会が見つかりません。' }, 模擬.遅れ);
    const a = 本文.args;
    模擬.返事 = { answers: a[2], comment: a[3], entries: a[4] };
    return 返す({ ok: true });
  }
  // 休み（副将）とバイト。バイトは「バイト先ごとのカレンダー」なので、模擬も同じ形で持つ
  if (本文.fn === 'loginAndLoadYasumi') return 返す({ token: 'a_test', all: 模擬.yasumiの全部() });
  if (本文.fn === 'yasumiLoadAll') return 返す(模擬.yasumiの全部());
  if (本文.fn === 'baitoLoadAll') {
    const id = String(本文.args[1] || '');
    const job = 模擬.baito.jobs.filter((j) => j.id === id)[0] || null;
    const 割当 = job ? 模擬.baito.割当.filter((x) => x.jobId === job.id) : [];
    const 自動 = {};
    割当.forEach((x) => { if (x.date <= 模擬.baito.today) 自動[x.memberId] = (自動[x.memberId] || 0) + 1; });
    return 返す({
      jobs: 模擬.baito.jobs, job: job, members: DATA.members, today: 模擬.baito.today,
      割当: 割当.map((x) => ({ id: x.id, date: x.date, memberId: x.memberId, name: (DATA.members.filter((m) => m.id === x.memberId)[0] || {}).name })),
      counts: DATA.members.map((m) => ({
        memberId: m.id, name: m.name,
        自動: 自動[m.id] || 0,
        調整: 模擬.baito.調整[m.id] || 0,
        回数: (自動[m.id] || 0) + (模擬.baito.調整[m.id] || 0),
      })),
    });
  }
  if (本文.fn === 'baitoSaveJob') {
    const x = 本文.args[1] || {};
    if (x.id) 模擬.baito.jobs.forEach((j) => { if (j.id === x.id) j.name = x.name; });
    else 模擬.baito.jobs.push({ id: 'b' + (模擬.baito.jobs.length + 1), name: x.name, active: true });
    return 返す({ ok: true, jobs: 模擬.baito.jobs });
  }
  if (本文.fn === 'baitoDeleteJob') {
    模擬.baito.jobs = 模擬.baito.jobs.filter((j) => j.id !== 本文.args[1]);
    模擬.baito.割当 = 模擬.baito.割当.filter((x) => x.jobId !== 本文.args[1]);
    return 返す({ ok: true, jobs: 模擬.baito.jobs });
  }
  if (本文.fn === 'baitoAssign') {
    const a = 本文.args;
    模擬.baito.割当.push({ id: 'y' + (模擬.baito.割当.length + 1), jobId: a[1], date: a[2], memberId: a[3] });
    return 返す({ ok: true });
  }
  if (本文.fn === 'baitoUnassign') {
    模擬.baito.割当 = 模擬.baito.割当.filter((x) => x.id !== 本文.args[1]);
    return 返す({ ok: true });
  }
  if (本文.fn === 'baitoSaveCount') {
    模擬.baito.調整[本文.args[2]] = Number(本文.args[3]) || 0;
    return 返す({ ok: true });
  }
  if (本文.fn === 'chiefMeta') return 返す({ 要パスワード: false });
  if (本文.fn === 'loginChiefAndLoad') return 返す({ token: 'c_test', base: 模擬.chiefのBASE });
  if (本文.fn === 'chiefLoadAll') return 返す(模擬.chiefのBASE);
  if (本文.fn === 'chiefDeletePlan') {
    if (模擬.削除 === '断る') return 答える(req, 200, { ok: false, error: 'その期間はもうありません。' }, 模擬.削除の遅れ);
    模擬.chiefのBASE = Object.assign({}, 模擬.chiefのBASE, {
      plans: 模擬.chiefのBASE.plans.filter((p) => p.id !== 本文.args[1]),
    });
    return 答える(req, 200, { ok: true, value: { ok: true } }, 模擬.削除の遅れ);
  }
  // 当番の副将画面（サブ整理タブを見るのに開く）。人員表にも同じ名前の関数があるので、呼び先で分ける
  if (どこ === '当番' && 本文.fn === 'loginAndLoad') return 返す({ token: 'a_test', all: 模擬.当番の全部() });
  if (どこ === '当番' && 本文.fn === 'adminLoadAll') return 返す(模擬.当番の全部());
  // 手入れのサブ整理（副将画面のタブ）
  if (本文.fn === 'adminLoadSubTerms') return 返す(模擬.サブ整理);
  if (本文.fn === 'adminSaveSubTerm') {
    const x = 本文.args[1] || {};
    const s = 模擬.サブ整理;
    if (x.id) {
      s.subTerms.forEach((t) => { if (t.id === x.id) { t.name = x.name; t.from = x.from; } });
      return 返す({ ok: true, id: x.id, 写した: '', all: s });
    }
    const id = 'sp' + (s.subTerms.length + 1);
    const 前 = s.subTerms.filter((t) => t.from < x.from).slice(-1)[0];
    const 写す = x.写す !== false && 前;
    s.subTerms.push({ id: id, name: x.name, from: x.from, note: '' });
    s.subTerms.sort((a, b) => (a.from < b.from ? -1 : 1));
    s.subs[id] = 写す ? JSON.parse(JSON.stringify(s.subs[前.id] || {})) : {};
    return 返す({ ok: true, id: id, 写した: 写す ? 前.name : '', all: s });
  }
  if (本文.fn === 'adminSaveBaseSubs') {
    模擬.基本のサブ保存 = 本文.args.slice(1);
    const s = 模擬.サブ整理;
    s.subs[本文.args[1]] = Object.assign({}, s.subs[本文.args[1]] || {}, 本文.args[2]);
    return 返す({ ok: true, 変えた: Object.keys(本文.args[2]).length, all: s });
  }
  if (本文.fn === 'adminDeleteSubTerm') {
    const s = 模擬.サブ整理;
    s.subTerms = s.subTerms.filter((t) => t.id !== 本文.args[1]);
    delete s.subs[本文.args[1]];
    return 返す({ ok: true, all: s });
  }
  // チーフ：期間をまとめて作る・1つの期間を開く・決まりを保存する
  if (本文.fn === 'chiefSavePlanForHorses') {
    模擬.まとめて作る = 本文.args.slice(1);
    return 返す({
      作った: 本文.args[1].map((h) => ({ horseId: h, name: h, id: 'pn_' + h, 引き継いだ: true, サブの元: '前の期間「前期」' })),
      飛ばした: [], だめ: [],
    });
  }
  if (本文.fn === 'chiefLoadPlan') return 返す(模擬.計画);
  if (本文.fn === 'chiefSavePlan') {
    模擬.期間の保存 = 本文.args[1];
    return 返す({ ok: true, id: 本文.args[1].id || 'pnew', 票を消した: false, 引き継いだ: false, サブの元: '' });
  }
  if (本文.fn === 'chiefSaveSubsBulk') {
    模擬.まとめて保存 = 本文.args[1];
    const subs = Object.assign({}, 模擬.chiefのBASE.subs || {}, 本文.args[1]);
    模擬.chiefのBASE = Object.assign({}, 模擬.chiefのBASE, { subs: subs });
    return 返す({ ok: true, 変えた: Object.keys(本文.args[1]).length, 外れた: 1, subs: subs });
  }
  if (本文.fn === 'adminLoadAll') {
    // 返事を送った時刻を覚える（「API の返事より先に画面が開いたか」を、時計の速さに頼らず比べるため）
    setTimeout(() => { 模擬.全部を返した時刻 = Date.now(); }, 模擬.遅れ);
    return 返す(模擬.adminの全部);
  }
  // 部員・馬匹管理（2026-09-15）。副将のログインと名簿
  if (どこ === '当番' && 本文.fn === 'login') return 返す('a_test');
  if (本文.fn === 'rosterLoad') return 返す({ members: [], horses: [], posts: ['運営'], academicYear: 2030, maxGrade: 6, ずれ: { 部員: 0, 馬: 0 } });
  if (本文.fn === 'adminShareUrl') return 返す({ memberUrl: 'https://hokudaiequestrian-design.github.io/taikai.html', adminUrl: '', manual: false });
  return 答える(req, 200, { ok: false, error: '模擬に無い：' + 本文.fn }, 10);
}

(async () => {
  if (!CHROME) { console.log('Chrome も Edge も見つからないので飛ばす'); return; }
  const srv = await 配る();
  const 元 = 'http://localhost:' + srv.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  const 画面のエラー = [];
  page.on('pageerror', (e) => 画面のエラー.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', 模擬で答える);

  const 知らせ = () => page.$eval('#msg', (el) => el.textContent).catch(() => '');
  const 覚え = (k) => page.evaluate((k) => localStorage.getItem(k), k);
  const 印の付いた日 = () => page.$$eval('.chip.selected', (els) => els.map((e) => e.textContent));
  const 出るまで待つ = () => page.waitForFunction(() => document.getElementById('formCard').style.display === 'block', { timeout: 15000 });

  await page.goto(元 + '/robots.txt');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('me', '美浦'); });

  // ---------- 1. 初めて開く ----------
  console.log('\n== 出欠の画面：初めて開く ==');
  模擬.呼ばれた = [];
  let 始め = Date.now();
  await page.goto(元 + '/taikai.html?event=e1');
  await 出るまで待つ();
  await page.waitForFunction(() => /前回の回答/.test(document.getElementById('msg').textContent), { timeout: 15000 });
  const 出るまで = Date.now() - 始め;
  確かめる('API から読んで出る（' + 出るまで + 'ms、模擬の往復 ' + 模擬.遅れ + 'ms）', 出るまで < 3000, 出るまで + 'ms');
  確かめる('名簿と自分の返事を API に聞く', 模擬.呼ばれた.indexOf('人員表 getMemberPageData') >= 0 && 模擬.呼ばれた.indexOf('人員表 getMyResponse') >= 0, JSON.stringify(模擬.呼ばれた));
  確かめる('写し（bajutsubu-cache）には行かない', !模擬.呼ばれた.some((x) => /cache/.test(x)));
  確かめる('名前を聞き直さない', (await page.$eval('.wholine', (el) => el.textContent)).indexOf('美浦') >= 0);
  確かめる('前の返事が入る', JSON.stringify(await 印の付いた日()) === JSON.stringify(['行ける', '行けない']), JSON.stringify(await 印の付いた日()));
  確かめる('前の理由が入る', (await page.$eval('#comment', (el) => el.value)) === '前に書いた理由');

  // ---------- 2. 送る（押した瞬間に受け付ける） ----------
  console.log('\n== 出欠の画面：送る ==');
  模擬.遅れ = 1500;
  const chips = await page.$$('.chip');
  await chips[2].click();
  await page.$eval('#comment', (el) => { el.value = '両日行けます'; });
  模擬.呼ばれた = [];
  始め = Date.now();
  await page.click('#submitBtn');
  await page.waitForFunction(() => /受け付けました/.test(document.getElementById('msg').textContent), { timeout: 3000 });
  const 受け付けまで = Date.now() - 始め;
  確かめる('押した瞬間に「受け付けました」（' + 受け付けまで + 'ms）', 受け付けまで < 500, 受け付けまで + 'ms');
  確かめる('受け付けた知らせにマイページへ戻るボタンが付く', !!(await page.$('#msg a.donehome')));
  確かめる('届くまで送り待ちに残る', (await 覚え('taikai:送り待ち') || '').indexOf('m_001|e1') > 0);
  await page.waitForFunction(() => /送信しました/.test(document.getElementById('msg').textContent), { timeout: 8000 });
  確かめる('届いたら「送信しました」に変わる', true);
  確かめる('届いたら送り待ちから消える', JSON.stringify(JSON.parse(await 覚え('taikai:送り待ち') || '{}')) === '{}', await 覚え('taikai:送り待ち'));
  確かめる('送信は1回だけ', 模擬.呼ばれた.filter((x) => x === '人員表 submitResponse').length === 1, JSON.stringify(模擬.呼ばれた));
  確かめる('マイページ用の「出したところ」が付く', JSON.parse(await 覚え('mypage:出したところ') || '{}').url === 'taikai.html');
  模擬.遅れ = 300;

  // ---------- 3. 開き直す ----------
  console.log('\n== 出欠の画面：開き直す ==');
  始め = Date.now();
  await page.goto(元 + '/taikai.html?event=e1');
  await 出るまで待つ();
  確かめる('覚えていたぶんで、API を待たずに出る（' + (Date.now() - 始め) + 'ms）', Date.now() - 始め < 模擬.遅れ + 200);
  await page.waitForFunction(() => !document.getElementById('busy').classList.contains('on'), { timeout: 8000 });
  await 待つ(300);
  確かめる('いま出した返事が出る', JSON.stringify(await 印の付いた日()) === JSON.stringify(['行ける', '行ける']), JSON.stringify(await 印の付いた日()));
  確かめる('理由もいま出したもの', (await page.$eval('#comment', (el) => el.value)) === '両日行けます');
  確かめる('API から取れたら手元のぶんは消える', (await 覚え('taikai:手元:m_001|e1')) === null, await 覚え('taikai:手元:m_001|e1'));

  // ---------- 4. 通信が切れて届かなかった ----------
  console.log('\n== 出欠の画面：届かなかったとき ==');
  模擬.送信 = '切れる';
  await page.click('#submitBtn');
  await page.waitForFunction(() => /まだ届いていません/.test(document.getElementById('msg').textContent), { timeout: 8000 });
  確かめる('「まだ届いていません」と出る', true);
  確かめる('送り待ちに残る', !!JSON.parse(await 覚え('taikai:送り待ち') || '{}')['m_001|e1']);
  await page.evaluate(() => {
    const 待ち = JSON.parse(localStorage.getItem('taikai:送り待ち'));
    待ち['m_001|e1'].時刻 -= 2 * 60 * 1000;
    localStorage.setItem('taikai:送り待ち', JSON.stringify(待ち));
    const 手元 = JSON.parse(localStorage.getItem('taikai:手元:m_001|e1'));
    手元.時刻 -= 2 * 60 * 1000;
    localStorage.setItem('taikai:手元:m_001|e1', JSON.stringify(手元));
  });
  模擬.送信 = 'ok';
  模擬.呼ばれた = [];
  await page.goto(元 + '/taikai.html?event=e1');
  await page.waitForFunction(() => /送信しました/.test(document.getElementById('msg').textContent), { timeout: 10000 });
  確かめる('開き直すと自動で送り直して「送信しました」', 模擬.呼ばれた.indexOf('人員表 submitResponse') >= 0, JSON.stringify(模擬.呼ばれた));
  確かめる('送り直したら送り待ちは空', JSON.stringify(JSON.parse(await 覚え('taikai:送り待ち') || '{}')) === '{}');

  // ---------- 5. サーバに断られた ----------
  console.log('\n== 出欠の画面：断られたとき ==');
  模擬.送信 = '断る';
  await page.click('#submitBtn');
  await page.waitForFunction(() => /送信に失敗しました/.test(document.getElementById('msg').textContent), { timeout: 8000 });
  確かめる('理由つきで失敗を出す', (await 知らせ()).indexOf('大会が見つかりません') > 0, await 知らせ());
  確かめる('断られたぶんは送り直さない（送り待ちから消す）', JSON.stringify(JSON.parse(await 覚え('taikai:送り待ち') || '{}')) === '{}');
  確かめる('断られたぶんを手元に残さない', (await 覚え('taikai:手元:m_001|e1')) === null);
  模擬.送信 = 'ok';

  // ---------- 6. マイページ ----------
  console.log('\n== マイページ ==');
  模擬.呼ばれた = [];
  await page.goto(元 + '/');
  await page.waitForFunction(() => document.querySelector('#meTodo') && !/読んでいます/.test(document.body.innerText), { timeout: 15000 });
  await 待つ(300);
  確かめる('人員表も当番も API の getMyPage で読む',
    模擬.呼ばれた.indexOf('人員表 getMyPage') >= 0 && 模擬.呼ばれた.indexOf('当番 getMyPage') >= 0, JSON.stringify(模擬.呼ばれた));
  確かめる('出した大会は「まだ」に出ない', (await page.$eval('#meTodo', (el) => el.textContent)).indexOf('春季大会') < 0);

  // ---------- 7. 管理者の画面 ----------
  console.log('\n== 管理者の画面：前回のぶんで先に開く ==');
  const 全部 = (名) => ({
    posts: ['運営', '馬匹'], maxGrade: 6, defaultJobs: [], choices: {}, jobColors: {}, academicYear: 2030,
    members: [{ id: 'm_001', name: 名, joinYear: 2029, grade: 2, post: '運営', note: '' }],
    // 2026-09-15 部員管理タブは部員・馬匹管理へ移したので、前回の中身が出るかは大会の一覧で見る
    horses: [], events: [{ id: 'e1', name: 名 + 'の大会', startDate: '', endDate: '' }], competitions: [], jobs: [],
  });
  await page.evaluate((all) => {
    sessionStorage.setItem('fukusho:jinin', 'T');   // 2026-09-15 副将は入口でログインした状態から（鍵はこのタブにだけ覚える）
    localStorage.setItem('jinin:admin:all', JSON.stringify(all));
  }, 全部('覚えていた人'));
  模擬.adminの全部 = 全部('新しい人');
  模擬.遅れ = 3000;
  模擬.全部を返した時刻 = 0;
  始め = Date.now();
  await page.goto(元 + '/taikai-admin.html');
  await page.waitForFunction(() => document.getElementById('appView').style.display === 'block', { timeout: 10000 });
  /*
    「何ms以内に開く」ではなく「API の返事が届く前に開いた」で確かめる（2026-09-14）。
    前は 1.2秒以内で見ていたが、PC が重いと 1.4〜1.5秒になって落ちた（画面の作りは同じ）。
  */
  const 開いた時刻 = Date.now();
  確かめる('覚えていたぶんで、API を待たずに開く（' + (開いた時刻 - 始め) + 'ms、模擬の返事は ' + 模擬.遅れ + 'ms 後）',
    !模擬.全部を返した時刻 || 開いた時刻 < 模擬.全部を返した時刻,
    '開いた ' + 開いた時刻 + ' ／ 返事 ' + 模擬.全部を返した時刻);
  確かめる('覚えていた中身が出る', (await page.$eval('#eventList', (el) => el.textContent)).indexOf('覚えていた人') >= 0);
  await page.waitForFunction(() => /新しい人/.test(document.getElementById('eventList').textContent), { timeout: 10000 });
  確かめる('届いたら新しい中身に差し替わる', true);
  // 2026-09-15「管理者」をやめて副将にそろえた。パスワードの欄は部員・馬匹管理へ移した
  確かめる('副将の画面で、パスワードの欄はもう無い', /副将/.test(await page.$eval('header.appbar', (h) => h.textContent)) && !(await page.$('#changePwBtn')));
  確かめる('書き出しのボタンは Excel', (await page.$eval('#exportBtn', (el) => el.textContent)) === 'Excelに書き出す');
  模擬.遅れ = 300;

  // ---------- 8. Excel を実際に落とす ----------
  console.log('\n== 管理者の画面：Excel を落とす（本物の ExcelJS） ==');
  const 落とし先 = fs.mkdtempSync(path.join(os.tmpdir(), 'bajutsu-xlsx-'));
  const cdp = await page.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: 落とし先 });
  const 見本 = {
    名前: '人員表_春季大会',
    行: [['', '', '', ''], ['', '9/20', 'LA', 'LB'], ['', '美浦', '北叡', '使役'], ['', '相棒', '北叡　', '在']],
    書式: [
      { 種類: 'setFontColors', 範囲: { row: 3, col: 3, numRows: 1, numCols: 2 }, 値: [[['#ff0000', '#000000']]] },
      { 種類: 'setFontWeights', 範囲: { row: 3, col: 3, numRows: 2, numCols: 1 }, 値: [[['bold'], ['bold']]] },
      { 種類: 'setBackgrounds', 範囲: { row: 4, col: 4, numRows: 1, numCols: 1 }, 値: [[['#fde68a']]] },
      { 種類: 'setFontFamily', 範囲: { row: 1, col: 1, numRows: 4, numCols: 4 }, 値: ['Arial'] },
      { 種類: 'setBorder', 範囲: { row: 2, col: 2, numRows: 3, numCols: 3 }, 値: [true, true, true, true, false, false] },
      { 種類: 'setDataValidation', 範囲: { row: 3, col: 3, numRows: 2, numCols: 2 }, 値: [{ 候補: ['使役', '北叡', '北叡　'] }] },
    ],
    列幅: { 2: 50, 3: 58 },
  };
  let 落とせた = null;
  // Excel を作る部品は cdnjs から読むので、通信のゆらぎで1回落ちることがある。1回だけやり直す（2026-09-14）
  let 最後のエラー = null;
  for (let 回 = 0; 回 < 2 && !落とせた; 回++) {
    try {
      await page.evaluate((表) => エクセルにして渡す(表), 見本);
      最後のエラー = null;
      for (let i = 0; i < 40 && !落とせた; i++) {
        await 待つ(250);
        落とせた = fs.readdirSync(落とし先).filter((f) => f.endsWith('.xlsx'))[0] || null;
      }
    } catch (e) {
      最後のエラー = e;
      await 待つ(2000);
    }
  }
  if (最後のエラー) 確かめる('Excel を作れる', false, 最後のエラー.message);
  確かめる('xlsx ファイルが落ちてくる', !!落とせた, fs.readdirSync(落とし先).join(','));
  if (落とせた) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(落とし先, 落とせた));
    const ws = wb.worksheets[0];
    確かめる('シート名が付く', ws.name === '人員表_春季大会', ws.name);
    確かめる('値が入る（馬付きの全角スペースも残る）', ws.getCell(3, 2).value === '美浦' && ws.getCell(4, 3).value === '北叡　', String(ws.getCell(4, 3).value));
    確かめる('乗る人の馬名は赤', (ws.getCell(3, 3).font.color || {}).argb === 'FFFF0000', JSON.stringify(ws.getCell(3, 3).font));
    確かめる('太字が付く', ws.getCell(4, 3).font.bold === true);
    確かめる('塗りが付く', ((ws.getCell(4, 4).fill || {}).fgColor || {}).argb === 'FFFDE68A', JSON.stringify(ws.getCell(4, 4).fill));
    確かめる('書体は Arial', ws.getCell(2, 2).font.name === 'Arial', JSON.stringify(ws.getCell(2, 2).font));
    確かめる('外枠の罫線が付き、内側には付かない',
      !!ws.getCell(2, 2).border.top && !!ws.getCell(2, 2).border.left && !!ws.getCell(4, 4).border.bottom && !ws.getCell(3, 3).border.top,
      JSON.stringify([ws.getCell(2, 2).border, ws.getCell(3, 3).border]));
    確かめる('プルダウンが付く', (ws.getCell(3, 3).dataValidation || {}).type === 'list', JSON.stringify(ws.getCell(3, 3).dataValidation));
    確かめる('列幅が付く', ws.getColumn(3).width > 7, String(ws.getColumn(3).width));
  }

  // ---------- 8.5 手入れ（チーフ）：期間の削除 ----------
  console.log(String.fromCharCode(10) + '== 手入れチーフ：期間の削除 ==');
  模擬.chiefのBASE = {
    horses: [{ id: 'h1', name: '北叡', active: true, chief: '美浦' }],
    plans: [
      { id: 'p1', horseId: 'h1', term: '前期', mode: '曜日', from: '', to: '', min: 1, max: null },
      { id: 'p2', horseId: 'h1', term: '後期', mode: '曜日', from: '', to: '', min: 1, max: null },
    ],
    members: [{ id: 'm_001', name: '美浦', grade: 2 }],
    期間名: ['前期', '後期'],
    既定のチーフ倍率: 2,
  };
  const 期間の数 = () => page.$$eval('#planList [data-delp]', (els) => els.length);
  page.on('dialog', (d) => d.accept());

  await page.goto(元 + '/teire-chief.html');
  await page.waitForSelector('#horseSelect option[value="h1"]', { timeout: 15000 });
  await page.select('#horseSelect', 'h1');
  await page.waitForSelector('#planList [data-delp]', { timeout: 15000 });
  確かめる('期間が2つ出る', (await 期間の数()) === 2, String(await 期間の数()));

  // 押した「その時」に消えること（サーバの返事は 模擬.削除の遅れ ミリ秒あと）
  模擬.削除 = 'ok';
  let 始め2 = Date.now();
  // 画面の中のエラーも拾う（削除が押せていない、のような取りこぼしを見つけるため）
  page.on('console', (m) => { if (m.type() === 'error') 画面のエラー.push('console: ' + m.text()); });
  await page.click('[data-delp="p1"]');
  await page.waitForFunction(() => document.querySelectorAll('#planList [data-delp]').length === 1, { timeout: 5000 });
  const 消えるまで = Date.now() - 始め2;
  確かめる('返事を待たずに消える（' + 消えるまで + 'ms、模擬の往復 ' + 模擬.削除の遅れ + 'ms）', 消えるまで < 模擬.削除の遅れ / 2, 消えるまで + 'ms');
  await page.waitForFunction(() => /削除しました/.test(document.getElementById('termMsg').textContent), { timeout: 15000 });
  確かめる('消えたままになる', (await 期間の数()) === 1, String(await 期間の数()));

  // 消せなかったときは戻す
  模擬.削除 = '断る';
  await page.click('[data-delp="p2"]');
  await page.waitForFunction(() => document.querySelectorAll('#planList [data-delp]').length === 0, { timeout: 5000 });
  await page.waitForFunction(() => /削除できませんでした/.test(document.getElementById('termMsg').textContent), { timeout: 15000 });
  確かめる('消せなかったら戻ってくる', (await 期間の数()) === 1, String(await 期間の数()));
  確かめる('理由がその場に出る', /その期間はもうありません/.test(await page.$eval('#termMsg', (el) => el.textContent)));

  // ---------- 8.6 手入れ（チーフ）：サブをまとめて直す ----------
  console.log(String.fromCharCode(10) + '== 手入れチーフ：サブをまとめて直す ==');
  模擬.chiefのBASE = {
    horses: [
      { id: 'h1', name: '北叡', active: true, chief: '美浦' },
      { id: 'h2', name: '北冴', active: true, chief: '' },
      { id: 'h3', name: '北翔', active: true, chief: '' },
    ],
    plans: [
      { id: 'p1', horseId: 'h1', term: '後期', mode: '曜日', from: '', to: '', min: 1, max: null },
      { id: 'p2', horseId: 'h2', term: '後期', mode: '曜日', from: '', to: '', min: 1, max: null },
      { id: 'p3', horseId: 'h1', term: '前期', mode: '曜日', from: '', to: '', min: 1, max: null },
    ],
    members: [{ id: 'm_001', name: '美浦', grade: 2 }, { id: 'm_002', name: '相棒', grade: 1 }],
    期間名: ['前期', '後期'],
    subs: { p1: ['m_001', 'm_002'], p3: ['m_002'] },
    既定のチーフ倍率: 2,
  };
  // 部員・馬匹管理（2026-09-15。「サブをまとめて直す」と「サブ整理」はここへ移した）を副将で開く。tab を渡すとそのタブを開く
  const 部員管理を開く = async (tab) => {
    await page.evaluate(() => { sessionStorage.setItem('fukusho:touban', 'a_test'); });   // 副将は入口でログインした状態から（2026-09-15）
    await page.goto(元 + '/buin.html');
    await page.waitForFunction(() => document.getElementById('app').style.display === 'block', { timeout: 15000 });
    if (tab) await page.click('.tabs [data-tab="' + tab + '"]');
  };
  const 付いている = () => page.$$eval('#sbGridBox table.subs-grid input:checked',
    (els) => els.map((e) => e.dataset.plan + '|' + e.dataset.member).sort());
  const 保存の知らせ = () => page.$eval('#sbSaveMsg', (el) => el.textContent);

  await 部員管理を開く('subs');
  await page.waitForSelector('#sbGridBox table.subs-grid', { timeout: 15000 });
  const 列の馬 = await page.$$eval('#sbGridBox table.subs-grid thead th:not(.rowhead)', (els) => els.map((e) => e.firstChild.textContent));
  確かめる('いちばん後ろの期間（後期）がある馬だけ並ぶ', JSON.stringify(列の馬) === JSON.stringify(['北叡', '北冴']), JSON.stringify(列の馬));
  確かめる('その期間が無い馬を知らせる', /北翔/.test(await page.$eval('#sbTermNote', (el) => el.textContent)));
  確かめる('保存ずみのサブにチェックが付く', JSON.stringify(await 付いている()) === JSON.stringify(['p1|m_001', 'p1|m_002']), JSON.stringify(await 付いている()));
  確かめる('チーフの印が出る', !!(await page.$('[data-cell="p1|m_001"] .tag')));
  確かめる('サブが0人の馬を知らせる', /0人/.test(await page.$eval('[data-colinfo="p2"]', (el) => el.textContent)));

  模擬.呼ばれた = [];
  await page.click('#sbSaveBtn');
  確かめる('変えていなければ送らずに知らせる',
    !模擬.呼ばれた.some((x) => /chiefSaveSubsBulk/.test(x)) && /変えたところがありません/.test(await 保存の知らせ()));

  // 北叡から相棒を外し、北冴に美浦を入れる（外すので確かめの窓が出る → 8.5 で付けた dialog が受ける）
  await page.click('input[data-plan="p1"][data-member="m_002"]');
  await page.click('input[data-plan="p2"][data-member="m_001"]');
  確かめる('直したマスに印が付く', (await page.$$('#sbGridBox td.changed')).length === 2);
  確かめる('保存していない馬を知らせる', /北叡、北冴/.test(await page.$eval('#sbDirtyText', (el) => el.textContent)));
  await page.click('#sbSaveBtn');
  await page.waitForFunction(() => /保存しました/.test(document.getElementById('sbSaveMsg').textContent), { timeout: 15000 });
  確かめる('変えた2頭ぶんを1回で送る',
    JSON.stringify(模擬.まとめて保存) === JSON.stringify({ p1: ['m_001'], p2: ['m_001'] }), JSON.stringify(模擬.まとめて保存));
  確かめる('送信は1回', 模擬.呼ばれた.filter((x) => x === '当番 chiefSaveSubsBulk').length === 1, JSON.stringify(模擬.呼ばれた));
  確かめる('保存したら直した印が消える', (await page.$$('#sbGridBox td.changed')).length === 0);
  確かめる('保存したぶんがチェックに残る', JSON.stringify(await 付いている()) === JSON.stringify(['p1|m_001', 'p2|m_001']), JSON.stringify(await 付いている()));

  await page.select('#sbTermSelect', '前期');
  確かめる('期間を切り替えると、その期間の馬とサブになる', JSON.stringify(await 付いている()) === JSON.stringify(['p3|m_002']), JSON.stringify(await 付いている()));

  // ---------- 8.65 チーフ：最新のサブ整理に合わせる（サブをまとめて直す） ----------
  console.log(String.fromCharCode(10) + '== チーフ：最新のサブ整理に合わせる（まとめて直す） ==');
  // 8.6 の続き。保存ずみは p1（北叡・後期）: 美浦、p2（北冴・後期）: 美浦
  模擬.chiefのBASE = Object.assign({}, 模擬.chiefのBASE, {
    最新のサブ整理: { id: 'sp2', name: '後期', from: '2030-10-01', subs: { h1: ['m_001'], h2: ['m_002'] } },
  });
  await 部員管理を開く('subs');   // いちばん後ろの期間（後期）が開く
  await page.waitForSelector('#sbGridBox table.subs-grid', { timeout: 15000 });
  const 最新ボタン = () => page.$eval('#sbLatestBtn', (el) => el.textContent);
  確かめる('ボタンに最新のサブ整理の日付が出る', /^最新（10月1日）のサブ整理に合わせる$/.test(await 最新ボタン()), await 最新ボタン());
  模擬.呼ばれた = [];
  await page.click('#sbLatestBtn');
  確かめる('押すと表の上だけ合わせ、まだ送らない',
    JSON.stringify(await 付いている()) === JSON.stringify(['p1|m_001', 'p2|m_002']) && !模擬.呼ばれた.some((x) => /chiefSaveSubsBulk/.test(x)),
    JSON.stringify(await 付いている()));
  確かめる('変わったマスに印が付く（北冴の2マス）', (await page.$$('#sbGridBox td.changed')).length === 2);
  確かめる('まだ保存していないと知らせる', /まだ保存していません/.test(await 保存の知らせ()), await 保存の知らせ());
  await page.click('#sbSaveBtn');   // 北冴から美浦が外れるので確かめの窓が出る（8.5 で付けた dialog が受ける）
  await page.waitForFunction(() => /保存しました/.test(document.getElementById('sbSaveMsg').textContent), { timeout: 15000 });
  確かめる('保存すると、変わった馬だけを送る', JSON.stringify(模擬.まとめて保存) === JSON.stringify({ p2: ['m_002'] }), JSON.stringify(模擬.まとめて保存));

  模擬.chiefのBASE = Object.assign({}, 模擬.chiefのBASE, { 最新のサブ整理: null });
  await 部員管理を開く('subs');
  await page.waitForSelector('#sbGridBox table.subs-grid', { timeout: 15000 });
  await page.click('#sbLatestBtn');
  確かめる('サブ整理が無いときは、押すと理由を出す（表は変えない）', /サブ整理がまだありません/.test(await 保存の知らせ()), await 保存の知らせ());

  // ---------- 8.66 チーフ：期間を作る・開始日を入れ直す ----------
  console.log(String.fromCharCode(10) + '== チーフ：期間を作る・開始日を入れ直す ==');
  模擬.chiefのBASE = Object.assign({}, 模擬.chiefのBASE, {
    最新のサブ整理: { id: 'sp2', name: '後期', from: '2030-10-01', subs: {} },
  });
  await page.goto(元 + '/teire-chief.html');
  await page.waitForSelector('#horseSelect option[value="h1"]', { timeout: 15000 });
  await page.select('#horseSelect', 'h1');
  await page.$eval('#termCard details.fold', (el) => { el.open = true; });
  確かめる('期間を作る欄に「最新（10月1日）のサブ整理に合わせる」が出て、最初は外れている',
    /最新（10月1日）のサブ整理に合わせる/.test(await page.$eval('#useLatestText', (el) => el.textContent)) &&
    !(await page.$eval('#useLatest', (el) => el.checked)));
  確かめる('曜日のときも開始日の欄が出て、終了日は出ない',
    !!(await page.$('#fromDate')) && (await page.$eval('#toWrap', (el) => el.style.display)) === 'none');
  await page.$eval('#termName', (el) => { el.value = '秋'; });
  // 2026-09-15 ここで馬を選び直す欄（全部の馬・いま選んでいる馬だけ）はやめた。上で選んだ馬（北叡）の期間を作る
  確かめる('期間を作る欄に、馬を選び直すチェックはもう無い', !(await page.$('#horseSheet')) && !(await page.$('#hAllBtn')));
  確かめる('どの馬の期間を作るかが書いてある', (await page.$eval('#newHorseName', (el) => el.textContent)) === '北叡');
  模擬.呼ばれた = [];
  await page.click('#newPlanBtn');
  確かめる('開始日が無いと期間を作らずに知らせる',
    /開始日を入れてください/.test(await page.$eval('#termMsg', (el) => el.textContent)) && !模擬.呼ばれた.some((x) => /chiefSavePlan/.test(x)));
  await page.$eval('#fromDate', (el) => { el.value = '2030-11-01'; });
  await page.click('#useLatest');
  await page.click('#newPlanBtn');
  await page.waitForFunction(() => /作りました/.test(document.getElementById('termMsg').textContent), { timeout: 15000 });
  確かめる('上で選んだ馬（北叡）だけに作る', JSON.stringify((模擬.まとめて作る || [])[0]) === JSON.stringify(['h1']), JSON.stringify(模擬.まとめて作る));
  const 作る中身 = (模擬.まとめて作る || [])[1] || {};
  確かめる('チェックすると「最新に合わせる」を付けて送る（曜日でも開始日を送る）',
    作る中身.最新に合わせる === true && 作る中身.from === '2030-11-01' && 作る中身.mode === '曜日', JSON.stringify(模擬.まとめて作る));
  確かめる('どこからサブを入れたかを知らせる', /前の期間「前期」/.test(await page.$eval('#termMsg', (el) => el.textContent)));

  // 開始日の無い曜日の期間（p1）を開いて、開始日を入れ直す
  const 七日 = ['月', '火', '水', '木', '金', '土', '日'].map((w) => ({ key: w, label: w + '曜' }));
  模擬.計画 = {
    plan: { id: 'p1', horseId: 'h1', term: '後期', mode: '曜日', from: '', to: '', min: 1, max: null, chiefRatio: null, note: '' },
    horse: { id: 'h1', name: '北叡', active: true, chief: '美浦' }, keys: 七日, keyError: '',
    members: 模擬.chiefのBASE.members, subs: ['m_001'], chiefMemberId: 'm_001',
    チーフ倍率: 2, 既定のチーフ倍率: 2, votes: [], cells: [], warnings: [],
  };
  await page.click('[data-open="p1"]');
  await page.waitForFunction(() => document.getElementById('planPane').style.display === 'block', { timeout: 15000 });
  確かめる('開始日の無い曜日の期間は「開始日がまだ入っていません」と出る',
    /開始日がまだ入っていません/.test(await page.$eval('#planPeriod', (el) => el.textContent)));
  確かめる('この期間の決まりに開始日の欄が出る', (await page.$eval('#editFromWrap', (el) => el.style.display)) === 'block');
  await page.$eval('#editFrom', (el) => { el.value = '2030-04-01'; });
  await page.click('#savePlanBtn');
  await page.waitForFunction(() => /保存しました/.test(document.getElementById('planMsg').textContent), { timeout: 15000 });
  確かめる('開始日を入れ直して送れる（方式は曜日のまま）',
    (模擬.期間の保存 || {}).id === 'p1' && 模擬.期間の保存.from === '2030-04-01' && 模擬.期間の保存.mode === '曜日', JSON.stringify(模擬.期間の保存));

  // ---------- 8.67 副将：サブ整理タブ ----------
  console.log(String.fromCharCode(10) + '== 副将：サブ整理タブ ==');
  模擬.当番の全部 = () => ({
    terms: [{ id: 't1', name: '前期', open: true }], termId: 't1',
    members: [{ id: 'm_001', name: '美浦', grade: 2, joinYear: 2029, note: '' }, { id: 'm_002', name: '相棒', grade: 1, joinYear: 2030, note: '' }],
    duties: [], slots: [], votes: [], cells: [],
    settings: { 個人下限: 1, 個人上限: 1, チーフ倍率: 2, 同曜日禁止: true, 連日回避: true, マル絶対: false },
    days: ['月', '火', '水', '木', '金', '土', '日'], 希望の数: 4, warnings: [],
  });
  模擬.サブ整理 = {
    members: [{ id: 'm_001', name: '美浦', grade: 2 }, { id: 'm_002', name: '相棒', grade: 1 }],
    horses: [{ id: 'h1', name: '北叡', active: true, chief: '美浦' }, { id: 'h2', name: '北冴', active: true, chief: '' }],
    subTerms: [{ id: 'sp1', name: '前期', from: '2030-04-01', note: '' }],
    subs: { sp1: { h1: ['m_001'] } },
  };
  const 基本のチェック = () => page.$$eval('#stGrid input:checked',
    (els) => els.map((e) => e.dataset.sthorse + '|' + e.dataset.stmember).sort());
  const 副将のエラーの数 = 画面のエラー.length;

  // 2026-09-15 サブ整理は副将画面のタブから、部員・馬匹管理のタブへ移した
  await 部員管理を開く('');
  確かめる('部員・馬匹管理にサブ整理のタブがある', !!(await page.$('[data-tab="subterms"]')));
  模擬.呼ばれた = [];
  await page.click('[data-tab="subterms"]');
  await page.waitForSelector('#stGrid table.subs-grid', { timeout: 15000 });
  確かめる('タブを開いたときに読む', 模擬.呼ばれた.indexOf('当番 adminLoadSubTerms') >= 0, JSON.stringify(模擬.呼ばれた));
  確かめる('いちばん新しいサブ整理が開く', /前期/.test(await page.$eval('#stOpenTitle', (el) => el.textContent)));
  確かめる('基本のサブにチェックが付く', JSON.stringify(await 基本のチェック()) === JSON.stringify(['h1|m_001']), JSON.stringify(await 基本のチェック()));
  確かめる('サブが0人の馬は0人と出る', /0人/.test(await page.$eval('[data-stcol="h2"]', (el) => el.textContent)));

  await page.click('input[data-sthorse="h2"][data-stmember="m_002"]');
  確かめる('直したマスに印が付く（サブ整理）', (await page.$$('#stGrid td.changed')).length === 1);
  await page.click('#stSaveBtn');
  await page.waitForFunction(() => /保存しました/.test(document.getElementById('stSaveMsg').textContent), { timeout: 15000 });
  確かめる('変えた馬だけを送る', JSON.stringify(模擬.基本のサブ保存) === JSON.stringify(['sp1', { h2: ['m_002'] }]), JSON.stringify(模擬.基本のサブ保存));
  確かめる('保存したら直した印が消える（サブ整理）', (await page.$$('#stGrid td.changed')).length === 0);

  await page.$eval('#stNewFold', (el) => { el.open = true; });
  模擬.呼ばれた = [];
  await page.click('#stNewBtn');
  確かめる('開始日が無いと送らずに知らせる（サブ整理）',
    /開始日を入れてください/.test(await page.$eval('#stNewMsg', (el) => el.textContent)) && !模擬.呼ばれた.some((x) => /adminSaveSubTerm/.test(x)));
  await page.type('#stNewName', '後期');
  await page.$eval('#stNewFrom', (el) => { el.value = '2030-10-01'; });
  await page.click('#stNewBtn');
  await page.waitForFunction(() => /後期/.test(document.getElementById('stOpenTitle').textContent), { timeout: 15000 });
  確かめる('作ると開いて、写したサブにチェックが付く', JSON.stringify(await 基本のチェック()) === JSON.stringify(['h1|m_001', 'h2|m_002']), JSON.stringify(await 基本のチェック()));
  const 一覧の文 = await page.$eval('#stList', (el) => el.textContent);
  確かめる('前期の範囲が後期の前日までになり、後期に「最新」が付く', /2030-09-30 まで/.test(一覧の文) && /後期.*最新/.test(一覧の文), 一覧の文);
  確かめる('副将画面でエラーが起きていない', 画面のエラー.length === 副将のエラーの数, 画面のエラー.slice(副将のエラーの数).join(' / '));

  // ---------- 8.7 休み（副将）：バイトはバイト先ごとのカレンダーで入れる ----------
  console.log('\n== 休み副将：バイトのカレンダー ==');
  await page.evaluate(() => sessionStorage.setItem('fukusho:touban', 'a_test'));   // 副将は入口でログインした状態から（2026-09-15）
  await page.goto(元 + '/yasumi-admin.html');
  await page.waitForFunction(() => document.getElementById('app').style.display === 'block', { timeout: 15000 });
  await page.click('[data-tab="baito"]');
  確かめる('バイトのタブが開く', await page.$eval('#tab-baito', (el) => el.style.display !== 'none'));
  確かめる('休みを入れるタブにバイトは出ない',
    !(await page.$$eval('#addKind option', (els) => els.map((e) => e.textContent))).includes('バイト'),
    JSON.stringify(await page.$$eval('#addKind option', (els) => els.map((e) => e.textContent))));

  // バイト先を作る（決めるのは名前だけ）
  await page.type('#baitoNew', 'フロンテア');
  await page.click('#baitoAddJob');
  await page.waitForFunction(() => document.getElementById('baitoCalCard').style.display === 'block', { timeout: 15000 });
  確かめる('名前だけでバイトを作れる', 模擬.baito.jobs.length === 1 && 模擬.baito.jobs[0].name === 'フロンテア',
    JSON.stringify(模擬.baito.jobs));
  確かめる('作るとカレンダーと回数が出る',
    (await page.$eval('#baitoCountCard', (el) => el.style.display)) === 'block');

  // 日を押して、名前を打って入れる
  await page.click('[data-day="2030-09-20"]');
  await page.waitForFunction(() => document.getElementById('baitoDay').style.display === 'block', { timeout: 15000 });
  確かめる('名前は打ち込んで絞り込める（候補つき）',
    (await page.$eval('#baitoWho', (el) => el.getAttribute('list'))) === 'baitoMembers'
    && (await page.$$eval('#baitoMembers option', (els) => els.length)) === 2);
  await page.type('#baitoWho', '美浦');
  await page.click('#baitoAddWho');
  await page.waitForFunction(() => /入れました/.test(document.getElementById('baitoMsg').textContent), { timeout: 15000 });
  確かめる('その日に人が入る', 模擬.baito.割当.length === 1 && 模擬.baito.割当[0].date === '2030-09-20',
    JSON.stringify(模擬.baito.割当));
  確かめる('カレンダーの枠に名前が出る',
    (await page.$eval('[data-day="2030-09-20"]', (el) => el.textContent)).indexOf('美浦') >= 0);

  // 名簿に無い名前は弾く
  await page.$eval('#baitoWho', (el) => { el.value = 'いない人'; });
  await page.click('#baitoAddWho');
  await page.waitForFunction(() => /名簿にありません/.test(document.getElementById('baitoMsg').textContent), { timeout: 15000 });
  確かめる('名簿に無い名前はその場で断る', 模擬.baito.割当.length === 1);

  // 回数（副将だけが見る）
  確かめる('過ぎた日のぶんが回数に出る',
    (await page.$eval('#baitoCountTable', (el) => el.textContent)).indexOf('相棒') >= 0);
  await page.$eval('.baito-adj[data-who="m_001"]', (el) => { el.value = '5'; });
  await page.click('[data-savecount="m_001"]');
  await page.waitForFunction(() => /直しました/.test(document.getElementById('baitoCountMsg').textContent), { timeout: 15000 });
  確かめる('手で足したぶんが保存される', 模擬.baito.調整.m_001 === 5, JSON.stringify(模擬.baito.調整));
  確かめる('回数は 入っているぶん＋手で足したぶん',
    (await page.$eval('#baitoCountTable tr:nth-child(2)', (el) => el.textContent)).indexOf('5') >= 0);

  // 外す
  await page.click('[data-off]');
  await page.waitForFunction(() => document.querySelectorAll('#baitoDayList [data-off]').length === 0, { timeout: 15000 });
  確かめる('その日のその人を外せる', 模擬.baito.割当.length === 0);

  確かめる('画面でエラーが起きていない', 画面のエラー.length === 0, 画面のエラー.join(' / '));

  // ---------- 9. 本物の API に keepalive で届くか ----------
  /*
    **それまでの場面とは別のブラウザで確かめる**（2026-09-14）。
    上の場面では送信の切断を真似る（keepalive の送信を途中で打ち切る）ので、同じブラウザのままだと
    その後始末が残って、本物の API への keepalive が「Failed to fetch」で落ちることがあった。
    同じ送り方を Chrome だけで試すと6回とも届く（サイトの不具合ではない）。
    通信のゆらぎで落ちないよう、1回だけやり直す。
  */
  console.log('\n== 本物：keepalive で Cloudflare の API に届くか ==');
  await browser.close();
  const 別のブラウザ = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  let 本物 = null;
  for (let 回 = 0; 回 < 2; 回++) {
    const 素のページ = await 別のブラウザ.newPage();
    await 素のページ.goto(元 + '/robots.txt');
    本物 = await 素のページ.evaluate(async (url) => {
      const 始め = Date.now();
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ fn: 'getMyPage', args: ['__存在しない__'] }), keepalive: true,
        });
        const text = await res.text();
        return { ok: res.ok, text: text.slice(0, 80), ms: Date.now() - 始め };
      } catch (e) {
        return { ok: false, text: String(e), ms: Date.now() - 始め };
      }
    }, API元 + '/jinin');
    await 素のページ.close();
    if (本物.ok && /^\{"ok":/.test(本物.text)) break;
    if (回 === 0) await 待つ(2000);
  }
  確かめる('keepalive でも本物から JSON が返る（' + 本物.ms + 'ms）', 本物.ok && /^\{"ok":/.test(本物.text), JSON.stringify(本物));

  await 別のブラウザ.close();
  srv.close();
  console.log('\n' + (失敗.length ? '✗ ' + 失敗.length + '件失敗' : '✓ ぜんぶ通った') + '（' + ok + '/' + (ok + 失敗.length) + '）');
  if (失敗.length) process.exit(1);
})().catch((e) => { console.log(e); process.exit(1); });
