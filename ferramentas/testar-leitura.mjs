// Testa a leitura municipal ao vivo contra uma eleição já apurada (pior caso:
// abrir a página com 100% contado). Mede o tempo, confere os totais com o
// arquivo nacional e roda um segundo ciclo para ver que nada é baixado de novo.
//
// Uso: node ferramentas/testar-leitura.mjs [eleicao=6257] [numA=13] [numB=22]

import { readFile } from "node:fs/promises";
import { novoEstado, atualizarMunicipios, montarObs, BASE_TSE } from "../municipios.js";
import { projetar } from "../projecao.js";

const [ele = "6257", nA = "13", nB = "22"] = process.argv.slice(2);
const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`); return r.json(); };

const bruta = JSON.parse(await readFile(new URL("../dados/base-1t-2026.json", import.meta.url), "utf8"));
const c = bruta.colunas, iA = c.indexOf("v" + nA), iB = c.indexOf("v" + nB);
const base = bruta.municipios.map((r) => ({ k: r[0] + r[1], uf: r[0], aptos1: r[c.indexOf("aptos")], V1: r[c.indexOf("validos")], A1: r[iA], B1: r[iB] }));

const est = novoEstado(Number(ele));
let parciais = 0;
const t0 = Date.now();
const r1 = await atualizarMunicipios(est, nA, nB, getJSON, {
  onProgresso: (f, t) => { if (f % 1000 === 0) console.log(`  ${f}/${t} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); },
  onParcial: () => parciais++,
});
const seg = (Date.now() - t0) / 1000;
const obs = montarObs(est);
let A = 0, B = 0; for (const o of obs.values()) { A += o.A; B += o.B; }

const br = await getJSON(`${BASE_TSE}/${ele}/dados/br/br-c0001-e${String(ele).padStart(6, "0")}-u.json`);
const tot = {}; for (const cg of br.carg) for (const a of cg.agr) for (const p of a.par) for (const k of p.cand) tot[k.n] = Number(k.vap);

console.log(`\nCiclo frio: ${r1.baixados} municípios em ${seg.toFixed(1)} s (${(r1.baixados / seg).toFixed(0)}/s), ${parciais} projeções parciais, falhas: ${r1.falhas.length ? r1.falhas.join(",") : "nenhuma"}`);
console.log(`Soma dos municípios: ${nA}=${A} (nacional ${tot[nA]}) ${A === tot[nA] ? "OK" : "DIFERENTE"} · ${nB}=${B} (nacional ${tot[nB]}) ${B === tot[nB] ? "OK" : "DIFERENTE"}`);

const t1 = Date.now();
const r2 = await atualizarMunicipios(est, nA, nB, getJSON);
console.log(`Segundo ciclo: ${r2.baixados} municípios baixados em ${((Date.now() - t1) / 1000).toFixed(1)} s`);

const t2 = Date.now();
const p = projetar(base, obs);
console.log(`Projeção com tudo apurado: ${(100 * p.share).toFixed(3)}% (apurado ${(100 * A / (A + B)).toFixed(3)}%), faixa [${(100 * p.faixa90[0]).toFixed(3)}, ${(100 * p.faixa90[1]).toFixed(3)}], ${Date.now() - t2} ms`);
console.log(`Tamanho do cache: ${(JSON.stringify(est.cache).length / 1024).toFixed(0)} KB`);
