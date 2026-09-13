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
  if (本文.fn === 'adminLoadAll') return 返す(模擬.adminの全部);
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
    horses: [], events: [], competitions: [], jobs: [],
  });
  await page.evaluate((all) => {
    localStorage.setItem('adminToken', 'T');
    localStorage.setItem('jinin:admin:all', JSON.stringify(all));
  }, 全部('覚えていた人'));
  模擬.adminの全部 = 全部('新しい人');
  模擬.遅れ = 1500;
  始め = Date.now();
  await page.goto(元 + '/taikai-admin.html');
  await page.waitForFunction(() => document.getElementById('appView').style.display === 'block', { timeout: 10000 });
  確かめる('覚えていたぶんで、API を待たずに開く（' + (Date.now() - 始め) + 'ms）', Date.now() - 始め < 1200);
  確かめる('覚えていた中身が出る', (await page.$eval('#memberList', (el) => el.textContent)).indexOf('覚えていた人') >= 0);
  await page.waitForFunction(() => /新しい人/.test(document.getElementById('memberList').textContent), { timeout: 10000 });
  確かめる('届いたら新しい中身に差し替わる', true);
  確かめる('パスワードを変える欄がある（スプレッドシートのメニューの代わり）', !!(await page.$('#changePwBtn')));
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
  try {
    await page.evaluate((表) => エクセルにして渡す(表), 見本);
    for (let i = 0; i < 40 && !落とせた; i++) {
      await 待つ(250);
      落とせた = fs.readdirSync(落とし先).filter((f) => f.endsWith('.xlsx'))[0] || null;
    }
  } catch (e) {
    確かめる('Excel を作れる', false, e.message);
  }
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

  確かめる('画面でエラーが起きていない', 画面のエラー.length === 0, 画面のエラー.join(' / '));

  // ---------- 9. 本物の API に keepalive で届くか ----------
  console.log('\n== 本物：keepalive で Cloudflare の API に届くか ==');
  const 素のページ = await browser.newPage();
  await 素のページ.goto(元 + '/robots.txt');
  const 本物 = await 素のページ.evaluate(async (url) => {
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
  確かめる('keepalive でも本物から JSON が返る（' + 本物.ms + 'ms）', 本物.ok && /^\{"ok":/.test(本物.text), JSON.stringify(本物));

  await browser.close();
  srv.close();
  console.log('\n' + (失敗.length ? '✗ ' + 失敗.length + '件失敗' : '✓ ぜんぶ通った') + '（' + ok + '/' + (ok + 失敗.length) + '）');
  if (失敗.length) process.exit(1);
})().catch((e) => { console.log(e); process.exit(1); });
