import { get } from '../../api.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { formatarMoeda } from '../../masks.js';

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">DRE Multi-periodo</h1>
    <p class="mb-4 text-sm text-slate-500">Receita, custo e lucro mes a mes - geral da frota ou de um veiculo especifico.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div>
        <label class="label">Quantidade de meses</label>
        <select class="input" data-filtro-meses>
          <option value="3">Ultimos 3 meses</option>
          <option value="6" selected>Ultimos 6 meses</option>
          <option value="12">Ultimos 12 meses</option>
          <option value="24">Ultimos 24 meses</option>
        </select>
      </div>
      <div><label class="label">Veiculo (opcional, geral se vazio)</label><div data-filtro-veiculo></div></div>
    </div>
    <div class="mb-3 flex justify-end"><button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button></div>
    <div class="card overflow-x-auto border-gray-300 p-0" data-tabela></div>
  `;

  let veiculoId = null;
  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: (id) => { veiculoId = id; atualizar(); } });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);

  const selectMeses = container.querySelector('[data-filtro-meses]');
  const tabelaEl = container.querySelector('[data-tabela]');
  selectMeses.addEventListener('change', () => atualizar());

  let ultimoResultado = null;

  function renderTabela(resultado) {
    ultimoResultado = resultado;
    tabelaEl.innerHTML = `
      <table class="w-full min-w-max border-collapse">
        <thead class="bg-brand-black"><tr>
          <th class="table-th">Mes</th><th class="table-th text-right">Receita</th><th class="table-th text-right">Custo</th><th class="table-th text-right">Lucro</th>
        </tr></thead>
        <tbody>
          ${resultado.meses.map((m) => `
            <tr class="border-b border-slate-100">
              <td class="table-td">${m.periodo}</td>
              <td class="table-td text-right">${formatarMoeda(m.receita)}</td>
              <td class="table-td text-right">${formatarMoeda(m.custo)}</td>
              <td class="table-td text-right font-medium ${m.lucro >= 0 ? 'text-emerald-500' : 'text-red-500'}">${formatarMoeda(m.lucro)}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" class="table-td py-6 text-center text-slate-400">Sem dados.</td></tr>'}
        </tbody>
      </table>
    `;
  }

  async function atualizar() {
    const params = new URLSearchParams({ meses: selectMeses.value });
    if (veiculoId) params.set('veiculo_id', veiculoId);
    const resultado = await get(`/relatorios/dre-multi-periodo?${params.toString()}`);
    renderTabela(resultado);
  }

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    if (!ultimoResultado) return;
    const filtros = [`${selectMeses.options[selectMeses.selectedIndex].text}`];
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    abrirRelatorioImpressao({
      titulo: `DRE Multi-periodo${ultimoResultado.veiculo ? ` - ${ultimoResultado.veiculo.placa}` : ' - Geral'}`,
      filtros,
      colunas: ['Mes', { titulo: 'Receita', alinhar: 'right' }, { titulo: 'Custo', alinhar: 'right' }, { titulo: 'Lucro', alinhar: 'right' }],
      linhas: ultimoResultado.meses.map((m) => [m.periodo, formatarMoeda(m.receita), formatarMoeda(m.custo), formatarMoeda(m.lucro)]),
      tituloVazio: 'Sem dados.',
    });
  });

  await atualizar();
}
