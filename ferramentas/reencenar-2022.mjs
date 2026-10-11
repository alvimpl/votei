// Reencena a noite do 2º turno de 2022: a cada horário, entrega ao modelo só as
// zonas que já tinham sido totalizadas e compara a projeção com o resultado final.
//
// Uso: node ferramentas/reencenar-2022.mjs [inicio=17:00] [fim=21:00] [passo=10]

import { readFile } from "node:fs/promises";
import { projetar } from "../projecao.js";

const [ini = "17:00", fim = "21:00", passo = "10"] = process.argv.slice(2);
const A = "13", B = "22"; // Lula, Bolsonaro

const dados = JSON.parse(await readFile(new URL("../dados/presidente-2022-mun.json", import.meta.url), "utf8")).municipios;

const base = [];
for (const [k, m] of Object.entries(dados)) {
  const t1 = m.t1 || {};
  const V1 = Object.entries(t1).filter(([n]) => /^\d+$/.test(n)).reduce((s, [, v]) => s + v, 0);
  base.push({ k, uf: k.slice(0, 2), aptos1: t1.aptos || 0, V1, A1: t1[A] || 0, B1: t1[B] || 0 });
}

let FA = 0, FB = 0;
for (const m of Object.values(dados)) for (const z of Object.values(m.t2z || {})) { FA += z[A] || 0; FB += z[B] || 0; }
const final = FA / (FA + FB);

function observar(ate) {
  const obs = new Map();
  for (const [k, m] of Object.entries(dados)) {
    const o = { A: 0, B: 0, aptosTot: 0, aptosRest: 0 };
    for (const z of Object.values(m.t2z || {})) {
      if (z.fim && z.fim <= ate) { o.A += z[A] || 0; o.B += z[B] || 0; o.aptosTot += z.aptos || 0; }
      else o.aptosRest += z.aptos || 0;
    }
    obs.set(k, o);
  }
  return obs;
}

const pct = (x) => (100 * x).toFixed(2).padStart(6);
console.log(`Resultado final: Lula ${pct(final)}%\n`);
console.log("hora   apurado  apurado-Lula  projeção  faixa 90%         chance Lula  erro(p.p.)  dentro?");
const [h0, m0] = ini.split(":").map(Number), [h1, m1] = fim.split(":").map(Number);
let erros = [], dentro = 0, n = 0;
for (let t = h0 * 60 + m0; t <= h1 * 60 + m1; t += Number(passo)) {
  const hh = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  const obs = observar(`2022-10-30 ${hh}:00`);
  let a = 0, b = 0; for (const o of obs.values()) { a += o.A; b += o.B; }
  const r = projetar(base, obs);
  const err = 100 * (r.share - final);
  const ok = final >= r.faixa90[0] && final <= r.faixa90[1];
  erros.push(Math.abs(err)); dentro += ok; n++;
  console.log(`${hh}  ${pct(r.pctApurado)}%  ${a + b ? pct(a / (a + b)) + "%" : "     —"}      ${pct(r.share)}%  [${pct(r.faixa90[0])}, ${pct(r.faixa90[1])}]  ${pct(r.chanceA)}%     ${err >= 0 ? "+" : ""}${err.toFixed(2)}      ${ok ? "sim" : "NÃO"}`);
}
console.log(`\nErro médio ${(erros.reduce((s, x) => s + x, 0) / n).toFixed(2)} p.p.; resultado dentro da faixa de 90% em ${dentro}/${n} horários`);
