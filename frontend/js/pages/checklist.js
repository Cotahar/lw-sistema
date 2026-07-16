import { get, put, podeGerenciar } from '../api.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

async function carregarChecklist(veiculoId, container, gerenciar) {
  try {
    const itens = await get(`/checklist/veiculo/${veiculoId}`);
    container.innerHTML = itens.length
      ? `
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th class="table-th">Presente</th><th class="table-th">Item</th><th class="table-th">Observacao</th>
          </tr></thead>
          <tbody>
            ${itens.map((item) => `
              <tr class="border-b border-slate-100" data-item-id="${item.item_id}">
                <td class="table-td"><input type="checkbox" data-presente ${item.presente ? 'checked' : ''} ${gerenciar ? '' : 'disabled'} /></td>
                <td class="table-td">${item.nome}</td>
                <td class="table-td"><input type="text" class="input" data-observacao value="${item.observacao || ''}" ${gerenciar ? '' : 'disabled'} /></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
      : '<p class="text-slate-400">Nenhum item cadastrado no catalogo de checklist (peca ao Admin cadastrar em Configuracoes).</p>';

    if (!gerenciar) return;
    container.querySelectorAll('tr[data-item-id]').forEach((tr) => {
      const itemId = tr.dataset.itemId;
      const salvar = async () => {
        try {
          await put(`/checklist/veiculo/${veiculoId}/${itemId}`, {
            presente: tr.querySelector('[data-presente]').checked,
            observacao: tr.querySelector('[data-observacao]').value || null,
          });
          mostrarToast('Checklist atualizado.');
        } catch (err) {
          mostrarErro(err);
        }
      };
      tr.querySelector('[data-presente]').addEventListener('change', salvar);
      tr.querySelector('[data-observacao]').addEventListener('blur', salvar);
    });
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Checklist de Bordo</h1>
    <div class="card mb-4 p-4">
      <label class="label">Selecione o veiculo</label>
      <div data-veiculo-select class="max-w-sm"></div>
    </div>
    <div class="card p-4" data-checklist>
      <p class="text-slate-400">Selecione um veiculo para ver o checklist.</p>
    </div>
  `;
  const gerenciar = podeGerenciar('checklist');
  const checklistEl = container.querySelector('[data-checklist]');
  const veiculoSelect = criarSearchableSelect({
    buscar: buscarVeiculos,
    placeholder: 'Pesquisar placa...',
    onChange: (veiculoId) => {
      if (veiculoId) carregarChecklist(veiculoId, checklistEl, gerenciar);
    },
  });
  container.querySelector('[data-veiculo-select]').appendChild(veiculoSelect.el);
}
