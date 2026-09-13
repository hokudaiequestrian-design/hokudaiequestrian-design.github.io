/**
 * 組み立てたページを本物のブラウザ（Chrome）で動かして、待たせない作りを確かめる。
 *
 *   npm install --no-save --no-package-lock puppeteer-core   （初回だけ。node_modules は .gitignore 済み）
 *   node tests/browsertest.js
 *
 * docs/ を手元で配り、Cloudflare の写しと Apps Script は**模擬**で答える（本物のシートには書かない）。
 * 最後の1件だけ、本物の Apps Script に keepalive で読み取りを投げて、転送を越えて返事が来るか見る。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter((p) => fs.existsSync(p))[0];
const DOCS = path.join(__dirname, '..', 'docs');
const 写し = 'https://bajutsubu-cache.hokudai-equestrian.workers.dev';
const 人員表GAS = 'AKfycbxUWCdZAA0-JIhl2Pr10KbAIZSKY4hcn7MfFwRWODjd0WQBWmmA25A-GdtVb5mcK38MTQ';
const 本物の人員表 = 'https://script.google.com/macros/s/' + 人員表GAS + '/exec';

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
  写しの版: '1000.1',
  写しの返事: 前の返事,
  写しが落ちている: false,
  写しの遅れ: 50,
  GASの遅れ: 1500,
  送信: 'ok',          // ok / 断る / 切れる
  呼ばれた: [],
  adminの全部: null,
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
  if (u.indexOf(写し) === 0) {
    模擬.呼ばれた.push('写し ' + u.slice(写し.length));
    if (模擬.写しが落ちている) return 答える(req, 503, { ok: false, error: '落ちている' }, 模擬.写しの遅れ);
    if (u.indexOf('/jinin/taikai') > 0) {
      return 答える(req, 200, { ok: true, value: { 版: 模擬.写しの版, data: DATA, memberId: 'm_001', 返事: { e1: 模擬.写しの返事 } } }, 模擬.写しの遅れ);
    }
    if (u.indexOf('/jinin/mypage') > 0) {
      return 答える(req, 200, { ok: true, value: { 版: 模擬.写しの版, me: { id: 'm_001', name: '美浦' }, 大会: [{ id: 'e1', name: '春季大会', 終わった: false, 出した: false, 行けない日: [], 日: [] }] } }, 模擬.写しの遅れ);
    }
  }
  if (u.indexOf('https://script.google.com/') === 0) {
    const 本文 = JSON.parse(req.postData() || '{}');
    const どこ = u.indexOf(人員表GAS) > 0 ? '人員表' : '当番';
    模擬.呼ばれた.push(どこ + ' ' + 本文.fn);
    const 返す = (value) => 答える(req, 200, { ok: true, value: value }, 模擬.GASの遅れ);
    if (どこ === '当番' && 本文.fn === 'getMyPage') {
      return 返す({ 版: 't1', me: { name: '美浦' }, members: [{ name: '美浦' }, { name: '相棒' }], 今日: '2030-09-18',
        当番: { 期間: [], 決まったぶん: [] }, 手入れ: [], 毎週の手入れ: [], 予定: [], 休み: [] });
    }
    if (本文.fn === 'getMemberPageData') return 返す(DATA);
    if (本文.fn === 'getMyResponse') return 返す(前の返事);
    if (本文.fn === 'submitResponse') {
      if (模擬.送信 === '切れる') { setTimeout(() => req.abort('failed').catch(() => {}), 200); return; }
      if (模擬.送信 === '断る') return 答える(req, 200, { ok: false, error: '大会が見つかりません。' }, 模擬.GASの遅れ);
      return 返す({ ok: true });
    }
    if (本文.fn === 'adminLoadAll') return 返す(模擬.adminの全部);
    if (本文.fn === 'adminShareUrl') return 返す({ memberUrl: 'https://x', adminUrl: 'https://y', manual: false });
    if (本文.fn === 'getMyPage') return 返す({ 版: '1000.1', me: null, 大会: [] });
    return 答える(req, 200, { ok: false, error: '模擬に無い：' + 本文.fn }, 10);
  }
  req.continue().catch(() => {});
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

  // 名前を覚えた状態から始める（入口で選んだあと）
  await page.goto(元 + '/robots.txt');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('me', '美浦'); });

  // ---------- 1. 初めて開く（覚えなし） ----------
  console.log('\n== 出欠の画面：初めて開く ==');
  模擬.呼ばれた = [];
  let 始め = Date.now();
  await page.goto(元 + '/taikai.html?event=e1');
  await page.waitForFunction(() => document.getElementById('formCard').style.display === 'block', { timeout: 10000 });
  const 出るまで = Date.now() - 始め;
  await 待つ(300);
  確かめる('写しから読んで、Apps Script を待たずに出る（' + 出るまで + 'ms）', 出るまで < 1500, 出るまで + 'ms');
  確かめる('Apps Script には読みに行かない', !模擬.呼ばれた.some((x) => x.indexOf('人員表 ') === 0), JSON.stringify(模擬.呼ばれた));
  確かめる('写しは1回だけ読む', 模擬.呼ばれた.filter((x) => x.indexOf('写し') === 0).length === 1, JSON.stringify(模擬.呼ばれた));
  確かめる('名前を聞き直さない', (await page.$eval('.wholine', (el) => el.textContent)).indexOf('美浦') >= 0);
  確かめる('前の返事が入る', JSON.stringify(await 印の付いた日()) === JSON.stringify(['行ける', '行けない']), JSON.stringify(await 印の付いた日()));
  確かめる('前の理由が入る', (await page.$eval('#comment', (el) => el.value)) === '前に書いた理由');

  // ---------- 2. 送る（押した瞬間に受け付ける） ----------
  console.log('\n== 出欠の画面：送る ==');
  const chips = await page.$$('.chip');
  await chips[2].click();   // 2日目を「行ける」に
  await page.$eval('#comment', (el) => { el.value = '両日行けます'; });
  模擬.呼ばれた = [];
  始め = Date.now();
  await page.click('#submitBtn');
  await page.waitForFunction(() => /受け付けました/.test(document.getElementById('msg').textContent), { timeout: 3000 });
  const 受け付けまで = Date.now() - 始め;
  確かめる('押した瞬間に「受け付けました」（' + 受け付けまで + 'ms）', 受け付けまで < 500, 受け付けまで + 'ms');
  確かめる('受け付けた知らせにマイページへ戻るボタンが付く', !!(await page.$('#msg a.donehome')));
  確かめる('届くまで送り待ちに残る', JSON.stringify(JSON.parse(await 覚え('taikai:送り待ち') || '{}')).indexOf('m_001|e1') > 0);
  await page.waitForFunction(() => /送信しました/.test(document.getElementById('msg').textContent), { timeout: 8000 });
  確かめる('届いたら「送信しました」に変わる', true);
  確かめる('届いたら送り待ちから消える', JSON.stringify(JSON.parse(await 覚え('taikai:送り待ち') || '{}')) === '{}', await 覚え('taikai:送り待ち'));
  確かめる('送った中身が正しい', 模擬.呼ばれた.filter((x) => x === '人員表 submitResponse').length === 1, JSON.stringify(模擬.呼ばれた));
  確かめる('マイページ用の「出したところ」が付く', JSON.parse(await 覚え('mypage:出したところ') || '{}').url === 'taikai.html');

  // ---------- 3. 開き直す（写しはまだ出す前の中身） ----------
  console.log('\n== 出欠の画面：写しが追いつく前に開き直す ==');
  模擬.呼ばれた = [];
  始め = Date.now();
  await page.goto(元 + '/taikai.html?event=e1');
  await page.waitForFunction(() => document.getElementById('formCard').style.display === 'block', { timeout: 10000 });
  確かめる('覚えていたぶんで、すぐ出る（' + (Date.now() - 始め) + 'ms）', Date.now() - 始め < 1000);
  await 待つ(500);
  確かめる('古い写しではなく、いま出した返事を出す', JSON.stringify(await 印の付いた日()) === JSON.stringify(['行ける', '行ける']), JSON.stringify(await 印の付いた日()));
  確かめる('理由もいま出したもの', (await page.$eval('#comment', (el) => el.value)) === '両日行けます');

  // 写しが追いついたら、手元のぶんは捨てる
  模擬.写しの版 = String(Date.now() + 1000) + '.1';
  模擬.写しの返事 = { answers: [{ date: '2030-09-20', attending: true }, { date: '2030-09-21', attending: true }], comment: '両日行けます', entries: [] };
  await page.goto(元 + '/taikai.html?event=e1');
  await page.waitForFunction(() => document.getElementById('formCard').style.display === 'block', { timeout: 10000 });
  await 待つ(500);
  確かめる('写しが追いついたら手元のぶんは消える', (await 覚え('taikai:手元:m_001|e1')) === null, await 覚え('taikai:手元:m_001|e1'));

  // ---------- 4. 通信が切れて届かなかった ----------
  console.log('\n== 出欠の画面：届かなかったとき ==');
  模擬.送信 = '切れる';
  await page.click('#submitBtn');
  await page.waitForFunction(() => /まだ届いていません/.test(document.getElementById('msg').textContent), { timeout: 8000 });
  確かめる('「まだ届いていません」と出る', true);
  const 残った = JSON.parse(await 覚え('taikai:送り待ち') || '{}')['m_001|e1'];
  確かめる('送り待ちに残る', !!残った);

  // 1分以上たってから開き直すと、自動で送り直す
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

  // ---------- 6. 写しが落ちている ----------
  console.log('\n== 出欠の画面：写しが落ちているとき ==');
  await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.indexOf('taikai:') === 0).forEach((k) => localStorage.removeItem(k)); });
  模擬.写しが落ちている = true;
  模擬.呼ばれた = [];
  await page.goto(元 + '/taikai.html?event=e1');
  await page.waitForFunction(() => document.getElementById('formCard').style.display === 'block', { timeout: 15000 });
  await page.waitForFunction(() => /前回の回答/.test(document.getElementById('msg').textContent), { timeout: 15000 });
  確かめる('Apps Script に聞き直して出る', 模擬.呼ばれた.indexOf('人員表 getMemberPageData') >= 0 && 模擬.呼ばれた.indexOf('人員表 getMyResponse') >= 0, JSON.stringify(模擬.呼ばれた));
  模擬.写しが落ちている = false;

  // ---------- 7. マイページ ----------
  console.log('\n== マイページ ==');
  模擬.呼ばれた = [];
  await page.evaluate(() => localStorage.setItem('mypage:出したところ', JSON.stringify({ url: 'taikai.html', 時刻: Date.now() })));
  模擬.写しの版 = '1000.1';   // 出す前に作られた写し
  await page.goto(元 + '/');
  // textContent だと <script> の中の文字まで拾うので、見えている字（innerText）で待つ
  await page.waitForFunction(() => document.querySelector('#meTodo') && !/読んでいます/.test(document.body.innerText), { timeout: 15000 });
  await 待つ(300);
  確かめる('人員表は写しから読む（Apps Script に getMyPage しない）',
    模擬.呼ばれた.some((x) => x.indexOf('写し /jinin/mypage') === 0) && 模擬.呼ばれた.indexOf('人員表 getMyPage') < 0, JSON.stringify(模擬.呼ばれた));
  const 未 = await page.$eval('#meTodo', (el) => el.textContent);
  確かめる('出したばかりの大会は、写しが古くても「まだ」に出さない', 未.indexOf('春季大会') < 0, 未);
  確かめる('写しが追いつくまで「出したところ」の印を残す', !!(await 覚え('mypage:出したところ')));

  // ---------- 8. 管理者の画面 ----------
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
  模擬.GASの遅れ = 2500;
  始め = Date.now();
  await page.goto(元 + '/taikai-admin.html');
  await page.waitForFunction(() => document.getElementById('appView').style.display === 'block', { timeout: 10000 });
  const 開くまで = Date.now() - 始め;
  確かめる('覚えていたぶんで、Apps Script を待たずに開く（' + 開くまで + 'ms）', 開くまで < 1500, 開くまで + 'ms');
  確かめる('覚えていた中身が出る', (await page.$eval('#memberList', (el) => el.textContent)).indexOf('覚えていた人') >= 0);
  await page.waitForFunction(() => /新しい人/.test(document.getElementById('memberList').textContent), { timeout: 10000 });
  確かめる('届いたら新しい中身に差し替わる', true);
  await page.click('#logoutLink');
  確かめる('ログアウトしたら覚えを消す', (await 覚え('jinin:admin:all')) === null);
  模擬.GASの遅れ = 1500;

  確かめる('画面でエラーが起きていない', 画面のエラー.length === 0, 画面のエラー.join(' / '));

  // ---------- 9. 本物の Apps Script に keepalive で届くか ----------
  console.log('\n== 本物：keepalive で Apps Script の転送を越えられるか ==');
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
  }, 本物の人員表);
  確かめる('keepalive でも本物から JSON が返る（' + 本物.ms + 'ms）', 本物.ok && 本物.text.indexOf('"ok":true') >= 0, JSON.stringify(本物));

  await browser.close();
  srv.close();
  console.log('\n' + (失敗.length ? '✗ ' + 失敗.length + '件失敗' : '✓ ぜんぶ通った') + '（' + ok + '/' + (ok + 失敗.length) + '）');
  if (失敗.length) process.exit(1);
})().catch((e) => { console.log(e); process.exit(1); });
