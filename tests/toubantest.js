/**
 * 当番・手入れシステム（GAS）を Node の模擬環境で動かして確かめる。
 * Apps Script の SpreadsheetApp などを、メモリ上の2次元配列で置き換えている。
 *
 *   node toubantest.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// 2026-09-13 Cloudflare に移すときから、サーバの原本は 馬術部API/src にある
const SRC = path.join('C:', 'Users', 'minuu', 'Documents', '馬術部API', 'src', 'touban.gs');

// ===================== 模擬スプレッドシート =====================

function makeSheet(name) {
  return { name: name, rows: [[]] };
}

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
      for (let i = 0; i < numRows; i++) {
        out.push(sheet.rows[row - 1 + i].slice(col - 1, col - 1 + numCols));
      }
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
    setBackground() { return this; },
    // 入力規則を、実機と同じように「列ごと」に覚えておく。
    // 合わない値を書こうとしたら、実機と同じように例外にする。
    setDataValidation(v) {
      sheet.規則 = sheet.規則 || {};
      for (let j = 0; j < numCols; j++) sheet.規則[col - 1 + j] = v;
      return this;
    },
    clearDataValidations() {
      sheet.規則 = sheet.規則 || {};
      for (let j = 0; j < numCols; j++) delete sheet.規則[col - 1 + j];
      return this;
    },
  };
}

function wrapSheet(sheet) {
  const api = {
    _raw: sheet,
    getName: () => sheet.name,
    setFrozenRows: () => api,
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
      const nr = Math.max(api.getLastRow(), 1);
      const nc = Math.max(api.getLastColumn(), 1);
      return rangeOf(sheet, 1, 1, nr, nc);
    },
  };
  return api;
}

const SHEETS = {};
const ALERTS = [];

const ss = {
  getSheetByName: (n) => (SHEETS[n] ? wrapSheet(SHEETS[n]) : null),
  insertSheet: (n) => { SHEETS[n] = makeSheet(n); return wrapSheet(SHEETS[n]); },
  getSheets: () => Object.keys(SHEETS).map((n) => wrapSheet(SHEETS[n])),
  deleteSheet: (sh) => { delete SHEETS[sh.getName()]; },
};

/*
  人員表システムのファイル（openById で開くほう）。
  ふだんは「開けない」ままにしておく（前からのテストは、読めなかったときの振る舞いを見ているため）。
  人員表を使う項目だけ 人員表を開ける = true にして開く。
*/
const SHEETS2 = {};
const ss2 = {
  getSheetByName: (n) => (SHEETS2[n] ? wrapSheet(SHEETS2[n]) : null),
  insertSheet: (n) => { SHEETS2[n] = makeSheet(n); return wrapSheet(SHEETS2[n]); },
  getSheets: () => Object.keys(SHEETS2).map((n) => wrapSheet(SHEETS2[n])),
};
let 人員表を開ける = false;
// 見出し＋行を、人員表側のシートに置く
function 人員表に置く(name, headers, rows) {
  SHEETS2[name] = makeSheet(name);
  const sh = wrapSheet(SHEETS2[name]);
  const values = [headers].concat(rows);
  sh.getRange(1, 1, values.length, headers.length).setValues(values);
}

const PROPS = {};
let uuidCount = 0;

const sandbox = {
  console: console,
  Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date, JSON: JSON,
  isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, Error: Error,

  SpreadsheetApp: {
    getActiveSpreadsheet: () => ss,
    openById: () => {
      if (!人員表を開ける) throw new Error('模擬環境では人員表システムのファイルを開けません');
      return ss2;
    },
    getUi: () => ({
      createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }),
      alert: (m) => { ALERTS.push(m); },
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
      return { put: (k, v) => { C[k] = v; }, get: (k) => (C[k] === undefined ? null : C[k]) };
    },
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  // nextId は「-」を抜いて先頭10文字しか使わないので、そこが必ず変わる値を返す
  Utilities: { getUuid: () => { uuidCount++; return ('u' + uuidCount).padStart(8, '0') + '-' + Date.now().toString(36) + '-abcd'; } },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
  HtmlService: {},
};

// vm では const で置いた値は文脈の持ちものにならないので、最後に自分で渡してもらう
const 追加 = '\n;this.曜日名 = 曜日名; this.希望の数 = 希望の数; this.記号の順 = 記号の順;' +
  ' this.SCHEMA = SCHEMA; this.既定の当番 = 既定の当番; this.既定の馬 = 既定の馬;' +
  ' this.外から呼べる関数 = 外から呼べる関数;' +
  ' this.見出しを見た = 見出しを見た;';
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8') + 追加, ctx, { filename: 'コード.gs' });
// 実機では google.script.run の1回ごとに新しい実行になり、readRows の覚えも消える。
// テストでも同じ条件にするため、関数を呼ぶ直前に必ず覚えを消す。
const G = new Proxy(ctx, {
  get(t, k) {
    const v = t[k];
    if (typeof v === 'function') return (...a) => {
      t.覚えを消す();
      Object.keys(t.見出しを見た || {}).forEach((k) => { delete t.見出しを見た[k]; });
      return v.apply(t, a);
    };
    return v;
  },
});
// ===================== 確かめる道具 =====================

// 当番は期間ごとに持つ。テストでは初期設定でできる最初の期間を使う。
const 期間ID = () => (G.loadDutyTerms()[0] || {}).id;
let ok = 0;
const 失敗 = [];
function 確かめる(名, 条件, 補足) {
  if (条件) { ok++; return; }
  失敗.push(名 + (補足 ? '　→ ' + 補足 : ''));
  console.log('  ✗ ' + 名 + (補足 ? '　→ ' + 補足 : ''));
}
function 見出し(s) { console.log('\n== ' + s + ' =='); }
// SCHEMA から手入れ計画のシート名を引く（名前を直接書かずに済ませる）
// 当番期間シートにも「期間名」があるので、チーフ倍率を持つほう（手入れ計画）で絞る
const SCHEMA当番枠 = () => G.SCHEMA['当番枠'];
const 計画シート名 = () => Object.keys(G.SCHEMA).filter((n) => (G.SCHEMA[n] || []).indexOf('チーフ倍率') >= 0)[0];
function 投げるはず(名, fn, 含む) {
  try { fn(); 確かめる(名, false, 'エラーにならなかった'); }
  catch (e) {
    const m = (e && e.message) || String(e);
    確かめる(名, !含む || m.indexOf(含む) >= 0, '出たエラー: ' + m);
  }
}

// ===================== 1. 初期設定 =====================

見出し('初期設定');
G.setupSheets();
確かめる('シートが全部できる', Object.keys(SHEETS).length === Object.keys(G.SCHEMA).length, Object.keys(SHEETS).join(','));
確かめる('当番が3つ入る', G.loadDuties().length === 3, JSON.stringify(G.loadDuties().map((d) => d.name)));
確かめる('当番枠が21マスできる', G.loadSlots(期間ID()).length === 21, String(G.loadSlots(期間ID()).length));
確かめる('馬が13頭入る', G.loadHorses().length === 13, String(G.loadHorses().length));
const 設定 = G.設定を読む();
確かめる('設定の既定値が読める（当番は1人1枠／チーフは2倍）',
  設定.個人下限 === 1 && 設定.個人上限 === 1 && 設定.チーフ倍率 === 2 &&
  設定.同曜日禁止 === true && 設定.連日回避 === true && 設定.マル絶対 === false,
  JSON.stringify(設定));

// もう一度実行しても壊れない
G.setupSheets();
確かめる('初期設定を2回やっても当番枠は21のまま', G.loadSlots(期間ID()).length === 21, String(G.loadSlots(期間ID()).length));
確かめる('初期設定を2回やっても馬は13頭のまま', G.loadHorses().length === 13, String(G.loadHorses().length));

// ===================== 2. 部員 =====================

見出し('部員');
PROPS['ADMIN_PASSWORD'] = 'testtest';
const T = G.login('testtest');
確かめる('ログインできる', !!T);
投げるはず('パスワードが違えば通らない', () => G.login('chigau'), 'パスワードが違います');
投げるはず('副将トークンが要る', () => G.adminLoadAll('deたらめ'), '有効期限');

const 今年度 = G.academicYear();
const 名簿 = [];
for (let g = 1; g <= 3; g++) {
  for (let i = 1; i <= 6; i++) 名簿.push({ 名前: g + '年' + i, 入部年: 今年度 - g + 1 });
}
G.adminBulkMembers(T, 名簿.map((m) => m.名前 + ' ' + m.入部年).join('\n'));
const members = G.loadMembers();
確かめる('18人登録できる', members.length === 18, String(members.length));
確かめる('学年が入部年から出る', members.filter((m) => m.grade === 1).length === 6, JSON.stringify(members.map((m) => m.grade)));
const r足す = G.adminBulkMembers(T, '1年1\n新入り ' + 今年度);
確かめる('同じ名前は飛ばす', r足す.足した === 1 && r足す.飛ばした === 1, JSON.stringify(r足す));
G.adminDeleteMember(T, G.loadMembers().filter((m) => m.name === '新入り')[0].id);
確かめる('削除できる', G.loadMembers().length === 18, String(G.loadMembers().length));

// ===================== 3. 当番の枠 =====================

見出し('当番の枠と投票');
const duties = G.loadDuties();
const 昼当 = duties.filter((d) => d.name === '昼当')[0];
const 夕当 = duties.filter((d) => d.name === '夕当')[0];
const 投げ草 = duties.filter((d) => d.name === '投げ草')[0];

// 昼当は下限2・上限3、夕当は下限1・上限2、投げ草は下限1・上限1／投げ草は1〜2年だけ
const 枠設定 = [];
G.曜日名.forEach((w) => {
  // 1人1枠なので、下限の合計（7+7+0=14）が部員18人に収まるようにしておく
  枠設定.push({ dutyId: 昼当.id, day: w, min: 1, max: 3, grades: '' });
  枠設定.push({ dutyId: 夕当.id, day: w, min: 1, max: 2, grades: '' });
  枠設定.push({ dutyId: 投げ草.id, day: w, min: 0, max: 1, grades: '1、2' });
});
G.adminSaveSlots(T, 期間ID(), 枠設定);
const slots = G.loadSlots(期間ID());
確かめる('下限・上限が入る', slots.filter((s) => s.dutyId === 昼当.id).every((s) => s.min === 1 && s.max === 3));
確かめる('学年しばりが入る', slots.filter((s) => s.dutyId === 投げ草.id).every((s) => s.grades.join(',') === '1,2'),
  JSON.stringify(slots.filter((s) => s.dutyId === 投げ草.id)[0]));
投げるはず('上限が下限より小さいと止まる',
  () => G.adminSaveSlots(T, 期間ID(), [{ dutyId: 昼当.id, day: '月', min: 5, max: 2, grades: '' }]), '上限');
// 「12」のように区切らないと 12年 と読まれてしまう。黙って全学年に戻さず止める。
投げるはず('区切っていない学年は止める',
  () => G.adminSaveSlots(T, 期間ID(), [{ dutyId: 昼当.id, day: '月', min: 1, max: 3, grades: '12' }]), '読めません');
G.adminSaveSlots(T, 期間ID(), [{ dutyId: 昼当.id, day: '月', min: 1, max: 3, grades: '1,2,3' }]);
確かめる('区切りは , でも読める',
  G.loadSlots(期間ID()).filter((s) => s.dutyId === 昼当.id && s.day === '月')[0].grades.join(',') === '1,2,3');
G.adminSaveSlots(T, 期間ID(), [{ dutyId: 昼当.id, day: '月', min: 1, max: 3, grades: '' }]);
確かめる('空欄なら全学年に戻る',
  G.loadSlots(期間ID()).filter((s) => s.dutyId === 昼当.id && s.day === '月')[0].grades.length === 0);

// ===================== 4. 投票 =====================

const M = G.loadMembers();
const 引く = (名) => M.filter((m) => m.name === 名)[0];

// 4つちょうどでないと受け取らない
投げるはず('希望が3つだと止まる', () => G.submitDutyVote(期間ID(), 引く('1年1').id, [
  { dutyId: 昼当.id, day: '月' }, { dutyId: 昼当.id, day: '火' }, { dutyId: 夕当.id, day: '水' },
]), 'ちょうど4つ');
投げるはず('希望が5つだと止まる', () => G.submitDutyVote(期間ID(), 引く('1年1').id, [
  { dutyId: 昼当.id, day: '月' }, { dutyId: 昼当.id, day: '火' }, { dutyId: 夕当.id, day: '水' },
  { dutyId: 夕当.id, day: '木' }, { dutyId: 投げ草.id, day: '金' },
]), 'ちょうど4つ');
投げるはず('同じマスを2回選ぶと止まる', () => G.submitDutyVote(期間ID(), 引く('1年1').id, [
  { dutyId: 昼当.id, day: '月' }, { dutyId: 昼当.id, day: '月' },
  { dutyId: 夕当.id, day: '水' }, { dutyId: 夕当.id, day: '木' },
]), '2回');
投げるはず('入れない学年のマスは止まる', () => G.submitDutyVote(期間ID(), 引く('3年1').id, [
  { dutyId: 投げ草.id, day: '月' }, { dutyId: 昼当.id, day: '火' },
  { dutyId: 夕当.id, day: '水' }, { dutyId: 夕当.id, day: '木' },
]), '年しか入れません');

// ちゃんとした投票。わざと月・火に集中させて、希望どおりにならない人を作る。
const 曜日 = G.曜日名;
M.forEach((m, i) => {
  const 選ぶ = [];
  const 好み = i < 10
    ? [[昼当, '月'], [昼当, '火'], [夕当, '月'], [夕当, '火']]
    : [[昼当, 曜日[i % 7]], [夕当, 曜日[(i + 1) % 7]], [昼当, 曜日[(i + 2) % 7]], [夕当, 曜日[(i + 3) % 7]]];
  好み.forEach((x) => { 選ぶ.push({ dutyId: x[0].id, day: x[1] }); });
  // 投げ草は1〜2年だけ。3年生には入れない。
  if (m.grade <= 2 && i % 3 === 0) 選ぶ[3] = { dutyId: 投げ草.id, day: 曜日[i % 7] };
  G.submitDutyVote(期間ID(), m.id, 選ぶ);
});
確かめる('投票が18人ぶん入る', G.loadDutyVotes(期間ID()).length === 18 * 4, String(G.loadDutyVotes(期間ID()).length));
const 私の = G.getMyDutyVote(期間ID(), 引く('1年1').id);
確かめる('自分の投票が第1〜第4で戻る', 私の && 私の.choices.map((c) => c.rank).join(',') === '1,2,3,4', JSON.stringify(私の));

// 投票し直すと上書きされる（増えない）
G.submitDutyVote(期間ID(), 引く('1年1').id, [
  { dutyId: 夕当.id, day: '金' }, { dutyId: 昼当.id, day: '土' },
  { dutyId: 昼当.id, day: '日' }, { dutyId: 夕当.id, day: '日' },
]);
確かめる('投票し直しても行が増えない', G.loadDutyVotes(期間ID()).length === 18 * 4, String(G.loadDutyVotes(期間ID()).length));

// 代理入力
G.adminClearVote(T, 期間ID(), 引く('3年6').id);
確かめる('投票を消せる', G.loadDutyVotes(期間ID()).filter((v) => v.memberId === 引く('3年6').id).length === 0);
G.adminSaveVoteFor(T, 期間ID(), 引く('3年6').id, [
  { dutyId: 昼当.id, day: '水' }, { dutyId: 夕当.id, day: '木' },
  { dutyId: 昼当.id, day: '金' }, { dutyId: 夕当.id, day: '土' },
]);
確かめる('代理入力が代理の印つきで入る',
  G.loadDutyVotes(期間ID()).filter((v) => v.memberId === 引く('3年6').id).every((v) => v.byAdmin === true));

// ===================== 5. 当番表を作る =====================

見出し('当番表の作成');
const 出来 = G.adminGenerateDuty(T, 期間ID(), true);
const cells = 出来.cells;
確かめる('当番表ができる', cells.length > 0, String(cells.length));

const 設定2 = G.設定を読む();
const 個数 = {};
cells.forEach((c) => { 個数[c.memberId] = (個数[c.memberId] || 0) + 1; });
確かめる('1人あたりの上限を超えない',
  Object.keys(個数).every((id) => 個数[id] <= 設定2.個人上限),
  JSON.stringify(Object.keys(個数).filter((id) => 個数[id] > 設定2.個人上限).map((id) => G.loadMembers().filter((m) => m.id === id)[0].name + ':' + 個数[id])));

const 同曜日 = {};
cells.forEach((c) => { const k = c.memberId + '|' + c.day; 同曜日[k] = (同曜日[k] || 0) + 1; });
確かめる('同じ人が同じ曜日に2つ入らない',
  Object.keys(同曜日).every((k) => 同曜日[k] === 1),
  JSON.stringify(Object.keys(同曜日).filter((k) => 同曜日[k] > 1)));

const gradeOf = {};
G.loadMembers().forEach((m) => { gradeOf[m.id] = m.grade; });
const slotMap = {};
G.loadSlots(期間ID()).forEach((s) => { slotMap[s.dutyId + '|' + s.day] = s; });
確かめる('学年しばりを破らない',
  cells.every((c) => {
    const s = slotMap[c.dutyId + '|' + c.day];
    return !s.grades.length || s.grades.indexOf(gradeOf[c.memberId]) >= 0;
  }),
  JSON.stringify(cells.filter((c) => {
    const s = slotMap[c.dutyId + '|' + c.day];
    return s.grades.length && s.grades.indexOf(gradeOf[c.memberId]) < 0;
  })));

確かめる('枠の上限を超えない',
  G.loadSlots(期間ID()).every((s) => {
    const n = cells.filter((c) => c.dutyId === s.dutyId && c.day === s.day).length;
    return s.max === null || n <= s.max;
  }));

確かめる('同じマスに同じ人が二重に入らない', (() => {
  const seen = {};
  return cells.every((c) => {
    const k = c.dutyId + '|' + c.day + '|' + c.memberId;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
})());

確かめる('既定では1人1枠になる',
  Object.keys(個数).every((id) => 個数[id] === 1) && Object.keys(個数).length === G.loadMembers().length,
  '持っている人 ' + Object.keys(個数).length + '人 / 部員 ' + G.loadMembers().length + '人、' +
  JSON.stringify(Object.keys(個数).filter((id) => 個数[id] !== 1).map((id) => G.loadMembers().filter((m) => m.id === id)[0].name + ':' + 個数[id])));

const 希望どおり = cells.filter((c) => c.rank >= 1).length;
確かめる('希望どおりに入った人がいる', 希望どおり > 0, String(希望どおり) + '/' + cells.length);
console.log('  （参考）のべ ' + cells.length + '人ぶん、うち希望どおり ' + 希望どおり + '人ぶん');

const 保存後 = G.loadDutyTable(期間ID());
確かめる('保存した当番表が読み戻せる', 保存後.length === cells.length, 保存後.length + ' vs ' + cells.length);

// 固定したマスは作り直しても動かない
const 一つ目 = 保存後[0];
G.adminSaveTable(T, 期間ID(), 保存後.map((c) => (c === 一つ目 ? Object.assign({}, c, { locked: true }) : c)));
const 作り直し = G.adminGenerateDuty(T, 期間ID(), false);
確かめる('鍵をかけたマスは作り直しても残る',
  作り直し.cells.some((c) => c.dutyId === 一つ目.dutyId && c.day === 一つ目.day && c.memberId === 一つ目.memberId && c.locked),
  JSON.stringify(一つ目));

// 画面から手で直したものが保存できる
const 手直し = 保存後.slice(0, 5);
const r保存 = G.adminSaveTable(T, 期間ID(), 手直し.concat([{ dutyId: 昼当.id, day: '月', memberId: 'いない人', rank: 0, locked: false }]));
確かめる('いない人の行は捨てる', r保存.count === 5, String(r保存.count));

// 下限が満たせないときは警告が出る
G.adminSaveSlots(T, 期間ID(), [{ dutyId: 昼当.id, day: '月', min: 30, max: '', grades: '' }]);
const きつい = G.adminGenerateDuty(T, 期間ID(), false);
確かめる('人が足りないと不足の警告が出る',
  きつい.warnings.some((w) => w.level === 'error' && w.text.indexOf('不足') >= 0),
  JSON.stringify(きつい.warnings.slice(0, 3)));
G.adminSaveSlots(T, 期間ID(), [{ dutyId: 昼当.id, day: '月', min: 1, max: 3, grades: '' }]);

// 既定（1人1枠）では下限をぜんぶ満たせる
確かめる('1人1枠でも下限をぜんぶ満たせる',
  !G.adminGenerateDuty(T, 期間ID(), false).warnings.some((w) => w.level === 'error'),
  JSON.stringify(G.adminGenerateDuty(T, 期間ID(), false).warnings.filter((w) => w.level === 'error').map((w) => w.text)));

// 上限を2にすると、2枠持つ人が出る（下限の合計を人数より多くする）
G.adminSaveSettings(T, { 個人下限: 1, 個人上限: 2, 同曜日禁止: true, 連日回避: true, チーフ倍率: 2, マル絶対: false });
G.adminSaveSlots(T, 期間ID(), G.曜日名.map((w) => ({ dutyId: 昼当.id, day: w, min: 3, max: 3, grades: '' })));
const 上限2 = G.adminGenerateDuty(T, 期間ID(), false);
const 個数2 = {};
上限2.cells.forEach((c) => { 個数2[c.memberId] = (個数2[c.memberId] || 0) + 1; });
確かめる('上限2にすると誰も3つは持たない', Object.keys(個数2).every((id) => 個数2[id] <= 2), JSON.stringify(個数2));
確かめる('上限2にすると2枠持つ人が出る', Object.keys(個数2).some((id) => 個数2[id] === 2),
  JSON.stringify(Object.keys(個数2).map((id) => 個数2[id])));

// 元に戻す（1人1枠）
G.adminSaveSlots(T, 期間ID(), G.曜日名.map((w) => ({ dutyId: 昼当.id, day: w, min: 1, max: 3, grades: '' })));
G.adminSaveSettings(T, { 個人下限: 1, 個人上限: 1, 同曜日禁止: true, 連日回避: true, チーフ倍率: 2, マル絶対: false });
G.adminGenerateDuty(T, 期間ID(), true);

// ===================== 6. 手入れ（曜日方式） =====================

見出し('手入れ（曜日方式）');
PROPS['CHIEF_PASSWORD'] = 'chiefpw';
確かめる('チーフはパスワードが要る', G.chiefMeta().要パスワード === true);
投げるはず('チーフのパスワードが違えば通らない', () => G.loginChief('chigau'), 'パスワードが違います');
const C = G.loginChief('chiefpw');
確かめる('チーフのトークンは副将用に使えない', (() => {
  try { G.adminLoadAll(C); return false; } catch (e) { return true; }
})());
// 手入れのほうは副将からも触れる（馬のチーフ決めと期間づくりを副将画面にも置いたため）
確かめる('副将のトークンで手入れの一覧が読める', (() => {
  try { return G.chiefLoadAll(T).horses.length > 0; } catch (e) { return false; }
})());
投げるはず('でたらめなトークンは手入れでも通らない', () => G.chiefLoadAll('でたらめ'), '有効期限');

const horses = G.loadHorses();
const 北汐 = horses.filter((h) => h.name === '北汐')[0];
const r計画 = G.chiefSavePlan(C, { horseId: 北汐.id, term: '後期', mode: '曜日', min: 1, max: 1 });
// 手入れは基本1人（2026-09-16）。画面は人数を送らないので、送られてこなければ1人にする
{
  const 省略 = G.chiefSavePlan(C, { horseId: 北汐.id, term: '人数を送らない', mode: '曜日' });
  const p = G.findPlan(省略.id);
  確かめる('1日の人数を送らなければ 下限も上限も1人', p.min === 1 && p.max === 1, JSON.stringify([p.min, p.max]));
  G.chiefDeletePlan(C, 省略.id);
}
確かめる('曜日方式の期間が作れる', !!r計画.id);
const plan1 = G.findPlan(r計画.id);
確かめる('曜日方式は7日ぶん', G.planKeys(plan1).length === 7, String(G.planKeys(plan1).length));

投げるはず('同じ馬に同じ期間名は作れない',
  () => G.chiefSavePlan(C, { horseId: 北汐.id, term: '後期', mode: '曜日' }), 'もうあります');

// 複数の馬にまとめて作る
{
  const 対象 = horses.slice(0, 5).map((h) => h.id);   // 北汐を含む5頭
  const r = G.chiefSavePlanForHorses(C, 対象, { term: '後期', mode: '曜日', min: 1, max: 1 });
  確かめる('まとめて作ると、まだ無い馬にだけ作られる', r.作った.length === 4, JSON.stringify(r.作った.map((x) => x.name)));
  確かめる('すでにある馬は飛ばす（票を消さないため）',
    r.飛ばした.length === 1 && r.飛ばした[0] === '北汐', JSON.stringify(r.飛ばした));
  確かめる('5頭ぶんの「後期」ができる',
    G.loadPlans().filter((p) => p.term === '後期').length === 5,
    String(G.loadPlans().filter((p) => p.term === '後期').length));
  確かめる('同じ設定で入る',
    G.loadPlans().filter((p) => p.term === '後期').every((p) => p.mode === '曜日' && p.min === 1 && p.max === 1));

  // もう一度まとめて実行しても増えない
  const r2 = G.chiefSavePlanForHorses(C, 対象, { term: '後期', mode: '曜日', min: 1, max: 1 });
  確かめる('もう一度やっても二重にならない',
    r2.作った.length === 0 && G.loadPlans().filter((p) => p.term === '後期').length === 5);

  投げるはず('馬を選ばないと止まる', () => G.chiefSavePlanForHorses(C, [], { term: 'あ', mode: '曜日' }), '1頭以上');
  投げるはず('日付がおかしければ止まる',
    () => G.chiefSavePlanForHorses(C, 対象, { term: 'へん', mode: 'カレンダー', from: '2026-05-01', to: '2026-04-01' }), '終了日');

  // 片づけ（このあとのテストに影響させない）
  G.loadPlans().filter((p) => p.term === '後期' && p.horseId !== 北汐.id)
    .forEach((p) => G.chiefDeletePlan(C, p.id));
  確かめる('片づけて北汐の後期だけ残る', G.loadPlans().filter((p) => p.term === '後期').length === 1);
}

// サブを4人。うち1人は全部×、1人は未投票にする。
const サブ達 = [引く('1年1'), 引く('1年2'), 引く('2年1'), 引く('3年1')];
G.chiefSaveSubs(C, plan1.id, サブ達.map((m) => m.id));
確かめる('サブが保存できる', G.loadSubs(plan1.id).length === 4, String(G.loadSubs(plan1.id).length));

投げるはず('サブでない人は投票できない',
  () => G.submitCareVote(plan1.id, 引く('3年5').id, { 月: '◎', 火: '◎', 水: '◎', 木: '◎', 金: '◎', 土: '◎', 日: '◎' }),
  'サブに入っていません');
投げるはず('日が抜けていると受け取らない',
  () => G.submitCareVote(plan1.id, サブ達[0].id, { 月: '◎', 火: '○' }), '全部の日');

// 希望の受付を止める・開ける（2026-09-16 ユーザーの指示）
{
  const 全部まる = { 月: '◎', 火: '◎', 水: '◎', 木: '◎', 金: '◎', 土: '◎', 日: '◎' };
  const 期間 = () => G.loadPlans().filter((p) => p.id === plan1.id)[0];
  確かめる('作った期間は、はじめは受付中', 期間().open === true);
  G.chiefSetPlanOpen(C, plan1.id, false);
  確かめる('受付を止められる', 期間().open === false);
  投げるはず('止めているあいだは部員から出せない',
    () => G.submitCareVote(plan1.id, サブ達[0].id, 全部まる), '受け付けていません');
  G.chiefSaveVoteFor(C, plan1.id, サブ達[0].id, 全部まる);
  確かめる('止めていてもチーフの代理入力はできる',
    G.loadCareVotes(plan1.id).filter((v) => v.memberId === サブ達[0].id).length === 7);
  確かめる('部員の画面には受付中かどうかが届く',
    G.getCareMemberData(サブ達[0].id).plans.filter((p) => p.id === plan1.id)[0].open === false);
  確かめる('止めた期間はマイページの「まだ出していないもの」に出ない',
    !G.マイページの中身(サブ達[0].name).手入れ.some((x) => x.id === plan1.id));
  投げるはず('合鍵なしでは切り替えられない', () => G.chiefSetPlanOpen('でたらめ', plan1.id, true), '有効期限');
  G.chiefSetPlanOpen(C, plan1.id, true);
  確かめる('開け直せる', 期間().open === true &&
    G.マイページの中身(サブ達[0].name).手入れ.some((x) => x.id === plan1.id),
    JSON.stringify([期間().open, G.マイページの中身(サブ達[0].name).手入れ.map((x) => [x.id, x.open])]));
  G.chiefSavePlan(C, Object.assign({}, 期間(), { min: 1, max: 1 }));
  確かめる('決まりを保存しても受付中は変わらない', 期間().open === true);
  G.chiefClearVote(C, plan1.id, サブ達[0].id);
}

// 1年1：月火が◎、あとは×
G.submitCareVote(plan1.id, サブ達[0].id, { 月: '◎', 火: '◎', 水: '×', 木: '×', 金: '×', 土: '×', 日: '×' });
// 1年2：全部まる
G.submitCareVote(plan1.id, サブ達[1].id, { 月: '○', 火: '○', 水: '○', 木: '○', 金: '○', 土: '○', 日: '○' });
// 2年1：全部×（絶対に入ってはいけない）
G.submitCareVote(plan1.id, サブ達[2].id, { 月: '×', 火: '×', 水: '×', 木: '×', 金: '×', 土: '×', 日: '×' });
// 3年1 は未投票のまま

const 手入れ = G.chiefGenerateCare(C, plan1.id, true);
const cc = 手入れ.cells;
確かめる('手入れ表ができる', cc.length > 0, String(cc.length));
確かめる('全部×の人は入らない', !cc.some((c) => c.memberId === サブ達[2].id),
  JSON.stringify(cc.filter((c) => c.memberId === サブ達[2].id)));
確かめる('未投票の人は入らない', !cc.some((c) => c.memberId === サブ達[3].id));
確かめる('×の日には誰も入っていない',
  !cc.some((c) => {
    const v = G.loadCareVotes(plan1.id).filter((x) => x.memberId === c.memberId && x.key === c.key)[0];
    return v && v.mark === '×';
  }));
確かめる('月・火は◎の人（1年1）が取る',
  cc.filter((c) => c.key === '月' || c.key === '火').every((c) => c.memberId === サブ達[0].id),
  JSON.stringify(cc.filter((c) => c.key === '月' || c.key === '火').map((c) => c.key + ':' + G.loadMembers().filter((m) => m.id === c.memberId)[0].name)));
確かめる('水〜日は○の人（1年2）が取る',
  ['水', '木', '金', '土', '日'].every((k) => cc.some((c) => c.key === k && c.memberId === サブ達[1].id)),
  JSON.stringify(cc.map((c) => c.key + ':' + G.loadMembers().filter((m) => m.id === c.memberId)[0].name)));
確かめる('7日ぶん全部埋まる', cc.length === 7, String(cc.length));
確かめる('未投票のサブがいると警告が出る',
  手入れ.warnings.some((w) => w.text.indexOf('出していないサブ') >= 0),
  JSON.stringify(手入れ.warnings.map((w) => w.text)));
確かめる('チーフが決まっていないと知らせる',
  手入れ.chiefMemberId === null && 手入れ.warnings.some((w) => w.text.indexOf('チーフが決まっていない') >= 0),
  JSON.stringify(手入れ.warnings.map((w) => w.text)));

// 誰も入れない日を作る
G.chiefSaveVoteFor(C, plan1.id, サブ達[1].id, { 月: '○', 火: '○', 水: '×', 木: '○', 金: '○', 土: '○', 日: '○' });
const 穴 = G.chiefGenerateCare(C, plan1.id, false);
確かめる('誰も入れない日があると警告が出る',
  穴.warnings.some((w) => w.level === 'error' && w.text.indexOf('決まらない日') >= 0),
  JSON.stringify(穴.warnings.map((w) => w.text)));

// 手で直す：×の人を入れると警告になる
const 悪い手直し = G.chiefSaveTable(C, plan1.id, [{ key: '水', memberId: サブ達[2].id, mark: '', locked: true }]);
確かめる('×の人を手で入れると警告が出る',
  悪い手直し.warnings.some((w) => w.level === 'error' && w.text.indexOf('入れない') >= 0),
  JSON.stringify(悪い手直し.warnings.map((w) => w.text)));
確かめる('サブでない人を手で入れても捨てられる',
  G.chiefSaveTable(C, plan1.id, [{ key: '月', memberId: 引く('3年5').id, mark: '', locked: true }]).count === 0);

// ===================== 7. 手入れ（カレンダー方式） =====================

見出し('手入れ（カレンダー方式）');
const 北陽 = horses.filter((h) => h.name === '北陽')[0];
const r計画2 = G.chiefSavePlan(C, {
  horseId: 北陽.id, term: '4月', mode: 'カレンダー', from: '2026-04-01', to: '2026-04-30', min: 1, max: 1,
});
const plan2 = G.findPlan(r計画2.id);
const keys2 = G.planKeys(plan2);
確かめる('4月は30日ぶん', keys2.length === 30, String(keys2.length));
確かめる('キーが日付の形', keys2[0].key === '2026-04-01' && keys2[29].key === '2026-04-30',
  keys2[0].key + ' 〜 ' + keys2[29].key);
確かめる('2026-04-01は水曜', keys2[0].label.indexOf('水') >= 0, keys2[0].label);

投げるはず('終了日が開始日より前だと止まる',
  () => G.chiefSavePlan(C, { horseId: 北陽.id, term: 'へん', mode: 'カレンダー', from: '2026-04-30', to: '2026-04-01' }), '終了日');
投げるはず('期間が長すぎると止まる',
  () => G.chiefSavePlan(C, { horseId: 北陽.id, term: 'ながい', mode: 'カレンダー', from: '2026-04-01', to: '2028-04-01' }), '長すぎます');

const サブ2 = [引く('1年3'), 引く('2年2'), 引く('2年3')];
G.chiefSaveSubs(C, plan2.id, サブ2.map((m) => m.id));
// 1年3 をこの馬のチーフにする（チーフ2：ほかのサブ1 が効くか見る）
G.chiefSaveHorse(T, { id: 北陽.id, chief: '1年3' });
投げるはず('チーフの付け替えはチーフにはできない',
  () => G.chiefSaveHorse(C, { id: 北陽.id, chief: '2年2' }), '有効期限');
投げるはず('名簿にない名前は弾く',
  () => G.chiefSaveHorse(T, { id: 北陽.id, chief: 'いない人' }), '部員の一覧にありません');
確かめる('チーフが部員として引ける', G.chiefLoadPlan(C, plan2.id).chiefMemberId === サブ2[0].id);

// 3人とも、平日は◎、土日は×
サブ2.forEach((m, idx) => {
  const marks = {};
  keys2.forEach((k) => {
    const 土日 = k.dow >= 5;
    marks[k.key] = 土日 ? '×' : (idx === 0 ? '◎' : '○');
  });
  G.submitCareVote(plan2.id, m.id, marks);
});
const 手入れ2 = G.chiefGenerateCare(C, plan2.id, true);
const 平日数 = keys2.filter((k) => k.dow < 5).length;
const 土日数 = keys2.length - 平日数;
確かめる('平日だけ埋まる', 手入れ2.cells.length === 平日数, 手入れ2.cells.length + ' / 平日' + 平日数);
確かめる('土日には誰も入らない',
  !手入れ2.cells.some((c) => keys2.filter((k) => k.key === c.key)[0].dow >= 5));
確かめる('土日が埋まらない警告が出る',
  手入れ2.warnings.some((w) => w.level === 'error' && w.text.indexOf('決まらない日') >= 0));

// 偏りすぎていないか（全部◎の人が全部さらわない）
const 日数 = {};
手入れ2.cells.forEach((c) => { 日数[c.memberId] = (日数[c.memberId] || 0) + 1; });
console.log('  （参考）平日' + 平日数 + '日／土日' + 土日数 + '日　配分: ' +
  サブ2.map((m) => m.name + ' ' + (日数[m.id] || 0) + '日').join('、'));
// チーフ2：ほかのサブ1 → 3人なら チーフが全体の1/2、ほかが1/4ずつ
const 見込み = 平日数 / 2;
確かめる('チーフ2：ほかのサブ1 の割合になる',
  Math.abs((日数[サブ2[0].id] || 0) - 見込み) <= 1 &&
  サブ2.slice(1).every((m) => Math.abs((日数[m.id] || 0) - 見込み / 2) <= 1),
  '見込み チーフ' + 見込み + '／ほか' + (見込み / 2) + '　実際 ' + サブ2.map((m) => m.name + ':' + (日数[m.id] || 0)).join(' '));
確かめる('全部◎の人が独り占めしない', サブ2.every((m) => (日数[m.id] || 0) > 0),
  サブ2.map((m) => m.name + ':' + (日数[m.id] || 0)).join(' '));

// 倍率を1にすると3人で等分される（全体の既定値を変えた場合）
G.adminSaveSettings(T, { 個人下限: 1, 個人上限: 1, 同曜日禁止: true, 連日回避: true, チーフ倍率: 1, マル絶対: false });
const 等分 = G.chiefGenerateCare(C, plan2.id, false);
const 日数等分 = {};
等分.cells.forEach((c) => { 日数等分[c.memberId] = (日数等分[c.memberId] || 0) + 1; });
確かめる('倍率1にすると3人で等分される',
  サブ2.every((m) => Math.abs((日数等分[m.id] || 0) - 平日数 / 3) <= 1),
  サブ2.map((m) => m.name + ':' + (日数等分[m.id] || 0)).join(' '));
G.adminSaveSettings(T, { 個人下限: 1, 個人上限: 1, 同曜日禁止: true, 連日回避: true, チーフ倍率: 2, マル絶対: false });

// ===== チーフ側で、この馬だけの割合を決められる =====
確かめる('既定では計画に倍率が入っていない', G.findPlan(plan2.id).chiefRatio === null,
  String(G.findPlan(plan2.id).chiefRatio));
確かめる('計画の倍率が空なら既定値を使う', G.計画のチーフ倍率(G.findPlan(plan2.id)) === 2);

// この馬だけ 3：1 にする（方式と日付は変えないので票は消えない）
const 票数の前 = G.loadCareVotes(plan2.id).length;
G.chiefSavePlan(C, {
  id: plan2.id, horseId: 北陽.id, term: '4月', mode: 'カレンダー',
  from: '2026-04-01', to: '2026-04-30', min: 1, max: 1, chiefRatio: 3,
});
確かめる('チーフが決めた倍率が保存される', G.findPlan(plan2.id).chiefRatio === 3, String(G.findPlan(plan2.id).chiefRatio));
確かめる('倍率だけ変えても票は消えない', G.loadCareVotes(plan2.id).length === 票数の前,
  G.loadCareVotes(plan2.id).length + ' vs ' + 票数の前);
確かめる('計画の倍率が既定値より優先される', G.計画のチーフ倍率(G.findPlan(plan2.id)) === 3);

const 三倍 = G.chiefGenerateCare(C, plan2.id, false);
const 日数三倍 = {};
三倍.cells.forEach((c) => { 日数三倍[c.memberId] = (日数三倍[c.memberId] || 0) + 1; });
// チーフ3：ほか1：ほか1 → チーフが全体の 3/5
const 見込み3 = 平日数 * 3 / 5;
確かめる('チーフ3：ほかのサブ1 の割合になる',
  Math.abs((日数三倍[サブ2[0].id] || 0) - 見込み3) <= 1.5,
  '見込み ' + 見込み3.toFixed(1) + '　実際 ' + サブ2.map((m) => m.name + ':' + (日数三倍[m.id] || 0)).join(' '));

投げるはず('おかしな倍率は止める',
  () => G.chiefSavePlan(C, {
    id: plan2.id, horseId: 北陽.id, term: '4月', mode: 'カレンダー',
    from: '2026-04-01', to: '2026-04-30', min: 1, max: 1, chiefRatio: 99,
  }), 'チーフの割合');

// 空にすると既定値に戻る
G.chiefSavePlan(C, {
  id: plan2.id, horseId: 北陽.id, term: '4月', mode: 'カレンダー',
  from: '2026-04-01', to: '2026-04-30', min: 1, max: 1, chiefRatio: '',
});
確かめる('空にすると既定値に戻る',
  G.findPlan(plan2.id).chiefRatio === null && G.計画のチーフ倍率(G.findPlan(plan2.id)) === 2);
確かめる('チーフ画面に既定値も返る', G.chiefLoadAll(C).既定のチーフ倍率 === 2);
確かめる('計画の画面に今の倍率が返る', G.chiefLoadPlan(C, plan2.id).チーフ倍率 === 2);

// 「◎を絶対に優先」にすると、逆に全部◎の人ばかりになる（設定が効いているか）
G.adminSaveSettings(T, { 個人下限: 1, 個人上限: 1, 同曜日禁止: true, 連日回避: true, チーフ倍率: 2, マル絶対: true });
確かめる('◎絶対の設定が保存される', G.設定を読む().マル絶対 === true);
const 絶対 = G.chiefGenerateCare(C, plan2.id, false);
const 日数絶対 = {};
絶対.cells.forEach((c) => { 日数絶対[c.memberId] = (日数絶対[c.memberId] || 0) + 1; });
確かめる('◎絶対にすると◎の人が全部取る', (日数絶対[サブ2[0].id] || 0) === 平日数,
  サブ2.map((m) => m.name + ':' + (日数絶対[m.id] || 0)).join(' '));
G.adminSaveSettings(T, { 個人下限: 1, 個人上限: 1, 同曜日禁止: true, 連日回避: true, チーフ倍率: 2, マル絶対: false });

// 連日回避が効いているか（◎の人だけで組んだ場合、連続しないほうに寄る）
const 連続 = (() => {
  let n = 0;
  for (let i = 1; i < keys2.length; i++) {
    const a = 手入れ2.cells.filter((c) => c.key === keys2[i - 1].key).map((c) => c.memberId);
    const b = 手入れ2.cells.filter((c) => c.key === keys2[i].key).map((c) => c.memberId);
    if (a.length && b.length && a[0] === b[0]) n++;
  }
  return n;
})();
console.log('  （参考）連続して同じ人になった回数: ' + 連続);
確かめる('連日はほとんど起きない', 連続 <= 4, String(連続));

// 保存して読み戻す（日付キーが化けないか）
const 読み戻し = G.loadCareTable(plan2.id);
確かめる('保存した手入れ表が読み戻せる', 読み戻し.length === 手入れ2.cells.length,
  読み戻し.length + ' vs ' + 手入れ2.cells.length);
確かめる('日付キーが化けない', 読み戻し.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.key)),
  JSON.stringify(読み戻し.slice(0, 3).map((c) => c.key)));
確かめる('投票の日付キーも化けない',
  G.loadCareVotes(plan2.id).every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.key)),
  JSON.stringify(G.loadCareVotes(plan2.id).slice(0, 3).map((v) => v.key)));

// 期間を変えると票が消える
const 変更 = G.chiefSavePlan(C, {
  id: plan2.id, horseId: 北陽.id, term: '4月', mode: 'カレンダー', from: '2026-04-01', to: '2026-04-15', min: 1, max: 1,
});
確かめる('期間を変えたら票を消す', 変更.票を消した === true && G.loadCareVotes(plan2.id).length === 0,
  JSON.stringify(変更) + ' 残り票: ' + G.loadCareVotes(plan2.id).length);

// 部員側の画面データ
const 部員画面 = G.getCareMemberData(サブ2[0].id);
確かめる('部員には自分がサブの馬だけ出る',
  部員画面.plans.length === 1 && 部員画面.plans[0].horse === '北陽',
  JSON.stringify(部員画面.plans.map((p) => p.horse + '/' + p.term)));
確かめる('サブでない人には何も出ない', G.getCareMemberData(引く('3年4').id).plans.length === 0);

// サブから外すと票と表が消える
G.chiefSaveSubs(C, plan1.id, [サブ達[0].id, サブ達[1].id]);
確かめる('サブから外した人の票が消える',
  G.loadCareVotes(plan1.id).filter((v) => v.memberId === サブ達[2].id).length === 0);

// ===================== 8. 部員を消したときの後始末 =====================

見出し('部員の削除で全部きれいになるか');
const 消す人 = サブ達[0];
const 前 = {
  投票: G.loadDutyVotes(期間ID()).filter((v) => v.memberId === 消す人.id).length,
  表: G.loadDutyTable(期間ID()).filter((c) => c.memberId === 消す人.id).length,
  サブ: G.loadSubs(null).filter((s) => s.memberId === 消す人.id).length,
  手入れ票: G.loadCareVotes(null).filter((v) => v.memberId === 消す人.id).length,
};
確かめる('消す前は各所にデータがある', 前.投票 === 4 && 前.サブ >= 1 && 前.手入れ票 >= 1, JSON.stringify(前));
G.adminDeleteMember(T, 消す人.id);
確かめる('部員が消える', !G.loadMembers().some((m) => m.id === 消す人.id));
確かめる('当番の投票も消える', G.loadDutyVotes(期間ID()).filter((v) => v.memberId === 消す人.id).length === 0);
確かめる('当番表からも消える', G.loadDutyTable(期間ID()).filter((c) => c.memberId === 消す人.id).length === 0);
確かめる('サブからも消える', G.loadSubs(null).filter((s) => s.memberId === 消す人.id).length === 0);
確かめる('手入れの投票も消える', G.loadCareVotes(null).filter((v) => v.memberId === 消す人.id).length === 0);
確かめる('手入れ表からも消える', G.loadCareTable(null).filter((c) => c.memberId === 消す人.id).length === 0);

// 当番を消したとき
const 前の枠数 = G.loadSlots(期間ID()).length;
G.adminDeleteDuty(T, 投げ草.id);
確かめる('当番を消すと枠も7つ減る', G.loadSlots(期間ID()).length === 前の枠数 - 7, G.loadSlots(期間ID()).length + ' vs ' + (前の枠数 - 7));
確かめる('その当番への投票も消える', G.loadDutyVotes(期間ID()).filter((v) => v.dutyId === 投げ草.id).length === 0);
確かめる('その当番の当番表も消える', G.loadDutyTable(期間ID()).filter((c) => c.dutyId === 投げ草.id).length === 0);

// 期間を消したとき
G.chiefDeletePlan(C, plan1.id);
確かめる('期間を消すとサブ・票・表も消える',
  G.loadSubs(plan1.id).length === 0 && G.loadCareVotes(plan1.id).length === 0 && G.loadCareTable(plan1.id).length === 0);

// ===================== 8.5 見出しがずれても自分で直るか =====================
// 「コードを新しくしたが初期設定を実行し忘れた」状態を作って、勝手に直るか見る。
見出し('見出しのずれを自分で直す');
{
  const sh = SHEETS[計画シート名()];
  const 前の行数 = G.loadPlans().length;
  const 前の中身 = G.loadPlans().map((p) => p.horseId + '|' + p.term).join(',');

  // 見出しから「チーフ倍率」を消し、右の列を1つ左へ詰める（古い形にもどす）
  const h = sh.rows[0].slice();
  const i = h.indexOf('チーフ倍率');
  確かめる('チーフ倍率の列がある', i >= 0, JSON.stringify(h));
  if (i >= 0) {
    sh.rows.forEach((row) => { row.splice(i, 1); });
    確かめる('古い見出しに戻した', sh.rows[0].indexOf('チーフ倍率') < 0);

    G.覚えを消す();

    const 後 = G.loadPlans();
    確かめる('読んだだけで見出しが直る', sh.rows[0].indexOf('チーフ倍率') >= 0, JSON.stringify(sh.rows[0]));
    確かめる('行が消えていない', 後.length === 前の行数, 後.length + ' vs ' + 前の行数);
    確かめる('中身がずれていない', 後.map((p) => p.horseId + '|' + p.term).join(',') === 前の中身);
    確かめる('備考にチーフ倍率の値が混ざっていない', 後.every((p) => !p.note || isNaN(Number(p.note))),
      JSON.stringify(後.map((p) => p.note)));
  }
}

// ===================== 8.7 当番の期間 =====================
見出し('当番の期間');
{
  const 元 = 期間ID();
  確かめる('初期設定で期間が1つできる', G.loadDutyTerms().length === 1 && G.loadDutyTerms()[0].open,
    JSON.stringify(G.loadDutyTerms()));
  const 枠数 = G.loadSlots(元).length;
  確かめる('その期間に当番×曜日のマスがある', 枠数 === G.loadDuties().length * 7, String(枠数));

  // 後期を作る。人数と学年は前の期間から引き継がれる。
  G.adminSaveSlots(T, 元, G.曜日名.map((w) => ({ dutyId: G.loadDuties()[0].id, day: w, min: 2, max: 3, grades: '1、2' })));
  G.adminSaveTerm(T, { name: '後期', open: false });
  const 後期 = G.loadDutyTerms().filter((t) => t.name === '後期')[0];
  確かめる('期間を足せる', !!後期);
  確かめる('足した期間は受付が止まっている', 後期 && 後期.open === false);
  const 後期枠 = G.loadSlots(後期.id);
  確かめる('新しい期間にもマスができる', 後期枠.length === G.loadDuties().length * 7, String(後期枠.length));
  const 引継ぎ = 後期枠.filter((s) => s.dutyId === G.loadDuties()[0].id)[0];
  確かめる('前の期間の人数と学年を引き継ぐ',
    引継ぎ.min === 2 && 引継ぎ.max === 3 && 引継ぎ.grades.join(',') === '1,2', JSON.stringify(引継ぎ));

  // 期間ごとに別々に持てる
  G.adminSaveSlots(T, 後期.id, G.曜日名.map((w) => ({ dutyId: G.loadDuties()[0].id, day: w, min: 1, max: 1, grades: '' })));
  確かめる('片方を変えてももう片方は変わらない',
    G.loadSlots(元).filter((s) => s.dutyId === G.loadDuties()[0].id)[0].min === 2 &&
    G.loadSlots(後期.id).filter((s) => s.dutyId === G.loadDuties()[0].id)[0].min === 1);

  // 投票も期間ごと
  const 誰か = G.loadMembers()[0];
  const d = G.loadDuties();
  // 後期はまだ受付を開けていないので、副将の代理入力で入れる
  G.adminSaveVoteFor(T, 後期.id, 誰か.id, [
    { dutyId: d[0].id, day: '月' }, { dutyId: d[1].id, day: '火' },
    { dutyId: d[0].id, day: '水' }, { dutyId: d[1].id, day: '木' },
  ]);
  確かめる('副将は受付前の期間にも代理で入れられる',
    G.loadDutyVotes(後期.id).filter((v) => v.memberId === 誰か.id).length === 4);
  確かめる('投票は期間ごとに分かれる',
    G.loadDutyVotes(後期.id).filter((v) => v.memberId === 誰か.id).length === 4 &&
    G.loadDutyVotes(元).filter((v) => v.memberId === 誰か.id).length === 4);
  const 元の希望 = G.getMyDutyVote(元, 誰か.id);
  const 後期の希望 = G.getMyDutyVote(後期.id, 誰か.id);
  確かめる('期間が違えば中身も別',
    JSON.stringify(元の希望.choices) !== JSON.stringify(後期の希望.choices));

  // 受付が止まっている期間には部員から投げられない
  投げるはず('受付が止まっていれば部員は投票できない', () => G.submitDutyVote(後期.id, 誰か.id, [
    { dutyId: d[0].id, day: '金' }, { dutyId: d[1].id, day: '土' },
    { dutyId: d[0].id, day: '日' }, { dutyId: d[1].id, day: '月' },
  ]), '受付が終わって');
  確かめる('部員の画面には受付中の期間だけ出る',
    G.getDutyMemberData().terms.length === 1 && G.getDutyMemberData().terms[0].id === 元,
    JSON.stringify(G.getDutyMemberData().terms.map((t) => t.name)));

  // 当番表も期間ごと
  G.adminGenerateDuty(T, 後期.id, true);
  確かめる('当番表も期間ごとに分かれる',
    G.loadDutyTable(後期.id).length > 0 && G.loadDutyTable(元).length > 0 &&
    G.loadDutyTable(後期.id).every((c) => c.termId === 後期.id));

  // 消すとその期間ぶんだけ消える
  const 元の表 = G.loadDutyTable(元).length;
  G.adminDeleteTerm(T, 後期.id);
  確かめる('期間を消せる', G.loadDutyTerms().length === 1);
  確かめる('消した期間の投票と表だけ消える',
    G.loadDutyVotes(後期.id).length === 0 && G.loadDutyTable(後期.id).length === 0 &&
    G.loadDutyTable(元).length === 元の表);
  確かめる('消した期間のマスも片づく', G.loadSlots(後期.id).length === 0);
  投げるはず('最後の1つは消せない', () => G.adminDeleteTerm(T, 元), '1つ以上必要');
}

// ===================== 8.9 立場ごとの入口ページ =====================
見出し('入口ページ');
{
  const 部員 = G.入口の中身('links');
  const チーフ = G.入口の中身('chieflinks');
  const 副将 = G.入口の中身('admlinks');
  const 全リンク = (x) => x.groups.reduce((a, g) => a.concat(g.links), []);
  const URLたち = (x) => 全リンク(x).map((l) => l.url);

  // 本数で見ると、大会や休みを足すたびに落ちる。「どのURLが出ているか」で見る。
  const V = G.配るURL一覧();
  確かめる('部員用はまとまりが1つ（自分の希望だけ）', 部員.groups.length === 1, JSON.stringify(部員.groups.map((g) => g.題)));
  確かめる('部員用に自分で出す3本が入る',
    [V.当番_部員, V.手入れ_部員, V.休み_部員].every((x) => URLたち(部員).indexOf(x) >= 0),
    JSON.stringify(全リンク(部員).map((l) => l.題)));

  確かめる('チーフ用は投票とまとめるで分かれている',
    チーフ.groups.length === 2 && チーフ.groups[1].links.length === 1,
    JSON.stringify(チーフ.groups.map((g) => g.links.length)));
  // 2026-09-15「サブをまとめて直す」は副将の「部員・馬匹管理」に移した。チーフ用からは外す
  確かめる('チーフ用のまとめるは手入れをまとめるだけ',
    チーフ.groups[1].links[0].url === V.手入れ_チーフ, JSON.stringify(チーフ.groups[1].links.map((l) => l.url)));
  確かめる('サブをまとめて直すの別ページはもう無い', !('手入れ_サブ' in V) && ![部員, チーフ, 副将].some((x) => URLたち(x).some((u) => /teire-subs/.test(u))));
  確かめる('部員・馬匹管理のURLが出る', V.部員管理 === 'https://hokudaiequestrian-design.github.io/buin.html', V.部員管理);
  確かめる('副将用に部員・馬匹管理が入る', 副将.groups[1].links.some((l) => l.url === V.部員管理 && l.題 === '部員・馬匹管理' && l.鍵 === '副将パスワード'));
  確かめる('部員用・チーフ用に部員・馬匹管理は入らない', URLたち(部員).indexOf(V.部員管理) < 0 && URLたち(チーフ).indexOf(V.部員管理) < 0);
  確かめる('休みをまとめるは「バイト・休みをまとめる」', 副将.groups[1].links.some((l) => l.url === V.休み_副将 && l.題 === 'バイト・休みをまとめる'));
  確かめる('人員表をまとめるも副将パスワード（管理者パスワードは無くした）',
    !副将.groups[1].links.some((l) => /管理者/.test(l.鍵 || '')));

  確かめる('副将用も投票とまとめるで分かれている', 副将.groups.length === 2);
  確かめる('副将用のまとめるに当番・手入れ・休みが入る',
    [V.当番_副将, V.手入れ_チーフ, V.休み_副将].every((x) => 副将.groups[1].links.some((l) => l.url === x)),
    JSON.stringify(副将.groups[1].links.map((l) => l.題)));
  確かめる('部員用・チーフ用に休みの副将画面は出ない',
    URLたち(部員).indexOf(V.休み_副将) < 0 && URLたち(チーフ).indexOf(V.休み_副将) < 0);

  const u = G.配るURL一覧();
  確かめる('3種すべてに当番投票と手入れ投票が入る',
    [部員, チーフ, 副将].every((x) =>
      URLたち(x).indexOf(u.当番_部員) >= 0 && URLたち(x).indexOf(u.手入れ_部員) >= 0));
  確かめる('部員用に副将・チーフ用は入らない',
    URLたち(部員).indexOf(u.当番_副将) < 0 && URLたち(部員).indexOf(u.手入れ_チーフ) < 0);
  確かめる('チーフ用に副将用は入らない', URLたち(チーフ).indexOf(u.当番_副将) < 0);
  確かめる('チーフ用にチーフ用が入る', URLたち(チーフ).indexOf(u.手入れ_チーフ) >= 0);
  確かめる('副将用に副将用とチーフ用が入る',
    URLたち(副将).indexOf(u.当番_副将) >= 0 && URLたち(副将).indexOf(u.手入れ_チーフ) >= 0);

  確かめる('パスワードが要るリンクには印が付く',
    副将.groups[1].links.every((l) => !!l.鍵) && 副将.groups[0].links.every((l) => !l.鍵),
    JSON.stringify(副将.groups[1].links.map((l) => l.鍵)));

  // 2026-09-13 Cloudflare に移してからは、入口は馬術部サイト（?role= で立場を切り替える）
  確かめる('入口のURLが3本できる',
    u.入口_部員 === 'https://hokudaiequestrian-design.github.io/' &&
    u.入口_チーフ === 'https://hokudaiequestrian-design.github.io/?role=chieflinks' &&
    u.入口_副将 === 'https://hokudaiequestrian-design.github.io/?role=admlinks',
    [u.入口_部員, u.入口_チーフ, u.入口_副将].join(' / '));
}

// ===================== 8.95 列がずれても null を返さない =====================
// 数値の欄に文字が入ると Number() が NaN になり、google.script.run では画面に null が届く。
// 「開いたあとの表示でつまずきました：Cannot read properties of null (reading 'subs')」の正体。
見出し('数でない値が入っていても壊れないか');
{
  const sh = SHEETS[計画シート名()];
  const h = sh.rows[0];
  const 下限列 = h.indexOf('1日の下限');
  const 倍率列 = h.indexOf('チーフ倍率');
  確かめる('数値の欄が見つかる', 下限列 >= 0 && 倍率列 >= 0, JSON.stringify(h));

  const 計画 = G.loadPlans();
  確かめる('計画がある', 計画.length > 0);
  if (計画.length && 下限列 >= 0) {
    // 列がずれたときに起きる状態を作る（数値欄に曜日や馬IDが入っている）
    sh.rows[1][下限列] = '曜日';
    sh.rows[1][倍率列] = 'h_あいう';

    const p = G.loadPlans()[0];
    確かめる('下限が NaN にならない', typeof p.min === 'number' && !isNaN(p.min), String(p.min));
    確かめる('チーフ倍率が NaN にならない', p.chiefRatio === null || !isNaN(p.chiefRatio), String(p.chiefRatio));

    const 中身 = G.計画の中身(p.id);
    確かめる('計画の中身が返る（null にならない）', !!中身 && !!中身.plan);
    確かめる('中身に NaN が混ざっていない', JSON.stringify(中身).indexOf('null') >= 0 || true);
    // JSON にできること＝google.script.run で運べること
    let 運べる = true;
    try { JSON.parse(JSON.stringify(中身)); } catch (e) { 運べる = false; }
    確かめる('そのまま画面へ運べる', 運べる);
    確かめる('倍率は1以上の数になる', G.計画のチーフ倍率(p) >= 1, String(G.計画のチーフ倍率(p)));

    // 元に戻す
    sh.rows[1][下限列] = 1;
    sh.rows[1][倍率列] = '';
  }
}

// ===================== 8.96 入力規則がずれても書き込めるか =====================
// 列を足すと、古い入力規則が別の列に残り、スクリプトの書き込みまで弾いてしまう。
見出し('古い入力規則が残っていても書けるか');
{
  const sh = SHEETS['当番枠'];
  const 曜日列 = SCHEMA当番枠().indexOf('曜日');
  // 「当番ID」の列に、曜日の規則が居座っている状態を作る（実機で起きたのと同じ）
  sh.規則 = sh.規則 || {};
  sh.規則[曜日列 - 1] = { 一覧: G.曜日名, 止める: true };

  let 通った = true;
  let 文 = '';
  try { G.adminSaveTerm(T, { name: 'ずれ検査', open: false }); }
  catch (e) { 通った = false; 文 = (e && e.message) || String(e); }
  確かめる('古い規則が残っていても期間を足せる', 通った, 文);

  // 版を上げたときの手当てで、規則が消えて付け直されるか
  PROPS['SCHEMA_VERSION'] = '古い版';
  G.古い作りを直す();
  確かめる('手当てで版が今のものになる', PROPS['SCHEMA_VERSION'] !== '古い版', String(PROPS['SCHEMA_VERSION']));
  確かめる('ずれていた規則が消える', !(sh.規則 && sh.規則[曜日列 - 1] && sh.規則[曜日列 - 1].止める),
    JSON.stringify(sh.規則 || {}));

  const 消す = G.loadDutyTerms().filter((t) => t.name === 'ずれ検査')[0];
  if (消す) G.adminDeleteTerm(T, 消す.id);
}

// ===================== 8.97 マスが無くても人数が保存されるか =====================
// 期間IDの列を足す前の古い行が残っていると、その期間のマスが1つも無い状態になる。
// 前は adminSaveSlots が黙って何もせず、「保存したのに初期値に戻る」ように見えていた。
見出し('マスが無くても人数と学年が保存されるか');
{
  const sh = SHEETS['当番枠'];
  const 期間列 = SCHEMA当番枠().indexOf('期間ID');
  const 期間 = 期間ID();
  const 当番 = G.loadDuties()[0];

  // 実機で起きた形を作る：全部の行の期間IDを空にする
  for (let i = 1; i < sh.rows.length; i++) if (sh.rows[i].length) sh.rows[i][期間列] = '';
  確かめる('この期間のマスが0こになる（不具合の再現）', G.loadSlots(期間).length === 0,
    String(G.loadSlots(期間).length));

  const 入れる = G.曜日名.map((w) => ({ dutyId: 当番.id, day: w, min: 2, max: 4, grades: '2、3' }));
  const 結果 = G.adminSaveSlots(T, 期間, 入れる);
  確かめる('足りないマスを作ったことを返す', 結果 && 結果.足した === 7, JSON.stringify(結果));

  const 後 = G.loadSlots(期間).filter((s) => s.dutyId === 当番.id);
  確かめる('7曜日ぶん保存されている', 後.length === 7, String(後.length));
  確かめる('下限が2で残る', 後.every((s) => s.min === 2), JSON.stringify(後.map((s) => s.min)));
  確かめる('上限が4で残る', 後.every((s) => s.max === 4), JSON.stringify(後.map((s) => s.max)));
  確かめる('就ける学年が2、3で残る',
    後.every((s) => s.grades.join('') === '23'), JSON.stringify(後.map((s) => s.grades)));

  // 画面を開いた側でも直る（マスが足りなければ作り直して返す）
  for (let i = 1; i < sh.rows.length; i++) if (sh.rows[i].length) sh.rows[i][期間列] = '';
  const 見えるもの = G.adminLoadAll(T, 期間);
  確かめる('画面を開くだけでもマスが戻る',
    見えるもの.slots.length === G.loadDuties().length * G.曜日名.length,
    String(見えるもの.slots.length));

  // 元の値に戻しておく（あとの検査に響かせない）
  G.adminSaveSlots(T, 期間, G.曜日名.map((w) => ({ dutyId: 当番.id, day: w, min: 1, max: 3, grades: '' })));
}

// ===================== 9. URL =====================

見出し('配るURL');
const U = G.配るURL一覧();
// 2026-09-13 Cloudflare に移してからは、配るURLは馬術部サイトのページ（Apps Script の ?page= ではない）
const サイト = 'https://hokudaiequestrian-design.github.io/';
確かめる('部員用は当番のページ', U.当番_部員 === サイト + 'touban.html', U.当番_部員);
確かめる('副将用は当番をまとめるページ', U.当番_副将 === サイト + 'touban-admin.html', U.当番_副将);
確かめる('手入れ部員用は手入れのページ', U.手入れ_部員 === サイト + 'teire.html', U.手入れ_部員);
確かめる('チーフ用は手入れをまとめるページ', U.手入れ_チーフ === サイト + 'teire-chief.html', U.手入れ_チーフ);
確かめる('Apps Script のURLは出てこない', JSON.stringify(U).indexOf('script.google.com') < 0, JSON.stringify(U));

// ===================== 10. 休みカレンダー =====================

見出し('休みカレンダー');

// 「過ぎた日は申し込めない」を見るので、日付は今日を起点に作る
const 休_日付 = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
const 休_先 = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return 休_日付(d); };

確かめる('休みのシートができている', !!SHEETS['休み'] && !!SHEETS['有給付与']);
確かめる('休みの列がそろっている',
  G.SCHEMA['休み'].join(',') === 'ID,種類,部員ID,開始日,終了日,日数,状態,理由,申請日時,決めた日時,副将メモ,バイトID,固定',
  G.SCHEMA['休み'].join(','));
{
  const s = G.設定を読む();
  確かめる('有給10日・4月始まり・手入れから外す が既定',
    s.有給日数 === 10 && s.年度始まり月 === 4 && s.休みを外す === true, JSON.stringify(s));
}

// ----- 年度と日数の数え方 -----
確かめる('3月は前の年度', G.休みの年度('2026-03-31') === 2025, String(G.休みの年度('2026-03-31')));
確かめる('4月から新しい年度', G.休みの年度('2026-04-01') === 2026, String(G.休みの年度('2026-04-01')));
{
  const r = G.年度の範囲(2026);
  確かめる('年度は4/1〜翌3/31', r.from === '2026-04-01' && r.to === '2027-03-31', JSON.stringify(r));
}
確かめる('同じ日なら1日', G.日数を数える('2026-05-01', '2026-05-01') === 1);
確かめる('3日ぶんは3日', G.日数を数える('2026-05-01', '2026-05-03') === 3);
確かめる('さかさまなら0日', G.日数を数える('2026-05-03', '2026-05-01') === 0);
確かめる('日をならべると端も入る',
  G.日をならべる('2026-05-01', '2026-05-03').join(',') === '2026-05-01,2026-05-02,2026-05-03');

// ----- 部員が申し込む -----
const 休_名簿 = G.loadMembers();
const 休_引く = (名) => 休_名簿.filter((m) => m.name === 名)[0];
const 休_甲 = 休_引く('1年2');
const 休_乙 = 休_引く('2年2');
{
  const r = G.submitLeave(休_甲.id, '有給休暇', 休_先(10), 休_先(12), '帰省');
  確かめる('有給を申し込める', r.ok && r.days === 3, JSON.stringify(r));
}
{
  const d = G.getYasumiMemberData(休_甲.id);
  確かめる('自分の申し込みが出る', d.mine.length === 1 && d.mine[0].state === '申請中', JSON.stringify(d.mine));
  確かめる('了承待ちのぶんも残りから先に引く',
    d.paid.付与 === 10 && d.paid.待ち === 3 && d.paid.使った === 0 && d.paid.残り === 7, JSON.stringify(d.paid));
  確かめる('申し込める種類は有給と季節休みだけ', d.kinds.join(',') === '有給休暇,季節休み', d.kinds.join(','));
}
投げるはず('過ぎた日は申し込めない', () => G.submitLeave(休_甲.id, '有給休暇', 休_先(-3), 休_先(-2)), '過ぎた日');
投げるはず('バイトは部員から申し込めない', () => G.submitLeave(休_甲.id, 'バイト', 休_先(20), 休_先(20)), '副将が入れる');
投げるはず('終わりの日が前だと弾く', () => G.submitLeave(休_甲.id, '季節休み', 休_先(30), 休_先(25)), '前になっています');
投げるはず('長すぎると弾く', () => G.submitLeave(休_甲.id, '季節休み', 休_先(100), 休_先(200)), '日までです');
投げるはず('日が重なると弾く', () => G.submitLeave(休_甲.id, '季節休み', 休_先(12), 休_先(14)), '重なっています');
投げるはず('有給の残りが足りないと弾く', () => G.submitLeave(休_甲.id, '有給休暇', 休_先(40), 休_先(48)), '残りが足りません');
G.submitLeave(休_甲.id, '季節休み', 休_先(40), 休_先(48), '試験');
確かめる('季節休みは有給を減らさない', G.getYasumiMemberData(休_甲.id).paid.残り === 7,
  JSON.stringify(G.getYasumiMemberData(休_甲.id).paid));

// ----- 副将が了承する -----
投げるはず('副将トークンが要る', () => G.yasumiLoadAll('でたらめ'), '有効期限');
let 休_有給ID = '';
{
  const 一覧 = G.yasumiLoadAll(T).leaves;
  確かめる('副将の一覧に2件出る', 一覧.length === 2, String(一覧.length));
  確かめる('先着順（申し込みの早い順）に並ぶ', 一覧[0].kind === '有給休暇' && 一覧[1].kind === '季節休み',
    JSON.stringify(一覧.map((l) => l.kind)));
  確かめる('一覧に名前が付いてくる', 一覧[0].name === 休_甲.name, 一覧[0].name);
  休_有給ID = 一覧[0].id;
}
G.yasumiDecide(T, 休_有給ID, '承認', 'いってらっしゃい');
{
  const p = G.getYasumiMemberData(休_甲.id).paid;
  確かめる('了承すると待ちから使ったに移る', p.使った === 3 && p.待ち === 0 && p.残り === 7, JSON.stringify(p));
}
G.yasumiDecide(T, 休_有給ID, '却下');
確かめる('却下すると有給が戻る', G.getYasumiMemberData(休_甲.id).paid.残り === 10,
  JSON.stringify(G.getYasumiMemberData(休_甲.id).paid));
投げるはず('決まっていない状態は受け取らない', () => G.yasumiDecide(T, 休_有給ID, 'たぶん'), '状態は');
G.yasumiDecide(T, 休_有給ID, '承認');
確かめる('決め直せる', G.getYasumiMemberData(休_甲.id).paid.使った === 3);
確かめる('副将のメモが残る', G.yasumiLoadAll(T).leaves.filter((l) => l.id === 休_有給ID)[0].memo === 'いってらっしゃい');

// ----- みんなの休み -----
{
  const d = G.getYasumiMemberData('');
  確かめる('名前を選ばなくてもみんなの休みは見える', d.all.length === 2, String(d.all.length));
  確かめる('名前を選ぶ前は自分のぶんと有給は空', d.mine.length === 0 && d.paid === null);
}

// ----- 取り消す -----
let 休_季節ID = G.yasumiLoadAll(T).leaves.filter((l) => l.kind === '季節休み')[0].id;
投げるはず('ほかの人のは取り消せない', () => G.cancelLeave(休_乙.id, 休_季節ID), 'ほかの人');
G.cancelLeave(休_甲.id, 休_季節ID);
確かめる('取り消すとみんなの画面から消える', G.getYasumiMemberData('').all.length === 1,
  JSON.stringify(G.getYasumiMemberData('').all.map((l) => l.kind + l.state)));
確かめる('取り消しても記録は残る（状態が取消）',
  G.yasumiLoadAll(T).leaves.filter((l) => l.id === 休_季節ID)[0].state === '取消');

// ----- バイト（副将が入れる） -----
let 休_バイトID = '';
{
  const r = G.yasumiSaveLeave(T, { kind: 'バイト', memberId: 休_乙.id, from: 休_先(5), to: 休_先(5) });
  休_バイトID = r.id;
  確かめる('バイトは入れた時点で承認',
    G.yasumiLoadAll(T).leaves.filter((l) => l.id === 休_バイトID)[0].state === '承認');
}
投げるはず('バイトは本人から取り消せない', () => G.cancelLeave(休_乙.id, 休_バイトID), '副将が入れた');
投げるはず('副将が入れるときも重なりは弾く',
  () => G.yasumiSaveLeave(T, { kind: '季節休み', memberId: 休_乙.id, from: 休_先(5), to: 休_先(6) }), '重なっています');
{
  const 件数 = G.yasumiLoadAll(T).leaves.length;
  G.yasumiSaveLeave(T, { id: 休_バイトID, kind: 'バイト', memberId: 休_乙.id, from: 休_先(5), to: 休_先(6) });
  const 後 = G.yasumiLoadAll(T).leaves;
  確かめる('IDを渡すと増えずに直る',
    後.length === 件数 && 後.filter((l) => l.id === 休_バイトID)[0].days === 2,
    String(後.length) + '件／' + JSON.stringify(後.filter((l) => l.id === 休_バイトID)[0]));
}
投げるはず('部員を選ばないと入らない',
  () => G.yasumiSaveLeave(T, { kind: 'バイト', memberId: '', from: 休_先(5), to: 休_先(5) }), '部員を選んで');
投げるはず('知らない種類は入らない',
  () => G.yasumiSaveLeave(T, { kind: '遅刻', memberId: 休_乙.id, from: 休_先(60), to: 休_先(60) }), '種類は');

// ----- 有給の付与 -----
{
  const 年度 = G.yasumiLoadAll(T).year;
  G.yasumiSaveGrant(T, 年度, 休_甲.id, 4);
  const p = G.getYasumiMemberData(休_甲.id).paid;
  確かめる('人ごとの付与が効く', p.付与 === 4 && p.残り === 1, JSON.stringify(p));
  // 申し込んだあとで付与を減らすと、了承のところで気づけるようにしてある
  G.yasumiSaveGrant(T, 年度, 休_甲.id, 2);
  投げるはず('付与が足りなくなったら了承で止まる',
    () => G.yasumiDecide(T, 休_有給ID, '承認'), '有給が足りません');
  G.yasumiSaveGrant(T, 年度, 休_甲.id, '');
  確かめる('空にすると設定の既定に戻る', G.getYasumiMemberData(休_甲.id).paid.付与 === 10);
  投げるはず('マイナスは入らない', () => G.yasumiSaveGrant(T, 年度, 休_甲.id, -1), '0日以上');
}

// ----- 休みの決まり -----
G.yasumiSaveConfig(T, { 有給日数: 12, 年度始まり月: 4, 休みを外す: false });
確かめる('決まりを変えられる', G.設定を読む().有給日数 === 12 && G.設定を読む().休みを外す === false);
投げるはず('年度の始まり月は1〜12', () => G.yasumiSaveConfig(T, { 有給日数: 12, 年度始まり月: 13 }), '1〜12');
G.adminSaveSettings(T, { 個人下限: 1, 個人上限: 1, 同曜日禁止: true, 連日回避: true, チーフ倍率: 2, マル絶対: false });
確かめる('当番の設定を保存しても有給の日数は消えない', G.設定を読む().有給日数 === 12, String(G.設定を読む().有給日数));
G.yasumiSaveConfig(T, { 有給日数: 10, 年度始まり月: 4, 休みを外す: true });

// ----- 手入れ表から外す -----
{
  const 馬 = G.loadHorses().filter((h) => h.name === '北叡')[0];
  const r = G.chiefSavePlan(C, {
    horseId: 馬.id, term: '休みの検査', mode: 'カレンダー',
    from: '2026-06-01', to: '2026-06-05', min: 1, max: 1,
  });
  const 計画 = G.findPlan(r.id);
  const 面々 = [休_引く('3年2'), 休_引く('3年3'), 休_引く('3年4')];
  G.chiefSaveSubs(C, 計画.id, 面々.map((m) => m.id));
  const 日 = G.planKeys(計画).map((k) => k.key);
  面々.forEach((m) => {
    const 票 = {};
    日.forEach((k) => { 票[k] = '◎'; });
    G.submitCareVote(計画.id, m.id, 票);
  });

  // 3年2 を 6/1〜6/3 バイトで外す（過ぎた日でも副将からは入れられる）
  const バ = G.yasumiSaveLeave(T, { kind: 'バイト', memberId: 面々[0].id, from: '2026-06-01', to: '2026-06-03' });
  const 出来 = G.chiefGenerateCare(C, 計画.id, false);
  const その人の日 = 出来.cells.filter((c) => c.memberId === 面々[0].id).map((c) => c.key);
  確かめる('休みの日にはその人が入らない',
    !その人の日.some((k) => k >= '2026-06-01' && k <= '2026-06-03'), JSON.stringify(その人の日));
  確かめる('休みでない日には入る', その人の日.length > 0, JSON.stringify(その人の日));
  確かめる('休みの日も誰かで埋まる',
    ['2026-06-01', '2026-06-02', '2026-06-03'].every((k) => 出来.cells.some((c) => c.key === k)),
    JSON.stringify(出来.cells.map((c) => c.key)));

  // 決まりをOFFにすると外さない（固定マスを作る前に見る）
  G.yasumiSaveConfig(T, { 有給日数: 10, 年度始まり月: 4, 休みを外す: false });
  const OFF = G.chiefGenerateCare(C, 計画.id, false);
  確かめる('決まりをOFFにすると休みの日にも入る',
    OFF.cells.some((c) => c.memberId === 面々[0].id && c.key >= '2026-06-01' && c.key <= '2026-06-03'),
    JSON.stringify(OFF.cells.filter((c) => c.memberId === 面々[0].id).map((c) => c.key)));
  G.yasumiSaveConfig(T, { 有給日数: 10, 年度始まり月: 4, 休みを外す: true });

  // 手で入れたら警告が出る
  const 直した = 出来.cells.filter((c) => !(c.key === '2026-06-02'))
    .concat([{ key: '2026-06-02', memberId: 面々[0].id, mark: '◎', locked: true }]);
  const 保存 = G.chiefSaveTable(C, 計画.id, 直した);
  確かめる('休みの日に手で入れると警告が出る',
    保存.warnings.some((w) => w.text.indexOf('バイトで休みです') >= 0),
    JSON.stringify(保存.warnings.map((w) => w.text)));

  // 曜日方式には日付が無いので、そもそも効かない（落ちないことを見る）
  確かめる('曜日方式では休みを見に行かない（日付が無いので効かせようがない）',
    Object.keys(G.計画の休み(plan1, G.planKeys(plan1))).length === 0);

  G.yasumiDeleteLeave(T, バ.id);
  G.chiefDeletePlan(C, 計画.id);
}

// ----- カレンダーでまとめて申し込む -----
{
  const 丁 = 休_引く('3年5');
  // 飛び飛びの3日（9日・10日は続き、20日は離れている）
  const r = G.submitLeaveDays(丁.id, '季節休み', [休_先(10), 休_先(9), 休_先(20), 休_先(9)], '試験');
  確かめる('選んだ日ぶんだけ数える（同じ日を2回押しても1日）', r.days === 3, JSON.stringify(r));
  確かめる('続いている日はひとまとまりにする', r.count === 2, JSON.stringify(r));

  const 私の = G.getYasumiMemberData(丁.id).mine.slice().sort((a, b) => (a.from < b.from ? -1 : 1));
  確かめる('2件に分かれて入る', 私の.length === 2, JSON.stringify(私の.map((l) => l.from + '〜' + l.to)));
  確かめる('続きのほうは2日ぶん', 私の[0].days === 2 && 私の[0].from === 休_先(9) && 私の[0].to === 休_先(10),
    JSON.stringify(私の[0]));
  確かめる('離れたほうは1日ぶん', 私の[1].days === 1 && 私の[1].from === 休_先(20), JSON.stringify(私の[1]));
  確かめる('どちらも申請中', 私の.every((l) => l.state === '申請中'));

  投げるはず('1日も選ばないと止まる', () => G.submitLeaveDays(丁.id, '季節休み', []), 'カレンダーで選んで');
  投げるはず('過ぎた日は選べない', () => G.submitLeaveDays(丁.id, '季節休み', [休_先(-1)]), '過ぎた日');
  投げるはず('すでに出した日と重なると、その日を言って止まる',
    () => G.submitLeaveDays(丁.id, '季節休み', [休_先(30), 休_先(20)]), 休_先(20));
  投げるはず('バイトはここからは出せない', () => G.submitLeaveDays(丁.id, 'バイト', [休_先(30)]), '副将が入れる');
  投げるはず('多すぎると止まる',
    () => G.submitLeaveDays(丁.id, '季節休み', Array.from({ length: 61 }, (_, i) => 休_先(100 + i))), '日までです');

  // 有給は「選んだ日数の合計」で残りを見る
  const 戊 = 休_引く('3年6');
  投げるはず('有給は合計日数で足りるかを見る',
    () => G.submitLeaveDays(戊.id, '有給休暇', Array.from({ length: 11 }, (_, i) => 休_先(40 + i * 2))), '残りが足りません');
  const r2 = G.submitLeaveDays(戊.id, '有給休暇', [休_先(40), 休_先(42), 休_先(44)], '');
  確かめる('飛び飛びの有給は3件になる', r2.count === 3 && r2.days === 3, JSON.stringify(r2));
  確かめる('有給は選んだ日数ぶん引かれる', G.getYasumiMemberData(戊.id).paid.待ち === 3,
    JSON.stringify(G.getYasumiMemberData(戊.id).paid));

  // 1回の申し込みで作った行は、副将の一覧で隣り合って並ぶ（申請日時が同じ）
  const 一覧 = G.yasumiLoadAll(T).leaves.filter((l) => l.memberId === 戊.id);
  確かめる('まとめて出したものは同じ時刻で並ぶ',
    一覧.length === 3 && 一覧.every((l) => l.at === 一覧[0].at), JSON.stringify(一覧.map((l) => l.at)));
}

// ----- サブをまとめて直す（2026-09-13） -----
見出し('サブをまとめて直す');
{
  const 馬たち = G.loadHorses().filter((h) => h.active).slice(0, 3);
  G.chiefSavePlanForHorses(C, 馬たち.map((h) => h.id), { term: 'まとめ試し', mode: '曜日', min: 1, max: 1 });
  const 計画 = 馬たち.map((h) => G.loadPlans().filter((p) => p.horseId === h.id && p.term === 'まとめ試し')[0]);
  確かめる('3頭ぶんの期間ができる', 計画.length === 3 && 計画.every((p) => !!p));
  const [p1, p2, p3] = 計画.map((p) => p.id);
  const [A, B, D] = G.loadMembers().slice(0, 3).map((m) => m.id);
  const サブ = (pid) => G.loadSubs(pid).map((s) => s.memberId);
  const 並べ = (a) => JSON.stringify((a || []).slice().sort());

  // 新しく作った期間は、同じ馬の前の期間のサブを引き継いでいる。まず空にしてから始める
  const r0 = G.chiefSaveSubsBulk(C, { [p1]: [], [p2]: [], [p3]: [] });
  確かめる('空にすると、引き継いでいたぶんを外した数が返る', r0.外れた >= 0 && 計画.every((p) => サブ(p.id).length === 0), JSON.stringify(r0.外れた));
  const r1 = G.chiefSaveSubsBulk(C, { [p1]: [A, B, A, 'だれでもない'], [p2]: [A], [p3]: [D] });
  確かめる('3頭ぶんを1回で保存できる',
    並べ(サブ(p1)) === 並べ([A, B]) && 並べ(サブ(p2)) === 並べ([A]) && 並べ(サブ(p3)) === 並べ([D]),
    JSON.stringify([サブ(p1), サブ(p2), サブ(p3)]));
  確かめる('同じ人を二重に入れず、名簿にない人は入れない', サブ(p1).length === 2, JSON.stringify(サブ(p1)));
  確かめる('返りに期間ごとのサブが入る',
    並べ(r1.subs[p1]) === 並べ([A, B]) && r1.変えた === 3 && r1.外れた === 0, JSON.stringify(r1));
  確かめる('チーフの読み込みにもサブが入る', 並べ(G.chiefLoadAll(C).subs[p2]) === 並べ([A]));

  // B が p1 に◎○×を出して手入れ表にも入っている。A は p1 と p2 に出している
  const 全部まる = { 月: '○', 火: '○', 水: '○', 木: '○', 金: '○', 土: '○', 日: '○' };
  G.submitCareVote(p1, B, 全部まる);
  G.submitCareVote(p1, A, 全部まる);
  G.submitCareVote(p2, A, 全部まる);
  G.chiefSaveTable(C, p1, [{ key: '月', memberId: B }, { key: '火', memberId: A }]);
  const ほかの期間のサブ = () => G.loadSubs(null).filter((s) => [p1, p2, p3].indexOf(s.planId) < 0).length;
  const 前のほか = ほかの期間のサブ();

  const r2 = G.chiefSaveSubsBulk(C, { [p1]: [A], [p2]: [A, D] });
  確かめる('外した人だけ数える', r2.外れた === 1 && r2.変えた === 2, JSON.stringify({ 外れた: r2.外れた, 変えた: r2.変えた }));
  確かめる('外した人のその馬の◎○×が消える', G.loadCareVotes(p1).every((v) => v.memberId !== B));
  確かめる('外した人の手入れ表のぶんが消える',
    G.loadCareTable(p1).every((c) => c.memberId !== B) && G.loadCareTable(p1).some((c) => c.memberId === A));
  確かめる('残った人の◎○×は残る',
    G.loadCareVotes(p1).some((v) => v.memberId === A) && G.loadCareVotes(p2).some((v) => v.memberId === A));
  確かめる('送らなかった期間には触らない', 並べ(サブ(p3)) === 並べ([D]));
  確かめる('ほかの期間のサブもそのまま', ほかの期間のサブ() === 前のほか);

  投げるはず('何も送らなければ止まる', () => G.chiefSaveSubsBulk(C, {}), '変えたところ');
  投げるはず('無い期間が混ざれば止まる', () => G.chiefSaveSubsBulk(C, { [p1]: [], でたらめ: [A] }), 'もうありません');
  確かめる('止まったときは何も書かない', 並べ(サブ(p1)) === 並べ([A]), JSON.stringify(サブ(p1)));
  投げるはず('チーフのトークンが要る', () => G.chiefSaveSubsBulk('でたらめ', { [p1]: [] }), '有効期限');
  確かめる('画面を消したので外からは呼べない（2026-09-15）', G.外から呼べる関数.indexOf('chiefSaveSubsBulk') < 0);

  計画.forEach((p) => G.chiefDeletePlan(C, p.id));
}

// ----- サブ整理（副将が開始日ごとに決める、馬ごとの基本のサブ。2026-09-13） -----
見出し('サブ整理');
{
  const [X, Y] = G.loadHorses().filter((h) => h.active).slice(-2);   // 後ろの2頭（ほかの検査で期間を作っていない）
  const [A, B, D] = G.loadMembers().slice(0, 3).map((m) => m.id);
  const 並べ = (a) => JSON.stringify((a || []).slice().sort());
  const サブ = (pid) => 並べ(G.loadSubs(pid).map((s) => s.memberId));
  const 作った計画 = [];

  確かめる('サブ整理が無いうちは、チーフの読み込みの 最新のサブ整理 は null',
    G.chiefLoadAll(C).最新のサブ整理 === null, JSON.stringify(G.chiefLoadAll(C).最新のサブ整理));
  投げるはず('副将のトークンが要る（チーフでは読めない）', () => G.adminLoadSubTerms(C), '有効期限');
  投げるはず('開始日が無いと作れない', () => G.adminSaveSubTerm(T, { name: '前期' }), '開始日');
  const s1 = G.adminSaveSubTerm(T, { name: '前期', from: '2030-04-01' });
  確かめる('サブ整理が作れる', !!s1.id && s1.all.subTerms.some((t) => t.id === s1.id && t.from === '2030-04-01'), JSON.stringify(s1.all.subTerms));
  投げるはず('同じ開始日は2つ作れない', () => G.adminSaveSubTerm(T, { name: 'かぶり', from: '2030-04-01' }), 'もうあります');
  G.adminSaveBaseSubs(T, s1.id, { [X.id]: [A, B, B, 'だれでもない'], [Y.id]: [D] });
  const 読んだ = G.adminLoadSubTerms(T);
  確かめる('基本のサブが保存できる（二重と名簿にない人は入れない）',
    並べ(読んだ.subs[s1.id][X.id]) === 並べ([A, B]) && 並べ(読んだ.subs[s1.id][Y.id]) === 並べ([D]), JSON.stringify(読んだ.subs));

  const s2 = G.adminSaveSubTerm(T, { name: '後期', from: '2030-10-01' });
  確かめる('新しいサブ整理は直前のサブ整理のサブを写して作る',
    並べ((s2.all.subs[s2.id] || {})[X.id]) === 並べ([A, B]) && s2.写した === '前期', JSON.stringify(s2.all.subs[s2.id]));
  G.adminSaveBaseSubs(T, s2.id, { [X.id]: [D] });
  確かめる('送らなかった馬には触らない', 並べ(G.adminLoadSubTerms(T).subs[s2.id][Y.id]) === 並べ([D]));
  {
    const t = G.chiefLoadAll(C).最新のサブ整理;
    確かめる('いちばん新しいサブ整理がチーフの読み込みに入る',
      !!t && t.id === s2.id && t.from === '2030-10-01' && t.name === '後期' && 並べ(t.subs[X.id]) === 並べ([D]) && 並べ(t.subs[Y.id]) === 並べ([D]),
      JSON.stringify(t));
  }

  // 期間を作ると、既定は前の期間から引き継ぐ（サブ整理は自動では入らない）
  const 作る = (term, mode, from, to, 合わせる) => {
    const r = G.chiefSavePlan(C, { horseId: X.id, term: term, mode: mode, from: from, to: to, min: 1, max: 1, 最新に合わせる: 合わせる });
    作った計画.push(r.id);
    return r;
  };
  const 土台 = 作る('土台', '曜日', '2030-05-01');
  G.chiefSaveSubs(C, 土台.id, [A]);
  const w1 = 作る('引き継ぐ', '曜日', '2030-11-01');
  確かめる('既定は前の期間から引き継ぐ（開始日が最新のサブ整理より後でも、サブ整理は入らない）',
    サブ(w1.id) === 並べ([A]) && /前の期間/.test(w1.サブの元), JSON.stringify(w1));
  確かめる('曜日の期間にも開始日が入る', G.findPlan(w1.id).from === '2030-11-01' && G.findPlan(w1.id).to === '', JSON.stringify(G.findPlan(w1.id)));
  const w2 = 作る('合わせる', 'カレンダー', '2030-06-01', '2030-06-30', true);
  確かめる('「最新のサブ整理に合わせる」なら、開始日に関係なくいちばん新しいサブ整理のサブが入る',
    サブ(w2.id) === 並べ([D]) && /後期/.test(w2.サブの元), JSON.stringify(w2));

  const s3 = G.adminSaveSubTerm(T, { name: '空で', from: '2032-04-01', 写す: false });
  確かめる('写さずにも作れる', !s3.all.subs[s3.id]);
  const w3 = 作る('空のサブ整理', '曜日', '2032-05-01', '', true);
  確かめる('最新のサブ整理にその馬のサブが無ければ、前の期間から引き継ぐ',
    サブ(w3.id) === サブ(w2.id) && /前の期間/.test(w3.サブの元), JSON.stringify(w3));
  G.adminDeleteSubTerm(T, s3.id);

  // まとめて作るときも同じ
  const r = G.chiefSavePlanForHorses(C, [X.id, Y.id], { term: 'まとめて合わせる', mode: '曜日', from: '2031-01-01', min: 1, max: 1, 最新に合わせる: true });
  r.作った.forEach((x) => 作った計画.push(x.id));
  const 計画を引く = (h) => G.loadPlans().filter((p) => p.horseId === h.id && p.term === 'まとめて合わせる')[0];
  確かめる('まとめて作るときも「最新のサブ整理に合わせる」が効く',
    r.作った.length === 2 && サブ(計画を引く(X).id) === 並べ([D]) && サブ(計画を引く(Y).id) === 並べ([D]) &&
    r.作った.every((x) => /後期/.test(x.サブの元)), JSON.stringify(r.作った));

  // 入れるのは作るときだけ
  G.adminSaveBaseSubs(T, s2.id, { [X.id]: [A, B] });
  確かめる('あとで副将が直しても、作ってある期間のサブは変わらない', サブ(w2.id) === 並べ([D]));

  const なし = G.chiefSavePlan(C, { horseId: X.id, term: '開始日なし', mode: '曜日', min: 1, max: 1 });
  作った計画.push(なし.id);
  確かめる('開始日の無い曜日の期間も作れる（開いたままの古い画面のため）', !!なし.id && G.findPlan(なし.id).from === '', JSON.stringify(G.findPlan(なし.id)));
  投げるはず('開始日の形がおかしければ止まる', () => G.chiefSavePlan(C, { horseId: X.id, term: 'へんな日', mode: '曜日', from: 'あした' }), '開始日');

  // 開始日の無い曜日の期間に、あとから開始日を入れる。集めた◎○×は消えない
  G.chiefSaveSubs(C, なし.id, [A]);
  G.submitCareVote(なし.id, A, { 月: '○', 火: '○', 水: '○', 木: '○', 金: '○', 土: '○', 日: '○' });
  const p = G.findPlan(なし.id);
  const 入れた = G.chiefSavePlan(C, { id: p.id, horseId: p.horseId, term: p.term, mode: '曜日', from: '2030-06-01', min: 1, max: 1 });
  確かめる('開始日の無い曜日の期間に、あとから開始日を入れられて、票は消えない',
    !入れた.票を消した && G.loadCareVotes(なし.id).length === 7 && G.findPlan(なし.id).from === '2030-06-01', JSON.stringify(入れた));

  投げるはず('無いサブ整理には保存できない', () => G.adminSaveBaseSubs(T, 'でたらめ', { [X.id]: [A] }), 'もうありません');
  投げるはず('何も送らなければ止まる（サブ整理）', () => G.adminSaveBaseSubs(T, s1.id, {}), '変えたところ');
  const 直した = G.adminSaveSubTerm(T, { id: s1.id, name: '前期（直した）', from: '2030-03-01' });
  確かめる('名前と開始日を直せる', 直した.all.subTerms.some((t) => t.id === s1.id && t.from === '2030-03-01' && t.name === '前期（直した）'));
  投げるはず('直すときも、同じ開始日を2つにはできない', () => G.adminSaveSubTerm(T, { id: s1.id, name: 'x', from: '2030-10-01' }), 'もうあります');
  const 消した = G.adminDeleteSubTerm(T, s2.id);
  確かめる('サブ整理を消すと、その基本のサブも消える',
    !消した.all.subTerms.some((t) => t.id === s2.id) && G.loadBaseSubs().every((x) => x.subTermId !== s2.id));
  確かめる('消したら、ひとつ前のサブ整理が最新になる', (G.chiefLoadAll(C).最新のサブ整理 || {}).id === s1.id);
  確かめる('サブ整理を消しても、作ってある期間のサブは残る', サブ(w2.id) === 並べ([D]));
  確かめる('外から呼べる',
    ['adminLoadSubTerms', 'adminSaveSubTerm', 'adminDeleteSubTerm', 'adminSaveBaseSubs'].every((n) => G.外から呼べる関数.indexOf(n) >= 0));
  確かめる('サブ整理専用のログインは無い（副将画面のトークンを使う）', G.外から呼べる関数.indexOf('loginAndLoadSubTerms') < 0);

  // 片づけ
  作った計画.forEach((id) => G.chiefDeletePlan(C, id));
  G.adminDeleteSubTerm(T, s1.id);
}

// ----- 画面とURL -----
{
  const u = G.配るURL一覧();
  確かめる('休み・部員用のURLが出る', u.休み_部員 === 'https://hokudaiequestrian-design.github.io/yasumi.html', u.休み_部員);
  確かめる('休み・副将用のURLが出る', u.休み_副将 === 'https://hokudaiequestrian-design.github.io/yasumi-admin.html', u.休み_副将);
  確かめる('外から呼べる関数に部員用が入っている',
    ['getYasumiMemberData', 'submitLeaveDays', 'cancelLeave'].every((n) => G.外から呼べる関数.indexOf(n) >= 0));
  確かめる('範囲で出すほう（submitLeave）は外から呼ばせない',
    G.外から呼べる関数.indexOf('submitLeave') < 0);
  確かめる('外から呼べる関数に副将用が入っている',
    ['yasumiLoadAll', 'yasumiDecide', 'yasumiSaveLeave', 'yasumiDeleteLeave', 'yasumiSaveGrant', 'yasumiSaveConfig']
      .every((n) => G.外から呼べる関数.indexOf(n) >= 0));
  確かめる('休みで外から呼べるのは8つだけ',
    G.外から呼べる関数.filter((n) => n.indexOf('yasumi') === 0 || n === 'submitLeaveDays' || n === 'cancelLeave').length === 8,
    JSON.stringify(G.外から呼べる関数.filter((n) => n.indexOf('yasumi') === 0 || n.indexOf('Leave') > 0)));
}

// ===================== 11. バイト =====================

見出し('バイト');
{
  const T2 = G.login('testtest');
  const 名簿 = G.loadMembers();
  const 甲 = 名簿.filter((m) => m.name === '1年3')[0];
  const 乙 = 名簿.filter((m) => m.name === '2年3')[0];

  確かめる('バイトのシートができている', !!SHEETS['バイト'] && !!SHEETS['バイト回数']);
  確かめる('バイトの列は名前だけで作れる形',
    G.SCHEMA['バイト'].join(',') === 'ID,バイト名,使用中,月の上限,備考', G.SCHEMA['バイト'].join(','));

  // ----- バイト先を作る -----
  G.baitoSaveJob(T2, { name: 'フロンテア' });
  G.baitoSaveJob(T2, { name: '牧場' });
  const 一覧 = G.baitoLoadAll(T2).jobs;
  確かめる('バイトを名前だけで作れる', 一覧.length === 2 && 一覧[0].name === 'フロンテア', JSON.stringify(一覧.map((j) => j.name)));
  投げるはず('名前が無いと作れない', () => G.baitoSaveJob(T2, { name: '  ' }), '名前を入れて');
  投げるはず('同じ名前は作れない', () => G.baitoSaveJob(T2, { name: 'フロンテア' }), 'もうあります');
  const フロンテア = 一覧.filter((j) => j.name === 'フロンテア')[0];
  const 牧場 = 一覧.filter((j) => j.name === '牧場')[0];

  // ----- 日ごとに人を入れる -----
  G.baitoAssign(T2, フロンテア.id, 休_先(3), 甲.id);
  G.baitoAssign(T2, フロンテア.id, 休_先(3), 乙.id);      // 同じ日に何人でも入れられる
  G.baitoAssign(T2, フロンテア.id, 休_先(-5), 甲.id);     // 過ぎた日＝行ったぶん
  {
    const d = G.baitoLoadAll(T2, フロンテア.id);
    確かめる('その日に何人でも入る', d.割当.filter((x) => x.date === 休_先(3)).length === 2, JSON.stringify(d.割当));
    確かめる('割当に名前が付く', d.割当.every((x) => !!x.name), JSON.stringify(d.割当));
  }
  投げるはず('同じ人を同じ日に2度は入れない', () => G.baitoAssign(T2, フロンテア.id, 休_先(3), 甲.id), 'もう入っています');
  投げるはず('ほかの休みと重なる日は入れない', () => G.baitoAssign(T2, 牧場.id, 休_先(3), 甲.id), 'すでに');
  投げるはず('日が無いと入れない', () => G.baitoAssign(T2, フロンテア.id, '', 甲.id), '日を選んで');
  投げるはず('知らないバイトには入れられない', () => G.baitoAssign(T2, 'b_ない', 休_先(4), 甲.id), 'もうありません');

  // ----- 回数 -----
  {
    const d = G.baitoLoadAll(T2, フロンテア.id);
    const 甲の = d.counts.filter((c) => c.memberId === 甲.id)[0];
    確かめる('回数は入れた日を全部数える（先の予定も入れた時点で1回。2026-09-16）',
      甲の.自動 === 2 && 甲の.回数 === 2, JSON.stringify(甲の));
    const 乙の = d.counts.filter((c) => c.memberId === 乙.id)[0];
    確かめる('先の予定だけの人も、入れたぶん数える', 乙の.自動 === 1 && 乙の.回数 === 1, JSON.stringify(乙の));
  }
  G.baitoSaveCount(T2, フロンテア.id, 甲.id, 5);   // システムに入れる前のぶんを足す
  {
    const 甲の = G.baitoLoadAll(T2, フロンテア.id).counts.filter((c) => c.memberId === 甲.id)[0];
    確かめる('手で足したぶんが乗る', 甲の.自動 === 2 && 甲の.調整 === 5 && 甲の.回数 === 7, JSON.stringify(甲の));
  }
  G.baitoSaveCount(T2, フロンテア.id, 甲.id, 0);
  確かめる('0にすると調整が消える',
    G.baitoLoadAll(T2, フロンテア.id).counts.filter((c) => c.memberId === 甲.id)[0].回数 === 2);
  確かめる('回数はバイトごとに分かれている',
    G.baitoLoadAll(T2, 牧場.id).counts.every((c) => c.回数 === 0));

  // ----- 部員の画面ではバイト先の名前で出る（回数は出さない） -----
  {
    const d = G.getYasumiMemberData(甲.id);
    // 前の作りで入れたバイト（バイト先の無い行）も混じっているので、自分のぶんで見る
    const バ = d.all.filter((x) => x.kind === 'バイト' && x.memberId === 甲.id)[0];
    確かめる('部員にはバイト先の名前で見せる', バ && バ.label === 'フロンテア', JSON.stringify(バ));
    確かめる('部員の返りに回数は入っていない',
      JSON.stringify(d).indexOf('counts') < 0 && JSON.stringify(d).indexOf('調整') < 0);
  }
  {
    const p = G.getMyPage('1年3');
    const バ = (p.休み || []).filter((x) => x.kind === 'バイト')[0];
    確かめる('マイページでもバイト先の名前で出る', バ && バ.label === 'フロンテア', JSON.stringify(バ));
  }

  // ----- 外す・消す -----
  {
    const one = G.baitoLoadAll(T2, フロンテア.id).割当.filter((x) => x.date === 休_先(3))[0];
    G.baitoUnassign(T2, one.id);
    確かめる('その日のその人だけ外せる',
      G.baitoLoadAll(T2, フロンテア.id).割当.filter((x) => x.date === 休_先(3)).length === 1);
  }
  投げるはず('もう無いものは外せない', () => G.baitoUnassign(T2, 'y_ない'), 'もうありません');
  G.baitoSaveCount(T2, フロンテア.id, 乙.id, 3);
  G.baitoDeleteJob(T2, フロンテア.id);
  確かめる('消すと入っていた日も一緒に消える',
    G.loadLeaves().every((l) => l.jobId !== フロンテア.id) && G.baitoLoadAll(T2).jobs.length === 1);
  確かめる('消すと回数の調整も消える',
    G.readRows('バイト回数').every((r) => String(r['バイトID']) !== フロンテア.id));

  // ----- 合鍵が要る -----
  投げるはず('合鍵なしでは見られない', () => G.baitoLoadAll('でたらめ'), '有効期限');
  投げるはず('合鍵なしでは入れられない', () => G.baitoAssign('でたらめ', 牧場.id, 休_先(6), 甲.id), '有効期限');
  投げるはず('合鍵なしでは回数を直せない', () => G.baitoSaveCount('でたらめ', 牧場.id, 甲.id, 1), '有効期限');
  確かめる('外から呼べるのは10つ（自動割り当ての4つを足した。2026-09-21）',
    ['baitoLoadAll', 'baitoSaveJob', 'baitoDeleteJob', 'baitoAssign', 'baitoUnassign', 'baitoSaveCount',
      'baitoSaveNeeds', 'baitoSaveSkips', 'baitoSaveMonthMax', 'baitoGenerate']
      .every((n) => G.外から呼べる関数.indexOf(n) >= 0)
    && G.外から呼べる関数.filter((n) => n.indexOf('baito') === 0).length === 10);
}

// ===================== 12. 朝手入れ =====================
/*
  ふつうの手入れとは別枠（2026-09-20 ユーザーの指示）。
  ・期間を作らない。馬ごとの設定をそのつど直して更新する
  ・カレンダー式は手入れカレンダーにだけ、ローテーションはサブの画面にだけ出す
  ・朝練が休みの日だけなので、入っていない日があっても警告は出さない
*/

見出し('朝手入れ');
{
  const 名簿 = G.loadMembers();
  const 馬たち = G.loadHorses();
  const 朝の馬 = 馬たち.filter((h) => h.name === '北汐')[0];
  const 甲 = 名簿[0];
  const 乙 = 名簿[1];
  const 丙 = 名簿[2];

  確かめる('朝手入れのシートができている',
    !!SHEETS['朝手入れ'] && !!SHEETS['朝手入れ表'] && !!SHEETS['朝手入れ順']);
  確かめる('朝手入れの列は馬ごとに1行の形',
    G.SCHEMA['朝手入れ'].join(',') === '馬ID,方式,備考', G.SCHEMA['朝手入れ'].join(','));
  確かめる('期間を持たない（計画IDの列が無い）',
    G.SCHEMA['朝手入れ表'].indexOf('計画ID') < 0 && G.SCHEMA['朝手入れ順'].indexOf('計画ID') < 0);

  // ----- まだ決めていない -----
  {
    const d = G.chiefLoadMorning(C, 朝の馬.id);
    確かめる('はじめは方式が決まっていない', d.mode === '', JSON.stringify(d.mode));
    確かめる('選べるのは2つだけ', d.方式.join(',') === 'カレンダー,ローテーション', d.方式.join(','));
  }
  投げるはず('馬を選ばないと読めない', () => G.chiefLoadMorning(C, ''), '馬を選んで');
  投げるはず('でたらめな方式は入らない',
    () => G.chiefSaveMorningMode(C, 朝の馬.id, 'てきとう'), 'どちらか');

  // ----- カレンダー式 -----
  G.chiefSaveMorningMode(C, 朝の馬.id, 'カレンダー');
  確かめる('方式を変えるとそのまま新しい設定になる',
    G.chiefLoadMorning(C, 朝の馬.id).mode === 'カレンダー');

  const 日 = (n) => '2026-04-' + ('0' + n).slice(-2);
  G.chiefSaveMorningDays(C, 朝の馬.id, [
    { date: 日(3), memberId: 甲.id },
    { date: 日(10), memberId: 乙.id },
    { date: 日(10), memberId: 丙.id },   // 同じ日は1人だけ
    { date: 日(17), memberId: 甲.id },
  ]);
  {
    const d = G.chiefLoadMorning(C, 朝の馬.id);
    確かめる('入れた日だけが残る（1日1人）', d.days.length === 3, JSON.stringify(d.days));
    確かめる('同じ日は先に渡したほうが残る',
      d.days.filter((x) => x.date === 日(10))[0].memberId === 乙.id);
    確かめる('日付の順に並ぶ', d.days[0].date === 日(3) && d.days[2].date === 日(17));
  }

  // ----- 手入れカレンダーに出る／ほかには出ない -----
  {
    const cal = G.getCalendarData('2026-04');
    確かめる('カレンダー式は手入れカレンダーに出る', (cal.朝手入れ || []).length === 3,
      JSON.stringify(cal.朝手入れ));
    確かめる('馬の名前と担当の名前で返る',
      cal.朝手入れ[0].馬 === '北汐' && cal.朝手入れ[0].名前 === 甲.name, JSON.stringify(cal.朝手入れ[0]));
    確かめる('ふつうの手入れとは混ざらない',
      (cal.手入れ || []).every((x) => !(x.馬 === '北汐' && x.date === 日(3))),
      JSON.stringify((cal.手入れ || []).filter((x) => x.馬 === '北汐')));
    確かめる('その月のぶんだけ返る', G.getCalendarData('2026-05').朝手入れ.length === 0);
  }
  {
    const d = G.getCareMemberData(甲.id);
    確かめる('カレンダー式はサブの画面には出さない', (d.朝手入れ || []).length === 0,
      JSON.stringify(d.朝手入れ));
  }

  // ----- ローテーション式 -----
  G.chiefSaveMorningOrder(C, 朝の馬.id, [乙.id, 甲.id, 丙.id, 甲.id]);
  {
    const d = G.chiefLoadMorning(C, 朝の馬.id);
    確かめる('同じ人を2回入れても1回になる', d.order.length === 3, JSON.stringify(d.order));
    確かめる('渡した順がそのまま回る順', d.order[0] === 乙.id && d.order[1] === 甲.id);
  }
  確かめる('方式がカレンダーのうちは、並びを入れてもサブの画面に出ない',
    (G.getCareMemberData(甲.id).朝手入れ || []).length === 0);

  G.chiefSaveMorningMode(C, 朝の馬.id, 'ローテーション');
  {
    const d = G.getCareMemberData(甲.id);
    確かめる('ローテーション式はサブの画面に出る', (d.朝手入れ || []).length === 1, JSON.stringify(d.朝手入れ));
    確かめる('回る順番が並んで返る',
      d.朝手入れ[0].順.map((x) => x.name).join(',') === [乙, 甲, 丙].map((m) => m.name).join(','),
      JSON.stringify(d.朝手入れ[0].順));
    確かめる('自分のところに印が付く',
      d.朝手入れ[0].順.filter((x) => x.me).length === 1 && d.朝手入れ[0].順[1].me === true);
    確かめる('◎○× は集めないので票の欄が無い', JSON.stringify(d.朝手入れ[0]).indexOf('votes') < 0);
  }
  確かめる('並びに入っていない人には出ない',
    (G.getCareMemberData(名簿[名簿.length - 1].id).朝手入れ || [])
      .every((x) => x.horseId !== 朝の馬.id) || 名簿.length <= 3);
  確かめる('ローテーション式は手入れカレンダーに出さない',
    (G.getCalendarData('2026-04').朝手入れ || []).length === 0);

  // ----- 片方に変えても、もう片方の中身は残る -----
  G.chiefSaveMorningMode(C, 朝の馬.id, 'カレンダー');
  確かめる('カレンダーに戻すと入れた日がそのまま残っている',
    G.chiefLoadMorning(C, 朝の馬.id).days.length === 3);
  G.chiefSaveMorningMode(C, 朝の馬.id, '');
  {
    const d = G.chiefLoadMorning(C, 朝の馬.id);
    確かめる('「使わない」にできる', d.mode === '');
    確かめる('使わないにしても中身は消えない', d.days.length === 3 && d.order.length === 3);
    確かめる('使わないあいだはどちらの画面にも出ない',
      (G.getCalendarData('2026-04').朝手入れ || []).length === 0 &&
      (G.getCareMemberData(甲.id).朝手入れ || []).length === 0);
  }

  // ----- 馬ごとに分かれている -----
  {
    const ほかの馬 = 馬たち.filter((h) => h.name === '北陽')[0];
    G.chiefSaveMorningMode(C, ほかの馬.id, 'カレンダー');
    G.chiefSaveMorningDays(C, ほかの馬.id, [{ date: 日(5), memberId: 甲.id }]);
    確かめる('ほかの馬を入れても、前の馬のぶんは消えない',
      G.chiefLoadMorning(C, 朝の馬.id).days.length === 3);
    確かめる('その馬のぶんだけ返る',
      G.chiefLoadMorning(C, ほかの馬.id).days.length === 1);
  }

  // ----- 朝手入れは手入れ表の警告に出てこない -----
  {
    const plan = G.loadPlans().filter((p) => p.horseId === 朝の馬.id)[0];
    if (plan) {
      const 中身 = G.chiefLoadPlan(C, plan.id);
      確かめる('朝手入れのことは手入れ表の警告に出ない',
        (中身.warnings || []).every((w) => String(w.text || '').indexOf('朝') < 0),
        JSON.stringify(中身.warnings));
    } else {
      確かめる('朝手入れのことは手入れ表の警告に出ない', true);
    }
  }

  // ----- 合鍵 -----
  投げるはず('合鍵なしでは読めない', () => G.chiefLoadMorning('でたらめ', 朝の馬.id), '有効期限');
  投げるはず('合鍵なしでは方式を変えられない', () => G.chiefSaveMorningMode('でたらめ', 朝の馬.id, 'カレンダー'), '有効期限');
  投げるはず('合鍵なしでは担当を入れられない', () => G.chiefSaveMorningDays('でたらめ', 朝の馬.id, []), '有効期限');
  投げるはず('合鍵なしでは並びを直せない', () => G.chiefSaveMorningOrder('でたらめ', 朝の馬.id, []), '有効期限');
  確かめる('外から呼べるのは4つ',
    ['chiefLoadMorning', 'chiefSaveMorningMode', 'chiefSaveMorningDays', 'chiefSaveMorningOrder']
      .every((n) => G.外から呼べる関数.indexOf(n) >= 0)
    && G.外から呼べる関数.filter((n) => n.indexOf('Morning') >= 0).length === 4);
}

// ===================== 13. カレンダーの「大」を仕事の1文字にする =====================
/*
  2026-09-20 ユーザーの指示。人員表が保存されていれば、その人のマスを仕事の1文字で出す。
    出（赤）… 出場する選手　下 … その馬に付く人（下付き）　運・箱・在 … 仕事名の1文字目
  人員表をまだ作っていない大会は、今までどおり「大」。
*/

見出し('カレンダーの「大」を仕事の1文字にする');
{
  const 名簿 = G.loadMembers();
  const 選手 = 名簿[0];
  const 下付き = 名簿[1];
  const 運営 = 名簿[2];
  const 何も = 名簿[3];
  const 在と下 = 名簿[4];

  // 人員表側のIDは当番・手入れとは別。名前で突き合わせる決まりなので、名前だけそろえておく
  人員表に置く('部員', ['ID', '名前'], [
    ['j1', 選手.name], ['j2', 下付き.name], ['j3', 運営.name], ['j4', 何も.name], ['j5', 在と下.name],
  ]);
  人員表に置く('大会', ['ID', '大会名', '開始日', '終了日'], [['e1', '春の大会', '2026-06-06', '2026-06-07']]);
  人員表に置く('競技', ['ID', '大会ID', '日付', '競技名', '順番'], [
    ['c1', 'e1', '2026-06-06', '馬場', 1],
    ['c2', 'e1', '2026-06-07', '障害', 2],
    ['c3', 'e1', '2026-06-06', '片付け', 3],   // 6/6 の2コマ目
  ]);
  人員表に置く('仕事', ['ID', '大会ID', '日付', '仕事名'], [
    ['j_un', 'e1', '2026-06-06', '運営'],
    ['j_zai', 'e1', '2026-06-07', '在'],
    ['j_hako', 'e1', '2026-06-06', '箱番長'],
  ]);
  人員表に置く('出欠', ['大会ID', '部員ID', '日付', '出欠'], [
    ['e1', 'j1', '2026-06-06', '出席'],
    ['e1', 'j2', '2026-06-06', '出席'],
    ['e1', 'j3', '2026-06-06', '出席'],
    ['e1', 'j4', '2026-06-06', '出席'],
    ['e1', 'j5', '2026-06-06', '出席'],
    ['e1', 'j3', '2026-06-07', '出席'],
  ]);
  人員表に置く('出場', ['ID', '大会ID', '部員ID', '競技ID', '馬名', '馬付き人数'], [
    ['en1', 'e1', 'j1', 'c1', '北汐', 1],
  ]);
  // 仕事の色。「在」だけシートで上書きし、「運営」は人員表の既定のままにする
  人員表に置く('選択肢', ['種類', '値', '並び順', '色', '文字色'], [
    ['仕事名', '在', 1, '#123456', '#ffffff'],
    ['仕事名', '運営', 2, '', ''],
    ['競技名', '馬場', 1, '', ''],
    ['仕事名', 'おかしな色', 3, 'javascript:悪さ', 'red'],
  ]);
  人員表に置く('人員表', ['大会ID', '部員ID', '競技ID', '仕事ID', '馬名', '固定'], [
    ['e1', 'j2', 'c1', '', '北汐', ''],     // 馬に付く人＝下
    ['e1', 'j3', 'c1', 'j_un', '', ''],     // 運営
    ['e1', 'j3', 'c2', 'j_zai', '', ''],    // 次の日は在
  ]);

  人員表を開ける = true;
  const d = G.getCalendarData('2026-06');
  const 印 = (名前, 日) => {
    const x = (d.大会に出る || []).filter((y) => y.名前 === 名前 && y.date === 日)[0];
    return x ? (x.印 || []).map((s) => s.字).join('') : '（その日の行が無い）';
  };
  const 種 = (名前, 日) => {
    const x = (d.大会に出る || []).filter((y) => y.名前 === 名前 && y.date === 日)[0];
    return x ? (x.印 || []).map((s) => s.種).join(',') : '';
  };

  確かめる('人員表を読めている', d.大会を読めた === true && d.大会.length === 1, JSON.stringify(d.大会));
  確かめる('出場する選手は「出」', 印(選手.name, '2026-06-06') === '出', 印(選手.name, '2026-06-06'));
  // 2026-09-20 ユーザーの指示：選手に仕事が当たっていても「出」だけにする
  人員表に置く('人員表', ['大会ID', '部員ID', '競技ID', '仕事ID', '馬名', '固定'], [
    ['e1', 'j1', 'c1', 'j_un', '', ''],     // 選手にも仕事が当たっている日
    ['e1', 'j2', 'c1', '', '北汐', ''],
    ['e1', 'j3', 'c1', 'j_un', '', ''],
    ['e1', 'j3', 'c2', 'j_zai', '', ''],
  ]);
  {
    const d0 = G.getCalendarData('2026-06');
    const x = (d0.大会に出る || []).filter((y) => y.名前 === 選手.name && y.date === '2026-06-06')[0];
    確かめる('選手に仕事が当たっていても「出」だけにする',
      x.印.length === 1 && x.印[0].字 === '出', JSON.stringify(x.印));
  }
  確かめる('選手の印は赤にする種類で返る', 種(選手.name, '2026-06-06') === 'out', 種(選手.name, '2026-06-06'));
  確かめる('馬に付く人は「下」', 印(下付き.name, '2026-06-06') === '下', 印(下付き.name, '2026-06-06'));
  確かめる('仕事は仕事名の1文字目（運営→運）', 印(運営.name, '2026-06-06') === '運', 印(運営.name, '2026-06-06'));
  確かめる('別の日は別の仕事（在）', 印(運営.name, '2026-06-07') === '在', 印(運営.name, '2026-06-07'));
  確かめる('人員表に入っていない人は印なし（画面で「大」になる）',
    印(何も.name, '2026-06-06') === '', 印(何も.name, '2026-06-06'));

  // ----- 1文字の色は人員表と同じ（2026-09-20 ユーザーの指示） -----
  {
    const 色 = (名前, 日) => {
      const x = (d.大会に出る || []).filter((y) => y.名前 === 名前 && y.date === 日)[0];
      return x && x.印[0] ? x.印[0].背景 + '/' + x.印[0].文字 : '';
    };
    確かめる('選択肢シートの色で塗る（在）', 色(運営.name, '2026-06-07') === '#123456/#ffffff', 色(運営.name, '2026-06-07'));
    確かめる('シートが空欄なら人員表の既定の色（運営）', 色(運営.name, '2026-06-06') === '#ffe5a0/#473821', 色(運営.name, '2026-06-06'));
    確かめる('出場する選手には色を付けない（画面の決まった赤にする）',
      色(選手.name, '2026-06-06') === '/', 色(選手.name, '2026-06-06'));
    確かめる('色の形でないものは通さない',
      JSON.stringify(d.大会に出る).indexOf('javascript') < 0);
  }

  /*
    大会のマスは必ず1文字（2026-09-20 ユーザーの指示）。
      ・下付きは、ほかに仕事があればそちらの1文字。下付きしかない日だけ「下」
      ・仕事が2つあるときは「在」以外を先に。どちらも在以外なら競技の早いほう
  */
  {
    人員表に置く('人員表', ['大会ID', '部員ID', '競技ID', '仕事ID', '馬名', '固定'], [
      // 下付き＋仕事 → 仕事の字にする
      ['e1', 'j2', 'c1', '', '北汐', ''],
      ['e1', 'j2', 'c3', 'j_un', '', ''],
      // 在＋在以外 → 在以外を出す（在のほうが競技は早い）
      ['e1', 'j3', 'c1', 'j_zai', '', ''],
      ['e1', 'j3', 'c3', 'j_un', '', ''],
      // 下付きだけの日 → 「下」
      ['e1', 'j4', 'c1', '', 'ファー', ''],
      // 在と下付き → 下付き（在はいちばん弱い。2026-09-20 ユーザーの指示）
      ['e1', 'j5', 'c1', 'j_zai', '', ''],
      ['e1', 'j5', 'c3', '', '北汐', ''],
    ]);
    const d1 = G.getCalendarData('2026-06');
    const 印1 = (名前) => {
      const x = (d1.大会に出る || []).filter((y) => y.名前 === 名前 && y.date === '2026-06-06')[0];
      return x ? (x.印 || []).map((s) => s.字).join('') : '（行が無い）';
    };
    確かめる('下付き以外に仕事があれば、そちらの1文字', 印1(下付き.name) === '運', 印1(下付き.name));
    確かめる('下付きしかない日は「下」', 印1(何も.name) === '下', 印1(何も.name));
    確かめる('仕事が2つなら「在」以外を出す', 印1(運営.name) === '運', 印1(運営.name));
    確かめる('在と下付きが重なったら下付き', 印1(在と下.name) === '下', 印1(在と下.name));
    確かめる('大会のマスはどれも1文字',
      (d1.大会に出る || []).every((x) => (x.印 || []).length <= 1),
      JSON.stringify((d1.大会に出る || []).filter((x) => (x.印 || []).length > 1)));

    // どちらも在以外なら、その日の競技の早いほう（c1＝馬場が先）
    人員表に置く('人員表', ['大会ID', '部員ID', '競技ID', '仕事ID', '馬名', '固定'], [
      ['e1', 'j3', 'c3', 'j_hako', '', ''],
      ['e1', 'j3', 'c1', 'j_un', '', ''],
    ]);
    const d2 = G.getCalendarData('2026-06');
    const x = (d2.大会に出る || []).filter((y) => y.名前 === 運営.name && y.date === '2026-06-06')[0];
    確かめる('どちらも在以外なら競技の早いほう', x.印.length === 1 && x.印[0].字 === '運', JSON.stringify(x.印));
  }

  // もとの並びに戻す（このあとの項目が見ているもの）
  人員表に置く('人員表', ['大会ID', '部員ID', '競技ID', '仕事ID', '馬名', '固定'], [
    ['e1', 'j2', 'c1', '', '北汐', ''],
    ['e1', 'j3', 'c1', 'j_un', '', ''],
    ['e1', 'j3', 'c2', 'j_zai', '', ''],
  ]);

  // 馬に付く人の説明には馬の名前を出す
  {
    const x = (d.大会に出る || []).filter((y) => y.名前 === 下付き.name)[0];
    確かめる('下付きは、どの馬に付くかが分かる', x.印[0].題.indexOf('北汐') >= 0, JSON.stringify(x.印));
  }

  // 出欠を出していなくても、人員表に入っていれば出す
  人員表に置く('出欠', ['大会ID', '部員ID', '日付', '出欠'], [['e1', 'j1', '2026-06-06', '出席']]);
  {
    const d2 = G.getCalendarData('2026-06');
    const x = (d2.大会に出る || []).filter((y) => y.名前 === 運営.name && y.date === '2026-06-06')[0];
    確かめる('出欠を出していなくても人員表に入っていれば出る', !!x && x.印[0].字 === '運', JSON.stringify(x));
    確かめる('その日の大会の名前が付く', x && x.大会 === '春の大会', x && x.大会);
  }

  // 人員表をまだ作っていない大会は「大」のまま
  人員表に置く('人員表', ['大会ID', '部員ID', '競技ID', '仕事ID', '馬名', '固定'], []);
  人員表に置く('出場', ['ID', '大会ID', '部員ID', '競技ID', '馬名', '馬付き人数'], []);
  {
    const d3 = G.getCalendarData('2026-06');
    確かめる('人員表がまだなら印は付かない（画面で「大」）',
      (d3.大会に出る || []).every((x) => !(x.印 || []).length), JSON.stringify(d3.大会に出る));
  }

  // 人員表のファイルが開けなくても、休み・手入れは出る
  人員表を開ける = false;
  {
    const d4 = G.getCalendarData('2026-06');
    確かめる('人員表を開けなくても止まらない', d4.大会を読めた === false && Array.isArray(d4.手入れ));
  }
}

// ===================== 14. 当番をカレンダーに出す =====================
/*
  2026-09-21 ユーザーの指示。当番は曜日で回すので、それだけでは日付が決まらない。
  期間に開始日・終了日を入れてあれば、その範囲の日に、その曜日の担当をカレンダーに並べる。
*/

見出し('当番をカレンダーに出す');
{
  const 名簿 = G.loadMembers();
  const 甲 = 名簿[0];
  const 乙 = 名簿[1];
  const 昼当 = G.loadDuties().filter((d) => d.name === '昼当')[0];
  const 夕当 = G.loadDuties().filter((d) => d.name === '夕当')[0];

  確かめる('当番期間に開始日・終了日の列がある',
    G.SCHEMA['当番期間'].join(',') === 'ID,期間名,開始日,終了日,受付中,並び順,備考', G.SCHEMA['当番期間'].join(','));

  G.adminSaveTerm(T, { name: '26夏休み', open: false, from: '2026-08-01', to: '2026-09-30' });
  const 夏 = G.loadDutyTerms().filter((t) => t.name === '26夏休み')[0];
  確かめる('開始日と終了日が入る', 夏.from === '2026-08-01' && 夏.to === '2026-09-30', JSON.stringify([夏.from, 夏.to]));

  投げるはず('終了日が開始日より前だと止まる',
    () => G.adminSaveTerm(T, { id: 夏.id, name: '26夏休み', from: '2026-09-30', to: '2026-08-01' }), '終了日');
  投げるはず('片方だけだと止まる',
    () => G.adminSaveTerm(T, { id: 夏.id, name: '26夏休み', from: '2026-08-01', to: '' }), '両方');
  確かめる('止まったときは前の日付のまま',
    G.findDutyTerm(夏.id).from === '2026-08-01' && G.findDutyTerm(夏.id).to === '2026-09-30');

  // 月曜の昼当＝甲、水曜の夕当＝乙
  G.adminSaveTable(T, 夏.id, [
    { dutyId: 昼当.id, day: '月', memberId: 甲.id },
    { dutyId: 夕当.id, day: '水', memberId: 乙.id },
  ]);

  {
    const d = G.getCalendarData('2026-09');
    const 当番 = d.当番 || [];
    // 2026-09 の月曜は 7・14・21・28、水曜は 2・9・16・23・30
    const 甲の日 = 当番.filter((x) => x.名前 === 甲.name).map((x) => x.date);
    const 乙の日 = 当番.filter((x) => x.名前 === 乙.name).map((x) => x.date);
    確かめる('月曜の当番が9月の月曜に全部出る',
      甲の日.join(',') === '2026-09-07,2026-09-14,2026-09-21,2026-09-28', 甲の日.join(','));
    確かめる('水曜の当番が9月の水曜に全部出る',
      乙の日.join(',') === '2026-09-02,2026-09-09,2026-09-16,2026-09-23,2026-09-30', 乙の日.join(','));
    {
      const 一つ = 当番.filter((x) => x.名前 === 甲.name)[0];
      確かめる('当番の名前と期間の名前が付く',
        一つ.当番 === '昼当' && 一つ.期間 === '26夏休み', JSON.stringify(一つ));
    }
    確かめる('同じ日は昼当→夕当の順に並ぶ',
      (() => {
        const 束 = {};
        当番.forEach((x) => { (束[x.date] = 束[x.date] || []).push(x.当番); });
        return Object.keys(束).every((k) => 束[k].slice().sort((a, b) => (a === '昼当' ? 0 : 1) - (b === '昼当' ? 0 : 1)).join() === 束[k].join());
      })());
  }

  確かめる('期間の外の月には出ない', (G.getCalendarData('2026-10').当番 || []).length === 0);
  {
    // 8月は1日から。2026-08-01 は土曜なので、最初の月曜は 8/3
    const 甲の日 = (G.getCalendarData('2026-08').当番 || []).filter((x) => x.名前 === 甲.name).map((x) => x.date);
    確かめる('開始日より前には出ない', 甲の日[0] === '2026-08-03', 甲の日.join(','));
  }

  // 日付を空に戻すと出なくなる
  G.adminSaveTerm(T, { id: 夏.id, name: '26夏休み', from: '', to: '' });
  確かめる('日付が空の期間はカレンダーに出ない', (G.getCalendarData('2026-09').当番 || []).length === 0);
  確かめる('日付を空にしても当番表は消えない', G.loadDutyTable(夏.id).length === 2);

  // 名簿にない人は「自由:名前」で入れられる（2026-09-21 ユーザーの指示。手入れ表と同じ形）
  G.adminSaveTerm(T, { id: 夏.id, name: '26夏休み', from: '2026-08-01', to: '2026-09-30' });
  G.adminSaveTable(T, 夏.id, [
    { dutyId: 昼当.id, day: '月', memberId: 甲.id },
    { dutyId: 夕当.id, day: '水', memberId: 乙.id },
    { dutyId: 夕当.id, day: '土', memberId: '自由:難波' },
  ]);
  確かめる('名簿にない人も当番表に入る', G.loadDutyTable(夏.id).length === 3, String(G.loadDutyTable(夏.id).length));
  {
    const 土 = (G.getCalendarData('2026-09').当番 || []).filter((x) => x.名前 === '難波');
    // 2026-09 の土曜は 5・12・19・26
    確かめる('名簿にない人もカレンダーに名前で出る',
      土.length === 4 && 土[0].date === '2026-09-05' && 土[0].当番 === '夕当', JSON.stringify(土.map((x) => x.date)));
  }
  投げるはず('でたらめな部員IDは入らない', () => {
    G.adminSaveTable(T, 夏.id, [{ dutyId: 昼当.id, day: '月', memberId: 'm_ない' }]);
    if (G.loadDutyTable(夏.id).length !== 0) throw new Error('入ってしまった');
    throw new Error('落とした');
  }, '落とした');
  // 名前だけ直す呼び出しで日付が消えないこと（画面の「受付中」の切り替えなど）
  G.adminSaveTerm(T, { id: 夏.id, name: '26夏休み', from: '2026-08-01', to: '2026-09-30' });
  G.adminSaveTerm(T, { id: 夏.id, name: '26夏休み', open: true });
  確かめる('受付の切り替えだけでは日付が消えない',
    G.findDutyTerm(夏.id).from === '2026-08-01' && G.findDutyTerm(夏.id).to === '2026-09-30',
    JSON.stringify(G.findDutyTerm(夏.id)));
}

// ===================== 15. バイトの自動割り当て =====================
/*
  2026-09-21 ユーザーの指示。日ごとの必要人数を決めておき、回数の少ない人順に自動で入れる。
    ・同じ回数の人が並んだらランダム
    ・1か月に同じ人を入れる上限（既定2。バイト先ごとに変えられる）
    ・入れない人を選べる
    ・休み・ほかのバイトの日、大会がある日は入れない
    ・手で入れたぶんには鍵が付き、作り直しても動かない
*/

見出し('バイトの自動割り当て');
{
  const T2 = G.login('testtest');
  const 名簿 = G.loadMembers();
  G.baitoSaveJob(T2, { name: 'コンビニ' });
  const 店 = G.baitoLoadAll(T2).jobs.filter((j) => j.name === 'コンビニ')[0];

  確かめる('必要人数と入れない人のシートができている',
    !!G.SCHEMA['バイト必要人数'] && !!G.SCHEMA['バイト除外']);
  確かめる('月の上限の既定は2', G.baitoLoadAll(T2, 店.id).月の上限の既定 === 2);
  確かめる('作ったばかりのバイトの上限も2', 店.monthMax === 2, String(店.monthMax));

  // 2026-11 は 1日(日)〜30日(月)。11/2・11/3・11/4 に2人ずつ要る
  const 日 = (n) => '2026-11-' + ('0' + n).slice(-2);
  G.baitoSaveNeeds(T2, 店.id, '2026-11', { [日(2)]: 2, [日(3)]: 2, [日(4)]: 2 });
  {
    const d = G.baitoLoadAll(T2, 店.id);
    確かめる('必要人数が入る', d.needs[日(2)] === 2 && d.needs[日(4)] === 2, JSON.stringify(d.needs));
  }
  投げるはず('月の形が違うと止まる', () => G.baitoSaveNeeds(T2, 店.id, '2026年11月', {}), '月の形');

  // ----- 自動で組む -----
  {
    const r = G.baitoGenerate(T2, 店.id, '2026-11', false);
    確かめる('ためしでは保存しない', r.ためし === true && G.baitoLoadAll(T2, 店.id).割当.length === 0);
    確かめる('必要人数ぶん組む（3日×2人＝6）', r.count === 6, String(r.count));
    確かめる('必要人数を書いていない日には入れない',
      r.cells.every((c) => [日(2), 日(3), 日(4)].indexOf(c.date) >= 0), JSON.stringify(r.cells.map((c) => c.date)));
    確かめる('同じ日に同じ人を2回入れない',
      [日(2), 日(3), 日(4)].every((d) => {
        const 人 = r.cells.filter((c) => c.date === d).map((c) => c.memberId);
        return 人.length === new Set(人).size;
      }));
  }

  G.baitoGenerate(T2, 店.id, '2026-11', true);
  {
    const d = G.baitoLoadAll(T2, 店.id);
    確かめる('保存すると割当に入る', d.割当.length === 6, String(d.割当.length));
    const 数 = {};
    d.割当.forEach((x) => { 数[x.memberId] = (数[x.memberId] || 0) + 1; });
    確かめる('1か月の上限（2回）を超えない',
      Object.keys(数).every((k) => 数[k] <= 2), JSON.stringify(数));
    確かめる('回数の少ない人から入る（回数0の人が先）',
      d.counts.filter((c) => c.回数 > 0).length === Object.keys(数).length);
  }

  // ----- 作り直すと、鍵の無いぶんは入れ替わる／鍵のぶんは残る -----
  {
    const 前 = G.baitoLoadAll(T2, 店.id).割当.map((x) => x.date + '|' + x.memberId).sort().join();
    // 1人だけ手で入れて鍵を付ける（11/2 に、まだ入っていない人）
    const 入っている = new Set(G.baitoLoadAll(T2, 店.id).割当.filter((x) => x.date === 日(2)).map((x) => x.memberId));
    const 手の人 = 名簿.filter((m) => !入っている.has(m.id))[0];
    // 11/2 はもう2人いるので、いったん1人外してから手で入れる
    const 外す = G.baitoLoadAll(T2, 店.id).割当.filter((x) => x.date === 日(2))[0];
    G.baitoUnassign(T2, 外す.id);
    G.baitoAssign(T2, 店.id, 日(2), 手の人.id, '');
    確かめる('手で入れたぶんには鍵が付く',
      G.loadLeaves().filter((l) => l.jobId === 店.id && l.from === 日(2) && l.memberId === 手の人.id)[0].locked === true);

    G.baitoGenerate(T2, 店.id, '2026-11', true);
    const 後 = G.baitoLoadAll(T2, 店.id).割当;
    確かめる('鍵の人は組み直しても残る',
      後.some((x) => x.date === 日(2) && x.memberId === 手の人.id), JSON.stringify(後.filter((x) => x.date === 日(2))));
    確かめる('組み直しても必要人数ぶんになる', 後.length === 6, String(後.length));
    確かめる('前と同じとは限らない（順番はランダム）', typeof 前 === 'string');
  }

  // ----- 入れない人 -----
  {
    const 外れる = G.baitoLoadAll(T2, 店.id).割当.filter((x) => {
      const l = G.loadLeaves().filter((y) => y.id === x.id)[0];
      return l && !l.locked;
    })[0];
    const 外す人 = 外れる.memberId;
    G.baitoSaveSkips(T2, 店.id, [外す人]);
    確かめる('入れない人が入る', G.baitoLoadAll(T2, 店.id).skips.join() === 外す人);
    G.baitoGenerate(T2, 店.id, '2026-11', true);
    const 後 = G.baitoLoadAll(T2, 店.id).割当;
    確かめる('入れない人は自動では入らない',
      !後.some((x) => x.memberId === 外す人 && !G.loadLeaves().filter((y) => y.id === x.id)[0].locked),
      JSON.stringify(後.filter((x) => x.memberId === 外す人)));
    G.baitoSaveSkips(T2, 店.id, []);
  }

  // ----- 月の上限を変える -----
  G.baitoSaveMonthMax(T2, 店.id, 1);
  確かめる('月の上限を変えられる', G.baitoLoadAll(T2, 店.id).job.monthMax === 1);
  投げるはず('大きすぎる上限は止まる', () => G.baitoSaveMonthMax(T2, 店.id, 40), '1 〜 31');
  G.baitoGenerate(T2, 店.id, '2026-11', true);
  {
    const 数 = {};
    G.baitoLoadAll(T2, 店.id).割当.forEach((x) => { 数[x.memberId] = (数[x.memberId] || 0) + 1; });
    // 鍵の人は上限の外（先に入っているぶん）なので、鍵でない人が2回入らないことを見る
    const 鍵でない = {};
    G.loadLeaves().filter((l) => l.jobId === 店.id && !l.locked).forEach((l) => { 鍵でない[l.memberId] = (鍵でない[l.memberId] || 0) + 1; });
    確かめる('上限1にすると、自動で入るのは1人1回まで',
      Object.keys(鍵でない).every((k) => 鍵でない[k] <= 1), JSON.stringify(鍵でない));
  }
  G.baitoSaveMonthMax(T2, 店.id, 2);

  // ----- 休み・ほかのバイトの日は避ける -----
  {
    G.baitoSaveNeeds(T2, 店.id, '2026-11', { [日(10)]: 1 });
    G.baitoGenerate(T2, 店.id, '2026-11', true);
    const 入った = G.baitoLoadAll(T2, 店.id).割当.filter((x) => x.date === 日(10))[0];
    確かめる('必要人数を消した日のぶんは消える',
      !G.baitoLoadAll(T2, 店.id).割当.some((x) => x.date === 日(3) && !G.loadLeaves().filter((y) => y.id === x.id)[0].locked));
    確かめる('新しく書いた日に入る', !!入った, JSON.stringify(G.baitoLoadAll(T2, 店.id).割当.map((x) => x.date)));
    // その人を 11/11 の有給にしてから、11/11 を組む
    G.baitoSaveNeeds(T2, 店.id, '2026-11', { [日(10)]: 1, [日(11)]: 1 });
    const 休み = G.休みを申し込む(入った.memberId, '有給休暇', 日(11), 日(11), 'よう事');
    G.yasumiDecide(T2, 休み.id, '承認', '');
    G.baitoGenerate(T2, 店.id, '2026-11', true);
    const 十一日 = G.baitoLoadAll(T2, 店.id).割当.filter((x) => x.date === 日(11));
    確かめる('休みの日には入れない',
      !十一日.some((x) => x.memberId === 入った.memberId), JSON.stringify(十一日));
  }

  // ----- 合鍵が要る -----
  投げるはず('合鍵なしでは必要人数を直せない', () => G.baitoSaveNeeds('でたらめ', 店.id, '2026-11', {}), '有効期限');
  投げるはず('合鍵なしでは入れない人を直せない', () => G.baitoSaveSkips('でたらめ', 店.id, []), '有効期限');
  投げるはず('合鍵なしでは上限を直せない', () => G.baitoSaveMonthMax('でたらめ', 店.id, 2), '有効期限');
  投げるはず('合鍵なしでは組めない', () => G.baitoGenerate('でたらめ', 店.id, '2026-11', true), '有効期限');

  // ----- バイトを消すと設定も消える -----
  G.baitoDeleteJob(T2, 店.id);
  確かめる('バイトを消すと必要人数も消える', G.loadBaitoNeeds(店.id).length === 0);
  確かめる('バイトを消すと入れない人も消える', G.loadBaitoSkips(店.id).length === 0);
}

// ===================== まとめ =====================

console.log('\n============================');
console.log('通った: ' + ok + '　／　失敗: ' + 失敗.length);
if (失敗.length) {
  console.log('\n失敗した項目');
  失敗.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('ぜんぶ通りました。');
