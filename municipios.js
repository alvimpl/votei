// Leitura incremental dos resultados por município durante a apuração.
//
// A cada ciclo:
//   1. lê o resumo nacional por estado (br-...-ab.json, ~30 KB);
//   2. para cada estado que mudou, lê o resumo por município dele (uf-...-ab.json);
//   3. baixa só os municípios cujo andamento mudou desde a última leitura,
//      os maiores primeiro, para a projeção parcial já cobrir a maior parte dos votos.
// O estado (cache) fica com quem chama, para poder ser guardado entre visitas.

export const BASE_TSE = "https://resultados.tse.jus.br/oficial/ele2026";

const num = (s) => Number(String(s ?? "0").replace(",", ".")) || 0;
const e6 = (ele) => String(ele).padStart(6, "0");
const urlAb = (ele, uf) => `${BASE_TSE}/${ele}/dados/${uf}/${uf}-e${e6(ele)}-ab.json`;
const urlMun = (ele, k) => `${BASE_TSE}/${ele}/dados/${k.slice(0, 2)}/${k}-c0001-e${e6(ele)}-u.json`;

export function novoEstado(ele, cache = {}) {
  return { ele, cache, info: {}, ufSig: {} };
}

function votos(d, nA, nB) {
  let A = 0, B = 0;
  for (const cg of d.carg || []) for (const a of cg.agr || []) for (const p of a.par || []) for (const c of p.cand || []) {
    if (c.n === nA) A = num(c.vap); else if (c.n === nB) B = num(c.vap);
  }
  return { A, B };
}

async function emParalelo(itens, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) await fn(itens[i++]); }));
}

/**
 * @param est      estado criado por novoEstado (é atualizado)
 * @param getJSON  url -> Promise<objeto>
 * @param opts     { concorrencia, aCada, onProgresso(feitos, total), onParcial() }
 * @returns { baixados, falhas }
 */
export async function atualizarMunicipios(est, nA, nB, getJSON, opts = {}) {
  const { concorrencia = 24, aCada = 400, onProgresso, onParcial } = opts;
  const ele = est.ele;
  const abBR = await getJSON(urlAb(ele, "br"));
  const mudaram = [];
  for (const a of abBR.abr || []) {
    if (a.tpabr !== "uf") continue;
    const sig = `${a.s?.st}|${a.ht}`;
    if (est.ufSig[a.cdabr] !== sig) mudaram.push([a.cdabr, sig]);
  }

  const fila = [], sigUF = {}, falhas = new Set();
  await emParalelo(mudaram, 6, async ([uf, sig]) => {
    try {
      const ab = await getJSON(urlAb(ele, uf));
      for (const m of ab.abr || []) {
        if (m.tpabr !== "mun") continue;
        const k = uf + m.cdabr, st = num(m.s?.st), te = num(m.e?.te), msig = `${st}|${m.ht}`;
        est.info[k] = { te, st };
        if (st > 0 && est.cache[k]?.sig !== msig) fila.push({ uf, k, msig, te });
      }
      sigUF[uf] = sig;
    } catch { falhas.add(uf); }
  });

  fila.sort((x, y) => y.te - x.te);
  let feitos = 0;
  await emParalelo(fila, concorrencia, async ({ uf, k, msig }) => {
    try {
      const d = await getJSON(urlMun(ele, k));
      est.cache[k] = { sig: msig, ...votos(d, nA, nB), est: num(d.e?.est), esnt: num(d.e?.esnt) };
    } catch { falhas.add(uf); }
    feitos++;
    if (feitos % 50 === 0) onProgresso?.(feitos, fila.length);
    if (feitos % aCada === 0 && feitos < fila.length) onParcial?.();
  });
  // Estado só é dado como lido se todos os municípios dele vieram; senão tenta de novo no próximo ciclo
  for (const [uf, sig] of Object.entries(sigUF)) if (!falhas.has(uf)) est.ufSig[uf] = sig;
  return { baixados: fila.length, falhas: [...falhas] };
}

/** Observações para projetar(): município -> votos apurados e eleitores que faltam. */
export function montarObs(est) {
  const obs = new Map();
  for (const [k, i] of Object.entries(est.info)) {
    const c = est.cache[k];
    // Município já com votos: usa a leitura dele (votos e eleitores do mesmo instante).
    // Ainda sem votos, ou contado mas não baixado ainda: conta como não apurado.
    if (c && c.A + c.B > 0) obs.set(k, { A: c.A, B: c.B, aptosTot: c.est, aptosRest: c.esnt });
    else obs.set(k, { A: 0, B: 0, aptosTot: 0, aptosRest: i.te });
  }
  return obs;
}
