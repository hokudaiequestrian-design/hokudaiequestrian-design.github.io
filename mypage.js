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

  async function 呼ぶ(api, fn, args) {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ fn: fn, args: args || [] }),
    });
    if (!res.ok) throw new Error('つながりませんでした（' + res.status + '）');
    const r = await res.json();
    if (!r.ok) throw new Error(r.error || '不明なエラーが起きました。');
    return r.value;
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
    // 手入れ・当番（曜日で組んだぶん）は、その曜日に当たる日に置く
    日々.forEach((d) => {
      const w = 曜日(d);
      ((t && t.毎週の手入れ) || []).forEach((c) => {
        if (c.曜日 === w) 入れる(d, { 種類: '手入れ', 本文: c.馬 + (c.記号 ? '（' + c.記号 + '）' : '') });
      });
      ((((t || {}).当番) || {}).決まったぶん || []).forEach((c) => {
        if (c.曜日 === w) 入れる(d, { 種類: '当番', 本文: c.当番 });
      });
    });
    // 休み。期間なので、またぐ日すべてに置く
    ((t && t.休み) || []).forEach((l) => {
      日々.forEach((d) => {
        if (d >= l.from && d <= (l.to || l.from)) {
          入れる(d, { 種類: '休み', 本文: l.kind + (l.state === '申請中' ? '（了承待ち）' : '') });
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
   */
  function 重なり(items) {
    const ある = {};
    items.forEach((x) => { ある[x.種類 === '出場' ? '大会' : x.種類] = true; });
    const 組 = ['大会', '手入れ', '当番', '休み'].filter((k) => ある[k]);
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
            '<div class="ev ev-' + 印[x.種類] + '">' +
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

  function まだのものを集める(t, j) {
    const out = [];
    (((t && t.当番) || {}).期間 || []).forEach((x) => {
      if (!x.出した) out.push({ url: 'touban.html', t: '当番の希望　' + x.name });
    });
    ((t && t.手入れ) || []).forEach((p) => {
      if (p.broken || p.出した) return;
      const 進み = p.日数 ? '（' + p.入れた + '／' + p.日数 + '日）' : '';
      out.push({ url: 'teire.html', t: '手入れの希望　' + p.horse + 進み });
    });
    ((j && j.大会) || []).forEach((ev) => {
      if (ev.終わった || ev.出した) return;
      out.push({ url: 'taikai.html', t: '大会の出欠　' + ev.name });
    });
    return out;
  }

  /**
   * 画面を「節」の集まりとして組む。1節＝1つの箱で、**中身が変わった節だけを書き換える**
   * （下の 描く）。全部を作り直すと、読んでいる途中で画面が飛ぶうえ、
   * スマホでは毎回ここが重くなる。
   */
  function 節々(t, j, 困った, 更新中) {
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

    // まだ出していないもの。いま出したばかりのぶんは、返事を待たずに消しておく
    const 出した = 更新中 ? 出したところ() : null;
    const まだ = まだのものを集める(t, j).filter((x) => !出した || x.url !== 出した.url);
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
    if (当番.length) 事実.push('<div>毎週の当番　' + esc(当番.map((c) => c.曜日 + '曜 ' + c.当番).join('／')) + '</div>');
    // チーフの名前は出さない（2026-09-13にユーザーが決めた。自分のページに要らない）
    const 馬 = ((t && t.手入れ) || []).map((p) => p.horse);
    if (馬.length) 事実.push('<div>サブの馬　' + esc(馬.join('／')) + '</div>');
    if (t && t.有給) {
      事実.push('<div>有給の残り　<b>' + esc(t.有給.残り) + '</b> 日' +
        (t.有給.待ち ? '<span class="tag" style="margin-left:8px;">了承待ち ' + esc(t.有給.待ち) + '日</span>' : '') + '</div>');
    }
    章.push({ id: 'meFacts', html: 事実.length ? '<div class="me-facts">' + 事実.join('') + '</div>' : '' });

    return 章;
  }

  // 検査用。画面では使わない（画面は 描く のほうを通る）
  const 組み立てる = (t, j, 困った, 更新中) => 節々(t, j, 困った, 更新中).map((s) => s.html).join('');

  /**
   * 節を突き合わせて、**中身が変わった節だけ** innerHTML を入れ替える。
   * 変わっていない節には触らないので、読んでいる位置も、押しかけのリンクも飛ばない。
   */
  const 描いた = {};
  function 描く(t, j, 困った, 更新中) {
    const 本体 = $('meBody');
    if (!本体) return;
    const 欲しい = 節々(t, j, 困った, 更新中);
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
  }

  // 名簿を選べるようにする。名簿は当番側のどの getMyPage でも一緒に返ってくる。
  function 名簿を並べる(sel, members, 名) {
    if (!members || !members.length) return;
    sel.innerHTML = '<option value="">選択してください</option>' +
      members.map((m) => '<option value="' + esc(m.name) + '">' + esc(m.name) + (m.grade ? '（' + m.grade + '年）' : '') + '</option>').join('');
    if (名 && members.some((m) => m.name === 名)) sel.value = 名;
  }

  async function 出す(名) {
    if (!名) { $('meBody').innerHTML = ''; Object.keys(描いた).forEach((k) => { delete 描いた[k]; }); return; }
    名前を覚える(名);

    // 前に取ってあるぶんを先に出す。通信を待たずに読み始められる。
    const 前 = 取り出す(鍵(名));
    if (前) 描く(前.t, 前.j, [], true);
    else $('meBody').innerHTML = '<p class="me-msg">読み込んでいます…</p>';

    let t = null, j = null;
    let 版t = 前 && 前.版t, 版j = 前 && 前.版j;
    let 変わった = false;
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
      呼ぶ(API.人員表, 'getMyPage', [名, 前 ? 版j : null]).then((r) => {
        if (r && r.同じ) { j = 前.j; return; }
        j = r; 版j = r.版; 変わった = true;
      }).catch((e) => 困った.push('大会のぶんを読めませんでした：' + e.message)),
    ]);

    // 両方そろったときだけ覚える（片方だけ新しい、という中身にしない）
    if (t && j) {
      if (変わった) 保存する(鍵(名), { t: t, j: j, 版t: 版t, 版j: 版j });
      try { localStorage.removeItem('mypage:出したところ'); } catch (e) { /* 消せなくても10分で切れる */ }
    }
    if ((!t || !j) && 前) {
      困った.push('読めなかったところは、前回の内容を出しています。');
      if (!t) t = 前.t;
      if (!j) j = 前.j;
    }
    描く(t, j, 困った, false);
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
    sel.addEventListener('change', () => 出す(sel.value));

    const 名 = 覚えた名前();
    名簿を並べる(sel, 取り出す('mypage:名簿'), 名);   // 覚えている名簿ですぐ選べるようにする

    if (名) {
      await 出す(名);
      const t = (取り出す(鍵(名)) || {}).t;
      if (t && t.members) 保存する('mypage:名簿', t.members);
      return;
    }

    // まだ誰も選んでいないときだけ、名簿を取りに行く
    try {
      const r = await 呼ぶ(API.当番, 'getMyPage', ['']);
      名簿を並べる(sel, r.members, '');
      保存する('mypage:名簿', r.members || []);
    } catch (e) {
      if (sel.options.length <= 1) {
        sel.innerHTML = '<option value="">名簿を読めませんでした</option>';
        $('meBody').innerHTML = '<p class="me-msg">名簿を読めませんでした：' + esc(e.message) +
          '<br>下のリンクからは今までどおり使えます。</p>';
      }
    }
  }

  始める();
})();
