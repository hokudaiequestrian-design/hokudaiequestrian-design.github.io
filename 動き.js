/*
  動き（2026-10-21 ユーザーの指示：「馬術部アプリ全般、UXUIアニメーションをふんだんに用いてUIを変えて」）。
  build.js が全ページ（出番表・会計の写しは除く）の </body> の手前に入れる。見た目は 動き.css。
    ・出てくる：カード・一覧の行・札・マグネットが、初めて出たときにずらしながら出る。
      どのページも innerHTML で描き直すので、同じ中身（クラス＋文字）は覚えておき、2回目からは動かさない
      （直したところ・新しく出たものだけが動く）。画面の外のカードは、見えたときに出る
    ・ボタンの波紋（押したところから広がる）
    ・数が 0 から数え上がる（まとめの数字）
    ・入れ替えのすべり（FLIP）：data-flip を持つもの（馬配のマグネット）は、押した直前の場所から新しい場所へすべる
    ・details.fold を閉じるときも、中身をしまってから閉じる
  動きを減らす設定の人には何もしない。
*/
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const 文書 = document;

  // ----- 出てくる -----
  const 種類 = [
    // [選び方, 出方]。上のものが先に当たる
    ['.mg', 'mo-drop'],
    ['tr', 'mo-fade'],
    ['.card, .hub-group, .me-uh, .uh-wb, .wb-board, section.me-day', 'mo-in'],
    ['.list-item, .name-chip, .pill, .chip, a.hub-link, .plist li, .entry-list li, .uh-row, .picked-list .item, .summary-grid .stat, .me-row, .mark-row, .checksheet label, .menu-item', 'mo-pop'],
  ];
  const 全部 = 種類.map((k) => k[0]).join(', ');
  const 見た = new Set();
  const 鍵 = (el) => el.tagName + '|' + String(el.className || '').replace(/\bmo-\S+/g, '').replace(/\b(sel|just|flash)\b/g, '').trim() + '|' +
    (el.getAttribute('data-flip') || '') + '|' + (el.textContent || '').replace(/\s+/g, ' ').slice(0, 120);
  const 出方 = (el) => { for (let i = 0; i < 種類.length; i++) if (el.matches(種類[i][0])) return 種類[i][1]; return ''; };

  // 画面の外にあるカードは、見えたときに出す
  const 見張り = 'IntersectionObserver' in window ? new IntersectionObserver((xs) => {
    xs.forEach((x) => {
      if (!x.isIntersecting) return;
      見張り.unobserve(x.target);
      x.target.classList.remove('mo-wait');
      x.target.classList.add('mo-in');
    });
  }, { rootMargin: '0px 0px -6% 0px' }) : null;

  let 直前のFLIP = null;   // { 時刻, 位置: Map(key → rect) }
  function 出す(els) {
    let n = 0;
    const 今のFLIP = 直前のFLIP && performance.now() - 直前のFLIP.時刻 < 800 ? 直前のFLIP.位置 : null;
    els.forEach((el) => {
      const k = 鍵(el);
      if (見た.has(k)) return;
      見た.add(k);
      const f = el.getAttribute('data-flip');
      if (f && 今のFLIP && 今のFLIP.has(f)) return;   // すべって来るものは落とさない
      const c = 出方(el);
      if (!c || n > 80) return;   // 一度にたくさん出るときは、頭のほうだけ動かす
      if (c === 'mo-in' && 見張り) {
        const r = el.getBoundingClientRect();
        if (r.top > window.innerHeight) { el.classList.add('mo-wait'); 見張り.observe(el); return; }
      }
      el.style.setProperty('--mo-d', Math.min(n * (c === 'mo-in' ? 70 : 28), 700) + 'ms');
      el.classList.add(c);
      n++;
      el.addEventListener('animationend', function 片付け(e) {
        if (e.target !== el) return;
        el.classList.remove(c);
        el.removeEventListener('animationend', 片付け);
      });
    });
    数える(els);
  }
  function 中から集める(nodes) {
    const out = [];
    nodes.forEach((nd) => {
      if (nd.nodeType !== 1) return;
      if (nd.matches && nd.matches(全部)) out.push(nd);
      if (nd.querySelectorAll) nd.querySelectorAll(全部).forEach((x) => out.push(x));
    });
    return out;
  }

  // ----- 数え上げ -----
  const 数の場所 = '.statline b, .summary-grid .stat b, .me-facts b, .cnt';
  const 数えた = new WeakSet();
  function 数える(els) {
    const 的 = [];
    els.forEach((el) => {
      if (el.matches && el.matches(数の場所)) 的.push(el);
      if (el.querySelectorAll) el.querySelectorAll(数の場所).forEach((x) => 的.push(x));
    });
    的.forEach((el) => {
      if (数えた.has(el)) return;
      数えた.add(el);
      const m = String(el.textContent).match(/^(\D*)(\d{1,4})(\D*)$/);
      if (!m || Number(m[2]) < 2) return;
      const 先 = Number(m[2]);
      const 始 = performance.now(), 長さ = Math.min(900, 300 + 先 * 20);
      const 進む = (t) => {
        if (!el.isConnected || el.textContent.indexOf(m[1]) !== 0) return;
        const p = Math.min(1, (t - 始) / 長さ);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = m[1] + Math.round(先 * e) + m[3];
        if (p < 1) requestAnimationFrame(進む);
      };
      requestAnimationFrame(進む);
    });
  }

  // ----- 入れ替えのすべり（FLIP） -----
  function 位置を覚える() {
    const 位置 = new Map();
    文書.querySelectorAll('[data-flip]').forEach((el) => {
      const k = el.getAttribute('data-flip');
      if (!位置.has(k)) 位置.set(k, el.getBoundingClientRect());
    });
    直前のFLIP = { 時刻: performance.now(), 位置: 位置 };
    // 押した処理が描き直したあとで、すべらせる
    requestAnimationFrame(すべらせる);
  }
  function すべらせる() {
    if (!直前のFLIP) return;
    const 位置 = 直前のFLIP.位置;
    const 動いた = new Set();
    文書.querySelectorAll('[data-flip]').forEach((el) => {
      const 前 = 位置.get(el.getAttribute('data-flip'));
      if (!前) return;
      // 外側（馬の行）がすべるときは、中（その馬の人）は一緒に動くので重ねない
      let p = el.parentElement;
      while (p) { if (動いた.has(p)) return; p = p.parentElement; }
      const 今 = el.getBoundingClientRect();
      const dx = 前.left - 今.left, dy = 前.top - 今.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      動いた.add(el);
      const 終わり = getComputedStyle(el).transform;
      const 終 = 終わり && 終わり !== 'none' ? 終わり : '';
      el.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px) ' + 終, zIndex: 5 },
        { transform: (終 || 'none'), zIndex: 5 },
      ], { duration: 520, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' });
    });
  }
  文書.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('[data-flip], button, [data-uh-sj-add]') && 文書.querySelector('[data-flip]')) 位置を覚える();
  }, true);
  文書.addEventListener('change', () => { if (文書.querySelector('[data-flip]')) 位置を覚える(); }, true);

  // ----- 波紋 -----
  文書.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (!b || b.disabled || b.matches('.mg, .linklike, .pickcell, .calday')) return;
    const r = b.getBoundingClientRect();
    const 大 = Math.max(r.width, r.height) * 2.2;
    const s = 文書.createElement('span');
    s.className = 'mo-ripple';
    s.style.width = s.style.height = 大 + 'px';
    s.style.left = (e.clientX - r.left - 大 / 2) + 'px';
    s.style.top = (e.clientY - r.top - 大 / 2) + 'px';
    b.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  });

  // ----- details.fold を閉じるときもしまう -----
  文書.addEventListener('click', (e) => {
    const sm = e.target.closest && e.target.closest('details.fold > summary');
    if (!sm) return;
    const d = sm.parentElement;
    if (!d.open || d.classList.contains('mo-closing')) return;
    const 中 = d.querySelector(':scope > .fold-body');
    if (!中) return;
    e.preventDefault();
    d.classList.add('mo-closing');
    中.addEventListener('animationend', function 閉じる() {
      中.removeEventListener('animationend', 閉じる);
      d.classList.remove('mo-closing');
      d.open = false;
    });
  });

  // ----- 見張る -----
  function 始める() {
    出す(中から集める([文書.body]));
    new MutationObserver((ms) => {
      const 足された = [];
      ms.forEach((m) => m.addedNodes.forEach((nd) => 足された.push(nd)));
      if (足された.length) 出す(中から集める(足された));
    }).observe(文書.body, { childList: true, subtree: true });
  }
  if (文書.readyState === 'loading') 文書.addEventListener('DOMContentLoaded', 始める);
  else 始める();
})();
