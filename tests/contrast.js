/*
  oklch の色を sRGB に直して、コントラスト比を実測する。
  DADS：本文は 4.5:1 以上、罫線・図は 3:1 以上。
*/
function oklchToSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  const gamma = (u) => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055);
  return [r, g, bb].map((u) => Math.min(1, Math.max(0, gamma(u))));
}

function luminance([r, g, b]) {
  const lin = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const 比 = (c1, c2) => {
  const a = luminance(c1), b = luminance(c2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((u) => Math.round(u * 255).toString(16).padStart(2, '0')).join('');

const 色 = {
  white:         [1, 1, 1],
  'danger':      oklchToSrgb(0.50, 0.190, 27),
  'danger-dark': oklchToSrgb(0.42, 0.173, 27),
  'danger-soft': oklchToSrgb(0.96, 0.019, 27),
  'warning':     oklchToSrgb(0.48, 0.105, 70),
  'warning-soft':oklchToSrgb(0.96, 0.030, 80),
};

Object.keys(色).forEach((k) => console.log(k.padEnd(13), hex(色[k])));
console.log('');
const 見る = (a, b, 要る) => {
  const r = 比(色[a], 色[b]);
  console.log(`${a} の上に ${b}`.padEnd(34), r.toFixed(2) + ':1', r >= 要る ? `OK（${要る}以上）` : `だめ（${要る}要る）`);
};
見る('danger', 'white', 4.5);
見る('danger-dark', 'white', 4.5);
見る('danger-soft', 'danger', 4.5);
見る('danger-soft', 'danger-dark', 4.5);
見る('white', 'danger', 3);
