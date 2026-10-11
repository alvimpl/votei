// Baixa o resultado de presidente do 1º turno de 2026 em cada município (TSE)
// e grava uma base compacta usada como referência pela projeção do 2º turno.
//
// Uso: node ferramentas/montar-base-1t.mjs
// Saída: dados/base-1t-2026.json

import { writeFile, mkdir } from "node:fs/promises";

const ELE = 6257;
const BASE = `https://resultados.tse.jus.br/oficial/ele2026/${ELE}`;
const E6 = String(ELE).padStart(6, "0");
const CONCORRENCIA = 16;

const num = (s) => Number(String(s ?? "0").replace(",", ".")) || 0;

async function getJSON(url, tentativas = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tentativas) throw e;
      await new Promise((ok) => setTimeout(ok, 500 * i));
    }
  }
}

function votosPorNumero(d) {
  const v = {};
  for (const cg of d.carg || []) for (const a of cg.agr || []) for (const p of a.par || []) for (const c of p.cand || []) {
    v[c.n] = num(c.vap);
  }
  return v;
}

const cfg = await getJSON(`${BASE}/config/mun-e${E6}-cm.json`);
const muns = [];
for (const uf of cfg.abr) for (const m of uf.mu) muns.push({ uf: uf.cd, cd: m.cd, nm: m.nm, ibge: m.cdi || "" });
console.log(`${muns.length} municípios na configuração`);

// Ordem dos candidatos: a do arquivo nacional, por votos
const br = await getJSON(`${BASE}/dados/br/br-c0001-e${E6}-u.json`);
const vbr = votosPorNumero(br);
const cands = Object.keys(vbr).sort((a, b) => vbr[b] - vbr[a]);

const linhas = new Array(muns.length);
let feitos = 0, prox = 0;
async function trabalhador() {
  while (prox < muns.length) {
    const i = prox++;
    const m = muns[i];
    const d = await getJSON(`${BASE}/dados/${m.uf}/${m.uf}${m.cd}-c0001-e${E6}-u.json`);
    const v = votosPorNumero(d);
    // [uf, cd, nome, ibge, aptos, comparecimento, válidos, brancos, nulos, ...votos na ordem de `cands`]
    linhas[i] = [m.uf, m.cd, m.nm, m.ibge, num(d.e?.te), num(d.e?.c), num(d.v?.vv), num(d.v?.vb), num(d.v?.tvn), ...cands.map((n) => v[n] || 0)];
    if (++feitos % 500 === 0) console.log(`${feitos}/${muns.length}`);
  }
}
await Promise.all(Array.from({ length: CONCORRENCIA }, trabalhador));

// Conferência: soma dos municípios contra o total nacional
const soma = cands.map((_, j) => linhas.reduce((s, l) => s + l[9 + j], 0));
const dif = cands.map((n, j) => soma[j] - vbr[n]).filter((x) => x !== 0);
console.log(dif.length ? `ATENÇÃO: soma difere do total nacional em ${dif.length} candidatos` : "Soma dos municípios confere com o total nacional");

await mkdir(new URL("../dados/", import.meta.url), { recursive: true });
await writeFile(new URL("../dados/base-1t-2026.json", import.meta.url), JSON.stringify({
  eleicao: ELE, geradoEm: `${br.dg} ${br.hg}`,
  colunas: ["uf", "cd", "nome", "ibge", "aptos", "comparecimento", "validos", "brancos", "nulos", ...cands.map((n) => "v" + n)],
  candidatos: cands,
  municipios: linhas,
}));
console.log("Gravado dados/base-1t-2026.json");
