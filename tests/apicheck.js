/**
 * 本物のウェブアプリに、外の画面と同じ形で投げて端から端まで通す。
 * ブラウザと同じく「POST → 302 → GET」の順で追う（Apps Script はこの形で返す）。
 * Cookie は一切送らない＝ログインしていないのと同じ状態で叩いている。
 *
 * 使い方: node apicheck.js
 */
const API = {
  当番: 'https://script.google.com/macros/s/AKfycbxRymAf5iGuZfmZE-CK2fwicbnj1tE6UZKywZ3cNDTkqxZp0aBAKIb67jYWfOzYorK2Yw/exec',
  人員表: 'https://script.google.com/macros/s/AKfycbxUWCdZAA0-JIhl2Pr10KbAIZSKY4hcn7MfFwRWODjd0WQBWmmA25A-GdtVb5mcK38MTQ/exec',
};

async function 呼ぶ(api, fn, args) {
  // Apps Script は続けて叩くと、たまにJSONではなくHTMLのエラーページを返す。
  // 本当に壊れているのか、その場かぎりのものかを分けるため、間を置いて1度だけ試し直す。
  let 最後 = null;
  for (let 回 = 0; 回 < 2; 回++) {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ fn: fn, args: args || [] }),
      redirect: 'follow',
    });
    const cors = res.headers.get('access-control-allow-origin');
    const body = await res.text();
    let 中身 = null;
    try { 中身 = JSON.parse(body); } catch (e) { /* HTMLが返ってきたときはそのまま見せる */ }
    最後 = { status: res.status, cors: cors, 中身: 中身, 生: body.slice(0, 160) };
    if (中身) return 最後;
    if (回 === 0) await new Promise((r) => setTimeout(r, 3000));
  }
  return 最後;
}

let ng = 0, 件 = 0;
const 確認 = (名, 条件, 補足) => {
  件++;
  if (!条件) { ng++; console.log('NG ' + 名 + (補足 ? '  ' + 補足 : '')); }
  else console.log('ok ' + 名 + (補足 ? '  ' + 補足 : ''));
};

(async () => {
  // --- パスワード不要の読み取りが通るか（＝外から本当に使えるか） ---
  const a = await 呼ぶ(API.当番, 'getDutyMemberData');
  確認('当番：getDutyMemberData が JSON で返る', a.中身 && a.中身.ok === true,
    a.中身 ? '' : 'status=' + a.status + ' 生=' + a.生);
  確認('当番：CORS が付いている', a.cors === '*', 'cors=' + a.cors);

  const b = await 呼ぶ(API.人員表, 'getMemberPageData');
  確認('人員表：getMemberPageData が JSON で返る', b.中身 && b.中身.ok === true,
    b.中身 ? '' : 'status=' + b.status + ' 生=' + b.生);
  確認('人員表：CORS が付いている', b.cors === '*', 'cors=' + b.cors);

  // 部員の名簿がちゃんと入って返ってくること（形だけでなく中身も見る）
  const 部員数 = b.中身 && b.中身.value && b.中身.value.members ? b.中身.value.members.length : 0;
  確認('人員表：部員が返ってくる', 部員数 > 0, 部員数 + '人');

  // --- 一覧に無い関数は弾かれるか（ここが緩いと誰でも叩けてしまう） ---
  const c = await 呼ぶ(API.当番, 'setupSheets');
  確認('当番：一覧に無い関数は弾く', c.中身 && c.中身.ok === false && /呼べない関数/.test(c.中身.error || ''),
    c.中身 ? c.中身.error : '');

  const d = await 呼ぶ(API.人員表, 'setAdminPassword');
  確認('人員表：一覧に無い関数は弾く', d.中身 && d.中身.ok === false && /呼べない関数/.test(d.中身.error || ''),
    d.中身 ? d.中身.error : '');

  // --- パスワードが要る関数は、合鍵なしでは通らないか ---
  const e = await 呼ぶ(API.当番, 'adminLoadAll', ['にせトークン']);
  確認('当番：合鍵なしの adminLoadAll は通らない', e.中身 && e.中身.ok === false,
    e.中身 ? e.中身.error : '');

  const f = await 呼ぶ(API.人員表, 'adminLoadAll', ['にせトークン']);
  確認('人員表：合鍵なしの adminLoadAll は通らない', f.中身 && f.中身.ok === false,
    f.中身 ? f.中身.error : '');

  // --- 合言葉が違えばログインできないこと ---
  const g = await 呼ぶ(API.当番, 'login', ['ちがうパスワード']);
  確認('当番：違うパスワードではログインできない', g.中身 && g.中身.ok === false,
    g.中身 ? g.中身.error : '');

  // --- 日本語がそのまま往復するか（文字化けしないこと） ---
  const h = await 呼ぶ(API.人員表, 'getMyResponse', ['無い大会', '無い部員']);
  確認('人員表：日本語の引数でも落ちない', h.中身 !== null,
    h.中身 ? (h.中身.ok ? '通った' : h.中身.error) : '生=' + h.生);

  // --- マイページ（入口が両方を1回ずつ呼ぶ） ---
  const i = await 呼ぶ(API.当番, 'getMyPage', ['']);
  const 名簿 = i.中身 && i.中身.ok && i.中身.value.members ? i.中身.value.members : [];
  確認('当番：getMyPage が名簿を返す', 名簿.length > 0, 名簿.length + '人');

  if (名簿.length) {
    const 名 = 名簿[0].name;
    const k = await 呼ぶ(API.当番, 'getMyPage', [名]);
    const v = k.中身 && k.中身.ok ? k.中身.value : null;
    確認('当番：getMyPage が自分のぶんを返す',
      !!(v && v.me && v.当番 && Array.isArray(v.予定)),
      v && v.me ? 'サブ ' + v.手入れ.length + '頭・受付中 ' + v.当番.期間.length + '件・有給 ' + (v.有給 ? v.有給.残り + '日' : 'なし')
        : (k.中身 ? k.中身.error : k.生));

    const l = await 呼ぶ(API.人員表, 'getMyPage', [名]);
    const w = l.中身 && l.中身.ok ? l.中身.value : null;
    確認('人員表：getMyPage が大会を返す', !!(w && Array.isArray(w.大会)),
      w ? '大会 ' + w.大会.length + '件' : (l.中身 ? l.中身.error : l.生));
  }

  console.log(ng ? ng + '件 失敗' : 件 + '件 すべて通過');
  process.exit(ng ? 1 : 0);
})();
