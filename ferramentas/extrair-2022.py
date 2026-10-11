"""Extrai do zip de 2022 do TSE só a votação de presidente por município,
lendo pedaços do zip remoto (HTTP Range) em vez de baixar os 580 MB.

Uso: python -I ferramentas/extrair-2022.py
Saída: dados/presidente-2022-mun.json
  {"municipios": {"<uf><cd>": {"t1": {...}, "t2z": {"<zona>": {...}}}}}
  votos por número, aptos, comp, fim (hora de totalização); 2º turno quebrado por zona
"""
import csv, io, json, os, sys, urllib.request, zipfile

URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2022.zip"
DETALHE = "https://cdn.tse.jus.br/estatistica/sead/odsele/detalhe_votacao_munzona/detalhe_votacao_munzona_2022.zip"


class ArquivoRemoto(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD")) as r:
            self.tam = int(r.headers["Content-Length"])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.tam + off
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0: n = self.tam - self.pos
        if n == 0 or self.pos >= self.tam: return b""
        fim = min(self.pos + n, self.tam) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{fim}"})
        with urllib.request.urlopen(req) as r:
            dados = r.read()
        self.pos += len(dados)
        return dados

    def readinto(self, b):
        dados = self.read(len(b))
        b[:len(dados)] = dados
        return len(dados)


def linhas(zf, nome):
    with zf.open(nome) as f:
        yield from csv.DictReader(io.TextIOWrapper(io.BufferedReader(f, 1 << 20), encoding="latin-1"), delimiter=";")


def destino(mun, k, l):
    """1º turno agregado por município; 2º turno por zona (para reencenar a apuração)."""
    m = mun.setdefault(k, {})
    if l["NR_TURNO"] == "1":
        return m.setdefault("t1", {})
    return m.setdefault("t2z", {}).setdefault(l["NR_ZONA"], {})


def main():
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    zc = zipfile.ZipFile(io.BufferedReader(ArquivoRemoto(URL), 1 << 22))
    nome = next(n for n in zc.namelist() if n.upper().endswith("_BR.CSV"))
    print("Lendo", nome, f"({zc.getinfo(nome).compress_size / 1e6:.1f} MB compactado)")

    mun = {}
    for l in linhas(zc, nome):
        if l["DS_CARGO"].upper() != "PRESIDENTE": continue
        k = l["SG_UF"].lower() + l["CD_MUNICIPIO"].zfill(5)
        v = destino(mun, k, l)
        n = l["NR_CANDIDATO"]
        v[n] = v.get(n, 0) + int(l["QT_VOTOS_NOMINAIS_VALIDOS"] or l["QT_VOTOS_NOMINAIS"] or 0)

    # Aptos e comparecimento por município e turno (arquivo de detalhe, pequeno)
    zd = zipfile.ZipFile(io.BufferedReader(ArquivoRemoto(DETALHE), 1 << 22))
    nd = next(n for n in zd.namelist() if n.upper().endswith("_BR.CSV"))
    for l in linhas(zd, nd):
        if l["DS_CARGO"].upper() != "PRESIDENTE": continue
        k = l["SG_UF"].lower() + l["CD_MUNICIPIO"].zfill(5)
        v = destino(mun, k, l)
        v["aptos"] = v.get("aptos", 0) + int(l["QT_APTOS"])
        v["comp"] = v.get("comp", 0) + int(l["QT_COMPARECIMENTO"])
        # Hora da última totalização: o município "fecha" quando a última zona dele fecha
        d, h = l["DT_ULTIMA_TOTALIZACAO"], l["HH_ULTIMA_TOTALIZACAO"]
        if d and h:
            dd, mm, aa = d.split("/")
            ts = f"{aa}-{mm}-{dd} {h}"
            if ts > v.get("fim", ""): v["fim"] = ts

    os.makedirs(os.path.join(raiz, "dados"), exist_ok=True)
    with open(os.path.join(raiz, "dados", "presidente-2022-mun.json"), "w", encoding="utf-8") as f:
        json.dump({"municipios": mun}, f, separators=(",", ":"))
    zonas = sum(len(v.get("t2z", {})) for v in mun.values())
    soma = {n: sum(z.get(n, 0) for v in mun.values() for z in v.get("t2z", {}).values()) for n in ("13", "22")}
    print(f"{len(mun)} municípios, {zonas} pares município-zona no 2º turno; totais 2º turno: {soma}")


if __name__ == "__main__":
    sys.exit(main())
