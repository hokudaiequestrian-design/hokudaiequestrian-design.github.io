/*
  入口（マイページ）の中身。build.js が入口ページに埋め込む。

  ここは静的サイトでだけ動く。GAS の画面からは別プロジェクトの人員表APIを呼べないので、
  原本の hub.html には入れていない（入れても向こうでは動かない）。
  API の2本は build.js が上に差し込む（const API = { 当番: …, 人員表: … }）。

  覚えるのは「名前」。当番・手入れ（m_xxxxxxxxxx）と大会人員表（m_001）で部員IDの体系が違い、
  画面が全部おなじドメインに並んでいるので、IDのまま覚えると画面を移るたびに当てが外れる。

  真ん中は**直近1週間のカレンダー**（2026-09-12に変更）。
  前は決まった予定を日付順に並べていたが、大会は競技の数だけ行が出るので、
  1つの大会だけで画面が埋まり、手入れや当番が押し出されていた。いまは
    ・大会中の仕事は日ごとに「大会」1行にまとめる（仕事の名前は重複を消して添えるだけ）
    ・選手として出場する競技だけは別の行にする（馬場の出番と障害の下付きの取り違え防止）
    ・何も無い日も枠として出す
  ようにして、同じ日に手入れや当番が重なっていればその場で気づけるようにしてある。
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const 一週間 = 7;

  // 通信のせいで失敗したときは 通信: true を付ける（サーバに断られたのと分けて、送り直すか決めるため）
  async function 呼ぶ(api, fn, args) {
    let r;
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ fn: fn, args: args || [] }),
      });
      if (!res.ok) throw new Error('つながりませんでした（' + res.status + '）');
      r = await res.json();
    } catch (e) {
      const err = /^つながりませんでした/.test((e && e.message) || '') ? e : new Error('つながりませんでした');
      err.通信 = true;
      throw err;
    }
    if (!r.ok) throw new Error(r.error || '不明なエラーが起きました。');
    return r.value;
  }

  /*
    人員表のぶんは、まず Cloudflare の写しから読む（2026-09-13）。
    Apps Script は1回の往復に2〜30秒かかるが、写しは0.1秒前後で返る。
    写しは GAS が毎分「変わっていたら」置くので、最大1〜2分遅れる。
    手元に写しより新しい版があれば手元を使い、写しが読めなければ Apps Script に聞く。
  */
  const 版の時刻 = (v) => Number(String(v == null ? '' : v).split('.')[0]) || 0;

  function 写しを読む(道) {
    const 止める = typeof AbortController === 'function' ? new AbortController() : null;
    const 時間切れ = setTimeout(() => { if (止める) 止める.abort(); }, 5000);
    return fetch(API.写し + 道, { cache: 'no-store', signal: 止める ? 止める.signal : undefined })
      .then((res) => {
        if (!res.ok) throw new Error('写しを読めませんでした（' + res.status + '）');
        return res.json();
      })
      .then((r) => {
        if (!r.ok) throw new Error(r.error || '写しを読めませんでした');
        return r.value;
      })
      .finally(() => clearTimeout(時間切れ));
  }

  // 返りは { 返事: getMyPage と同じ形, 写し: 写しから読んだか }
  async function 人員表を読む(名, 持っている版) {
    if (API.写し) {
      try {
        const r = await 写しを読む('/jinin/mypage?name=' + encodeURIComponent(名) +
          (持っている版 ? '&v=' + encodeURIComponent(持っている版) : ''));
        // 手元のほうが新しい（前に Apps Script から直に取った）なら、古い写しで戻さない
        if (!r.同じ && 持っている版 && 版の時刻(r.版) < 版の時刻(持っている版)) {
          return { 返事: { 版: 持っている版, 同じ: true }, 写し: true };
        }
        return { 返事: r, 写し: true };
      } catch (e) { /* 写しが読めなければ Apps Script に聞く */ }
    }
    return { 返事: await 呼ぶ(API.人員表, 'getMyPage', [名, 持っている版]), 写し: false };
  }

  const 覚えた名前 = () => { try { return localStorage.getItem('me') || ''; } catch (e) { return ''; } };
  const 名前を覚える = (n) => { try { localStorage.setItem('me', n); } catch (e) { /* 保存できない設定でも動かす */ } };

  /*
    前に取った中身を覚えておき、**開いた瞬間にそれを出す**（2026-09-13）。
    Apps Script は1回の往復に2〜5秒かかる。待っているあいだ真っ白だと「遅い」のではなく
    「壊れている」ように見えるので、前回のぶんを先に出して、届いたら差し替える。
  */
  const 保存する = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* いっぱいなら諦める */ } };
  const 取り出す = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const 鍵 = (名) => 'mypage:' + 名;

  // ----- 日付。シートと同じ 2026-09-15 の文字列のまま足し引きする -----
  const 曜日名 = ['日', '月', '火', '水', '木', '金', '土'];

  function 日付に(s) {
    const p = String(s || '').split('-');
    if (p.length !== 3) return null;
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  function 文字に(d) {
    const z = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function 足す(s, 日数) {
    const d = 日付に(s);
    if (!d) return s;
    d.setDate(d.getDate() + 日数);
    return 文字に(d);
  }
  // 2026-09-15 → 9/15（月）
  function 和風(s) {
    const d = 日付に(s);
    return d ? (d.getMonth() + 1) + '/' + d.getDate() + '（' + 曜日名[d.getDay()] + '）' : String(s || '');
  }
  const 曜日 = (s) => { const d = 日付に(s); return d ? 曜日名[d.getDay()] : ''; };

  const 節 = (題, 中身) => '<section class="me-sec"><h2>' + 題 + '</h2>' + 中身 + '</section>';

  // ----- 1週間ぶんを日ごとに集める -----
  /**
   * 日付 → その日にあること、の表を作る。
   * 種類は 出場／大会／手入れ／当番／休み の5つ。並べる順もこの順で、
   * 間違えると事故になるもの（出場・大会）を上に置く。
   */
  function 一週間を組む(t, j, 今日) {
    const 日々 = [];
    const 表 = {};
    for (let i = 0; i < 一週間; i++) {
      const d = 足す(今日, i);
      表[d] = [];
      日々.push(d);
    }
    const 入れる = (date, x) => { if (表[date]) 表[date].push(x); };

    // 手入れ（日付で組んだぶん）
    ((t && t.予定) || []).forEach((x) => {
      入れる(x.date, { 種類: '手入れ', 本文: x.馬 + (x.記号 ? '（' + x.記号 + '）' : '') });
    });
    // 手入れ・当番（曜日で組んだぶん）は、その曜日に当たる日に置く。
    // 期間の開始日〜終了日の外には置かない（2026-09-30。夏休みの当番が秋にも出ていた）
    const 期間の中 = (c, d) => (!c.from || d >= c.from) && (!c.to || d <= c.to);
    日々.forEach((d) => {
      const w = 曜日(d);
      ((t && t.毎週の手入れ) || []).forEach((c) => {
        if (c.曜日 === w && 期間の中(c, d)) 入れる(d, { 種類: '手入れ', 本文: c.馬 + (c.記号 ? '（' + c.記号 + '）' : '') });
      });
      ((((t || {}).当番) || {}).決まったぶん || []).forEach((c) => {
        if (c.曜日 === w && 期間の中(c, d)) 入れる(d, { 種類: '当番', 本文: c.当番 });
      });
    });
    // 休み。期間なので、またぐ日すべてに置く
    ((t && t.休み) || []).forEach((l) => {
      日々.forEach((d) => {
        if (d >= l.from && d <= (l.to || l.from)) {
          // バイトはバイト先の名前で出す（部員には「バイト」と書かない）
          入れる(d, { 種類: '休み', バイト: l.kind === 'バイト', 本文: (l.label || l.kind) + (l.state === '申請中' ? '（了承待ち）' : '') });
        }
      });
    });
    // 大会。仕事はその日ぶんを1行にまとめ、出場する競技だけ別の行にする
    ((j && j.大会) || []).forEach((ev) => {
      (ev.日 || []).forEach((day) => {
        if (!day.date || !表[day.date] || day.行けない) return;
        (day.出場 || []).forEach((x) => {
          入れる(day.date, {
            種類: '出場',
            本文: (x.競技 || '出場') + (x.馬 ? '　' + x.馬 + 'で出ます' : ''),
            添え: ev.name,
          });
        });
        const 仕事 = (day.仕事 || []).join('・');
        入れる(day.date, {
          種類: '大会',
          本文: ev.name,
          添え: 仕事 || ((day.出場 || []).length ? '' : '仕事はまだ決まっていません'),
        });
      });
    });

    const 順 = { 出場: 0, 大会: 1, 手入れ: 2, 当番: 3, 休み: 4 };
    日々.forEach((d) => { 表[d].sort((a, b) => 順[a.種類] - 順[b.種類]); });
    return { 日々: 日々, 表: 表 };
  }

  /**
   * 同じ日に別ものが入っていたら教える。
   * 出場と大会は同じ大会の話なので、まとめて1つとして数える。
   * 手入れと当番はどちらも毎日のことで、同じ日にあってふつうなので知らせない。
   * （大会や休みと重なったときは、そこに手入れ・当番も並べて出す）
   */
  const 毎日のこと = { 手入れ: true, 当番: true };

  function 重なり(items) {
    const ある = {};
    items.forEach((x) => { ある[x.種類 === '出場' ? '大会' : x.種類] = true; });
    const 組 = ['大会', '手入れ', '当番', '休み'].filter((k) => ある[k]);
    if (組.every((k) => 毎日のこと[k])) return '';
    return 組.length >= 2 ? 組.join('と') + 'が重なっています' : '';
  }

  const 印 = { 出場: 'run', 大会: 'meet', 手入れ: 'care', 当番: 'duty', 休み: 'off' };

  function 週の見た目(t, j, 今日) {
    const 組 = 一週間を組む(t, j, 今日);
    const 中身 = 組.日々.map((d) => {
      const items = 組.表[d];
      const 注意 = 重なり(items);
      const 行 = items.length
        ? items.map((x) =>
            '<div class="ev ev-' + 印[x.種類] + (x.バイト ? ' ev-baito' : '') + '">' +
              '<span class="k">' + esc(x.種類) + '</span>' +
              '<span class="b">' + esc(x.本文) + '</span>' +
              (x.添え ? '<span class="s">' + esc(x.添え) + '</span>' : '') +
            '</div>').join('')
        : '<div class="ev none">予定なし</div>';
      return '<div class="me-day' + (d === 今日 ? ' today' : '') + '">' +
        '<div class="d"><span class="dd">' + esc(和風(d)) + '</span>' +
          (d === 今日 ? '<span class="now">今日</span>' : '') + '</div>' +
        '<div class="x">' + 行 +
          (注意 ? '<p class="warn">' + esc(注意) + '</p>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="me-week">' + 中身 + '</div>';
  }

  // ----- 1週間より先。いつ何があるかだけ分かればよいので1行ずつ -----
  function 先の予定(t, j, 今日) {
    const 週末 = 足す(今日, 一週間 - 1);
    const out = [];
    ((t && t.予定) || []).forEach((x) => {
      if (x.date > 週末) out.push({ date: x.date, いつ: 和風(x.date), なに: '手入れ　' + x.馬, 印: '手入れ' });
    });
    ((j && j.大会) || []).forEach((ev) => {
      if (ev.終わった) return;
      const 日 = (ev.日 || []).map((x) => x.date).filter((x) => x && x > 週末).sort();
      if (!日.length) {
        // 期間をまだ入れていない大会。カレンダーには置けないので、ここで名前だけ出す
        const 日付あり = (ev.日 || []).some((x) => x.date);
        if (!日付あり && (ev.日 || []).length) out.push({ date: '9999-99-99', いつ: '日にち未定', なに: ev.name, 印: '大会' });
        return;
      }
      out.push({
        date: 日[0],
        いつ: 和風(日[0]) + (日.length > 1 ? '〜' + 和風(日[日.length - 1]) : ''),
        なに: ev.name,
        印: '大会',
      });
    });
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out.slice(0, 6).map((x) =>
      '<div class="me-row"><span class="when">' + esc(x.いつ) + '</span>' +
      '<span class="what">' + esc(x.なに) + '</span>' +
      '<span class="tag">' + esc(x.印) + '</span></div>').join('');
  }

  /**
   * いま出したばかりのページ。出した直後は、まだサーバの返事に反映されていないので、
   * **返事を待たずにその行を消す**（楽観的な先出し）。各ページに差し込んだ
   * スクリプト（build.js）が、送信できたときにここへ書く。
   */
  function 出したところ() {
    const v = 取り出す('mypage:出したところ');
    if (!v || !v.url) return null;
    return Date.now() - (v.時刻 || 0) < 10 * 60 * 1000 ? v : null;   // 10分だけ効かせる
  }

  /*
    出欠の画面で「受け付けた」けれど、まだ届いたと確かめていない送信（taikai:送り待ち）。
    出欠の画面は押した瞬間に受け付けて裏で送るので、送り終わる前に閉じられることがある。
    ここ（マイページ）を開いたときにも送り直す。1分たっていないものは、まだ飛んでいる最中かもしれないので待つ。
    書き方は出欠の画面（人員表システム_GAS/member.html の 送り待ちを直す）と同じにしてある。
  */
  function 送り待ちを直す(x, 届いた) {
    const 鍵 = x.memberId + '|' + x.eventId;
    const 待ち = 取り出す('taikai:送り待ち') || {};
    if (待ち[鍵] && 待ち[鍵].時刻 === x.時刻) { delete 待ち[鍵]; 保存する('taikai:送り待ち', 待ち); }
    const 手元 = 取り出す('taikai:手元:' + 鍵);
    if (!手元 || 手元.時刻 < x.時刻) return;
    if (届いた && 手元.時刻 === x.時刻) {
      手元.時刻 = Date.now();
      保存する('taikai:手元:' + 鍵, 手元);
    } else if (!届いた) {
      try { localStorage.removeItem('taikai:手元:' + 鍵); } catch (e) { /* 消せなくても害は無い */ }
    }
  }

  function 送り待ちを送る() {
    const 待ち = 取り出す('taikai:送り待ち') || {};
    Object.keys(待ち).forEach((k) => {
      const x = 待ち[k];
      if (!x || Date.now() - (x.時刻 || 0) < 60 * 1000) return;
      呼ぶ(API.人員表, 'submitResponse', [x.eventId, x.memberId, x.answers, x.comment, x.rides]).then(() => {
        送り待ちを直す(x, true);
        保存する('mypage:出したところ', { url: 'taikai.html', 時刻: Date.now() });
      }, (e) => {
        if (!e.通信) 送り待ちを直す(x, false);   // 断られた（大会が消えた など）ものは送り直さない
      });
    });
  }

  /*
    行き先には「どれの話か」を付ける（2026-09-13）。
    付けないと、飛んだ先でもう一度その大会／その期間を選ばされる。
    受け取る側（各画面の URLの()）は、知らない値なら今までどおり選ばせる。
    url は押す先、ページ は「出したかどうか」を見分ける鍵（?付きだと当たらない）。
  */
  function まだのものを集める(t, j) {
    const out = [];
    (((t && t.当番) || {}).期間 || []).forEach((x) => {
      if (!x.出した) out.push({ ページ: 'touban.html', url: 'touban.html?term=' + encodeURIComponent(x.id), t: '当番の希望　' + x.name });
    });
    ((t && t.手入れ) || []).forEach((p) => {
      if (p.broken || p.出した) return;
      const 進み = p.日数 ? '（' + p.入れた + '／' + p.日数 + '日）' : '';
      out.push({ ページ: 'teire.html', url: 'teire.html?plan=' + encodeURIComponent(p.id), t: '手入れの希望　' + p.horse + 進み });
    });
    ((j && j.大会) || []).forEach((ev) => {
      if (ev.終わった || ev.出した) return;
      out.push({ ページ: 'taikai.html', url: 'taikai.html?event=' + encodeURIComponent(ev.id), t: '大会の出欠　' + ev.name });
    });
    return out;
  }

  /**
   * 画面を「節」の集まりとして組む。1節＝1つの箱で、**中身が変わった節だけを書き換える**
   * （下の 描く）。全部を作り直すと、読んでいる途中で画面が飛ぶうえ、
   * スマホでは毎回ここが重くなる。
   */
  function 節々(t, j, 困った, 更新中, 写しが追いついていない) {
    const 章 = [];
    const 知らせ = [];

    if (更新中) 知らせ.push('<p class="me-fresh">前回の内容です。いま新しいぶんを読んでいます…</p>');
    if (困った.length) {
      知らせ.push('<p class="me-msg">' + 困った.map(esc).join('<br>') +
        '<br>出せなかったところだけ空になっています。下のリンクからは今までどおり使えます。</p>');
    }
    章.push({ id: 'meNotice', html: 知らせ.join('') });

    if (t && !t.me && j && !j.me) {
      return [{ id: 'meNotice', html: '<p class="me-msg">その名前が名簿にありません。副将に伝えてください。</p>' }];
    }

    // これからの1週間
    const 今日 = (t && t.今日) || 文字に(new Date());
    章.push({ id: 'meWeek', html: 節('これからの1週間', 週の見た目(t, j, 今日)) });

    // 1週間より先
    const 先 = 先の予定(t, j, 今日);
    章.push({ id: 'meSoon', html: 先 ? 節('1週間より先', '<div class="me-list">' + 先 + '</div>') : '' });

    // まだ出していないもの。いま出したばかりのぶんは、返事を待たずに消しておく。
    // 写しがまだ出す前の中身のとき（最大1〜2分）も消しておく
    const 出した = (更新中 || 写しが追いついていない) ? 出したところ() : null;
    const まだ = まだのものを集める(t, j).filter((x) => !出した || x.ページ !== 出した.url);
    章.push({ id: 'meTodo', html: 節('まだ出していないもの', まだ.length
      ? '<div class="me-list">' + まだ.map((x) =>
          '<a class="me-todo" href="' + esc(x.url) + '">' +
            '<span class="mi">未</span><span class="t">' + esc(x.t) + '</span>' +
            '<span class="go"><svg viewBox="0 0 10 16" aria-hidden="true" focusable="false"><use href="#i-go"/></svg></span>' +
          '</a>').join('') + '</div>'
      : '<div class="me-done">ぜんぶ出してあります。</div>') });

    // 毎週決まっているもの・サブの馬・有給
    const 事実 = [];
    const 当番 = ((((t || {}).当番) || {}).決まったぶん) || [];
    // 終わった期間はサーバが外してある。これから始まる期間は「○/○から」を添える（2026-09-30）
    const 今日の日 = (t && t.今日) || '';
    const から = (c) => (c.from && c.from > 今日の日 ? '（' + Number(c.from.slice(5, 7)) + '/' + Number(c.from.slice(8, 10)) + 'から）' : '');
    if (当番.length) 事実.push('<div>毎週の当番　' + esc(当番.map((c) => c.曜日 + '曜 ' + c.当番 + から(c)).join('／')) + '</div>');
    // チーフの名前は出さない（2026-09-13にユーザーが決めた。自分のページに要らない）
    const 馬 = ((t && t.手入れ) || []).map((p) => p.horse);
    if (馬.length) 事実.push('<div>サブの馬　' + esc(馬.join('／')) + '</div>');
    // 馬休日の手入れグループ（2026-11-09）。副将が決める。入っていない人には出さない
    if (t && t.馬休日グループ) 事実.push('<div>馬休日グループ <b>' + esc(t.馬休日グループ) + '</b></div>');
    // 一限がある曜日（2026-10-21）。押して入れ外しする。朝練の馬配で前半の馬に入れるのに使う
    if (t && t.me) {
      const 一限 = t.一限 || [];
      事実.push('<div class="me-ichigen"><span>一限がある曜日</span>' + ['月', '火', '水', '木', '金', '土'].map((w) =>
        '<button type="button" data-ichigen="' + w + '" aria-pressed="' + (一限.indexOf(w) >= 0) + '">' + w + '</button>').join('') + '</div>');
    }
    if (t && t.有給) {
      事実.push('<div>有給の残り　<b>' + esc(t.有給.残り) + '</b> 日' +
        (t.有給.待ち ? '<span class="tag" style="margin-left:8px;">了承待ち ' + esc(t.有給.待ち) + '日</span>' : '') + '</div>');
    }
    章.push({ id: 'meFacts', html: 事実.length ? '<div class="me-facts">' + 事実.join('') + '</div>' : '' });

    // チーフの馬休の申請（2026-11-07）。カレンダーより上。チーフ用の入口だけ
    if (馬休の入る口() && t && t.me) 章.push({ id: 'meKyu', html: 馬休の枠 });
    章.push({ id: 'meCal', html: カレンダーの節 });
    return 章;
  }

  /*
    みんなのカレンダー（2026-09-13）。できた手入れ表とみんなの休みを、月ごとに見る画面（calendar.html）への入口。
    自分の予定は上の「これからの1週間」に出ているので、ここは「みんなのぶん」を見に行く枠。
    名前を選ぶ前から出す（見るだけならパスワードも名前も要らない）。
  */
  const カレンダーの節 = 節('カレンダー',
    '<div class="me-cal">' +
      '<a class="off" href="calendar.html?tab=cal">カレンダー<span class="d">みんなの休み・バイト・大会</span></a>' +
      '<a class="care" href="calendar.html?tab=teire">手入れ予定<span class="d">どの日に誰がどの馬の手入れか</span></a>' +
    '</div>');

  // 検査用。画面では使わない（画面は 描く のほうを通る）
  const 組み立てる = (t, j, 困った, 更新中, 追いつかず) => 節々(t, j, 困った, 更新中, 追いつかず).map((s) => s.html).join('');

  /**
   * 節を突き合わせて、**中身が変わった節だけ** innerHTML を入れ替える。
   * 変わっていない節には触らないので、読んでいる位置も、押しかけのリンクも飛ばない。
   */
  const 描いた = {};
  function 描く(t, j, 困った, 更新中, 追いつかず) {
    const 本体 = $('meBody');
    if (!本体) return;
    const 欲しい = 節々(t, j, 困った, 更新中, 追いつかず);
    const 残り = {};
    Array.prototype.forEach.call(本体.children, (el) => { 残り[el.id] = el; });

    欲しい.forEach((s, i) => {
      let el = 残り[s.id];
      if (el) delete 残り[s.id];
      else { el = document.createElement('div'); el.id = s.id; }
      if (描いた[s.id] !== s.html) { el.innerHTML = s.html; 描いた[s.id] = s.html; }
      if (本体.children[i] !== el) 本体.insertBefore(el, 本体.children[i] || null);
    });
    Object.keys(残り).forEach((k) => { 残り[k].remove(); delete 描いた[k]; });
    // チーフの馬休の枠を描いたら、その中身を出す（読んだものは覚えてあるので、枠を描き直しても出せる）
    if (欲しい.some((x) => x.id === 'meKyu')) 馬休を出す(覚えた名前());
  }

  /*
    朝練の馬配（2026-10-21 ユーザーの指示：確定したら、みんなのマイページのいちばん上に）。
    サーバは確定した今日・明日のぶんを返す。版が同じあいだは前の返事を使い回すので、
    日付が変わったあとに前の日のぶんが残らないよう、ここで自分の今日より前を落とす。
  */
  /*
    2026-10-21 ユーザーの指示：部室のホワイトボードに寄せる（写真あり）。
    白いボードに 前半・後半（集合の30分後・その1時間後）の2列、馬と人はマグネット（左から1鞍目・2鞍目…）、右に出席の欄、下に掃除。
    日付・時間・欄の名前はマーカーの手書き風（Klee One）、マグネットは印字したラベル風（明朝）。
    自分の名前と乗る馬は黄色いマグネット（ボードの黄色いテープの感じ）。
  */
  const 傾き = ['-1.2deg', '0.6deg', '-0.4deg', '1deg', '-0.8deg', '0.3deg', '1.3deg'];
  function マグネット(文字, cls, i) {
    return '<span class="mg' + (cls ? ' ' + cls : '') + '" style="--tilt:' + 傾き[i % 傾き.length] + '">' + esc(文字) + '</span>';
  }
  function 手書きの字を読む() {
    if (document.getElementById('wbFont')) return;
    const l = document.createElement('link');
    l.id = 'wbFont';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Klee+One:wght@600&display=swap';
    document.head.appendChild(l);
  }
  function ボードの日付(key) {
    const d = new Date(key + 'T00:00:00');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + '日月火水木金土'.charAt(d.getDay()) + '）';
  }
  function 馬配の見た目(x, 名, 今日) {
    let 私 = '';
    let n = 0;
    // 一限の人のマグネットは若干黄色く（2026-10-21）。名前はサーバが出席の「一限」に入れてくる（欄としては出さない）
    const 一限 = ((x.出席 || []).filter((s) => s.欄 === '一限')[0] || { 人: [] }).人;
    const 時 = x.時刻 || { 前: '6:00', 後: '7:00' };   // 集合の30分後・その1時間後（サーバが出す。古い返りは前の決め打ち）
    const 列 = [['前', 時.前 + '〜'], ['後', 時.後 + '〜']].map((k) => {
      const 行 = (x[k[0]] || []).map((r) => {
        const 乗る = 名 && r.人.indexOf(名) >= 0;
        const 人 = r.人.map((p, i) => {
          if (名 && p === 名) 私 += (私 ? ' と ' : '') + r.馬 + ' の ' + (i + 1) + '鞍目（' + k[1] + '）';   // 二頭乗りなら2頭とも（2026-10-21）
          return マグネット(p, 名 && p === 名 ? 'mine' : 一限.indexOf(p) >= 0 ? 'ichigen' : '', n++);
        }).join('');
        return '<div class="wb-row">' + マグネット(r.馬, 'horse' + (乗る ? ' mine' : ''), n++) + '<span class="wb-riders">' + 人 + '</span></div>';
      }).join('');
      return '<div class="wb-col"><div class="wb-hand wb-time">' + k[1] + '</div>' + (行 || '<p class="wb-none wb-hand">なし</p>') + '</div>';
    }).join('');
    // 一限は黄色いマグネットで分かるので、出席の欄には出さない（2026-10-22 ユーザーの指示）
    const 出席 = (x.出席 || []).filter((s) => s.欄 !== '一限').map((s) =>
      '<div class="wb-srow"><span class="wb-hand wb-lab">' + esc(s.欄) + '</span><span class="wb-mags">' +
      s.人.map((p) => マグネット(p, 名 && p === 名 ? 'mine sm' : 'sm', n++)).join('') + '</span></div>').join('');
    const 掃除 = ((x.掃除 || []).length || x.掃除場所)
      ? '<div class="wb-souji"><span class="wb-hand wb-lab">掃除</span>' +
        (x.掃除場所 ? '<span class="wb-hand wb-place">' + esc(x.掃除場所) + '</span>' : '') + '<span class="wb-hand wb-names">' + (x.掃除 || []).map((p) => (名 && p === 名 ? '<b class="me">' + esc(p) + '</b>' : esc(p))).join('・') + '</span></div>' : '';
    // 馬休コーナー（2026-10-21）：馬と手入れの人。古い返り（馬休が無い）は馬だけ
    const 馬休 = x.馬休 || (x.休む馬 || []).map((h) => ({ 馬: h, 人: '' }));
    馬休.forEach((k) => { if (名 && k.人 === 名) 私 += (私 ? '、' : '') + '馬休の ' + k.馬 + ' の手入れ'; });
    const 休む馬 = 馬休.length
      ? '<div class="wb-souji"><span class="wb-hand wb-lab">馬休</span><span class="wb-mags">' + 馬休.map((k) => '<span class="wb-kyu">' + マグネット(k.馬, 'horse sm', n++) +
          (k.人 ? マグネット(k.人, 名 && k.人 === 名 ? 'mine sm' : 一限.indexOf(k.人) >= 0 ? 'ichigen sm' : 'sm', n++) : '') + '</span>').join('') + '</span></div>' : '';
    return '<section class="me-uh" aria-label="朝練の馬配">' +
      '<div class="wb-board">' +
      '<div class="wb-top"><span class="wb-hand wb-date">' + esc(ボードの日付(x.date)) + '</span>' +
      '<span class="wb-when">' + (x.date === 今日 ? '今日' : '明日') + 'の朝練</span></div>' +
      (名 ? '<p class="wb-me">' + (私 ? 'あなたは ' + esc(私) : 'あなたは乗る馬に入っていません') + '</p>' : '') +
      '<div class="wb-main">' + 列 +
      (出席 ? '<div class="wb-side"><div class="wb-hand wb-time">出席</div>' + 出席 + '</div>' : '') + '</div>' +
      (掃除 || 休む馬 ? '<div class="wb-bottom">' + 掃除 + 休む馬 + '</div>' : '') +
      '</div></section>';
  }

  function 馬配を出す(並び, 名) {
    let 箱 = $('meUmahai');
    if (!箱) {
      const 先頭 = document.querySelector('main .me-pick');
      if (!先頭 || !先頭.parentNode) return;
      箱 = document.createElement('div');
      箱.id = 'meUmahai';
      先頭.parentNode.insertBefore(箱, 先頭.parentNode.firstChild);   // ページのいちばん上
    }
    const 今日 = 文字に(new Date());
    const html = (並び || []).filter((x) => x.date >= 今日).map((x) => 馬配の見た目(x, 名, 今日)).join('');
    if (html) 手書きの字を読む();
    // 前に描いた文字と比べる（中身の innerHTML は 動き.js が付けるクラスで変わるので比べない。2026-10-21）
    if (箱.dataset.html !== html) { 箱.innerHTML = html; 箱.dataset.html = html; }
  }

  /*
    一限がある曜日を押したとき（2026-10-21）。押した見た目はすぐ変え、保存できたら読み直す。
  */
  let 今の = { 名: '', t: null };
  function 一限を押せるようにする() {
    const 本体 = $('meBody');
    if (!本体) return;
    本体.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ichigen]');
      if (!b || !今の.t || !今の.t.me) return;
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      const 曜日 = Array.prototype.filter.call(本体.querySelectorAll('[data-ichigen]'), (x) => x.getAttribute('aria-pressed') === 'true')
        .map((x) => x.dataset.ichigen);
      try {
        await 呼ぶ(API.当番, 'saveFirstPeriod', [今の.t.me.id, 曜日]);
        出す(今の.名);
      } catch (err) {
        alert('一限の曜日を保存できませんでした：' + err.message);
        出す(今の.名);
      }
    });
  }

  // 名簿を選べるようにする。名簿は当番側のどの getMyPage でも一緒に返ってくる。
  function 名簿を並べる(sel, members, 名) {
    if (!members || !members.length) return;
    sel.innerHTML = '<option value="">選択してください</option>' +
      members.map((m) => '<option value="' + esc(m.name) + '">' + esc(m.name) + (m.grade ? '（' + m.grade + '年）' : '') + '</option>').join('');
    if (名 && members.some((m) => m.name === 名)) sel.value = 名;
  }

  async function 出す(名) {
    // 名前を選んでいなくても、カレンダーの枠だけは出す
    if (!名) { $('meBody').innerHTML = '<div id="meCal">' + カレンダーの節 + '</div>'; Object.keys(描いた).forEach((k) => { delete 描いた[k]; }); return; }
    名前を覚える(名);

    // 前に取ってあるぶんを先に出す。通信を待たずに読み始められる。
    const 前 = 取り出す(鍵(名));
    if (前) { 描く(前.t, 前.j, [], true); 馬配を出す(前.t && 前.t.馬配, 名); }
    else $('meBody').innerHTML = '<p class="me-msg">読み込んでいます…</p>';

    let t = null, j = null;
    let 版t = 前 && 前.版t, 版j = 前 && 前.版j;
    let 変わった = false;
    let jは写し = false;
    const 困った = [];
    const sel = $('meSelect');

    // 持っている版を渡す。何も書き替わっていなければ「同じ」とだけ返るので、
    // 送られてくる量も、画面を書き換える手間もゼロになる。
    await Promise.all([
      呼ぶ(API.当番, 'getMyPage', [名, 前 ? 版t : null]).then((r) => {
        if (r && r.同じ) { t = 前.t; return; }
        t = r; 版t = r.版; 変わった = true;
        if (sel && sel.options.length <= 1) 名簿を並べる(sel, r.members, 名);   // 名簿もこの返りに入っている
      }).catch((e) => 困った.push('当番・手入れを読めませんでした：' + e.message)),
      人員表を読む(名, 前 ? 版j : null).then((x) => {
        const r = x.返事;
        jは写し = x.写し;
        if (r && r.同じ) { j = 前.j; return; }
        j = r; 版j = r.版; 変わった = true;
      }).catch((e) => 困った.push('大会のぶんを読めませんでした：' + e.message)),
    ]);

    // 出欠を出したのが写しの版より後なら、写しにはまだ載っていない
    const 印 = 出したところ();
    const 追いつかず = !!印 && 印.url === 'taikai.html' && jは写し && 版の時刻(版j) < 印.時刻;

    // 両方そろったときだけ覚える（片方だけ新しい、という中身にしない）
    if (t && j) {
      if (変わった) 保存する(鍵(名), { t: t, j: j, 版t: 版t, 版j: 版j });
      if (!追いつかず) {
        try { localStorage.removeItem('mypage:出したところ'); } catch (e) { /* 消せなくても10分で切れる */ }
      }
    }
    if ((!t || !j) && 前) {
      困った.push('読めなかったところは、前回の内容を出しています。');
      if (!t) t = 前.t;
      if (!j) j = 前.j;
    }
    描く(t, j, 困った, false, 追いつかず);
    今の = { 名: 名, t: t };
    if (t) 馬配を出す(t.馬配, 名);
  }

  /*
    馬配がなおったら、開いている画面にもすぐ出す（2026-11-05 ユーザーの指示）。
    サーバーの /live に WebSocket でつないでおくと、馬配を保存・直した瞬間に知らせが来る。
    知らせが来たら馬配だけ読み直す（版が同じなら「同じ」とだけ返るので、通信も描き直しもほぼゼロ）。
    切れたら少しずつ間をあけてつなぎ直す。つなぎ直したとき・画面に戻ったときも読み直す（見逃し防止）。
  */
  async function 馬配を読み直す() {
    const 名 = 今の.名 || 覚えた名前();
    const 前 = 名 ? 取り出す(鍵(名)) : null;
    const r = await 呼ぶ(API.当番, 'getMyPage', [名, 前 ? 前.版t : null]);
    if (!r || r.同じ) return;
    if (前) { 前.t = r; 前.版t = r.版; 保存する(鍵(名), 前); }
    if (名) 今の = { 名: 名, t: r };
    馬配を出す(r.馬配, 名);
  }

  function 馬配の知らせを受ける() {
    if (typeof WebSocket !== 'function') return;
    const 住所 = String(API.当番).replace(/^http/, 'ws').replace(/\/touban$/, '/live');
    let 待ち = 1000, ping = null, 読み中 = false, また = false;
    const 読む = async () => {
      if (読み中) { また = true; return; }   // 読んでいる最中に知らせが来たら、終わってからもう一度
      読み中 = true;
      try { do { また = false; await 馬配を読み直す(); } while (また); } catch (e) { /* 通信できなければ、次の知らせかつなぎ直しで読む */ } finally { 読み中 = false; }
    };
    const つなぐ = () => {
      let ws;
      try { ws = new WebSocket(住所); } catch (e) { return; }
      ws.onopen = () => {
        待ち = 1000;
        読む();
        clearInterval(ping);
        ping = setInterval(() => { try { ws.send('ping'); } catch (e) { /* 切れたら onclose が来る */ } }, 30000);
      };
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        try { if (JSON.parse(e.data).更新 === '馬配') 読む(); } catch (x) { /* 読めない知らせは無視 */ }
      };
      ws.onclose = () => { clearInterval(ping); setTimeout(つなぐ, 待ち); 待ち = Math.min(待ち * 2, 30000); };
    };
    つなぐ();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) 読む(); });
  }

  /**
   * 開いたときの流れ。**待つ回数を減らすのが肝**（2026-09-13）。
   *   ・名簿だけを取る往復をやめた。当番側の getMyPage は名前を渡しても名簿を一緒に返すので、
   *     名前を覚えている人は **2回の往復（当番・人員表を同時）** だけで済む
   *   ・名簿も中身も前回のぶんを覚えてあるので、開いた瞬間は通信0回で出る
   */
  async function 始める() {
    const sel = $('meSelect');
    if (!sel) return;
    馬配の知らせを受ける();
    sel.addEventListener('change', () => 出す(sel.value));
    一限を押せるようにする();
    馬休を押せるようにする();
    送り待ちを送る();   // 出欠の画面で、届く前に閉じられたぶん

    const 名 = 覚えた名前();
    名簿を並べる(sel, 取り出す('mypage:名簿'), 名);   // 覚えている名簿ですぐ選べるようにする

    if (名) {
      await 出す(名);
      const t = (取り出す(鍵(名)) || {}).t;
      if (t && t.members) 保存する('mypage:名簿', t.members);
      return;
    }

    // 名前を選ぶ前でも、カレンダーの枠は出しておく（見るだけなら名前は要らない）
    出す('');

    // まだ誰も選んでいないときだけ、名簿を取りに行く
    try {
      const r = await 呼ぶ(API.当番, 'getMyPage', ['']);
      名簿を並べる(sel, r.members, '');
      馬配を出す(r.馬配, '');
      保存する('mypage:名簿', r.members || []);
    } catch (e) {
      if (sel.options.length <= 1) {
        sel.innerHTML = '<option value="">名簿を読めませんでした</option>';
        $('meBody').innerHTML = '<p class="me-msg">名簿を読めませんでした：' + esc(e.message) +
          '<br>下のリンクからは今までどおり使えます。</p>';
      }
    }
  }

  /*
    副将のログイン（2026-09-15 ユーザーの指示：副将は入口でだけパスワードを入れ、マイページから行き来するあいだは聞かない）。
    副将の入口（?role=admlinks）の「みんなのぶんをまとめる」に、パスワードの欄を1つ置く。
    入れると当番・手入れと人員表の両方にログインし、鍵をこのタブの sessionStorage に置く（タブを閉じると消える）。
    副将の各画面は、この鍵で開く（入口の鍵が無いときは、パスワードの欄ではなく入口への案内を出す）。
    ログインするまでは、まとめるほうのリンクを隠す。
  */
  /*
    了承待ちの休みの知らせ（2026-09-21 ユーザーの指示：副将のマイページの上のほうに、
    わかりやすく出す）。**副将がログインしているあいだだけ**出す。だれが・いつ休むかは
    副将の鍵が要る中身なので、パスワードを入れる前には出せない。
    ページのいちばん上（名前を選ぶ欄より前）に置く。#meBody の外なので、
    名前を選び直して中が描き直されても消えない。
  */
  const 知らせに出す数 = 5;

  // 10/2（金）／10/2（金）〜10/3（土）
  function 休みの日どり(l) {
    const 頭 = 和風(l.from);
    return l.to && l.to !== l.from ? 頭 + '〜' + 和風(l.to) : 頭;
  }

  function 休みの知らせの見た目(r) {
    const 待ち = (r && r.待ち) || [];
    if (!待ち.length) return '';
    const 行 = 待ち.slice(0, 知らせに出す数).map((l) =>
      '<div class="a-row">' +
        '<span class="who">' + esc(l.name) + '</span>' +
        '<span class="what">' + esc(l.kind) + '</span>' +
        '<span class="when">' + esc(休みの日どり(l)) + '</span>' +
        '<span class="days">' + esc(l.days) + '日</span>' +
      '</div>').join('');
    const 残り = 待ち.length - 知らせに出す数;
    return '<div class="me-alert" role="status">' +
      '<p class="a-head">休みの申し込みが <b>' + esc(待ち.length) + '件</b> 届いています</p>' +
      '<div class="a-list">' + 行 +
        (残り > 0 ? '<div class="a-more">ほか ' + esc(残り) + '件</div>' : '') +
      '</div>' +
      '<a class="a-go" href="yasumi-admin.html">休みをまとめる を開く' +
        '<svg viewBox="0 0 10 16" aria-hidden="true" focusable="false"><use href="#i-go"/></svg></a>' +
    '</div>';
  }

  function 知らせの箱() {
    let 箱 = $('meAlert');
    if (箱) return 箱;
    const 先頭 = document.querySelector('main .me-pick');
    if (!先頭 || !先頭.parentNode) return null;
    箱 = document.createElement('div');
    箱.id = 'meAlert';
    先頭.parentNode.insertBefore(箱, 先頭);
    return 箱;
  }

  async function 休みの知らせを出す(当番の鍵) {
    const 箱 = 知らせの箱();
    if (!箱) return;
    try {
      箱.innerHTML = 休みの知らせの見た目(await 呼ぶ(API.当番, 'yasumiPending', [当番の鍵]));
    } catch (e) {
      箱.innerHTML = '';   // 読めなくても入口のほかは今までどおり使える
    }
  }

  function 知らせを消す() {
    const 箱 = $('meAlert');
    if (箱) 箱.innerHTML = '';
  }

  /*
    2026-10-21 ユーザーの指示：副将のパスワードをなくして（質問して「端末で覚える」に決めた）。
    鍵とパスワードを localStorage に置き、**この端末ではログアウトするまで聞かない**。鍵は6時間で切れるので、
    切れていたら覚えたパスワードで入り直す（副将の各画面では build.js の call() が同じことをする）。
    パスワードが変わっていたら覚えたものを消して、入れ直してもらう。
  */
  const 副将の鍵の名 = { 当番: 'fukusho:touban', 人員表: 'fukusho:jinin', パスワード: 'fukusho:pw' };
  const 鍵を読む = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const 鍵を置く = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 置けなければ画面ごとに入口へ戻される */ } };
  const 鍵を消す = () => {
    try {
      localStorage.removeItem(副将の鍵の名.当番);
      localStorage.removeItem(副将の鍵の名.人員表);
      localStorage.removeItem(副将の鍵の名.パスワード);
      // 前（2026-10-20 まで）はタブごとに置いていた
      sessionStorage.removeItem(副将の鍵の名.当番);
      sessionStorage.removeItem(副将の鍵の名.人員表);
    } catch (e) { /* 消せなくても6時間で切れる */ }
  };
  async function パスワードで入る(pw) {
    const 鍵 = await Promise.all([呼ぶ(API.当番, 'login', [pw]), 呼ぶ(API.人員表, 'login', [pw])]);
    鍵を置く(副将の鍵の名.当番, 鍵[0]);
    鍵を置く(副将の鍵の名.人員表, 鍵[1]);
    鍵を置く(副将の鍵の名.パスワード, pw);
  }

  function 副将のログイン() {
    if (typeof 立場 === 'undefined' || 立場 !== 'admlinks' || typeof localStorage === 'undefined') return;
    const 群 = Array.prototype.filter.call(document.querySelectorAll('#hub-groups .hub-group'),
      (g) => !!g.querySelector('a.hub-link[href="touban-admin.html"]'))[0];
    if (!群) return;
    const 一覧 = 群.querySelector('.hub-list');
    const 箱 = document.createElement('div');
    箱.className = 'fk-login';
    一覧.parentNode.insertBefore(箱, 一覧);

    function 入っている() {
      一覧.hidden = false;
      箱.innerHTML = '<p class="fk-on"><span>副将でログインしています。この端末では、ログアウトするまでパスワードを聞きません。</span>' +
        '<button type="button" class="fk-out">ログアウト</button></p>';
      箱.querySelector('.fk-out').addEventListener('click', () => { 鍵を消す(); 入っていない('ログアウトしました。'); });
      休みの知らせを出す(鍵を読む(副将の鍵の名.当番));   // 了承待ちの休み（2026-09-21）
      // 副将がログインしたら、馬休の枠も読み直す（枠がまだ無いときは、出すときに読む）
      馬休の状態.名 = '';
      馬休を出す(覚えた名前());
    }
    function 入っていない(文) {
      一覧.hidden = true;
      知らせを消す();   // ログアウト・期限切れのあとに、前の中身を残さない
      箱.innerHTML = '<label for="fkPw">副将パスワード</label>' +
        '<div class="fk-row"><input type="password" id="fkPw" autocomplete="current-password"><button type="button" id="fkBtn">ログイン</button></div>' +
        '<p class="hint">ここで1回入れると、この端末では<b>ログアウトするまで</b>、当番・バイトと休み・部員・馬匹管理・人員表・手入れの画面でもパスワードを聞きません。</p>' +
        (文 ? '<p class="me-msg">' + esc(文) + '</p>' : '');
      const 押す = async () => {
        const pw = $('fkPw').value;
        if (!pw) return 入っていない('副将パスワードを入れてください。');
        try {
          await パスワードで入る(pw);
          入っている();
        } catch (e) { 入っていない(e.message); }
      };
      $('fkBtn').addEventListener('click', 押す);
      $('fkPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') 押す(); });
    }

    const 当番の鍵 = 鍵を読む(副将の鍵の名.当番);
    const 人員表の鍵 = 鍵を読む(副将の鍵の名.人員表);
    const pw = 鍵を読む(副将の鍵の名.パスワード);
    if (!pw && (!当番の鍵 || !人員表の鍵)) return 入っていない('');
    入っている();
    // 鍵がまだ生きているかを裏で確かめる。切れていたら覚えたパスワードで入り直す（通信の失敗では消さない）
    Promise.all([呼ぶ(API.当番, 'adminShareUrl', [当番の鍵]), 呼ぶ(API.人員表, 'adminShareUrl', [人員表の鍵])])
      .catch((e) => {
        if (e.通信) return;
        if (!pw) { 鍵を消す(); return 入っていない('ログインの有効期限が切れました。もう一度入れてください。'); }
        パスワードで入る(pw).then(() => 休みの知らせを出す(鍵を読む(副将の鍵の名.当番)), (err) => {
          if (err.通信) return;
          鍵を消す();
          入っていない('副将パスワードが変わったようです。もう一度入れてください。');
        });
      });
  }
  /*
    チーフの馬休（2026-11-07 ユーザーの指示）。チーフ用の入口（?role=chieflinks）のマイページだけに出す。
    カレンダーより上に、自分が担当する馬の馬休を、月ごとのチェックリストで決める。
    ・チェックを入れた日が馬休になる。申請ではなくチーフの決定なので、副将の承認は要らない
    ・すぐ付け外しできる。外すと、その日の馬休は取り消される
    ・月曜は基本馬休と書くが、チェックは最初から入れない
    ・大会の日は背景を緑にする。最初はチェックを入れない（入れること自体はできる）
    ・過ぎた日は変えられない
    ・チーフのパスワードは副将と同じく端末で覚える（6時間で切れたら覚えたもので入り直す）
    読むのは chiefLoadAll・chiefLoadUmaKyu と getCalendarData（大会の日）。決めるのは chiefSetUmaKyu。
  */
  const 馬休の入る口 = () => typeof 立場 !== 'undefined' && (立場 === 'chieflinks' || 立場 === 'admlinks');
  const 副将か = () => typeof 立場 !== 'undefined' && 立場 === 'admlinks';
  const 馬休の枠 = '<section class="me-sec me-kyu" aria-label="馬休"><h2>馬休</h2>' +
    '<div id="kyuBody"><p class="me-msg">読み込んでいます…</p></div></section>';
  const 馬休の状態 = {
    名: '', 馬: null, 月: '', 申請: [], 大会: {}, 選んだ: '',
    知らせ: '', 困った: '', 鍵が要る: false, 読んでいる: '',
  };
  const 馬休の色 = { '承認': 'kyu-ok', '申請中': 'kyu-req', '却下': 'kyu-no' };
  const 馬休の字 = { '承認': '馬休', '申請中': '申請中', '却下': '却下' };

  // ----- チーフの鍵。この端末で覚える（6時間で切れるので、切れる前に取り直す） -----
  const 鍵の長さ = 5.5 * 60 * 60 * 1000;
  function チーフの鍵を読む() {
    if (副将か()) return 鍵を読む(副将の鍵の名.当番);
    try {
      const t = localStorage.getItem('chief:tok') || '';
      return t && Date.now() - Number(localStorage.getItem('chief:tokAt') || 0) < 鍵の長さ ? t : '';
    } catch (e) { return ''; }
  }
  function チーフの鍵を置く(t, pw) {
    try {
      localStorage.setItem('chief:tok', t);
      localStorage.setItem('chief:tokAt', String(Date.now()));
      localStorage.setItem('chief:pw', pw);
    } catch (e) { /* 置けなければ、開くたびに入れてもらう */ }
  }
  function チーフの鍵を消す() {
    try {
      localStorage.removeItem('chief:tok');
      localStorage.removeItem('chief:tokAt');
      localStorage.removeItem('chief:pw');
    } catch (e) { /* 消せなくても6時間で切れる */ }
  }
  // 覚えたパスワード。無ければ null（空で覚えていれば ''）
  function 覚えたパスワード() {
    try { return localStorage.getItem(副将か() ? 副将の鍵の名.パスワード : 'chief:pw'); } catch (e) { return null; }
  }
  function 鍵が要る(文) {
    const e = new Error(文 || '');
    e.鍵が要る = true;
    return e;
  }
  async function チーフでログイン(pw) {
    if (副将か()) {
      // 副将は副将のパスワードで入る（チーフの鍵とは別。どちらの鍵もチーフの処理を受けられる）
      const t = await 呼ぶ(API.当番, 'login', [pw]);
      鍵を置く(副将の鍵の名.当番, t);
      鍵を置く(副将の鍵の名.パスワード, pw);
      return t;
    }
    const t = await 呼ぶ(API.当番, 'loginChief', [pw]);
    チーフの鍵を置く(t, pw);
    return t;
  }
  // 同時に何度頼まれても、入りは1回だけ走らせる（読み込みが並ぶと、入り直しが二重に走るため）
  let 入りの途中 = null;
  function チーフの鍵をもらう() {
    if (!入りの途中) 入りの途中 = チーフの鍵を入り直す().finally(() => { 入りの途中 = null; });
    return 入りの途中;
  }
  // 鍵が無い・切れたとき。覚えたパスワードで入り直す。覚えていなければ、パスワード無しで試す（設けていなければ通る）
  async function チーフの鍵を入り直す() {
    const pw = 覚えたパスワード();
    if (副将か() && pw === null) throw 鍵が要る('副将のログインが要ります。入口の「副将でログイン」で入れてください。');
    try {
      return await チーフでログイン(pw === null ? '' : pw);
    } catch (e) {
      if (e.通信) throw e;
      if (pw !== null && !副将か()) チーフの鍵を消す();
      throw 鍵が要る(pw === null ? '' : e.message);
    }
  }
  // チーフの処理を呼ぶ。引数は鍵の後ろに並ぶ
  async function チーフへ(fn, 引数) {
    const 手元 = チーフの鍵を読む();
    const t = 手元 || (await チーフの鍵をもらう());
    try {
      return await 呼ぶ(API.当番, fn, [t].concat(引数));
    } catch (e) {
      if (e.通信 || !/有効期限/.test(e.message)) throw e;
      return 呼ぶ(API.当番, fn, [await チーフの鍵をもらう()].concat(引数));
    }
  }

  // ----- 読む -----
  async function 大会を読む(月) {
    if (馬休の状態.大会[月]) return;
    const r = await 呼ぶ(API.当番, 'getCalendarData', [月]);
    const 日 = {};
    (r.大会 || []).forEach((ev) => {
      (ev.日 || []).forEach((d) => { 日[d] = 日[d] ? 日[d] + '・' + ev.name : ev.name; });
    });
    馬休の状態.大会[月] = 日;
  }

  // 担当の馬（チーフの名前が自分の名前の、使用中の馬）と、決まっている馬休と、今月の大会の日を読む
  async function 馬休を読む(名) {
    const s = 馬休の状態;
    s.読んでいる = 名;
    s.困った = '';
    try {
      const [全部, 一覧] = await Promise.all([チーフへ('chiefLoadAll', []), チーフへ('chiefLoadUmaKyu', [])]);
      s.馬 = (全部.horses || []).filter((h) => h.active && String(h.chief || '').trim() === 名).map((h) => ({ id: h.id, name: h.name }));
      s.申請 = 一覧 || [];
      s.名 = 名;
      s.鍵が要る = false;
      if (!s.月) s.月 = 文字に(new Date()).slice(0, 7);
      try { await 大会を読む(s.月); } catch (e) { s.知らせ = '大会の日を読めませんでした（馬休は決められます）。'; }
    } catch (e) {
      if (e.鍵が要る) { s.鍵が要る = true; s.知らせ = e.message; }
      else s.困った = e.message;
    } finally {
      s.読んでいる = '';
    }
    馬休を描く();
  }

  // ----- 見る -----
  function 選んだ馬() {
    const s = 馬休の状態;
    const 並び = (s.馬 || []).map((h) => h.id);
    return 並び.indexOf(s.選んだ) >= 0 ? s.選んだ : (並び[0] || '');
  }
  // 1日の見方：決まっている馬休・大会・曜日・チェックが入っているか・過ぎた日か
  function 日の見方(馬ID, key, 今日) {
    const s = 馬休の状態;
    const r = s.申請.filter((x) => x.horseId === 馬ID && x.date === key)[0];
    const 状態 = r ? r.state : '';
    const 大会名 = (s.大会[s.月] || {})[key] || '';
    return {
      状態: 状態,
      大会名: 大会名,
      曜: 日付に(key).getDay(),
      過ぎた: key < 今日,
      チェック: !!状態 && 状態 !== '却下',
    };
  }
  function その月の日(月) {
    const 初め = 日付に(月 + '-01');
    const 日数 = new Date(初め.getFullYear(), 初め.getMonth() + 1, 0).getDate();
    const 並び = [];
    for (let d = 1; d <= 日数; d++) 並び.push(月 + '-' + (d < 10 ? '0' + d : '' + d));
    return 並び;
  }
  function 馬休のログインを作る() {
    if (副将か()) return '<p class="hint">馬休を決めるには、副将のログインが要ります。上の「副将でログイン」で入れてください。</p>' +
      (馬休の状態.知らせ ? '<p class="me-msg" role="status">' + esc(馬休の状態.知らせ) + '</p>' : '');
    return '<p class="hint">馬休を決めるには、チーフのパスワードが要ります。この端末では、ログアウトするまで聞きません。</p>' +
      '<div class="kyu-login"><input type="password" id="kyuPw" autocomplete="current-password" aria-label="チーフのパスワード">' +
      '<button type="button" data-kyu-act="login">入る</button></div>' +
      (馬休の状態.知らせ ? '<p class="me-msg" role="status">' + esc(馬休の状態.知らせ) + '</p>' : '');
  }
  function 馬休のカレンダーを作る() {
    const s = 馬休の状態;
    const 馬ID = 選んだ馬();
    const 今日 = 文字に(new Date());
    const 初め = 日付に(s.月 + '-01');
    let 枠 = 曜日名.map((w) => '<div class="kyu-head">' + w + '</div>').join('');
    for (let i = 0; i < 初め.getDay(); i++) 枠 += '<div class="kyu-blank" aria-hidden="true"></div>';
    const 大会の一覧 = [];
    その月の日(s.月).forEach((key) => {
      const v = 日の見方(馬ID, key, 今日);
      const d = Number(key.slice(8));
      if (v.大会名) 大会の一覧.push(Number(key.slice(5, 7)) + '/' + d + '（' + 曜日名[v.曜] + '）' + v.大会名);
      const 印 = v.状態 ? (馬休の字[v.状態] || v.状態) : (v.大会名 ? '大会' : v.曜 === 1 ? '基本馬休' : '');
      const 色 = [v.曜 === 1 ? 'kyu-mon' : '', v.大会名 ? 'kyu-taikai' : '', v.過ぎた ? 'kyu-past' : ''].filter(Boolean).join(' ');
      枠 += '<label class="kyu-d ' + 色 + '"' + (v.大会名 ? ' title="' + esc(v.大会名) + '"' : '') + '>' +
        '<input type="checkbox" data-kyu-day="' + key + '"' + (v.チェック ? ' checked' : '') + (v.過ぎた ? ' disabled' : '') +
        ' aria-label="' + d + '日（' + 曜日名[v.曜] + '）馬休">' +
        '<span class="kyu-n">' + d + '</span>' +
        '<span class="kyu-t ' + (馬休の色[v.状態] || '') + '">' + esc(印) + '</span></label>';
    });
    const 選ぶ = s.馬.length > 1
      ? '<label class="kyu-horse">馬<select data-kyu-act="horse">' +
        s.馬.map((h) => '<option value="' + esc(h.id) + '"' + (h.id === 馬ID ? ' selected' : '') + '>' + esc(h.name) + '</option>').join('') +
        '</select></label>'
      : '<p class="kyu-one">' + esc(s.馬[0].name) + '</p>';
    return '<div class="kyu-top">' + 選ぶ +
      '<div class="kyu-month"><button type="button" data-kyu-act="prev" aria-label="前の月">‹</button>' +
      '<b>' + s.月.replace('-', '年') + '月</b>' +
      '<button type="button" data-kyu-act="next" aria-label="次の月">›</button></div></div>' +
      '<p class="hint">馬休にする日にチェックを入れてください。チーフの決定なので、副将の承認は要りません。外せばすぐ取り消せます。<b>月曜は基本馬休</b>ですが、チェックは最初から入っていません。<b>大会の日</b>は背景が緑です。過ぎた日は変えられません。</p>' +
      '<div class="kyu-grid">' + 枠 + '</div>' +
      (大会の一覧.length ? '<ul class="kyu-taikai-list">' + 大会の一覧.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      (副将か() ? '' : '<div class="kyu-act"><button type="button" class="secondary" data-kyu-act="logout">ログアウト</button></div>') +
      (s.知らせ ? '<p class="me-msg" role="status">' + esc(s.知らせ) + '</p>' : '');
  }
  function 馬休を描く() {
    const 箱 = $('kyuBody');
    if (!箱) return;
    const s = 馬休の状態;
    if (s.鍵が要る) 箱.innerHTML = 馬休のログインを作る();
    else if (s.困った) 箱.innerHTML = '<p class="me-msg">' + esc(s.困った) + '</p>';
    else if (!s.馬) 箱.innerHTML = '<p class="me-msg">読み込んでいます…</p>';
    else if (!s.馬.length) 箱.innerHTML = '<p class="me-msg">担当している馬がありません。副将に確認してください。</p>';
    else 箱.innerHTML = 馬休のカレンダーを作る();
  }
  // 枠が描かれたとき。中身を読めていれば描き直すだけ（読み直さない）。読めていなければ読む
  function 馬休を出す(名) {
    const s = 馬休の状態;
    if (!馬休の入る口() || !$('kyuBody') || !名) return;
    if (s.読んでいる === 名) return;
    if (s.名 === 名 && s.馬) return 馬休を描く();
    馬休を読む(名);
  }

  // ----- 押したとき -----
  // 決めは1つずつ順に送る（速く押しても、返りの順が入れ替わらないように）。送り中の数で、返りを使うか決める
  let 送る列 = Promise.resolve();
  let 送り中 = 0;
  function 決めを送る(送る) {
    送り中++;
    送る列 = 送る列.then(async () => {
      try {
        const 一覧 = await 送る();
        if (送り中 === 1) 馬休の状態.申請 = 一覧;   // 最後の1つの返りだけを、画面の中身にする
      } catch (e) {
        if (e.鍵が要る) { 馬休の状態.鍵が要る = true; 馬休の状態.知らせ = 'パスワードを入れ直してください。'; }
        else 馬休の状態.知らせ = 'うまく決められませんでした：' + e.message;
        // 送れなかったぶんを戻すため、いまの一覧を読み直す（読めなくても画面はそのまま）
        try { if (送り中 === 1) 馬休の状態.申請 = await チーフへ('chiefLoadUmaKyu', []); } catch (e2) { /* そのまま */ }
      } finally {
        送り中--;
      }
      馬休を描く();
    });
  }
  function 日を押す(key, on) {
    const s = 馬休の状態;
    const 馬ID = 選んだ馬();
    s.申請 = s.申請.filter((x) => !(x.horseId === 馬ID && x.date === key));
    if (on) s.申請.push({ horseId: 馬ID, date: key, state: '承認' });
    s.知らせ = '';
    馬休を描く();
    決めを送る(() => チーフへ('chiefSetUmaKyu', [馬ID, [key], on]));
  }
  async function 月を送る(d) {
    const s = 馬休の状態;
    const 初め = 日付に(s.月 + '-01');
    const 次 = new Date(初め.getFullYear(), 初め.getMonth() + d, 1);
    s.月 = 次.getFullYear() + '-' + String(次.getMonth() + 1).padStart(2, '0');
    s.知らせ = '';
    try { await 大会を読む(s.月); } catch (e) { s.知らせ = '大会の日を読めませんでした。'; }
    馬休を描く();
  }
  async function 馬休のログインを押す() {
    const 入れた = $('kyuPw');
    const pw = 入れた ? 入れた.value : '';
    馬休の状態.知らせ = '';
    try {
      await チーフでログイン(pw);
    } catch (e) {
      馬休の状態.知らせ = e.message;
      馬休を描く();
      return;
    }
    馬休の状態.鍵が要る = false;
    await 馬休を読む(覚えた名前());
  }
  function 馬休のログアウト() {
    チーフの鍵を消す();
    Object.assign(馬休の状態, { 名: '', 馬: null, 申請: [], 知らせ: '', 困った: '', 鍵が要る: true });
    馬休を描く();
  }
  // 馬休の枠の中の押し物。枠は描き直されるので、付けるのは #meBody（いつもある所）
  function 馬休を押せるようにする() {
    const 本体 = $('meBody');
    if (!本体) return;
    本体.addEventListener('click', (e) => {
      const b = e.target.closest('[data-kyu-act]');
      if (!b) return;
      const 行 = b.getAttribute('data-kyu-act');
      if (行 === 'login') 馬休のログインを押す();
      else if (行 === 'prev') 月を送る(-1);
      else if (行 === 'next') 月を送る(1);
      else if (行 === 'logout') 馬休のログアウト();
    });
    本体.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('input[data-kyu-day]')) 日を押す(t.getAttribute('data-kyu-day'), t.checked);
      else if (t.matches('select[data-kyu-act="horse"]')) { 馬休の状態.選んだ = t.value; 馬休を描く(); }
    });
  }

  try { 副将のログイン(); } catch (e) { /* 入口のほかの部分は動かす */ }

  始める();
})();
