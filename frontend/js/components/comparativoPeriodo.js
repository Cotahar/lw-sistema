// "Comparar com periodo anterior" (Lote 6 - "melhorias transversais"),
// mesmo padrao ja usado em pages/dre.js/renderComparativo - extraido aqui
// pra ser reutilizado por qualquer relatorio com filtro de data_de/data_ate
// e totais agregados que fazem sentido comparar. So calcula o periodo
// anterior EQUIVALENTE (mesma duracao em dias, imediatamente anterior) - a
// busca dos dados desse periodo continua por conta de cada tela (mesmo
// endpoint que ja usa, so trocando as datas).

// Retorna null quando as datas nao formam um intervalo valido (falta uma
// ponta, ou invertido) - quem chama deve tratar como "sem comparativo".
export function periodoAnteriorEquivalente(dataDeIso, dataAteIso) {
  if (!dataDeIso || !dataAteIso) return null;
  const de = new Date(`${dataDeIso}T00:00:00Z`);
  const ate = new Date(`${dataAteIso}T00:00:00Z`);
  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || ate < de) return null;
  const duracaoDias = Math.round((ate - de) / 86400000) + 1;
  const anteriorAte = new Date(de);
  anteriorAte.setUTCDate(anteriorAte.getUTCDate() - 1);
  const anteriorDe = new Date(anteriorAte);
  anteriorDe.setUTCDate(anteriorDe.getUTCDate() - duracaoDias + 1);
  const isoDe = (d) => d.toISOString().slice(0, 10);
  return { de: isoDe(anteriorDe), ate: isoDe(anteriorAte) };
}

// Seta + cor de acordo com a variacao (%), positiva ou negativa -
// inverterCores deixa "custo caiu" verde mesmo sendo uma queda numerica (o
// oposto de receita/lucro, onde subir e bom).
function deltaPercentual(atual, anterior, inverterCores) {
  if (anterior === null || anterior === undefined) return '<span class="text-xs text-slate-400">sem periodo anterior</span>';
  if (!anterior) return '<span class="text-xs text-slate-400">-</span>';
  const variacao = ((atual - anterior) / Math.abs(anterior)) * 100;
  const subiu = variacao >= 0;
  const bom = inverterCores ? !subiu : subiu;
  const cor = variacao === 0 ? 'text-slate-400' : bom ? 'text-emerald-600' : 'text-red-600';
  const seta = variacao === 0 ? '' : subiu ? '&uarr;' : '&darr;';
  return `<span class="text-xs font-medium ${cor}">${seta} ${Math.abs(variacao).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>`;
}

function linha(label, atual, anterior, formatador, inverterCores) {
  return `
    <tr class="border-b border-slate-100 last:border-0">
      <td class="table-td">${label}</td>
      <td class="table-td text-right">${formatador(atual)}</td>
      <td class="table-td text-right text-slate-500">${anterior != null ? formatador(anterior) : '-'}</td>
      <td class="table-td text-right">${deltaPercentual(atual, anterior, inverterCores)}</td>
    </tr>
  `;
}

// indicadores: [{ label, atual, anterior, formatador, inverterCores? }]
// periodoAnteriorTexto: string ja formatada (ex.: "01/08/2026 a 15/08/2026").
export function renderComparativoPeriodo(el, { periodoAnteriorTexto, indicadores }) {
  if (!indicadores || !indicadores.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="card mt-4 overflow-x-auto border-gray-300 p-0">
      <div class="flex items-center justify-between px-4 pt-3">
        <h2 class="font-semibold text-slate-900">Comparativo com o periodo anterior</h2>
        <p class="text-xs text-slate-400">${periodoAnteriorTexto}</p>
      </div>
      <table class="mt-2 w-full min-w-max border-collapse">
        <thead class="bg-brand-black"><tr>
          <th class="table-th">Indicador</th><th class="table-th text-right">Periodo atual</th><th class="table-th text-right">Periodo anterior</th><th class="table-th text-right">Variacao</th>
        </tr></thead>
        <tbody>${indicadores.map((i) => linha(i.label, i.atual, i.anterior, i.formatador, i.inverterCores)).join('')}</tbody>
      </table>
    </div>
  `;
}
