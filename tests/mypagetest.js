/**
 * マイページ（入口）の中身を確かめる。
 *
 *   1. 人員表システムの getMyPage が「日ごと」に返すこと
 *      （大会中の仕事は1日1つにまとめ、出場する競技だけは別に返す）
 *   2. mypage.js が、それと当番・手入れのぶんを1週間のカレンダーに並べること
 *
 * 人員表の コード.gs は Node の模擬スプレッドシートで動かす（toubantest.js と同じやり方）。
 * mypage.js は画面の中のIIFEなので、末尾に中の関数を外へ出す1行を足してから読み込む。
 *
 *   node mypagetest.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// 2026-09-13 Cloudflare に移すときから、サーバの原本は 馬術部API/src にある
const 人員表 = path.join('C:', 'Users', 'minuu', 'Documents', '馬術部API', 'src', 'jinin.gs');
const 入口 = path.join(__dirname, '..', 'mypage.js');

// ===================== 模擬スプレッドシート =====================

function makeSheet(name) { return { name: name, rows: [[]] }; }

function ensure(sheet, r, c) {
  while (sheet.rows.length < r) sheet.rows.push([]);
  for (let i = 0; i < sheet.rows.length; i++) {
    while (sheet.rows[i].length < c) sheet.rows[i].push('');
  }
}

function rangeOf(sheet, row, col, numRows, numCols) {
  return {
    setValues(vals) {
      ensure(sheet, row + vals.length - 1, col + (vals[0] ? vals[0].length : 0) - 1);
      vals.forEach((r, i) => r.forEach((v, j) => { sheet.rows[row - 1 + i][col - 1 + j] = v; }));
      return this;
    },
    setFormulas(vals) { return this.setValues(vals); },
    getValues() {
      ensure(sheet, row + numRows - 1, col + numCols - 1);
      const out = [];
      for (let i = 0; i < numRows; i++) out.push(sheet.rows[row - 1 + i].slice(col - 1, col - 1 + numCols));
      return out;
    },
    clearContent() {
      ensure(sheet, row + numRows - 1, col + numCols - 1);
      for (let i = 0; i < numRows; i++) {
        for (let j = 0; j < numCols; j++) sheet.rows[row - 1 + i][col - 1 + j] = '';
      }
      return this;
    },
    setFontWeight() { return this; },
    setFontColor() { return this; },
    setBackground() { return this; },
    setBackgrounds() { return this; },
    setNote() { return this; },
    clearNote() { return this; },
    setHorizontalAlignment() { return this; },
    setVerticalAlignment() { return this; },
    setWrap() { return this; },
    setBorder() { return this; },
    setNumberFormat() { return this; },
    merge() { return this; },
    setDataValidation() { return this; },
    clearDataValidations() { return this; },
  };
}

function wrapSheet(sheet) {
  const api = {
    _raw: sheet,
    getName: () => sheet.name,
    setFrozenRows: () => api,
    setFrozenColumns: () => api,
    setColumnWidth: () => api,
    setColumnWidths: () => api,
    setRowHeight: () => api,
    autoResizeColumn: () => api,
    getMaxRows: () => Math.max(sheet.rows.length, 200),
    getMaxColumns: () => Math.max.apply(null, sheet.rows.map((r) => r.length).concat([26])),
    getLastRow() {
      let last = 0;
      sheet.rows.forEach((r, i) => { if (r.some((c) => c !== '' && c !== null && c !== undefined)) last = i + 1; });
      return last;
    },
    getLastColumn() {
      let last = 0;
      sheet.rows.forEach((r) => {
        for (let j = r.length - 1; j >= 0; j--) {
          if (r[j] !== '' && r[j] !== null && r[j] !== undefined) { last = Math.max(last, j + 1); break; }
        }
      });
      return last;
    },
    getRange: (r, c, nr, nc) => rangeOf(sheet, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc),
    getDataRange() {
      return rangeOf(sheet, 1, 1, Math.max(api.getLastRow(), 1), Math.max(api.getLastColumn(), 1));
    },
    getFilter: () => null,
    clear: () => { sheet.rows = [[]]; return api; },
    deleteRows: () => api,
    insertRowsAfter: () => api,
    hideColumns: () => api,
  };
  return api;
}

const SHEETS = {};
const ss = {
  getName: () => '人員表テスト',
  getId: () => 'TEST_SHEET_ID',
  getSheetByName: (n) => (SHEETS[n] ? wrapSheet(SHEETS[n]) : null),
  insertSheet: (n) => { SHEETS[n] = makeSheet(n); return wrapSheet(SHEETS[n]); },
  getSheets: () => Object.keys(SHEETS).map((n) => wrapSheet(SHEETS[n])),
  deleteSheet: (sh) => { delete SHEETS[sh.getName()]; },
  setActiveSheet: (sh) => sh,
  moveActiveSheet: () => {},
};

const PROPS = {};
let uuidCount = 0;

const sandbox = {
  console: console,
  Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date, JSON: JSON,
  isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, Error: Error, RegExp: RegExp,

  SpreadsheetApp: {
    getActiveSpreadsheet: () => ss,
    openById: () => { throw new Error('当番・手入れのシートはこのテストでは開かない'); },
    getUi: () => ({
      createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addSubMenu() { return this; }, addToUi() {} }),
      alert: () => {},
      prompt: () => ({ getSelectedButton: () => 'CANCEL', getResponseText: () => '' }),
      ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
      Button: { OK: 'OK' },
    }),
    newDataValidation: () => {
      const b = {
        requireValueInList() { return b; }, requireCheckbox() { return b; },
        setAllowInvalid() { return b; }, setHelpText() { return b; }, build() { return {}; },
      };
      return b;
    },
    flush: () => {},
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (PROPS[k] === undefined ? null : PROPS[k]),
      setProperty: (k, v) => { PROPS[k] = v; },
      deleteProperty: (k) => { delete PROPS[k]; },
    }),
  },
  CacheService: {
    getScriptCache: () => {
      const C = sandbox.__cache = sandbox.__cache || {};
      return { put: (k, v) => { C[k] = v; }, get: (k) => (C[k] === undefined ? null : C[k]), remove: (k) => { delete C[k]; } };
    },
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {}, waitLock: () => {} }) },
  Utilities: {
    getUuid: () => { uuidCount++; return ('u' + uuidCount).padStart(8, '0') + '-' + Date.now().toString(36) + '-abcd'; },
    // JSTのぶんだけ実機と違うが、テストの日付はどれも同じ日の中なのでこれで足りる
    formatDate: (d, tz, fmt) => {
      const z = (n) => ('0' + n).slice(-2);
      const s = d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
      return fmt === 'yyyy-MM-dd' ? s : s + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
    },
  },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
  HtmlService: {},
  ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }), MimeType: { JSON: 'JSON' } },
};

const ctx = vm.createContext(sandbox);
// vm では const で置いた値は文脈の持ちものにならないので、使うものは最後に渡してもらう
vm.runInContext(
  fs.readFileSync(人員表, 'utf8') + '\n;this.外から呼べる関数 = 外から呼べる関数; this.終日の枠ID = 終日の枠ID;',
  ctx, { filename: 'コード.gs' });
// 実機では呼び出しごとに新しい実行になり、読んだシートの覚えも「版を進めたか」も消える。
// テストでも同じ条件にするため、関数を呼ぶ直前に両方を戻す。
// 覚えを消す() は「書き替えた」合図で版まで進めてしまうので、ここでは置き場を直に空にする
const 実行を始める = new vm.Script(
  'Object.keys(読んだ中身).forEach((k) => { delete 読んだ中身[k]; }); 版を進めた = false;');
const G = new Proxy(ctx, {
  get(t, k) {
    const v = t[k];
    if (typeof v === 'function') return (...a) => { 実行を始める.runInContext(ctx); return v.apply(t, a); };
    return v;
  },
});

// ===================== 確かめる道具 =====================

let ok = 0;
const 失敗 = [];
function 確かめる(名, 条件, 補足) {
  if (条件) { ok++; return; }
  失敗.push(名 + (補足 ? '　→ ' + 補足 : ''));
  console.log('  ✗ ' + 名 + (補足 ? '　→ ' + 補足 : ''));
}
function 見出し(s) { console.log('\n== ' + s + ' =='); }

// 今日から数えた日付。getMyPage は「今日」で終わった大会を落とすので、日付は毎回作り直す
const ゼロ埋め = (n) => ('0' + n).slice(-2);
function 日(ずれ) {
  const d = new Date();
  d.setDate(d.getDate() + ずれ);
  return d.getFullYear() + '-' + ゼロ埋め(d.getMonth() + 1) + '-' + ゼロ埋め(d.getDate());
}

// ===================== 1. 人員表の getMyPage =====================

見出し('人員表：下ごしらえ');
G.setupSheets();
PROPS['ADMIN_PASSWORD'] = 'testtest';
const T = G.login('testtest');
G.adminBulkMembers(T, ['美浦,2024,運営', '相棒,2025,馬匹'].join('\n'));
const 私 = G.loadMembers().filter((m) => m.name === '美浦')[0];
確かめる('部員が入る', !!私, JSON.stringify(G.loadMembers().map((m) => m.name)));

// 3日間の大会。初日は競技が無く仕事だけ（馬房作りの日）、2日目に競技が3つ
const 保存 = G.adminSaveEvent(T, {
  name: '春季大会',
  startDate: 日(1),
  endDate: 日(3),
  competitions: [
    { name: 'LA', date: 日(2) },
    { name: '3A', date: 日(2) },
    { name: 'LB', date: 日(2) },
    { name: '片付け', date: 日(3) },
  ],
  jobs: [
    { name: '積み下ろし・馬房作り', date: 日(1), min: 1 },
    { name: '使役', date: 日(2), min: 1 },
    { name: '運営', date: 日(2), min: 1 },
    { name: '片付け', date: 日(3), min: 1 },
  ],
});
const 大会ID = 保存.eventId;
const 競技 = {};
G.loadCompetitions(大会ID).forEach((c) => { 競技[c.name] = c.id; });
const 仕事 = {};
G.loadJobs(大会ID).forEach((j) => { 仕事[j.name] = j.id; });
確かめる('競技が4つ入る', Object.keys(競技).length === 4, JSON.stringify(Object.keys(競技)));

// 出場：2日目のLAに北叡で出る
G.adminSaveEntry(T, 大会ID, 私.id, 競技['LA'], '北叡', 1);
確かめる('出場が1件入る', G.loadEntries(大会ID).length === 1);

// 人員表のマス。初日は競技が無いので「終日」の枠に入る
const 終日 = G.終日の枠ID(日(1));
G.saveCells(大会ID, {
  [私.id + '|' + 終日]: { jobId: 仕事['積み下ろし・馬房作り'], horse: '', locked: false },
  [私.id + '|' + 競技['3A']]: { jobId: 仕事['使役'], horse: '', locked: false },
  [私.id + '|' + 競技['LB']]: { jobId: 仕事['使役'], horse: '', locked: false },
  [私.id + '|' + 競技['片付け']]: { jobId: '', horse: '北冴', locked: false },
});

見出し('人員表：getMyPage');
const j = G.getMyPage('美浦');
確かめる('自分が見つかる', !!(j.me && j.me.name === '美浦'), JSON.stringify(j.me));
const ev = (j.大会 || [])[0];
確かめる('大会が1つ返る', !!ev && ev.name === '春季大会', JSON.stringify((j.大会 || []).map((x) => x.name)));
確かめる('日が3つ返る（競技の数ではなく日の数）', ev.日.length === 3, JSON.stringify(ev.日.map((d) => d.date)));

const 初日 = ev.日[0], 二日目 = ev.日[1], 三日目 = ev.日[2];
確かめる('競技が無い日の仕事も拾う', JSON.stringify(初日.仕事) === JSON.stringify(['積み下ろし・馬房作り']), JSON.stringify(初日.仕事));
確かめる('同じ仕事が競技ごとに並ばない（1つにまとまる）',
  JSON.stringify(二日目.仕事) === JSON.stringify(['使役']), JSON.stringify(二日目.仕事));
確かめる('出場する競技は仕事と別に返る',
  二日目.出場.length === 1 && 二日目.出場[0].競技 === 'LA' && 二日目.出場[0].馬 === '北叡',
  JSON.stringify(二日目.出場));
確かめる('出場する競技は仕事のほうに混ざらない', 二日目.仕事.indexOf('LA') < 0, JSON.stringify(二日目.仕事));
確かめる('馬名だけのマスは「◯◯に付く」になる',
  JSON.stringify(三日目.仕事) === JSON.stringify(['北冴に付く']), JSON.stringify(三日目.仕事));
確かめる('日には日付と見出しが付く', !!初日.date && !!初日.label, JSON.stringify(初日));

// 行けないと答えた日は、その日だけ印が付く
G.submitResponse(大会ID, 私.id, [
  { date: 日(1), attending: true },
  { date: 日(2), attending: true },
  { date: 日(3), attending: false },
], 'バイトのため', [{ competitionId: 競技['LA'], horse: '北叡', helpers: 1 }]);
const j2 = G.getMyPage('美浦');
const ev2 = j2.大会[0];
確かめる('出欠を出したことが分かる', ev2.出した === true);
確かめる('行けない日に印が付く',
  ev2.日[0].行けない === false && ev2.日[2].行けない === true,
  JSON.stringify(ev2.日.map((d) => d.行けない)));

// 名簿に無い人
const j3 = G.getMyPage('いない人');
確かめる('名簿に無ければ me が null', j3.me === null && Array.isArray(j3.大会));

// 終わった大会は日を返さない（読みに行かない）
G.adminSaveEvent(T, { name: '去年の大会', startDate: 日(-30), endDate: 日(-28), competitions: [], jobs: [] });
const 去年 = G.getMyPage('美浦').大会.filter((x) => x.name === '去年の大会')[0];
確かめる('終わった大会は終わった印が付いて日が空', 去年.終わった === true && 去年.日.length === 0, JSON.stringify(去年));

// ===================== 1.4 版（変わっていなければ送らない） =====================

見出し('人員表：版');
const 版あり = G.getMyPage('美浦');
確かめる('返事に版が入る', !!版あり.版, String(版あり.版));
const 同じ = G.getMyPage('美浦', 版あり.版);
確かめる('同じ版なら「同じ」とだけ返す', 同じ.同じ === true && !同じ.大会, JSON.stringify(同じ));
確かめる('送る量がほぼ0になる',
  JSON.stringify(同じ).length < JSON.stringify(版あり).length / 10,
  JSON.stringify(同じ).length + 'バイト ← ' + JSON.stringify(版あり).length + 'バイト');
確かめる('違う版なら中身を返す', !!G.getMyPage('美浦', 'ちがう版').大会);

// 書き替えたら版が変わり、画面は取り直すことになる
G.adminSaveEvent(T, { name: '版のテスト大会', startDate: 日(5), endDate: 日(5), competitions: [], jobs: [] });
const 書き替えたあと = G.getMyPage('美浦', 版あり.版);
確かめる('書き替えたら「同じ」と言わない', !書き替えたあと.同じ && !!書き替えたあと.大会, JSON.stringify(書き替えたあと).slice(0, 60));
確かめる('新しい版が付く', 書き替えたあと.版 !== 版あり.版, 書き替えたあと.版 + ' ← ' + 版あり.版);
G.adminDeleteEvent(T, G.loadEvents().filter((e) => e.name === '版のテスト大会')[0].id);

// ===================== 1.5 読んだシートの覚え =====================

// 1回の実行のあいだ同じシートを読み直さない。ただし書き替えたら忘れること。
// ここだけは G（呼ぶたびに覚えを消す）ではなく ctx を直に使い、1回の実行の中を真似る。
見出し('人員表：読んだシートの覚え');
ctx.覚えを消す();
let 読んだ回数 = 0;
const 元のシートを読む = ctx.シートを読む;
ctx.シートを読む = function (name) { 読んだ回数++; return 元のシートを読む.apply(ctx, arguments); };
ctx.readRows('部員');
ctx.readRows('部員');
確かめる('同じシートは1回しか読まない', 読んだ回数 === 1, String(読んだ回数));
const 覚えた行 = ctx.readRows('部員');
覚えた行[0]['名前'] = '書き換えてみる';
確かめる('覚えを書き換えても元は壊れない', ctx.readRows('部員')[0]['名前'] !== '書き換えてみる');
ctx.writeRows('部員', ctx.readRows('部員'));
ctx.readRows('部員');
確かめる('書き替えたシートは読み直す', 読んだ回数 === 2, String(読んだ回数));
ctx.シートを読む = 元のシートを読む;

// ===================== 1.6 表示用の写し（Cloudflare） =====================

見出し('人員表：表示用の写し');
const 束 = G.写しの束();
確かめる('写しに版が付く', 束.版 === G.データの版(), 束.版);
確かめる('部員全員ぶん入る', Object.keys(束.人).length === G.loadMembers().length, Object.keys(束.人).join(','));
確かめる('出欠の画面ぶんは getMemberPageData と同じ',
  JSON.stringify(束.出欠画面) === JSON.stringify(G.getMemberPageData()));
const 本物のマイページ = G.getMyPage('美浦');
delete 本物のマイページ.版;
確かめる('マイページぶんは getMyPage と同じ',
  JSON.stringify(束.人['美浦'].マイページ) === JSON.stringify(本物のマイページ),
  JSON.stringify(束.人['美浦'].マイページ).slice(0, 80));
確かめる('返事は大会ごとに getMyResponse と同じ',
  G.loadEvents().every((e) => JSON.stringify(束.人['美浦'].返事[e.id]) === JSON.stringify(G.getMyResponse(e.id, 私.id))));
確かめる('出していない人の返事は null', G.loadEvents().every((e) => 束.人['相棒'].返事[e.id] === null));
確かめる('部員IDが付く', 束.人['美浦'].id === 私.id);

見出し('人員表：写しを送る');
const 送った = [];
let 応答コード = 200;
sandbox.UrlFetchApp = {
  fetch: (url, opt) => {
    送った.push({ url: url, opt: opt });
    return { getResponseCode: () => 応答コード, getContentText: () => (応答コード === 200 ? '{"ok":true}' : 'だめ') };
  },
};
確かめる('送り先が無ければ送らない', G.写しを送る(false) === '未設定' && 送った.length === 0);

sandbox.写し先 = { url: 'https://cache.test', 鍵: 'test-key', 起こす先: 'https://script.google.com/macros/s/TEST/exec' };
確かめる('初めては送る', G.写しを送る(false) === '送った' && 送った.length === 1);
const 一通目 = 送った[0];
確かめる('PUT /jinin に置く', 一通目.url === 'https://cache.test/jinin' && 一通目.opt.method === 'put', 一通目.url);
確かめる('鍵を付ける', 一通目.opt.headers.Authorization === 'Bearer test-key');
確かめる('中身は写しの束', !!JSON.parse(一通目.opt.payload).人['美浦']);

確かめる('変わっていなければ送らない', G.写しを送る(false) === '同じ' && 送った.length === 1, String(送った.length));
確かめる('必ずのときは変わっていなくても送る', G.写しを送る(true) === '送った' && 送った.length === 2);

G.adminSaveEvent(T, { name: '写しのテスト大会', startDate: 日(8), endDate: 日(8), competitions: [], jobs: [] });
確かめる('書き替えたら送る', G.写しを送る(false) === '送った' && 送った.length === 3);
確かめる('送った写しに書き替えが入っている',
  JSON.stringify(JSON.parse(送った[2].opt.payload).出欠画面.events).indexOf('写しのテスト大会') > 0);

PROPS['写しを送った時刻'] = String(Date.now() - 31 * 60 * 1000);
確かめる('30分たったら変わっていなくても送る（シートを手で直したとき用）', G.写しを送る(false) === '送った' && 送った.length === 4);

G.adminDeleteEvent(T, G.loadEvents().filter((e) => e.name === '写しのテスト大会')[0].id);
応答コード = 500;
let 投げた = null;
try { G.写しを送る(false); } catch (e) { 投げた = e; }
確かめる('置けなかったら知らせる', !!投げた && /500/.test(投げた.message), 投げた && 投げた.message);
let 見回りが投げた = null;
try { G.毎分の見回り(); } catch (e) { 見回りが投げた = e; }
確かめる('見回りは送れなくても止まらない', !見回りが投げた, 見回りが投げた && 見回りが投げた.message);
応答コード = 200;
const 送る前 = 送った.length;
確かめる('置けなかったぶんは次の見回りで送り直す', G.写しを送る(false) === '送った' && 送った.length > 送る前);

// ===================== 2. マイページの組み立て =====================

見出し('入口：1週間のカレンダー');

// IIFE の中の関数を外へ出して読み込む（画面のファイルはそのまま使う）
const 入口のソース = fs.readFileSync(入口, 'utf8')
  .replace('  始める();',
    '  this.__test = { 一週間を組む, 重なり, 週の見た目, 先の予定, 組み立てる, 節々, 描く, 和風, 足す, 人員表を読む, 送り待ちを直す };');

// 模擬DOM。innerHTML を書いた回数を数えて、「変わった節だけ書き換える」を確かめられるようにする
function 模擬要素() {
  const el = { id: '', children: [], 書いた: 0, _html: '' };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = v; el.書いた++; },
  });
  el.insertBefore = (子, 前) => {
    const i = 前 ? el.children.indexOf(前) : -1;
    const いま = el.children.indexOf(子);
    if (いま >= 0) el.children.splice(いま, 1);
    if (i < 0) el.children.push(子); else el.children.splice(i, 0, 子);
    子.親 = el;
    return 子;
  };
  el.remove = () => {
    if (!el.親) return;
    const i = el.親.children.indexOf(el);
    if (i >= 0) el.親.children.splice(i, 1);
  };
  return el;
}
const meBody = 模擬要素();
const 覚え箱 = {};
const 入口ctx = vm.createContext({
  console: console, fetch: () => {}, Date: Date,
  API: { 当番: 'https://touban.test', 人員表: 'https://gas.test', 写し: 'https://cache.test' },
  setTimeout: setTimeout, clearTimeout: clearTimeout, AbortController: AbortController,
  encodeURIComponent: encodeURIComponent,
  localStorage: {
    getItem: (k) => (覚え箱[k] === undefined ? null : 覚え箱[k]),
    setItem: (k, v) => { 覚え箱[k] = String(v); },
    removeItem: (k) => { delete 覚え箱[k]; },
  },
  document: {
    getElementById: (id) => (id === 'meBody' ? meBody : null),
    createElement: () => 模擬要素(),
  },
});
vm.runInContext(入口のソース, 入口ctx, { filename: 'mypage.js' });
const M = 入口ctx.__test;
確かめる('入口の中の関数を取り出せる', !!(M && M.一週間を組む), Object.keys(入口ctx));

const 今日 = 日(0);
const t = {
  me: { id: 'm_x', name: '美浦' },
  今日: 今日,
  当番: { 期間: [{ id: 'k1', name: '前期', 出した: true }], 決まったぶん: [{ 曜日: 曜日の(日(2)), 当番: '夕当' }] },
  手入れ: [{ id: 'p1', horse: '北叡', chief: '相棒', 日数: 7, 入れた: 7, 出した: true }],
  毎週の手入れ: [],
  予定: [
    { date: 日(2), 種類: '手入れ', 馬: '北叡', 記号: '◎' },
    { date: 日(9), 種類: '手入れ', 馬: '北叡', 記号: '○' },
  ],
  休み: [{ id: 'l1', kind: '有給休暇', from: 日(5), to: 日(5), days: 1, state: '申請中' }],
  有給: { 残り: 8, 待ち: 1 },
};
function 曜日の(s) {
  const p = s.split('-');
  return ['日', '月', '火', '水', '木', '金', '土'][new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
}

const jm = {
  me: { id: 'm_001', name: '美浦' },
  大会: [{
    id: 'e1', name: '春季大会', 終わった: false, 出した: true, 行けない日: [],
    日: [
      { date: 日(1), label: '1日目', 行けない: false, 仕事: ['積み下ろし・馬房作り'], 出場: [] },
      { date: 日(2), label: '2日目', 行けない: false, 仕事: ['使役'], 出場: [{ 競技: 'LA', 馬: '北叡' }] },
      { date: 日(3), label: '3日目', 行けない: true, 仕事: [], 出場: [] },
    ],
  }, {
    id: 'e2', name: '秋季大会', 終わった: false, 出した: false, 行けない日: [],
    日: [{ date: 日(20), label: '1日目', 行けない: false, 仕事: [], 出場: [] }],
  }],
};

const 週 = M.一週間を組む(t, jm, 今日);
確かめる('1週間ぶんの枠ができる', 週.日々.length === 7 && 週.日々[0] === 今日, JSON.stringify(週.日々));
確かめる('今日は何も無い', 週.表[今日].length === 0, JSON.stringify(週.表[今日]));
確かめる('大会の日は「大会」1行になる',
  週.表[日(1)].length === 1 && 週.表[日(1)][0].種類 === '大会' && 週.表[日(1)][0].本文 === '春季大会',
  JSON.stringify(週.表[日(1)]));
確かめる('その日の仕事は添えに入る', 週.表[日(1)][0].添え === '積み下ろし・馬房作り', JSON.stringify(週.表[日(1)][0]));

const 二日目の枠 = 週.表[日(2)];
確かめる('出場・大会・手入れ・当番がその日に並ぶ',
  JSON.stringify(二日目の枠.map((x) => x.種類)) === JSON.stringify(['出場', '大会', '手入れ', '当番']),
  JSON.stringify(二日目の枠.map((x) => x.種類)));
確かめる('出場が先頭に来る', 二日目の枠[0].種類 === '出場' && 二日目の枠[0].本文.indexOf('LA') === 0, JSON.stringify(二日目の枠[0]));
確かめる('出場には乗る馬が付く', 二日目の枠[0].本文.indexOf('北叡') > 0, 二日目の枠[0].本文);
確かめる('重なりを知らせる', M.重なり(二日目の枠) === '大会と手入れと当番が重なっています', M.重なり(二日目の枠));
確かめる('1つだけの日は知らせない', M.重なり(週.表[日(1)]) === '', M.重なり(週.表[日(1)]));

確かめる('行けないと答えた日には大会を出さない', 週.表[日(3)].length === 0, JSON.stringify(週.表[日(3)]));
確かめる('休みもカレンダーに出る',
  週.表[日(5)].length === 1 && 週.表[日(5)][0].種類 === '休み' && 週.表[日(5)][0].本文.indexOf('了承待ち') > 0,
  JSON.stringify(週.表[日(5)]));
確かめる('1週間より先の手入れはカレンダーに入らない',
  Object.keys(週.表).every((d) => d <= 日(6)), JSON.stringify(Object.keys(週.表)));

const html = M.週の見た目(t, jm, 今日);
確かめる('7日ぶんの枠が出る', (html.match(/class="me-day/g) || []).length === 7);
確かめる('今日の枠に印が付く', html.indexOf('today') > 0 && html.indexOf('今日</span>') > 0);
確かめる('何も無い日は「予定なし」', html.indexOf('予定なし') > 0);
確かめる('種類の字が入る（色だけに頼らない）',
  html.indexOf('>出場<') > 0 && html.indexOf('>大会<') > 0 && html.indexOf('>手入れ<') > 0 && html.indexOf('>当番<') > 0);

const 先 = M.先の予定(t, jm, 今日);
確かめる('1週間より先の大会が出る', 先.indexOf('秋季大会') > 0, 先);
確かめる('1週間より先の手入れが出る', 先.indexOf('手入れ') > 0, 先);
確かめる('1週間の中の予定は先に出さない', 先.indexOf('春季大会') < 0, 先);

// 期間をまだ入れていない大会（日付なし）も、名前だけは出す
const 日付なし = M.先の予定(t, {
  me: jm.me,
  大会: [{ id: 'e3', name: '日付未定の大会', 終わった: false, 出した: false, 行けない日: [],
    日: [{ date: '', label: '全日', 行けない: false, 仕事: [], 出場: [] }] }],
}, 今日);
確かめる('日付が入っていない大会は「日にち未定」で出す',
  日付なし.indexOf('日付未定の大会') > 0 && 日付なし.indexOf('日にち未定') > 0, 日付なし);

// 通信できなかったときも、できたほうは出す
const 本文 = M.組み立てる(t, null, ['大会のぶんを読めませんでした：つながりませんでした（500）']);
確かめる('片方が読めなくてもカレンダーは出る', 本文.indexOf('これからの1週間') > 0 && 本文.indexOf('読めませんでした') > 0);
確かめる('毎週の当番は下にまとめて書く', 本文.indexOf('毎週の当番') > 0);
確かめる('サブの馬にチーフの名前を出さない',
  本文.indexOf('サブの馬') > 0 && 本文.indexOf('チーフ') < 0,
  本文.slice(本文.indexOf('サブの馬'), 本文.indexOf('サブの馬') + 60));
確かめる('前回の内容を先に出すときは断り書きを付ける',
  M.組み立てる(t, jm, [], true).indexOf('前回の内容です') > 0);
確かめる('新しく取れたときは断り書きを付けない',
  M.組み立てる(t, jm, [], false).indexOf('前回の内容です') < 0);

// ===================== 2.5 書き換えを最小にする／出した直後 =====================

見出し('入口：変わった節だけ書き換える');
const 節 = M.節々(t, jm, [], false);
確かめる('節に名前が付いている',
  JSON.stringify(節.map((s) => s.id)) === JSON.stringify(['meNotice', 'meWeek', 'meSoon', 'meTodo', 'meFacts', 'meCal']),
  JSON.stringify(節.map((s) => s.id)));
// みんなのカレンダーの枠（2026-09-13）
const カレンダー枠 = 節.filter((s) => s.id === 'meCal')[0].html;
確かめる('カレンダーの枠に手入れと休みの入口がある',
  カレンダー枠.indexOf('calendar.html?tab=teire') > 0 && カレンダー枠.indexOf('calendar.html?tab=yasumi') > 0 && カレンダー枠.indexOf('>カレンダー<') > 0,
  カレンダー枠.slice(0, 120));

M.描く(t, jm, [], false);
確かめる('節のぶんだけ箱ができる', meBody.children.length === 6, String(meBody.children.length));
const 週の箱 = meBody.children[1];
const 書いた回数 = 週の箱.書いた;
M.描く(t, jm, [], false);
確かめる('同じ中身なら書き換えない', 週の箱.書いた === 書いた回数, String(週の箱.書いた) + '回目');

const t2 = JSON.parse(JSON.stringify(t));
t2.有給 = { 残り: 7, 待ち: 0 };
M.描く(t2, jm, [], false);
確かめる('変わった節だけ書き換える',
  週の箱.書いた === 書いた回数 && meBody.children[4].書いた === 2,
  '週' + 週の箱.書いた + '回／事実' + meBody.children[4].書いた + '回');

見出し('入口：行き先に「どれの話か」を付ける');
const 未提出HTML = M.組み立てる(t, jm, [], false);
確かめる('大会の出欠は、その大会まで飛ぶ',
  未提出HTML.indexOf('taikai.html?event=e2') > 0, 未提出HTML.slice(未提出HTML.indexOf('taikai.html'), 未提出HTML.indexOf('taikai.html') + 40));
const t3 = JSON.parse(JSON.stringify(t));
t3.当番.期間 = [{ id: 'k9', name: '後期', 出した: false }];
t3.手入れ = [{ id: 'p9', horse: '北冴', 日数: 7, 入れた: 0, 出した: false }];
const 未提出HTML2 = M.組み立てる(t3, jm, [], false);
確かめる('当番の希望は、その期間まで飛ぶ', 未提出HTML2.indexOf('touban.html?term=k9') > 0);
確かめる('手入れの希望は、その馬まで飛ぶ', 未提出HTML2.indexOf('teire.html?plan=p9') > 0);

見出し('入口：出した直後（返事を待たずに消す）');
const 大会が未提出 = (html) => html.indexOf('大会の出欠') > 0;
確かめる('ふだんは未提出に出る', 大会が未提出(M.組み立てる(t, jm, [], false)));
覚え箱['mypage:出したところ'] = JSON.stringify({ url: 'taikai.html', 時刻: Date.now() });
確かめる('出した直後、前回の内容を出すあいだは消える', !大会が未提出(M.組み立てる(t, jm, [], true)));
確かめる('新しく取れたぶんには効かせない（本当の答えを出す）', 大会が未提出(M.組み立てる(t, jm, [], false)));
覚え箱['mypage:出したところ'] = JSON.stringify({ url: 'taikai.html', 時刻: Date.now() - 20 * 60 * 1000 });
確かめる('古い印は効かない（20分前）', 大会が未提出(M.組み立てる(t, jm, [], true)));
delete 覚え箱['mypage:出したところ'];

// ===================== 3. マイページに戻るボタン =====================

見出し('組み立てたページ：マイページに戻る');
const docs = path.join(__dirname, '..', 'docs');
const 中のページ = fs.readdirSync(docs).filter((f) => /[.]html$/.test(f) && f !== 'index.html');
確かめる('中のページが9つある（カレンダーを足した）', 中のページ.length === 9, 中のページ.join(','));
中のページ.forEach((f) => {
  const s = fs.readFileSync(path.join(docs, f), 'utf8');
  const 帯 = (s.match(/<header class="appbar[^>]*>[\s\S]*?<\/header>/) || [''])[0];
  確かめる(f + '：見出し帯に戻るリンクがある', 帯.indexOf('class="backhome"') > 0, 帯.slice(0, 80));
  確かめる(f + '：戻るリンクが題より前（左上）にある',
    帯.indexOf('backhome') < 帯.indexOf('<span'), 帯.slice(0, 120));
  確かめる(f + '：帯が上に貼り付く（下まで読んでも戻れる）', s.indexOf('header.appbar { position: sticky;') > 0);
  確かめる(f + '：立場を付け直す', s.indexOf("localStorage.getItem('role')") > 0);
});
// 部員が出す4ページは、名前を聞き直さない（入口で選んでいる）。戻る道は必ず残す。
見出し('組み立てたページ：名前を聞き直さない');
['touban.html', 'teire.html', 'yasumi.html', 'taikai.html'].forEach((f) => {
  const s = fs.readFileSync(path.join(docs, f), 'utf8');
  確かめる(f + '：名前を聞き直さない', s.indexOf('function 名前は聞かない') > 0);
  確かめる(f + '：名前を選び直すところは置かない（入口でやる）', s.indexOf('>ちがう人</button>') < 0);
  確かめる(f + '：URLで「どれの話か」を受け取る', s.indexOf('function URLの') > 0);
});

const 入口HTML = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
確かめる('入口じたいには戻るリンクを付けない', 入口HTML.indexOf('class="backhome"') < 0);
確かめる('入口は立場を覚える', 入口HTML.indexOf("localStorage.setItem('role'") > 0);

// ===================== 4. 出し終わったときのボタン =====================

// build.js が各ページに差し込むスクリプトを、簡単な模擬DOMで動かす
見出し('組み立てたページ：出し終わったときのボタン');
const 差し込み = (fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8')
  .match(/const 戻るのJS = `<script>([\s\S]*?)<` \+ `\/script>`;/) || [])[1];
確かめる('差し込むスクリプトを取り出せる', !!差し込み);

function 要素(cls, text) {
  return {
    className: cls, textContent: text, dataset: {}, href: '', 後ろ: [],
    classList: { contains: (c) => cls.split(' ').indexOf(c) >= 0 },
    querySelectorAll: () => [],
    insertAdjacentElement(どこ, el) { this.後ろ.push(el); },
  };
}
const 帯のリンク = 要素('backhome', '← マイページ');
let 観察 = null;
const body = 要素('', '');
const domCtx = vm.createContext({
  console: console,
  localStorage: { getItem: (k) => (k === 'role' ? 'admlinks' : null) },
  encodeURIComponent: encodeURIComponent,
  MutationObserver: function (cb) { 観察 = cb; this.observe = () => {}; },
  document: {
    body: body,
    querySelectorAll: (sel) => (sel === 'a.backhome' ? [帯のリンク] : []),
    createElement: () => 要素('', ''),
  },
});
vm.runInContext(差し込み, domCtx, { filename: 'build.js の差し込み' });

確かめる('帯のリンクに立場が付く', 帯のリンク.href === 'index.html?role=admlinks', 帯のリンク.href);

const 出せた = 要素('msg success', '送信しました。ありがとうございます。');
観察([{ addedNodes: [出せた] }]);
確かめる('出し終わった知らせの下にボタンが出る',
  出せた.後ろ.length === 1 && 出せた.後ろ[0].className === 'donehome' && 出せた.後ろ[0].textContent === 'マイページに戻る',
  JSON.stringify(出せた.後ろ.map((x) => x.className)));
確かめる('ボタンにも立場が付く', 出せた.後ろ[0].href === 'index.html?role=admlinks', 出せた.後ろ[0].href);

観察([{ addedNodes: [出せた] }]);
確かめる('同じ知らせに2つ付かない', 出せた.後ろ.length === 1, String(出せた.後ろ.length));

const 読み込み = 要素('msg success', '前回の回答を読み込みました。書き換えて送信すると更新されます。');
観察([{ addedNodes: [読み込み] }]);
確かめる('読み込んだだけの知らせには付けない', 読み込み.後ろ.length === 0, String(読み込み.後ろ.length));

const 失敗の知らせ = 要素('msg error', '送信に失敗しました：つながりませんでした');
観察([{ addedNodes: [失敗の知らせ] }]);
確かめる('失敗の知らせには付けない', 失敗の知らせ.後ろ.length === 0, String(失敗の知らせ.後ろ.length));

// ===================== 5. 高速化（写し・待たせない送信） =====================

見出し('出欠の画面：どちらの返事を出すか');
// git の autocrlf で CRLF になっていることがあるので、LF にそろえてから探す
const 出欠の原本 = fs.readFileSync(path.join(__dirname, '..', '画面', '人員表', 'member.html'), 'utf8').split('\r\n').join('\n');
const 選ぶソース = (出欠の原本.match(/const 版の時刻 = [^\n]*\n/) || [''])[0] +
  (出欠の原本.match(/function どちらの返事\([\s\S]*?\n}\n/) || [''])[0];
確かめる('原本から どちらの返事 を取り出せる', 選ぶソース.indexOf('function どちらの返事') > 0 && 選ぶソース.indexOf('const 版の時刻') === 0);
const 選ぶctx = vm.createContext({ Number: Number, String: String });
vm.runInContext(選ぶソース + ';this.どちらの返事 = どちらの返事;', 選ぶctx);
const 選ぶ = 選ぶctx.どちらの返事;
const サーバの返事 = { answers: [{ date: 'd', attending: true }], comment: '', entries: [] };
const 手元の返事 = { answers: [{ date: 'd', attending: false }], comment: '用事', entries: [{ competitionId: 'c', horse: '北叡' }], 時刻: 2000 };
確かめる('手元が無ければサーバ', 選ぶ(サーバの返事, '1000.1', null, false).返事 === サーバの返事);
確かめる('出す前に作られた写しなら、手元を出す', 選ぶ(サーバの返事, '1000.1', 手元の返事, false).手元を使った === true);
const 出したあと = 選ぶ(サーバの返事, '3000.1', 手元の返事, false);
確かめる('出したあとに作られた写しなら、サーバを出して手元は捨てる', 出したあと.返事 === サーバの返事 && 出したあと.手元は古い === true);
確かめる('Apps Script から直に取ったぶんはサーバを出す', 選ぶ(サーバの返事, null, 手元の返事, false).手元を使った === false);
確かめる('まだ届いていなければ、新しい写しでも手元', 選ぶ(サーバの返事, '3000.1', 手元の返事, true).手元を使った === true);
確かめる('まだ届いていなければ、Apps Script のぶんでも手元', 選ぶ(サーバの返事, null, 手元の返事, true).手元を使った === true);
const 手元で = 選ぶ(null, '1000.1', 手元の返事, false).返事;
確かめる('手元の返事はサーバと同じ形（answers・comment・entries）',
  手元で.comment === '用事' && 手元で.answers.length === 1 && 手元で.entries[0].horse === '北叡' && 手元で.時刻 === undefined,
  JSON.stringify(手元で));

見出し('組み立てたページ：写しと送信');
const 出欠HTML = fs.readFileSync(path.join(docs, 'taikai.html'), 'utf8');
// 2026-09-13 Cloudflare の API に移してからは、API そのものが速いので「写し」は使わない
確かめる('出欠の画面に写しの読み口は入らない（API に直に聞く）',
  出欠HTML.indexOf('function 写しから読む') < 0 && 出欠HTML.indexOf('bajutsubu-cache') < 0);
確かめる('出欠の画面は Cloudflare の API を呼ぶ', 出欠HTML.indexOf("const API = 'https://bajutsubu-api.hokudai-equestrian.workers.dev/jinin'") >= 0);
確かめる('keepalive は出欠の送信だけ', 出欠HTML.indexOf("const 閉じても届ける = ['submitResponse'];") > 0);
確かめる('通信の失敗に印を付ける', 出欠HTML.indexOf('err.通信 = true;') > 0);
['touban.html', 'teire.html', 'yasumi.html', 'taikai-admin.html', 'touban-admin.html'].forEach((f) => {
  確かめる(f + '：写しの読み口は入らない', fs.readFileSync(path.join(docs, f), 'utf8').indexOf('function 写しから読む') < 0);
});
確かめる('入口には写しの窓口を渡さない（人員表も API に直に聞く）', 入口HTML.indexOf('bajutsubu-cache') < 0);
確かめる('入口は Cloudflare の API を呼ぶ', 入口HTML.indexOf('"人員表": "https://bajutsubu-api.hokudai-equestrian.workers.dev/jinin"') > 0 &&
  入口HTML.indexOf('"当番": "https://bajutsubu-api.hokudai-equestrian.workers.dev/touban"') > 0);
確かめる('写しの窓口に鍵が入っていない（public のリポジトリ）',
  [出欠HTML, 入口HTML].every((s) => s.indexOf('WRITE_KEY') < 0 && s.indexOf('Bearer') < 0));

async function 写しのテスト() {
  見出し('入口：人員表は写しから読む');
  const 呼ばれた = [];
  const 返す = (value) => ({ ok: true, status: 200, json: async () => ({ ok: true, value: value }) });
  入口ctx.fetch = async (url) => {
    呼ばれた.push(url);
    return url.indexOf('https://cache.test') === 0
      ? 返す({ 版: '5000.1', me: { name: '美浦' }, 大会: [] })
      : 返す({ 版: '9000.1', me: { name: '美浦' }, 大会: [] });
  };
  let x = await M.人員表を読む('美浦', null);
  確かめる('まず写しに聞く', x.写し === true && 呼ばれた.length === 1 && 呼ばれた[0].indexOf('https://cache.test/jinin/mypage?name=') === 0, JSON.stringify(呼ばれた));
  x = await M.人員表を読む('美浦', '6000.1');
  確かめる('持っている版を渡す', 呼ばれた[1].indexOf('&v=6000.1') > 0, 呼ばれた[1]);
  確かめる('写しが手元より古ければ「同じ」扱い（古い中身に戻さない）', x.返事.同じ === true && x.返事.版 === '6000.1', JSON.stringify(x));
  x = await M.人員表を読む('美浦', '4000.1');
  確かめる('写しが新しければ中身を使う', !x.返事.同じ && x.返事.版 === '5000.1', JSON.stringify(x));

  入口ctx.fetch = async (url) => {
    呼ばれた.push(url);
    return url.indexOf('https://cache.test') === 0
      ? { ok: false, status: 503, json: async () => ({ ok: false }) }
      : 返す({ 版: '9000.1', me: null, 大会: [] });
  };
  x = await M.人員表を読む('美浦', null);
  確かめる('写しが読めなければ Apps Script に聞く', x.写し === false && x.返事.版 === '9000.1' && 呼ばれた[呼ばれた.length - 1] === 'https://gas.test');

  見出し('入口：送り待ちの片付け');
  覚え箱['taikai:送り待ち'] = JSON.stringify({ 'm1|e1': { memberId: 'm1', eventId: 'e1', 時刻: 100 } });
  覚え箱['taikai:手元:m1|e1'] = JSON.stringify({ 時刻: 100, answers: [] });
  M.送り待ちを直す({ memberId: 'm1', eventId: 'e1', 時刻: 100 }, true);
  確かめる('届いたら送り待ちから消える', JSON.parse(覚え箱['taikai:送り待ち'])['m1|e1'] === undefined);
  確かめる('届いたら手元の時刻を届いた時刻にする（写しと比べるため）', JSON.parse(覚え箱['taikai:手元:m1|e1']).時刻 > 100);
  覚え箱['taikai:送り待ち'] = JSON.stringify({ 'm1|e1': { memberId: 'm1', eventId: 'e1', 時刻: 300 } });
  M.送り待ちを直す({ memberId: 'm1', eventId: 'e1', 時刻: 200 }, true);
  確かめる('あとで出し直したぶんは消さない', JSON.parse(覚え箱['taikai:送り待ち'])['m1|e1'].時刻 === 300);
  覚え箱['taikai:送り待ち'] = JSON.stringify({ 'm2|e1': { memberId: 'm2', eventId: 'e1', 時刻: 100 } });
  覚え箱['taikai:手元:m2|e1'] = JSON.stringify({ 時刻: 100 });
  M.送り待ちを直す({ memberId: 'm2', eventId: 'e1', 時刻: 100 }, false);
  確かめる('断られたら手元も送り待ちも消す',
    覚え箱['taikai:手元:m2|e1'] === undefined && JSON.parse(覚え箱['taikai:送り待ち'])['m2|e1'] === undefined);
}

// ===================== まとめ =====================

写しのテスト().catch((e) => { 失敗.push('写しのテストが止まった：' + e.message); console.log(e); }).then(() => {
  console.log('\n' + (失敗.length ? '✗ ' + 失敗.length + '件失敗' : '✓ ぜんぶ通った') + '（' + ok + '/' + (ok + 失敗.length) + '）');
  if (失敗.length) process.exit(1);
});
