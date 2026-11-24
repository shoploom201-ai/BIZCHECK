/* SHA-256 (UTF-8) — 관리자 비밀번호 해시용. 브라우저/Node 공용, 외부 의존성 없음 */
(function (root) {
  'use strict';
  const primes = [];
  for (let n = 2; primes.length < 64; n++) {
    if (primes.every(p => n % p !== 0)) primes.push(n);
  }
  const frac = x => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
  const K = primes.map(p => frac(Math.cbrt(p)));
  const H0 = primes.slice(0, 8).map(p => frac(Math.sqrt(p)));
  const ror = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(str) {
    const bytes = new TextEncoder().encode(String(str));
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    const bits = len * 8;
    dv.setUint32(total - 8, Math.floor(bits / 4294967296));
    dv.setUint32(total - 4, bits >>> 0);

    const H = H0.slice();
    const W = new Uint32Array(64);
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const a = W[t - 15], b = W[t - 2];
        const s0 = ror(a, 7) ^ ror(a, 18) ^ (a >>> 3);
        const s1 = ror(b, 17) ^ ror(b, 19) ^ (b >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = sha256;
  else root.Sha256 = sha256;
})(typeof window !== 'undefined' ? window : globalThis);
