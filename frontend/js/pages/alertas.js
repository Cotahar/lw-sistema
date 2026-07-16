import { get, post, del, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarDataBr } from '../masks.js';

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

async function abrirNovaRegra(recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Veiculo *</label><div data-veiculo></div></div>
    <div><label class="label">Descricao *</label><input type="text" name="descricao" class="input" required placeholder="Ex.: Revisao a cada 50.000 km" /></div>
    <div><label class="label">Intervalo (km) *</label><input type="number" name="intervalo_km" class="input" required min="1" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar</button></div>
  `;
  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...' });
  form.querySelector('[data-veiculo]').appendChild(veiculoSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const veiculo_id = veiculoSelect.getValue();
    if (!veiculo_id) { erro.textContent = 'Selecione o veiculo.'; erro.classList.remove('hidden'); return; }
    try {
      await post('/alertas/regras', { veiculo_id, descricao: form.descricao.value, intervalo_km: Number(form.intervalo_km.value) });
      fecharModal();
      mostrarToast('Regra de alerta cadastrada.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Nova regra de alerta', conteudo: form });
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Alertas de Manutencao</h1>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-slate-900">Ocorrencias pendentes</h2>
    </div>
    <div data-tabela-ocorrencias class="mb-6"></div>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-slate-900">Regras cadastradas</h2>
    </div>
    <div data-tabela-regras></div>
  `;
  const gerenciar = podeGerenciar('alertas');

  const veiculosCache = {};
  async function nomeVeiculo(id) {
    if (!veiculosCache[id]) {
      try { veiculosCache[id] = (await get(`/veiculos/${id}`)).placa; } catch { veiculosCache[id] = `#${id}`; }
    }
    return veiculosCache[id];
  }

  const tabelaOcorrencias = criarDataTable({
    colunas: [
      { chave: 'placa', titulo: 'Veiculo' },
      { chave: 'regra_descricao', titulo: 'Regra' },
      { chave: 'km_atual_no_disparo', titulo: 'KM no disparo', render: (r) => r.km_atual_no_disparo.toLocaleString('pt-BR') },
      { chave: 'data_disparo', titulo: 'Data', render: (r) => formatarDataBr(r.data_disparo) },
    ],
    buscarDados: () => get('/alertas/ocorrencias?status=Pendente'),
    acoesExtras: gerenciar ? () => [{
      label: 'Resolver',
      onClick: async (r) => {
        const ok = await confirmarAcao({ titulo: 'Resolver alerta', mensagem: 'Marcar este alerta como resolvido? O contador reinicia a partir do km atual.', textoConfirmar: 'Resolver', perigo: false });
        if (!ok) return;
        try {
          await post(`/alertas/ocorrencias/${r.id}/resolver`, {});
          mostrarToast('Alerta resolvido.');
          tabelaOcorrencias.recarregar();
          tabelaRegras.recarregar();
        } catch (err) { mostrarErro(err); }
      },
    }] : undefined,
    vazio: 'Nenhum alerta pendente.',
  });
  container.querySelector('[data-tabela-ocorrencias]').appendChild(tabelaOcorrencias.el);

  const tabelaRegras = criarDataTable({
    colunas: [
      { chave: 'placa', titulo: 'Veiculo' },
      { chave: 'descricao', titulo: 'Descricao' },
      { chave: 'intervalo_km', titulo: 'Intervalo (km)', render: (r) => r.intervalo_km.toLocaleString('pt-BR') },
      { chave: 'km_referencia', titulo: 'Referencia atual (km)', render: (r) => r.km_referencia.toLocaleString('pt-BR') },
    ],
    buscarDados: async () => {
      const regras = await get('/alertas/regras');
      for (const r of regras) r.placa = await nomeVeiculo(r.veiculo_id);
      return regras;
    },
    onNovo: gerenciar ? () => abrirNovaRegra(tabelaRegras.recarregar) : undefined,
    onExcluir: gerenciar ? (r) => del(`/alertas/regras/${r.id}`) : undefined,
    tituloNovo: 'Regra',
    vazio: 'Nenhuma regra cadastrada.',
  });
  container.querySelector('[data-tabela-regras]').appendChild(tabelaRegras.el);
}
