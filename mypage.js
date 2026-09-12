/*
  入口（マイページ）の中身。build.js が入口ページに埋め込む。

  ここは静的サイトでだけ動く。GAS の画面からは別プロジェクトの人員表APIを呼べないので、
  原本の hub.html には入れていない（入れても向こうでは動かない）。
  API の2本は build.js が上に差し込む（const API = { 当番: …, 人員表: … }）。

  覚えるのは「名前」。当番・手入れ（m_xxxxxxxxxx）と大会人員表（m_001）で部員IDの体系が違い、
  画面が全部おなじドメインに並んでいるので、IDのまま覚えると画面を移るたびに当てが外れる。
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

  // 2026-09-15 → 9/15（月）
  function 和風(d) {
    const p = String(d || '').split('-');
    if (p.length !== 3) return String(d || '');
    const dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return Number(p[1]) + '/' + Number(p[2]) + '（' + '日月火水木金土'[dt.getDay()] + '）';
  }

  const 節 = (題, 中身) => '<section class="me-sec"><h2>' + 題 + '</h2>' + 中身 + '</section>';
  const 行 = (いつ, なに, 印) =>
    '<div class="me-row"><span class="when">' + esc(いつ) + '</span>' +
    '<span class="what">' + esc(なに) + '</span>' +
    (印 ? '<span class="tag">' + esc(印) + '</span>' : '') + '</div>';

  function 予定を集める(t, j) {
    const out = [];
    ((t && t.予定) || []).forEach((x) => {
      out.push({ date: x.date, なに: '手入れ　' + x.馬 + (x.記号 ? '（' + x.記号 + '）' : ''), 印: '手入れ' });
    });
    ((j && j.大会) || []).forEach((ev) => {
      (ev.予定 || []).forEach((x) => {
        const 中 = [x.競技, x.仕事 || (x.馬 ? x.馬 + 'に付く' : '')].filter((v) => v).join('　');
        out.push({ date: x.date, なに: ev.name + '　' + 中, 印: '大会' });
      });
    });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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

  function 組み立てる(t, j, 困った) {
    const 章 = [];

    if (困った.length) {
      章.push('<p class="me-msg">' + 困った.map(esc).join('<br>') +
        '<br>出せなかったところだけ空になっています。下のリンクからは今までどおり使えます。</p>');
    }
    if (t && !t.me && j && !j.me) {
      return '<p class="me-msg">その名前が名簿にありません。副将に伝えてください。</p>';
    }

    // これからの予定
    const 予定 = 予定を集める(t, j);
    章.push(節('これから', 予定.length
      ? '<div class="me-list">' + 予定.slice(0, 8).map((x) => 行(和風(x.date), x.なに, x.印)).join('') + '</div>'
      : '<div class="me-done">決まっている予定はまだありません。</div>'));

    // まだ出していないもの
    const まだ = まだのものを集める(t, j);
    章.push(節('まだ出していないもの', まだ.length
      ? '<div class="me-list">' + まだ.map((x) =>
          '<a class="me-todo" href="' + esc(x.url) + '">' +
            '<span class="mi">未</span><span class="t">' + esc(x.t) + '</span>' +
            '<span class="go"><svg viewBox="0 0 10 16" aria-hidden="true" focusable="false"><use href="#i-go"/></svg></span>' +
          '</a>').join('') + '</div>'
      : '<div class="me-done">ぜんぶ出してあります。</div>'));

    // 毎週決まっているもの
    const 毎週 = []
      .concat((((t && t.当番) || {}).決まったぶん || []).map((c) => 行(c.曜日 + '曜', '当番　' + c.当番, '当番')))
      .concat(((t && t.毎週の手入れ) || []).map((c) => 行(c.曜日 + '曜', '手入れ　' + c.馬 + (c.記号 ? '（' + c.記号 + '）' : ''), '手入れ')));
    if (毎週.length) 章.push(節('毎週', '<div class="me-list">' + 毎週.join('') + '</div>'));

    // サブの馬と有給
    const 事実 = [];
    const 馬 = ((t && t.手入れ) || []).map((p) => p.horse + (p.chief ? '（チーフ ' + p.chief + '）' : ''));
    if (馬.length) 事実.push('<div>サブの馬　' + esc(馬.join('／')) + '</div>');
    if (t && t.有給) {
      事実.push('<div>有給の残り　<b>' + esc(t.有給.残り) + '</b> 日' +
        (t.有給.待ち ? '<span class="tag" style="margin-left:8px;">了承待ち ' + esc(t.有給.待ち) + '日</span>' : '') + '</div>');
    }
    if (事実.length) 章.push('<div class="me-facts">' + 事実.join('') + '</div>');

    return 章.join('');
  }

  async function 出す(名) {
    if (!名) { $('meBody').innerHTML = ''; return; }
    名前を覚える(名);
    $('meBody').innerHTML = '<p class="me-msg">読み込んでいます…</p>';
    let t = null, j = null;
    const 困った = [];
    await Promise.all([
      呼ぶ(API.当番, 'getMyPage', [名]).then((r) => { t = r; }).catch((e) => 困った.push('当番・手入れを読めませんでした：' + e.message)),
      呼ぶ(API.人員表, 'getMyPage', [名]).then((r) => { j = r; }).catch((e) => 困った.push('大会のぶんを読めませんでした：' + e.message)),
    ]);
    $('meBody').innerHTML = 組み立てる(t, j, 困った);
  }

  async function 始める() {
    const sel = $('meSelect');
    if (!sel) return;
    sel.addEventListener('change', () => 出す(sel.value));
    try {
      const r = await 呼ぶ(API.当番, 'getMyPage', ['']);
      const members = r.members || [];
      sel.innerHTML = '<option value="">選択してください</option>' +
        members.map((m) => '<option value="' + esc(m.name) + '">' + esc(m.name) + (m.grade ? '（' + m.grade + '年）' : '') + '</option>').join('');
      const 名 = 覚えた名前();
      if (名 && members.some((m) => m.name === 名)) { sel.value = 名; await 出す(名); }
    } catch (e) {
      sel.innerHTML = '<option value="">名簿を読めませんでした</option>';
      $('meBody').innerHTML = '<p class="me-msg">名簿を読めませんでした：' + esc(e.message) +
        '<br>下のリンクからは今までどおり使えます。</p>';
    }
  }

  始める();
})();
