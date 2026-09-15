/**
 * 人員表の画面の見た目と触り心地（2026-09-15）を、本物の Chrome で確かめる。
 *
 *   node tests/ui-jinin.js            （先に node build.js。puppeteer-core は browsertest と同じ）
 *   SHOTS=フォルダ node tests/ui-jinin.js   … 画面の写真をそこに置く
 *
 * 「WebアプリのUIデザインを洗練させるための7つのヒント」の 3（ボタンを減らす）と 7（インタラクション）に沿って
 * 作り直したので、その約束を見る：
 *   ・行の編集・削除はアイコンで、乗せた行・キーボードで入った行にだけ出る
 *   ・たまに使う操作は ⋯ にしまってある。外を押す・Esc で閉じる
 *   ・人員表のマスは右クリックでメニューが出て、そこから固定・コピー・貼り付けができる
 *   ・保存したところが光る、選んだ札に✓が付く、動きを減らす設定では動かない
 * API は模擬（本物のデータには触らない）。
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
const 仕事 = (id, date) => ({ id: id, eventId: 'e1', date: date, name: '使役', min: 1, max: null, allowedPosts: [], allowedGrades: [], preferredGrades: [], allowedMembers: [] });
const 全部 = {
  posts: ['運営', '箱番長', '馬匹', '会計'], maxGrade: 6, defaultJobs: [],
  choices: { 競技名: ['LA', 'LB'], 仕事名: ['使役', '馬付き'] },
  jobColors: { 使役: { 背景: '#e0f2fe', 文字: '#075985' } }, academicYear: 2030,
  members: [
    { id: 'm_001', name: '美浦', joinYear: 2029, grade: 2, post: '運営', note: '' },
    { id: 'm_002', name: '相棒', joinYear: 2030, grade: 1, post: '馬匹', note: '' },
    { id: 'm_003', name: '北山', joinYear: 2028, grade: 3, post: '箱番長', note: '寮' },
  ],
  horses: [{ id: 'h1', name: '北叡', active: true, chief: '美浦', note: '' }, { id: 'h2', name: '北冴', active: false, chief: '', note: '' }],
  events: [{ id: 'e1', name: '春季大会', startDate: '2030-09-20', endDate: '2030-09-21' }],
  competitions: [
    { id: 'c1', eventId: 'e1', date: '2030-09-20', name: 'LA' },
    { id: 'c2', eventId: 'e1', date: '2030-09-20', name: 'LB' },
    { id: 'c3', eventId: 'e1', date: '2030-09-21', name: 'LA' },
  ],
  jobs: [仕事('j1', '2030-09-20'), 仕事('j2', '2030-09-21')],
};
const 大会 = () => ({
  competitions: 全部.competitions, jobs: 全部.jobs,
  entries: [{ id: 'x1', memberId: 'm_002', competitionId: 'c1', horse: '北叡', helpers: 1 }],
  responses: [
    { memberId: 'm_001', date: '2030-09-20', attending: true, comment: '' },
    { memberId: 'm_001', date: '2030-09-21', attending: true, comment: '' },
    { memberId: 'm_002', date: '2030-09-20', attending: true, comment: '日曜は用事' },
    { memberId: 'm_002', date: '2030-09-21', attending: false, comment: '日曜は用事' },
  ],
  cells: { 'm_001|c1': { jobId: 'j1', horse: null, locked: false } },
  days: [{ date: '2030-09-20', label: '9/20（金）' }, { date: '2030-09-21', label: '9/21（土）' }],
  休み: { 使えた: true, 表: {}, 名前だけ: [] },
});
const 出欠の画面 = {
  members: 全部.members, horses: ['北叡'],
  events: [{ id: 'e1', name: '春季大会', days: [
    { date: '2030-09-20', label: '9/20（金）', competitions: [{ id: 'c1', name: 'LA' }] },
    { date: '2030-09-21', label: '9/21（土）', competitions: [] },
  ] }],
};
const 模擬 = { 保存したマス: null };

function 模擬で答える(req) {
  const u = req.url();
  if (u.indexOf(API元 + '/') !== 0) { req.continue().catch(() => {}); return; }
  const 本文 = JSON.parse(req.postData() || '{}');
  const 返す = (value) => setTimeout(() => req.respond({
    status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json',
    body: JSON.stringify({ ok: true, value: value }),
  }).catch(() => {}), 80);
  const a = 本文.args || [];
  switch (本文.fn) {
    case 'adminLoadAll': return 返す(全部);
    case 'adminShareUrl': return 返す({ memberUrl: 'https://example.test/taikai.html' });
    case 'adminLoadEvent': return 返す(大会());
    case 'adminSaveCells': 模擬.保存したマス = a[2]; return 返す({ warnings: [] });
    case 'adminSaveMember': {
      const x = a[1];
      全部.members = 全部.members.map((m) => (m.id === x.id ? Object.assign({}, m, { name: x.name, note: x.note }) : m));
      return 返す(全部.members);
    }
    case 'getMemberPageData': return 返す(出欠の画面);
    case 'getMyResponse': return 返す(null);
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
  await page.setRequestInterception(true);
  page.on('request', 模擬で答える);
  const 写す = async (名) => { if (写真の置き場) await page.screenshot({ path: path.join(写真の置き場, 名 + '.png') }); };
  const 見える度 = (sel) => page.$eval(sel, (el) => Number(getComputedStyle(el).opacity));
  /*
    右クリック。puppeteer は押す前にマスが見えるよう表をスクロールし、そのスクロールの知らせが
    メニューが開いた「あと」に届いて閉じてしまう（画面は表がスクロールしたらメニューを閉じる作り）。
    人が右クリックしても表はスクロールしないので、先に見える所へ動かして落ち着いてから押す。
  */
  const 右クリック = async (sel) => {
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    await 待つ(200);
    await page.click(sel, { button: 'right' });
    await 待つ(200);
  };

  try {
    // ---------- 副将で開く（2026-09-15：「管理者」をやめて副将にそろえ、部員管理は部員・馬匹管理へ移した） ----------
    console.log('\n== 副将：開く ==');
    await page.goto(元 + '/robots.txt');
    await page.evaluate((all) => { localStorage.clear(); sessionStorage.setItem('fukusho:jinin', 'T'); localStorage.setItem('jinin:admin:all', JSON.stringify(all)); }, 全部);
    await page.goto(元 + '/taikai-admin.html');
    await page.waitForFunction(() => document.getElementById('appView').style.display === 'block', { timeout: 10000 });
    await 待つ(400);
    確かめる('見出しは「副将」で、画面に「管理者」は出ない',
      /副将/.test(await page.$eval('header.appbar', (h) => h.textContent)) && !/管理者/.test(await page.evaluate(() => document.body.innerText)));
    確かめる('「部員管理」のタブはもう無く、大会・競技設定から開く',
      !(await page.$('.tabs button[data-tab="members"]')) && (await page.$eval('.tabs button.active', (b) => b.dataset.tab)) === 'events');
    確かめる('部員・馬匹管理へのリンクがある', !!(await page.$('a[href="buin.html"]')));
    確かめる('部員の一覧・部の馬・パスワードの欄はもう無い', !(await page.$('#memberList')) && !(await page.$('#horseList')) && !(await page.$('#changePwBtn')));
    await 写す('1-副将で開いたところ');

    // ---------- 大会の設定：× で消せる ----------
    console.log('\n== 管理者：大会の設定 ==');
    await page.click('.tabs button[data-tab="events"]');
    await page.$eval('#eventList .is-row .icon-btn', (b) => b.click());   // 編集
    await page.waitForFunction(() => document.querySelectorAll('#dayList .comp-row').length === 3, { timeout: 5000 });
    // 押すのは svg の上（ボタンの中のアイコン）。前は e.target のクラスを見ていたので、ここで押しても消えなかった
    const 前の数 = (await page.$$('#dayList .comp-row')).length;
    const 位置 = await page.$eval('#dayList .comp-row .remove-comp svg', (s) => { const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(位置.x, 位置.y);
    確かめる('競技の × を（アイコンの上で）押すと、その行が消える', (await page.$$('#dayList .comp-row')).length === 前の数 - 1);
    await page.$eval('#dayList .add-comp', (b) => b.querySelector('svg').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    確かめる('＋のアイコンの上で押しても競技が足される', (await page.$$('#dayList .comp-row')).length === 前の数);
    await 写す('2-大会の設定');

    // ---------- 人員表 ----------
    console.log('\n== 管理者：人員表（⋯ と右クリック） ==');
    await page.click('.tabs button[data-tab="board"]');
    await page.select('#boardEventSelect', 'e1');
    await page.waitForSelector('td.cell[data-key="m_001|c2"]', { timeout: 5000 });

    // 閉じた <details> の中のボタンも offsetParent を持つので、「見えているか」は checkVisibility で見る
    const 見えるボタン = await page.$$eval('#tab-board .card:first-child button', (bs) => bs.filter((b) => b.checkVisibility()).map((b) => b.textContent.trim()));
    確かめる('上に並ぶ文字のボタンは「自動生成」だけ', JSON.stringify(見えるボタン) === '["自動生成"]', JSON.stringify(見えるボタン));
    確かめる('「大会を編集」「Excelに書き出す」は ⋯ の中', await page.$eval('#exportBtn', (b) => !!b.closest('details.menu')) && await page.$eval('#editEventBtn', (b) => !!b.closest('details.menu')));
    await page.click('#boardMenu > summary');
    確かめる('⋯ を押すと開く', await page.$eval('#boardMenu', (d) => d.open) && await page.$eval('#exportBtn', (b) => !!b.offsetParent));
    await page.keyboard.press('ArrowDown');
    確かめる('矢印キーで項目に移れる', (await page.evaluate(() => document.activeElement.id)) === 'editEventBtn');
    await page.keyboard.press('ArrowDown');
    確かめる('もう一度で次の項目', (await page.evaluate(() => document.activeElement.id)) === 'exportBtn');
    await 待つ(300);   // 出てくる動きが終わってから撮る
    await 写す('3-人員表-その他のメニュー');
    await page.keyboard.press('Escape');
    確かめる('Esc で閉じて、⋯ に戻る', !(await page.$eval('#boardMenu', (d) => d.open)) && (await page.evaluate(() => document.activeElement.tagName)) === 'SUMMARY');
    await page.click('#boardMenu > summary');
    await page.mouse.click(700, 20);
    確かめる('外を押しても閉じる', !(await page.$eval('#boardMenu', (d) => d.open)));

    // 最初にマスを選んでも表がずれない（前は選んだ瞬間に上の帯が現れて表が下がり、右クリックが1段上の見出しに当たっていた）
    await page.$eval('td.cell[data-key="m_001|c1"]', (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    await 待つ(200);
    const 選ぶ前の位置 = await page.$eval('td.cell[data-key="m_001|c1"]', (td) => td.getBoundingClientRect().top);
    await page.click('td.cell[data-key="m_001|c1"]');
    await 待つ(100);
    const 選んだ後の位置 = await page.$eval('td.cell[data-key="m_001|c1"]', (td) => td.getBoundingClientRect().top);
    確かめる('最初にマスを選んでも、表は上下にずれない', Math.abs(選ぶ前の位置 - 選んだ後の位置) < 1, 選ぶ前の位置 + ' → ' + 選んだ後の位置);
    await page.keyboard.press('Escape');   // 選択を外して、右クリックは「選んでいないマス」から始める

    // 右クリック
    const 固定前 =await page.$eval('td.cell[data-key="m_001|c1"]', (td) => td.classList.contains('locked'));
    await 右クリック('td.cell[data-key="m_001|c1"]');
    確かめる('マスを右クリックすると、メニューが出る', !(await page.$eval('#cellMenu', (m) => m.hidden)));
    確かめる('ブラウザの右クリックのメニューは出さない（こちらの一覧が出る）', await page.$eval('#cellMenu', (m) => getComputedStyle(m).position === 'fixed'));
    const 枠 = await page.$eval('#cellMenu', (m) => { const r = m.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
    確かめる('メニューは画面からはみ出さない', 枠.l >= 0 && 枠.t >= 0 && 枠.r <= 枠.w && 枠.b <= 枠.h, JSON.stringify(枠));
    確かめる('ショートカットも並べて出す', (await page.$eval('#cellMenu [data-do="copy"] .kbd', (el) => el.textContent)) === 'Ctrl+C');
    // 前は button.danger の赤い塗りが残って、赤地に赤文字で読めなかった
    const 空にする = await page.$eval('#cellMenu [data-do="clear"]', (b) => ({ 地: getComputedStyle(b).backgroundColor, 字: getComputedStyle(b).color }));
    確かめる('「空にする」は赤い文字だけで、塗りつぶしにならない（文字が読める）', 空にする.地 === 'rgba(0, 0, 0, 0)' && 空にする.字 !== 空にする.地, JSON.stringify(空にする));
    確かめる('まだコピーしていないので、貼り付けは押せない', await page.$eval('#cellMenu [data-do="paste"]', (b) => b.disabled));
    確かめる('右クリックしたマスが選ばれている', (await page.$eval('#cellCount', (el) => el.textContent)) === '美浦／LA');
    await 待つ(300);
    await 写す('4-人員表-右クリック');
    await page.keyboard.press('ArrowDown');
    確かめる('矢印キーで次の項目へ（編集→固定）', (await page.evaluate(() => document.activeElement.dataset.do)) === 'lock');
    await page.keyboard.press('Enter');
    await 待つ(150);
    確かめる('メニューの「固定」で、そのマスが固定される', (await page.$eval('td.cell[data-key="m_001|c1"]', (td) => td.classList.contains('locked'))) === !固定前);
    確かめる('押したらメニューは閉じる', await page.$eval('#cellMenu', (m) => m.hidden));
    確かめる('保存していない変更の帯が出る', await page.$eval('#savingBar', (b) => b.classList.contains('on')));

    await 右クリック('td.cell[data-key="m_001|c1"]');
    await page.click('#cellMenu [data-do="copy"]');
    確かめる('メニューの「コピー」でコピーできる', /コピーしました/.test(await page.$eval('#cellMsg', (el) => el.textContent)));
    await 右クリック('td.cell[data-key="m_001|c2"]');
    確かめる('コピーしたあとは貼り付けが押せる', !(await page.$eval('#cellMenu [data-do="paste"]', (b) => b.disabled)));
    await page.click('#cellMenu [data-do="paste"]');
    確かめる('メニューの「貼り付け」で入る', (await page.$eval('td.cell[data-key="m_001|c2"]', (td) => td.textContent)) === '使役');
    await page.keyboard.press('Escape');

    // 範囲を選んでから、その中を右クリックしても範囲は崩れない
    // page.click には「Shift を押しながら」の指定が無い（渡しても黙って無視される）ので、キーを押したまま押す
    await page.click('td.cell[data-key="m_001|c1"]');
    await page.keyboard.down('Shift');
    await page.click('td.cell[data-key="m_001|c3"]');
    await page.keyboard.up('Shift');
    const 範囲 = await page.$eval('#cellCount', (el) => el.textContent);
    await 右クリック('td.cell[data-key="m_001|c2"]');
    確かめる('選んだ範囲の中を右クリックしても、範囲は崩れない', (await page.$eval('#cellCount', (el) => el.textContent)) === 範囲 && /マスを選択中/.test(範囲), 範囲);
    await page.keyboard.press('Escape');
    確かめる('Esc で閉じる', await page.$eval('#cellMenu', (m) => m.hidden));

    // 行の固定（アイコン）
    /*
      行の錠前は、マスを貼り付けたり固定したりしても描き直さない（前からの作り。表を描き直したときに合う）。
      なので「押す前」の形はあてにならない。1回押して形を合わせてから、もう1回押して入れ替わるかを見る。
    */
    const 錠 = 'button[data-lock="m_001"]';
    const 錠の形 = () => page.$eval(錠, (b) => [b.getAttribute('aria-pressed'), b.querySelector('use').getAttribute('href')]);
    await page.click(錠);
    const 押す前 = await 錠の形();
    await page.click(錠);
    const 押した後 = await 錠の形();
    確かめる('名前の横の錠前は絵文字ではなくアイコンで、押すと形と「押されている」が変わる',
      押す前[0] !== 押した後[0] && 押す前[1] !== 押した後[1] && /#i-(un)?lock/.test(押した後[1]), JSON.stringify([押す前, 押した後]));
    確かめる('人員表に絵文字の錠前は残っていない', (await page.$eval('#tab-board', (el) => el.textContent)).indexOf('🔒') < 0);

    // 選んだマスの道具はアイコン
    確かめる('選んだマスの操作は、文字のボタンではなくアイコン（何のボタンかは説明で分かる）',
      await page.$$eval('#cellTools button', (bs) => bs.length === 6 && bs.every((b) => b.classList.contains('icon-btn') && b.getAttribute('aria-label') && !b.textContent.trim())));

    // 保存すると、保存したマスが光る
    await page.click('#saveCellsBtn');
    await page.waitForFunction(() => document.querySelectorAll('td.cell.flash').length > 0, { timeout: 5000 })
      .then(() => 確かめる('保存したマスが一瞬光る', true), () => 確かめる('保存したマスが一瞬光る', false));
    確かめる('光るのは保存したマスだけ', (await page.$$eval('td.cell.flash', (tds) => tds.map((td) => td.dataset.key))).every((k) => ['m_001|c1', 'm_001|c2', 'm_001|c3'].indexOf(k) >= 0),
      JSON.stringify(await page.$$eval('td.cell.flash', (tds) => tds.map((td) => td.dataset.key))));
    await 待つ(250);
    await 写す('5-人員表-保存したところ');

    // 見出しの帯の「← マイページ」まわりの CSS が、人員表の画面でも値を持つ（前は変数が無くて効いていなかった）
    確かめる('見出しの帯が上に貼り付く（build.js の CSS が効く）', await page.$eval('header.appbar', (h) => getComputedStyle(h).position === 'sticky' && getComputedStyle(h).zIndex === '200'));

    // ---------- 出欠・選手出場：出場の削除もアイコン ----------
    console.log('\n== 管理者：出欠・選手出場 ==');
    await page.click('.tabs button[data-tab="entries"]');
    await page.select('#entryEventSelect', 'e1');
    await page.waitForSelector('#entryList .is-row', { timeout: 5000 });
    確かめる('出場の「削除」もアイコン（文字のボタンは無い）',
      await page.$$eval('#entryList .is-row', (rs) => rs.every((r) => r.querySelector('.row-actions .icon-btn.danger') && !/削除/.test(r.textContent))));
    await page.hover('#entryList .is-row');
    await 待つ(350);
    確かめる('乗せると出場を消すアイコンが出る', (await 見える度('#entryList .is-row .row-actions')) === 1);
    await 写す('5b-出欠・選手出場');

    // ---------- 部員：出欠 ----------
    console.log('\n== 部員：出欠の画面（ヒント7） ==');
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('me', '美浦'); });
    await page.goto(元 + '/taikai.html?event=e1');
    await page.waitForFunction(() => document.getElementById('formCard').style.display === 'block' && document.querySelectorAll('.chip').length === 4, { timeout: 10000 });
    確かめる('行ける・行けないの札はボタン（キーボードでも選べる）', await page.$$eval('.chip', (cs) => cs.every((c) => c.tagName === 'BUTTON' && c.getAttribute('aria-pressed') === 'false')));
    await page.focus('.chip[data-day="0"][data-val="1"]');
    await page.keyboard.press('Enter');
    await 待つ(50);
    const 札 = await page.$eval('.chip[data-day="0"][data-val="1"]', (c) => ({
      cls: c.className, pressed: c.getAttribute('aria-pressed'), 印: getComputedStyle(c, '::before').content, 動き: getComputedStyle(c).animationName,
    }));
    確かめる('Enter で選べて、「押されている」になる', /selected/.test(札.cls) && 札.pressed === 'true', JSON.stringify(札));
    確かめる('選んだ札には✓が付く（色だけで伝えない）', 札.印 === '"✓"', 札.印);
    確かめる('押した札だけ少し膨らむ', 札.動き === 'pick' && (await page.$eval('.chip[data-day="1"][data-val="1"]', (c) => getComputedStyle(c).animationName)) === 'none');
    確かめる('答えた日は左の線が変わる', await page.$eval('.day-vote', (d) => d.classList.contains('yes')));
    確かめる('行ける日にした日だけ、出場の欄が下りてくる', (await page.$eval('.ride-box', (b) => getComputedStyle(b).animationName)) === 'msg-in');
    await page.click('.chip[data-day="1"][data-val="0"]');
    await 待つ(250);
    確かめる('行けないを選ぶと、赤の札に✓', await page.$eval('.chip[data-day="1"][data-val="0"]', (c) => c.classList.contains('no-chip') && getComputedStyle(c, '::before').content === '"✓"'));
    確かめる('別の日を押したら、前に押した日の出場欄は動き直さない', (await page.$eval('.ride-box', (b) => getComputedStyle(b).animationName)) === 'none');
    確かめる('テストが見ている札の文字は変わらない（✓は飾り）', JSON.stringify(await page.$$eval('.chip.selected', (cs) => cs.map((c) => c.textContent))) === '["行ける","行けない"]');
    await 写す('6-出欠の画面');
    // 部員はスマホで開くことが多い
    await page.setViewport({ width: 400, height: 860 });
    await 待つ(300);
    await 写す('7-出欠の画面-スマホ');
    確かめる('スマホの幅でも横にはみ出さない', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + innerWidth));

    // 動きを減らす設定
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.click('.chip[data-day="0"][data-val="0"]');
    確かめる('動きを減らす設定では、動きがほぼ0になる', (await page.$eval('.chip[data-day="0"][data-val="0"]', (c) => getComputedStyle(c).animationDuration)) === '0.001s');

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
