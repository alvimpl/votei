# Votei

Página para acompanhar a apuração do 2º turno presidencial de 2026, com projeção do resultado final calculada a partir da apuração por município.

- `index.html`: a página
- `projecao.js`: modelo de projeção (referência do 1º turno + desvio medido ao vivo, com simulações)
- `municipios.js`: leitura incremental dos arquivos públicos do TSE
- `dados/`: base do 1º turno de 2026 e votação de 2022 por município (para a simulação)
- `ferramentas/`: scripts para montar as bases e testar o modelo (`node ferramentas/reencenar-2022.mjs`)

Dados: arquivos públicos do TSE (resultados.tse.jus.br e dadosabertos.tse.jus.br). A projeção é uma estimativa estatística, não um dado oficial.
