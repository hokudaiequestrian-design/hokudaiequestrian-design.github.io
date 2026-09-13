/**
 * 写しの窓口（worker/index.mjs）を、模擬の KV で動かして確かめる。
 *
 *   node tests/workertest.js
 *
 * 見ているもの：鍵が無いと置けない／名前を渡した人のぶんだけ返す／写しを丸ごと返す口が無い／
 * 版が同じなら「同じ」だけ返す／ブラウザから読めるように CORS が付く。
 */
const path = require('path');
const { pathToFileURL } = require('url');

let ok = 0;
const 失敗 = [];
function 確かめる(名, 条件, 補足) {
  if (条件) { ok++; return; }
  失敗.push(名);
  console.log('  ✗ ' + 名 + (補足 ? '　→ ' + 補足 : ''));
}

(async () => {
  const worker = (await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'index.mjs')).href)).default;

  const 箱 = {};
  const env = {
    WRITE_KEY: 'test-key-0123456789',
    DATA: {
      get: async (k, type) => (箱[k] === undefined ? null : (type === 'json' ? JSON.parse(箱[k]) : 箱[k])),
      put: async (k, v) => { 箱[k] = v; },
    },
  };
  const 呼ぶ = async (method, p, 本文, 鍵) => {
    const headers = {};
    if (鍵) headers.Authorization = 'Bearer ' + 鍵;
    const res = await worker.fetch(new Request('https://x.workers.dev' + p, { method: method, headers: headers, body: 本文 }), env);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 空の返事もある */ }
    return { status: res.status, json: json, headers: res.headers };
  };

  const 束 = {
    版: '1789256375057.219396',
    出欠画面: { members: [{ id: 'm_001', name: '美浦', grade: 2 }], horses: ['北叡'], events: [{ id: 'e1', name: '春季大会', days: [] }] },
    人: {
      美浦: {
        id: 'm_001',
        マイページ: { me: { id: 'm_001', name: '美浦', grade: 2 }, 大会: [{ id: 'e1', name: '春季大会' }] },
        返事: { e1: { answers: [{ date: '2026-09-20', attending: false }], comment: '私だけの理由', entries: [] } },
      },
      相棒: {
        id: 'm_002',
        マイページ: { me: { id: 'm_002', name: '相棒' }, 大会: [] },
        返事: { e1: { answers: [], comment: '相棒の秘密の理由', entries: [] } },
      },
    },
  };

  console.log('== 置く ==');
  確かめる('写しが無いうちは 503', (await 呼ぶ('GET', '/jinin/mypage?name=美浦')).status === 503);
  確かめる('鍵なしでは置けない', (await 呼ぶ('PUT', '/jinin', JSON.stringify(束))).status === 401);
  確かめる('違う鍵では置けない', (await 呼ぶ('PUT', '/jinin', JSON.stringify(束), 'test-key-0123456780')).status === 401);
  確かめる('長さの違う鍵でも置けない', (await 呼ぶ('PUT', '/jinin', JSON.stringify(束), 'test')).status === 401);
  確かめる('鍵なしで置こうとしても中身は変わらない', 箱.jinin === undefined);
  確かめる('形の違うものは置けない', (await 呼ぶ('PUT', '/jinin', '{"版":"1"}', env.WRITE_KEY)).status === 400);
  確かめる('JSONでなければ置けない', (await 呼ぶ('PUT', '/jinin', 'こんにちは', env.WRITE_KEY)).status === 400);
  const 置いた = await 呼ぶ('PUT', '/jinin', JSON.stringify(束), env.WRITE_KEY);
  確かめる('正しい鍵なら置ける', 置いた.status === 200 && 置いた.json.ok && 置いた.json.版 === 束.版, JSON.stringify(置いた.json));

  console.log('== マイページ ==');
  const 美浦 = await 呼ぶ('GET', '/jinin/mypage?name=' + encodeURIComponent('美浦'));
  確かめる('名前を渡すとその人のマイページ', 美浦.json.value.me.name === '美浦' && 美浦.json.value.大会.length === 1, JSON.stringify(美浦.json));
  確かめる('版が付く（GASの getMyPage と同じ形）', 美浦.json.value.版 === 束.版);
  確かめる('ブラウザから読める（CORS）', 美浦.headers.get('Access-Control-Allow-Origin') === '*');
  確かめる('途中に残させない', /no-store/.test(美浦.headers.get('Cache-Control') || ''));
  確かめる('名前の前後の空白は無視', (await 呼ぶ('GET', '/jinin/mypage?name=' + encodeURIComponent(' 美浦 '))).json.value.me.name === '美浦');
  const 同じ = await 呼ぶ('GET', '/jinin/mypage?name=' + encodeURIComponent('美浦') + '&v=' + 束.版);
  確かめる('同じ版なら「同じ」だけ', 同じ.json.value.同じ === true && !同じ.json.value.大会, JSON.stringify(同じ.json));
  const 違う版 = await 呼ぶ('GET', '/jinin/mypage?name=' + encodeURIComponent('美浦') + '&v=1.1');
  確かめる('違う版なら中身を返す', !!違う版.json.value.大会);
  const いない = await 呼ぶ('GET', '/jinin/mypage?name=' + encodeURIComponent('いない人'));
  確かめる('名簿に無い人は me が null（GASと同じ）', いない.json.value.me === null && Array.isArray(いない.json.value.大会));
  確かめる('名前なしでも誰かのぶんは出ない', (await 呼ぶ('GET', '/jinin/mypage')).json.value.me === null);
  確かめる('toString のような名前でも壊れない', (await 呼ぶ('GET', '/jinin/mypage?name=toString')).json.value.me === null);

  console.log('== 出欠の画面 ==');
  const 出欠 = await 呼ぶ('GET', '/jinin/taikai?name=' + encodeURIComponent('美浦'));
  確かめる('名簿と大会が1回で来る', 出欠.json.value.data.members.length === 1 && 出欠.json.value.data.events.length === 1);
  確かめる('自分の返事が大会ごとに来る', 出欠.json.value.返事.e1.comment === '私だけの理由');
  確かめる('部員IDが付く', 出欠.json.value.memberId === 'm_001');
  確かめる('ほかの人の理由は入らない', JSON.stringify(出欠.json).indexOf('相棒の秘密の理由') < 0);
  const 名なし = await 呼ぶ('GET', '/jinin/taikai');
  確かめる('名前なしなら返事は空', JSON.stringify(名なし.json.value.返事) === '{}' && 名なし.json.value.memberId === '');

  console.log('== 丸ごと返す口が無い ==');
  確かめる('GET /jinin は使えない', (await 呼ぶ('GET', '/jinin')).status === 405);
  確かめる('知らない道は 404', (await 呼ぶ('GET', '/jinin/all')).status === 404);
  確かめる('読む道に PUT はできない', (await 呼ぶ('PUT', '/jinin/mypage', '{}', env.WRITE_KEY)).status === 405);
  const 事前 = await worker.fetch(new Request('https://x.workers.dev/jinin/mypage', { method: 'OPTIONS' }), env);
  確かめる('事前確認（OPTIONS）に答える', 事前.status === 204 && 事前.headers.get('Access-Control-Allow-Origin') === '*');

  console.log('\n' + (失敗.length ? '✗ ' + 失敗.length + '件失敗' : '✓ ぜんぶ通った') + '（' + ok + '/' + (ok + 失敗.length) + '）');
  if (失敗.length) process.exit(1);
})();
