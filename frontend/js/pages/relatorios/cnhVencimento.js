import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarDataBr } from '../../masks.js';

function textoDias(dias) {
  if (dias < 0) return `Vencida ha ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return 'Vence hoje';
  return `${dias} dia(s)`;
}
function corDias(dias) {
  if (dias < 0) return 'badge-critico';
  if (dias <= 15) return 'badge-critico';
  if (dias <= 30) return 'badge-atencao';
  return 'badge-neutro';
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">CNH a Vencer</h1>
    <p class="mb-4 text-sm text-slate-500">Motoristas com CNH vencida ou perto de vencer.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div>
        <label class="label">Janela (dias)</label>
        <select class="input" data-filtro-dias>
          <option value="30">Proximos 30 dias</option>
          <option value="60" selected>Proximos 60 dias</option>
          <option value="90">Proximos 90 dias</option>
          <option value="180">Proximos 180 dias</option>
        </select>
      </div>
    </div>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-resumo></div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  const selectDias = container.querySelector('[data-filtro-dias]');
  const resumoEl = container.querySelector('[data-resumo]');
  selectDias.addEventListener('change', () => tabela.recarregar());

  const tabela = criarDataTable({
    colunas: [
      { chave: 'nome', titulo: 'Motorista', render: (r) => r.nome },
      { chave: 'cnh', titulo: 'CNH', render: (r) => r.cnh },
      { chave: 'cnh_validade', titulo: 'Validade', render: (r) => formatarDataBr(r.cnh_validade) },
      { chave: 'dias_restantes', titulo: 'Situacao', render: (r) => `<span class="${corDias(r.dias_restantes)}">${textoDias(r.dias_restantes)}</span>`, exportar: (r) => textoDias(r.dias_restantes) },
    ],
    ordenacaoInicial: { chave: 'dias_restantes', direcao: 'asc' },
    corLinha: (r) => (r.dias_restantes < 0 ? 'bg-red-950/40' : ''),
    exportar: { nomeArquivo: 'cnh-a-vencer' },
    buscarDados: async (termo) => {
      const dados = await get(`/relatorios/cnh-vencimento?dias=${selectDias.value}`);
      const termoLower = (termo || '').toLowerCase();
      const filtrados = termoLower ? dados.filter((r) => r.nome.toLowerCase().includes(termoLower)) : dados;
      const vencidas = filtrados.filter((r) => r.dias_restantes < 0).length;
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Dentro da janela</p><p class="mt-1 text-2xl font-bold text-slate-900">${filtrados.length}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Ja vencidas</p><p class="mt-1 text-2xl font-bold ${vencidas ? 'text-red-600' : 'text-slate-900'}">${vencidas}</p></div>
      `;
      return filtrados;
    },
    vazio: 'Nenhum motorista com CNH vencendo nesta janela.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/cnh-vencimento',
    obterFiltros: () => ({ dias: selectDias.value }),
    aplicarFiltros: (f) => {
      selectDias.value = f.dias || '60';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const vencidas = dados.filter((r) => r.dias_restantes < 0).length;
    abrirRelatorioImpressao({
      titulo: 'CNH a Vencer',
      filtros: [`Janela: proximos ${selectDias.value} dias`],
      resumo: [
        { label: 'Dentro da janela', valor: String(dados.length) },
        { label: 'Ja vencidas', valor: String(vencidas), cor: vencidas ? 'red' : 'zinc' },
      ],
      colunas: ['Motorista', 'CNH', 'Validade', 'Situacao'],
      linhas: dados.map((r) => [r.nome, r.cnh, formatarDataBr(r.cnh_validade), textoDias(r.dias_restantes)]),
      tituloVazio: 'Nenhum motorista com CNH vencendo nesta janela.',
    });
  });
}
