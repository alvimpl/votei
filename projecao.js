// Projeção do resultado final de um 2º turno a partir da apuração parcial.
//
// Ideia: o 1º turno de cada município é a referência. Nos municípios já apurados,
// medimos quanto o 2º turno se desviou dessa referência; aplicamos esse desvio
// (estimado por estado, puxado para a região e para o país quando há poucos dados)
// aos votos que ainda faltam em cada município. A incerteza vem de simulações.
//
// Para cada município:
//   a = votos do candidato A no 1º turno / válidos do 1º turno
//   o = votos dos demais candidatos (nem A nem B) / válidos do 1º turno
//   share esperado de A no 2º turno = a + t·o + δ(estado)
// t = fração dos "demais" que vai para A (aprendida durante a apuração)
// δ = desvio do estado (hierárquico: país → região → estado)

export const REGIAO = {
  ac: "N", am: "N", ap: "N", pa: "N", ro: "N", rr: "N", to: "N",
  al: "NE", ba: "NE", ce: "NE", ma: "NE", pb: "NE", pe: "NE", pi: "NE", rn: "NE", se: "NE",
  df: "CO", go: "CO", ms: "CO", mt: "CO",
  es: "SE", mg: "SE", rj: "SE", sp: "SE",
  pr: "S", rs: "S", sc: "S",
  zz: "EX",
};

export const PARAMS = {
  t0: 0.5, tauT: 0.2,     // prior da transferência dos demais para A
  sigma0: 0.035,          // variação própria de cada município em torno do esperado
  tauN: 0.03,             // desvio nacional a priori
  tauR: 0.02,             // quanto uma região pode diferir do país
  tauS: 0.02,             // quanto um estado pode diferir da região
  piso: 0.015,            // incerteza mínima do estado, proporcional ao que falta (correlação entre municípios)
  n0: 3000,               // votos parciais de um município valem tanto quanto o modelo com n0 votos
  tauK: 0.05,             // incerteza do comparecimento relativo ao 1º turno
  sims: 4000,
};

/**
 * @param {Array} base  [{k, uf, aptos1, V1, A1, B1}] — 1º turno por município
 * @param {Map}   obs   k -> {A, B, aptosTot, aptosRest} — 2º turno apurado até agora.
 *                       aptosRest: eleitores em seções ainda não totalizadas (se ausente, usa aptos1).
 * @returns projeção nacional e por estado
 */
export function projetar(base, obs, opt = {}) {
  const P = { ...PARAMS, ...opt };

  // 1. Unidades com referência do 1º turno
  const U = [];
  for (const m of base) {
    const o = obs.get(m.k) || {};
    const n = (o.A || 0) + (o.B || 0);
    const V1 = m.V1 || 0;
    U.push({
      k: m.k, uf: m.uf, rg: REGIAO[m.uf] || "EX",
      a: V1 ? m.A1 / V1 : NaN, o: V1 ? (V1 - m.A1 - m.B1) / V1 : NaN,
      q1: m.aptos1 ? V1 / m.aptos1 : NaN,         // válidos por eleitor apto no 1º turno
      A: o.A || 0, B: o.B || 0, n,
      aptosTot: o.aptosTot || 0,
      aptosRest: o.aptosRest ?? (n ? 0 : m.aptos1 || 0),
    });
  }
  // Municípios sem referência utilizável herdam a média do estado
  const medUF = {};
  for (const u of U) if (Number.isFinite(u.a)) {
    const s = (medUF[u.uf] ||= { a: 0, o: 0, q: 0, c: 0 });
    s.a += u.a; s.o += u.o; s.q += u.q1; s.c++;
  }
  for (const u of U) if (!Number.isFinite(u.a)) {
    const s = medUF[u.uf] || { a: 0.5, o: 0, q: 0.75, c: 1 };
    u.a = s.a / s.c; u.o = s.o / s.c; u.q1 = s.q / s.c;
  }

  // 2. Observações: share de A entre A+B e sua precisão
  const obsU = U.filter((u) => u.n > 0);
  for (const u of obsU) {
    u.y = u.A / u.n;
    u.prec = 1 / (P.sigma0 ** 2 + 0.25 / u.n);
  }

  // Somas por grupo para o ajuste hierárquico (dependem de t)
  const grupos = (fn) => { const g = {}; for (const u of obsU) { const x = (g[fn(u)] ||= { P: 0, SY: 0, SO: 0 }); x.P += u.prec; x.SY += u.prec * (u.y - u.a); x.SO += u.prec * u.o; } return g; };
  const gN = grupos(() => "br"), gR = grupos((u) => u.rg), gS = grupos((u) => u.uf);
  const zero = { P: 0, SY: 0, SO: 0 };

  function desvios(t, draw) {
    const n = gN.br || zero;
    const pn = n.P + 1 / P.tauN ** 2;
    let dN = (n.SY - t * n.SO) / pn;
    if (draw) dN += draw() / Math.sqrt(pn);
    const dR = {}, dS = {};
    for (const rg of new Set(Object.values(REGIAO))) {
      const r = gR[rg] || zero, pr = r.P + 1 / P.tauR ** 2;
      dR[rg] = (r.SY - t * r.SO + dN / P.tauR ** 2) / pr;
      if (draw) dR[rg] += draw() / Math.sqrt(pr);
    }
    for (const uf of Object.keys(REGIAO)) {
      const s = gS[uf] || zero, ps = s.P + 1 / P.tauS ** 2;
      dS[uf] = (s.SY - t * s.SO + dR[REGIAO[uf]] / P.tauS ** 2) / ps;
      if (draw) dS[uf] += draw() / Math.sqrt(ps);
    }
    return dS;
  }

  // 3. Ajuste: alterna entre t e os desvios
  let t = P.t0, dS = desvios(t);
  let pT = 1 / P.tauT ** 2;
  for (let it = 0; it < 6; it++) {
    let num = P.t0 / P.tauT ** 2, den = 1 / P.tauT ** 2;
    for (const u of obsU) { const r = u.y - u.a - dS[u.uf]; num += u.prec * u.o * r; den += u.prec * u.o * u.o; }
    t = Math.min(1, Math.max(0, num / den)); pT = den;
    dS = desvios(t);
  }

  // 4. Comparecimento relativo ao 1º turno (válidos por apto), por estado
  const kap = {}; let kn = 0, kd = 0;
  for (const u of obsU) if (u.aptosTot > 0) {
    const e = u.aptosTot * u.q1; kn += u.n; kd += e;
    const s = (kap[u.uf] ||= { n: 0, d: 0 }); s.n += u.n; s.d += e;
  }
  const kN = (kn + 50000) / (kd + 50000); // puxado para 1 no começo
  const kapUF = (uf) => { const s = kap[uf]; return s ? (s.n + 20000 * kN) / (s.d + 20000) : kN; };

  // 5. Agregados por estado do que falta (linear em t e δ para simular rápido)
  const E = {};
  for (const uf of Object.keys(REGIAO)) E[uf] = { A: 0, B: 0, aptosRest: 0, aptos: 0, Vr: 0, C: 0, W: 0, WO: 0, var0: 0, n: 0 };
  for (const u of U) {
    const e = E[u.uf]; if (!e) continue;
    e.A += u.A; e.B += u.B; e.n += u.n;
    e.aptosRest += u.aptosRest; e.aptos += u.aptosRest + u.aptosTot;
    if (u.aptosRest <= 0) continue;
    const Vr = u.aptosRest * u.q1 * kapUF(u.uf);
    const lam = u.n ? u.n / (u.n + P.n0) : 0;
    e.Vr += Vr;
    e.C += Vr * (lam * (u.y ?? 0) + (1 - lam) * u.a);
    e.W += Vr * (1 - lam);
    e.WO += Vr * (1 - lam) * u.o;
    e.var0 += (Vr * (1 - lam) * P.sigma0) ** 2 + (lam ? Vr * Vr * lam * lam * 0.25 / (u.n + 1) : 0);
  }
  const ufs = Object.keys(E).filter((uf) => E[uf].aptos > 0);

  const restA = (e, uf, tt, d) => Math.min(e.Vr, Math.max(0, e.C + tt * e.WO + d[uf] * e.W));

  // 6. Projeção pontual
  const porUF = {};
  let TA = 0, TB = 0;
  for (const uf of ufs) {
    const e = E[uf], ra = restA(e, uf, t, dS), rb = e.Vr - ra;
    porUF[uf] = {
      A: e.A + ra, B: e.B + rb, restA: ra, restB: rb,
      apuradoA: e.A, apuradoB: e.B,
      pctApurado: e.aptos ? 1 - e.aptosRest / e.aptos : 0,
      desvio: dS[uf],
    };
    TA += e.A + ra; TB += e.B + rb;
  }

  // 7. Simulações
  const rnd = gauss(P.seed ?? 12345);
  const sdT = 1 / Math.sqrt(pT);
  const shares = new Float64Array(P.sims);
  const ufSims = Object.fromEntries(ufs.map((uf) => [uf, 0]));
  let vitA = 0;
  for (let i = 0; i < P.sims; i++) {
    const tt = Math.min(1, Math.max(0, t + rnd() * sdT));
    const d = desvios(tt, rnd);
    const zK = rnd();
    let a = 0, b = 0;
    for (const uf of ufs) {
      const e = E[uf];
      const resto = e.aptos ? e.aptosRest / e.aptos : 0;
      const k = 1 + zK * P.tauK * 0.5 + rnd() * P.tauK * 0.5;
      let ra = restA(e, uf, tt, d) + rnd() * (Math.sqrt(e.var0) + P.piso * resto * e.W);
      ra = Math.min(e.Vr, Math.max(0, ra));
      const rb = e.Vr - ra;
      a += e.A + ra * k; b += e.B + rb * k;
      if (e.A + ra * k > e.B + rb * k) ufSims[uf]++;
    }
    shares[i] = a / (a + b);
    if (a > b) vitA++;
  }
  shares.sort();
  const q = (p) => shares[Math.min(P.sims - 1, Math.floor(p * P.sims))];
  for (const uf of ufs) porUF[uf].chanceA = ufSims[uf] / P.sims;

  const aptos = ufs.reduce((s, uf) => s + E[uf].aptos, 0);
  const rest = ufs.reduce((s, uf) => s + E[uf].aptosRest, 0);
  return {
    A: TA, B: TB, share: TA / (TA + TB),
    faixa90: [q(0.05), q(0.95)], faixa50: [q(0.25), q(0.75)],
    chanceA: vitA / P.sims,
    transferencia: t, transferenciaSD: sdT,
    pctApurado: aptos ? 1 - rest / aptos : 0,
    municipiosComDados: obsU.length,
    porUF,
  };
}

// Normal padrão com semente (para resultados estáveis entre atualizações)
function gauss(seed) {
  let s = seed >>> 0;
  const u = () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  let extra = null;
  return () => {
    if (extra !== null) { const v = extra; extra = null; return v; }
    let a, b, r;
    do { a = 2 * u() - 1; b = 2 * u() - 1; r = a * a + b * b; } while (r >= 1 || r === 0);
    const f = Math.sqrt(-2 * Math.log(r) / r);
    extra = b * f; return a * f;
  };
}
