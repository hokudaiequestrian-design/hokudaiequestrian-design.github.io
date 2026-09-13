/*
  人員表の「表示用の写し」を配る窓口（Cloudflare Workers）。2026-09-13に作った。

  なぜ要るか：
  Apps Script は1回の往復に2〜30秒かかる（しばらく使われないと眠り、起こすのに時間がかかる）。
  読むだけの画面（マイページ・出欠の画面）まで毎回そこを待つのをやめ、
  GAS が毎分「変わっていたら」送ってくる写しを、ここから0.1秒前後で返す。

  決まりごと：
  - **書き込みはここを通らない。** 出欠の送信や管理者の操作は、今までどおり Apps Script に送る。
  - 写しを置けるのは、鍵（Worker の secret の WRITE_KEY）を持っている GAS だけ。
  - **写しを丸ごと返す口は作らない。** 返すのは、今の Apps Script でもパスワード無しで
    取れるぶん（getMyPage・getMemberPageData・getMyResponse と同じ中身）だけ。
    写しには全員の出欠の返事が入っているので、「名前を渡してその人のぶん」に限る。
  - GET にしてあるのは、ブラウザが事前確認（preflight）を投げない単純なリクエストにするため。

    GET  /jinin/mypage?name=名前&v=持っている版  → getMyPage(名前, 版) と同じ形
    GET  /jinin/taikai?name=名前                  → 出欠の画面に要るぶんを1回で
    PUT  /jinin   （Authorization: Bearer 鍵）    → GAS が写しを置く
*/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

const 返す = (中身, status) => new Response(JSON.stringify(中身), {
  status: status || 200,
  headers: Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    // 古い写しをブラウザや途中に残さない（新しさは中の「版」で判断する）
    'Cache-Control': 'no-store',
  }, CORS),
});

// 鍵の突き合わせ。1文字目で違うと早く返る比べ方だと、時間から鍵を当てられるので全部比べる
function 鍵が合う(req, env) {
  const 期待 = String(env.WRITE_KEY || '');
  const 来た = String(req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!期待 || 来た.length !== 期待.length) return false;
  let 差 = 0;
  for (let i = 0; i < 期待.length; i++) 差 |= 期待.charCodeAt(i) ^ 来た.charCodeAt(i);
  return 差 === 0;
}

/*
  読んだ写しを数秒だけ覚える。同じ Worker が続けて呼ばれたとき、
  KV の読み取り（無料枠は1日10万回）と JSON の読み直しを省く。
  新しい写しが置かれたら、置いた Worker ではその場で差し替わる。
*/
const 覚える秒 = 5;
let 覚え = null;

async function 写しを読む(env) {
  if (覚え && Date.now() - 覚え.時刻 < 覚える秒 * 1000) return 覚え.束;
  const 束 = await env.DATA.get('jinin', 'json');
  if (束) 覚え = { 束: 束, 時刻: Date.now() };
  return 束;
}

const 名前 = (url) => String(url.searchParams.get('name') || '').trim();

// 同じ名前が2人いたら GAS の getMyPage と同じく先の人。写しを作る側で先の人だけ入れてある
const その人 = (束, 名) => (名 && 束.人 && Object.prototype.hasOwnProperty.call(束.人, 名) ? 束.人[名] : null);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/jinin') {
      if (req.method !== 'PUT') return 返す({ ok: false, error: '置くとき以外は使いません' }, 405);
      if (!鍵が合う(req, env)) return 返す({ ok: false, error: '鍵が違います' }, 401);
      const 本文 = await req.text();
      let 束;
      try { 束 = JSON.parse(本文); } catch (e) { return 返す({ ok: false, error: 'JSONではありません' }, 400); }
      if (!束 || !束.版 || !束.人 || !束.出欠画面) return 返す({ ok: false, error: '写しの形が違います' }, 400);
      await env.DATA.put('jinin', 本文);
      覚え = { 束: 束, 時刻: Date.now() };
      return 返す({ ok: true, 版: 束.版, バイト: 本文.length });
    }

    if (req.method !== 'GET') return 返す({ ok: false, error: '読むだけの窓口です' }, 405);
    if (url.pathname !== '/jinin/mypage' && url.pathname !== '/jinin/taikai') {
      return 返す({ ok: false, error: 'ありません' }, 404);
    }

    const 束 = await 写しを読む(env);
    if (!束) return 返す({ ok: false, error: 'まだ写しが届いていません' }, 503);

    if (url.pathname === '/jinin/mypage') {
      const 持っている = url.searchParams.get('v');
      if (持っている && 持っている === 束.版) return 返す({ ok: true, value: { 版: 束.版, 同じ: true } });
      const 人 = その人(束, 名前(url));
      const value = Object.assign({}, 人 ? 人.マイページ : { me: null, 大会: [] }, { 版: 束.版 });
      return 返す({ ok: true, value: value });
    }

    // /jinin/taikai：getMemberPageData と、その人の全大会ぶんの getMyResponse を1回で
    const 人 = その人(束, 名前(url));
    return 返す({
      ok: true,
      value: {
        版: 束.版,
        data: 束.出欠画面,
        memberId: 人 ? 人.id : '',
        返事: 人 ? 人.返事 : {},
      },
    });
  },
};
