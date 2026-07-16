import { get, post, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../components/modal.js';
import { mostrarToast } from '../components/toast.js';
import { attachDataMask, parseDataBrParaIso, formatarDataBr } from '../masks.js';
import { navegar } from '../router.js';

const STATUS_BADGE = {
  EmAndamento: 'bg-emerald-100 text-emerald-700',
  AguardandoAcerto: 'bg-amber-100 text-amber-700',
  Finalizada: 'bg-slate-100 text-slate-600',
};
const STATUS_LABEL = { EmAndamento: 'Em Andamento', AguardandoAcerto: 'Aguardando Acerto', Finalizada: 'Finalizada' };

async function buscarConjuntos(termo) {
  const conjuntos = await get('/conjuntos');
  const termoLower = (termo || '').toLowerCase();
  const filtrados = termo
    ? conjuntos.filter((c) => (c.nome || '').toLowerCase().includes(termoLower) || c.itens.some((i) => i.placa.toLowerCase().includes(termoLower)))
    : conjuntos;
  return filtrados.map((c) => ({ value: c.id, label: `${c.nome || `Conjunto #${c.id}`} (${c.itens.map((i) => i.placa).join(' + ')})` }));
}
async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}

async function abrirNovaViagem(recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Conjunto (composicao) *</label><div data-conjunto></div></div>
    <div><label class="label">Motorista *</label><div data-motorista></div></div>
    <div><label class="label">Data de inicio *</label><input type="text" name="data_inicio" class="input" required /></div>
    <div><label class="label">KM inicial *</label><input type="number" name="km_inicial" class="input" required /><p class="mt-1 text-xs text-slate-400" data-dica-km></p></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Iniciar viagem</button></div>
  `;
  attachDataMask(form.data_inicio);
  const conjuntoSelect = criarSearchableSelect({
    buscar: buscarConjuntos,
    placeholder: 'Pesquisar composicao...',
    onChange: async (conjuntoId) => {
      if (!conjuntoId) return;
      try {
        const sugestao = await get(`/viagens/sugestao-km-inicial/${conjuntoId}`);
        form.km_inicial.value = sugestao.km_sugerido;
        form.querySelector('[data-dica-km]').textContent = `Sugerido a partir do hodometro de ${sugestao.unidade_tratora.placa}. Pode editar se necessario.`;
      } catch { /* silencioso: usuario preenche manualmente */ }
    },
  });
  form.querySelector('[data-conjunto]').appendChild(conjuntoSelect.el);
  const motoristaSelect = criarSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...' });
  form.querySelector('[data-motorista]').appendChild(motoristaSelect.el);

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const conjunto_id = conjuntoSelect.getValue();
    const motorista_id = motoristaSelect.getValue();
    if (!conjunto_id || !motorista_id) { erro.textContent = 'Selecione o conjunto e o motorista.'; erro.classList.remove('hidden'); return; }
    const data_inicio = parseDataBrParaIso(form.data_inicio.value);
    if (!data_inicio) { erro.textContent = 'Data de inicio invalida.'; erro.classList.remove('hidden'); return; }
    try {
      const viagem = await post('/viagens', { conjunto_id, motorista_id, data_inicio, km_inicial: Number(form.km_inicial.value) });
      fecharModal();
      mostrarToast('Viagem iniciada.');
      recarregar();
      navegar(`/viagens/${viagem.id}`);
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Nova viagem', conteudo: form });
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Viagens e Fretes</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('viagens');

  const motoristasCache = {};
  async function nomeMotorista(id) {
    if (!motoristasCache[id]) {
      try { motoristasCache[id] = (await get(`/motoristas/${id}`)).nome; } catch { motoristasCache[id] = `#${id}`; }
    }
    return motoristasCache[id];
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data_inicio', titulo: 'Inicio', render: (r) => formatarDataBr(r.data_inicio) },
      { chave: 'data_fim', titulo: 'Fim', render: (r) => (r.data_fim ? formatarDataBr(r.data_fim) : '-') },
      { chave: 'motorista_nome', titulo: 'Motorista' },
      { chave: 'km_inicial', titulo: 'KM Inicial', render: (r) => r.km_inicial.toLocaleString('pt-BR') },
      { chave: 'km_final', titulo: 'KM Final', render: (r) => (r.km_final ? r.km_final.toLocaleString('pt-BR') : '-') },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="badge ${STATUS_BADGE[r.status]}">${STATUS_LABEL[r.status]}</span>` },
    ],
    buscarDados: async () => {
      const viagens = await get('/viagens');
      for (const v of viagens) v.motorista_nome = await nomeMotorista(v.motorista_id);
      return viagens;
    },
    onNovo: gerenciar ? () => abrirNovaViagem(tabela.recarregar) : undefined,
    acoesExtras: () => [{ label: 'Abrir', onClick: (r) => navegar(`/viagens/${r.id}`) }],
    tituloNovo: 'Viagem',
    vazio: 'Nenhuma viagem registrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
