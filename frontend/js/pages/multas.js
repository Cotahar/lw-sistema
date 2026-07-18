import { get, post, put, del, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr } from '../masks.js';

const STATUS_LABEL = {
  AguardandoIndicacao: 'Aguardando indicacao',
  CondutorIndicado: 'Condutor indicado',
  NaoIndicado: 'Nao indicado (dobrou)',
  Paga: 'Paga',
  Recorrida: 'Recorrida',
  Cancelada: 'Cancelada',
};

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}

function badgePrazo(multa) {
  if (multa.status !== 'AguardandoIndicacao') return '';
  const dias = multa.dias_restantes;
  const cor = dias <= 5 ? 'bg-red-100 text-red-700' : dias <= 15 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
  const texto = dias < 0 ? `${Math.abs(dias)} dia(s) vencido` : dias === 0 ? 'vence hoje' : `${dias} dia(s)`;
  return `<span class="badge ${cor} ml-1">${texto}</span>`;
}

async function montarFormulario(registro, aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Veiculo *</label><div data-veiculo></div></div>
      <div><label class="label">Motorista (se ja souber)</label><div data-motorista></div></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Orgao autuador</label><input type="text" name="orgao_autuador" class="input" placeholder="Ex: DETRAN-SP, PRF" /></div>
      <div><label class="label">N. do auto de infracao</label><input type="text" name="numero_ait" class="input" /></div>
    </div>
    <div><label class="label">Descricao da infracao *</label><input type="text" name="descricao" class="input" required placeholder="Ex: Excesso de velocidade" /></div>
    <div class="grid grid-cols-3 gap-3">
      <div><label class="label">Valor original *</label><input type="text" name="valor_original" class="input" required /></div>
      <div><label class="label">Data da infracao</label><input type="text" name="data_infracao" class="input" /></div>
      <div><label class="label">Data da notificacao *</label><input type="text" name="data_notificacao" class="input" required /></div>
    </div>
    <div><label class="label">Observacoes</label><textarea name="observacoes" class="input" rows="2"></textarea></div>
    <p class="text-xs text-slate-500">O prazo de 30 dias pra indicar o condutor (Art. 257 par. 8 CTB) e calculado automaticamente a partir da data de notificacao.</p>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button></div>
  `;

  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', valorInicial: registro?.veiculo_id ?? null, labelInicial: registro?.veiculo_placa || '' });
  form.querySelector('[data-veiculo]').appendChild(veiculoSelect.el);
  const motoristaSelect = criarSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', valorInicial: registro?.motorista_id ?? null, labelInicial: registro?.motorista_nome || '' });
  form.querySelector('[data-motorista]').appendChild(motoristaSelect.el);

  attachMoedaMask(form.valor_original, registro?.valor_original || 0);
  attachDataMask(form.data_infracao, registro?.data_infracao);
  attachDataMask(form.data_notificacao, registro?.data_notificacao);
  if (registro) {
    form.orgao_autuador.value = registro.orgao_autuador || '';
    form.numero_ait.value = registro.numero_ait || '';
    form.descricao.value = registro.descricao || '';
    form.observacoes.value = registro.observacoes || '';
  }

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const veiculo_id = veiculoSelect.getValue();
    if (!veiculo_id) { erro.textContent = 'Selecione o veiculo.'; erro.classList.remove('hidden'); return; }
    const data_notificacao = parseDataBrParaIso(form.data_notificacao.value);
    if (!data_notificacao) { erro.textContent = 'Informe uma data de notificacao valida.'; erro.classList.remove('hidden'); return; }
    try {
      await aoSalvar({
        veiculo_id,
        motorista_id: motoristaSelect.getValue() || null,
        orgao_autuador: form.orgao_autuador.value || null,
        numero_ait: form.numero_ait.value || null,
        descricao: form.descricao.value,
        valor_original: getMoedaValue(form.valor_original),
        data_infracao: form.data_infracao.value ? parseDataBrParaIso(form.data_infracao.value) : null,
        data_notificacao,
        observacoes: form.observacoes.value || null,
      });
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  return form;
}

async function abrirFormulario(registro, recarregar) {
  const form = await montarFormulario(registro, async (valores) => {
    if (registro) await put(`/multas/${registro.id}`, valores);
    else await post('/multas', valores);
    fecharModal();
    mostrarToast(registro ? 'Multa atualizada.' : 'Multa cadastrada.');
    recarregar();
  });
  abrirModal({ titulo: registro ? 'Editar multa' : 'Nova multa', conteudo: form, largura: 'max-w-2xl' });
}

async function abrirIndicarCondutor(registro, recarregar) {
  const corpo = document.createElement('div');
  corpo.className = 'space-y-4';
  corpo.innerHTML = `
    <div><label class="label">Motorista *</label><div data-motorista></div></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="button" class="btn-primary" data-salvar>Indicar condutor</button></div>
  `;
  const motoristaSelect = criarSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', valorInicial: registro.motorista_id ?? null, labelInicial: registro.motorista_nome || '' });
  corpo.querySelector('[data-motorista]').appendChild(motoristaSelect.el);
  const overlay = abrirModal({ titulo: `Indicar condutor - ${registro.veiculo_placa}`, conteudo: corpo });
  overlay.querySelector('[data-salvar]').addEventListener('click', async () => {
    const erroEl = overlay.querySelector('[data-erro]');
    erroEl.classList.add('hidden');
    const motorista_id = motoristaSelect.getValue();
    if (!motorista_id) { erroEl.textContent = 'Selecione o motorista.'; erroEl.classList.remove('hidden'); return; }
    try {
      await post(`/multas/${registro.id}/indicar-condutor`, { motorista_id });
      fecharModal();
      mostrarToast('Condutor indicado.');
      recarregar();
    } catch (err) {
      erroEl.textContent = err.message;
      erroEl.classList.remove('hidden');
    }
  });
}

async function marcarNaoIndicado(registro, recarregar) {
  const ok = await confirmarAcao({
    titulo: 'Marcar como nao indicado',
    mensagem: `O prazo pra indicar o condutor desta multa (${registro.veiculo_placa}) vai ser marcado como vencido. O valor dobra automaticamente (Art. 257 par. 8 CTB): de ${formatarMoeda(registro.valor_original)} para ${formatarMoeda(registro.valor_original * 2)}. Confirma?`,
    textoConfirmar: 'Confirmar',
  });
  if (!ok) return;
  try {
    await post(`/multas/${registro.id}/status`, { status: 'NaoIndicado' });
    mostrarToast('Multa marcada como nao indicada.');
    recarregar();
  } catch (err) {
    mostrarErro(err);
  }
}

async function marcarPaga(registro, recarregar) {
  const ok = await confirmarAcao({ titulo: 'Marcar como paga', mensagem: `Confirma que a multa do veiculo ${registro.veiculo_placa} foi paga?`, textoConfirmar: 'Confirmar' });
  if (!ok) return;
  try {
    await post(`/multas/${registro.id}/status`, { status: 'Paga' });
    mostrarToast('Multa marcada como paga.');
    recarregar();
  } catch (err) {
    mostrarErro(err);
  }
}

async function verNotificacao(registro) {
  try {
    const texto = await get(`/multas/${registro.id}/notificacao-condutor`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <textarea readonly class="input h-64 font-mono text-sm">${texto}</textarea>
      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="btn-secondary" data-copiar>Copiar texto</button>
      </div>
    `;
    const overlay = abrirModal({ titulo: `Notificacao - ${registro.veiculo_placa}`, conteudo: corpo, largura: 'max-w-xl' });
    overlay.querySelector('[data-copiar]').addEventListener('click', async () => {
      await navigator.clipboard.writeText(texto);
      mostrarToast('Texto copiado.');
    });
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Multas de Transito</h1>
    <p class="mb-4 text-sm text-slate-500">Lancamento manual. Prazo de indicacao do condutor calculado automaticamente (30 dias da notificacao); nao indicar a tempo dobra o valor da multa (Art. 257 par. 8 CTB).</p>
    <div data-tabela></div>
  `;
  const gerenciar = podeGerenciar('multas');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'veiculo_placa', titulo: 'Veiculo' },
      { chave: 'motorista_nome', titulo: 'Motorista', render: (r) => r.motorista_nome || '-' },
      { chave: 'descricao', titulo: 'Infracao' },
      { chave: 'valor_original', titulo: 'Valor', render: (r) => formatarMoeda(r.status === 'NaoIndicado' && r.valor_nao_indicacao ? r.valor_nao_indicacao : r.valor_original) },
      { chave: 'prazo_indicacao', titulo: 'Prazo indicacao', render: (r) => `${formatarDataBr(r.prazo_indicacao)}${badgePrazo(r)}` },
      { chave: 'status', titulo: 'Status', render: (r) => STATUS_LABEL[r.status] || r.status },
    ],
    buscarDados: () => get('/multas'),
    onNovo: gerenciar ? () => abrirFormulario(null, tabela.recarregar) : undefined,
    onEditar: gerenciar ? (r) => abrirFormulario(r, tabela.recarregar) : undefined,
    onExcluir: gerenciar ? (r) => del(`/multas/${r.id}`) : undefined,
    acoesExtras: gerenciar ? (r) => {
      const acoes = [];
      if (r.status === 'AguardandoIndicacao' || r.status === 'CondutorIndicado') {
        acoes.push({ label: 'Indicar condutor', onClick: (reg) => abrirIndicarCondutor(reg, tabela.recarregar) });
      }
      if (r.status === 'AguardandoIndicacao') {
        acoes.push({ label: 'Marcar nao indicado', onClick: (reg) => marcarNaoIndicado(reg, tabela.recarregar) });
      }
      if (r.motorista_nome) {
        acoes.push({ label: 'Notificacao', onClick: verNotificacao });
      }
      if (r.status !== 'Paga' && r.status !== 'Cancelada') {
        acoes.push({ label: 'Marcar paga', onClick: (reg) => marcarPaga(reg, tabela.recarregar) });
      }
      return acoes;
    } : undefined,
    tituloNovo: 'Multa',
    vazio: 'Nenhuma multa lancada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
