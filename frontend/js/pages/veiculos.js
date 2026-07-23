import { get, post, put, del, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarDataBr, formatarDataHoraBr } from '../masks.js';
import { criarBotaoSincronizarOnixsat } from '../components/onixsatSync.js';

const TIPOS = ['Cavalo', 'Carreta', 'Dolly', 'Truck', 'Toco'];

async function buscarCarretas(termo) {
  const veiculos = await get(`/veiculos?tipo=Carreta${termo ? `&search=${encodeURIComponent(termo)}` : ''}`);
  return veiculos.map((v) => ({ value: v.id, label: v.placa }));
}

function montarFormulario(registro, aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div>
      <label class="label">Placa *</label>
      <input type="text" name="placa" class="input uppercase" required maxlength="8" />
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label">Tipo *</label>
        <select name="tipo" class="input" required>
          ${TIPOS.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="label">Qtd. Eixos *</label>
        <input type="number" name="qtd_eixos" class="input" required min="1" />
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Marca</label><input type="text" name="marca" class="input" /></div>
      <div><label class="label">Modelo</label><input type="text" name="modelo" class="input" /></div>
    </div>
    <div><label class="label">Ano de fabricacao</label><input type="number" name="ano_fabricacao" class="input" /></div>
    <div data-bloco-carreta class="hidden">
      <label class="label">Carreta padrao</label>
      <div data-carreta-select></div>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2">
      <button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button>
    </div>
  `;

  form.placa.value = registro?.placa || '';
  form.tipo.value = registro?.tipo || 'Cavalo';
  form.qtd_eixos.value = registro?.qtd_eixos ?? '';
  form.marca.value = registro?.marca || '';
  form.modelo.value = registro?.modelo || '';
  form.ano_fabricacao.value = registro?.ano_fabricacao ?? '';

  const blocoCarreta = form.querySelector('[data-bloco-carreta]');
  const carretaSelect = criarSearchableSelect({
    buscar: buscarCarretas,
    placeholder: 'Pesquisar carreta...',
    valorInicial: registro?.carreta_padrao_id ?? null,
    labelInicial: registro?.carreta_padrao_placa || '',
  });
  form.querySelector('[data-carreta-select]').appendChild(carretaSelect.el);

  function atualizarVisibilidadeCarreta() {
    blocoCarreta.classList.toggle('hidden', form.tipo.value !== 'Cavalo');
  }
  form.tipo.addEventListener('change', atualizarVisibilidadeCarreta);
  atualizarVisibilidadeCarreta();

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const valores = {
      placa: form.placa.value.trim().toUpperCase(),
      tipo: form.tipo.value,
      qtd_eixos: Number(form.qtd_eixos.value),
      marca: form.marca.value || null,
      modelo: form.modelo.value || null,
      ano_fabricacao: form.ano_fabricacao.value ? Number(form.ano_fabricacao.value) : null,
      carreta_padrao_id: form.tipo.value === 'Cavalo' ? carretaSelect.getValue() : null,
    };
    try {
      await aoSalvar(valores);
    } catch (err) {
      erro.textContent = err.message || 'Erro ao salvar.';
      erro.classList.remove('hidden');
    }
  });

  return form;
}

async function abrirFormulario(registro, recarregar) {
  const form = montarFormulario(registro, async (valores) => {
    if (registro) await put(`/veiculos/${registro.id}`, valores);
    else await post('/veiculos', valores);
    fecharModal();
    mostrarToast(registro ? 'Veiculo atualizado.' : 'Veiculo cadastrado.');
    recarregar();
  });
  abrirModal({ titulo: registro ? `Editar veiculo ${registro.placa}` : 'Novo veiculo', conteudo: form });
}

export async function abrirHodometro(veiculo, recarregar) {
  try {
    const eventos = await get(`/veiculos/${veiculo.id}/hodometro`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <div class="mb-4 flex items-end gap-2">
        <div class="flex-1">
          <label class="label">Novo km (atual: ${veiculo.hodometro_atual.toLocaleString('pt-BR')})</label>
          <input type="number" class="input" data-novo-km min="${veiculo.hodometro_atual}" />
        </div>
        <button type="button" class="btn-primary" data-registrar>Registrar</button>
      </div>
      <p class="hidden text-sm text-red-600" data-erro-km></p>
      <div class="max-h-64 overflow-y-auto">
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">KM</th><th class="py-1">Origem</th></tr></thead>
          <tbody>
            ${eventos.map((e) => `<tr class="border-b border-slate-100"><td class="py-1">${formatarDataBr(e.data_hora)}</td><td class="py-1">${e.km.toLocaleString('pt-BR')}</td><td class="py-1">${e.origem}</td></tr>`).join('') || '<tr><td colspan="3" class="py-3 text-center text-slate-400">Sem historico.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    const overlay = abrirModal({ titulo: `Hodometro - ${veiculo.placa}`, conteudo: corpo, largura: 'max-w-lg' });
    overlay.querySelector('[data-registrar]').addEventListener('click', async () => {
      const erroEl = overlay.querySelector('[data-erro-km]');
      erroEl.classList.add('hidden');
      const km = Number(overlay.querySelector('[data-novo-km]').value);
      if (!km) return;
      try {
        await post(`/veiculos/${veiculo.id}/hodometro`, { km });
        fecharModal();
        mostrarToast('Hodometro atualizado.');
        recarregar();
      } catch (err) {
        erroEl.textContent = err.message;
        erroEl.classList.remove('hidden');
      }
    });
  } catch (err) {
    mostrarErro(err);
  }
}

export async function abrirLocalizacao(veiculo, recarregar) {
  try {
    const eventos = await get(`/veiculos/${veiculo.id}/localizacao`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <div class="mb-4 flex items-end gap-2">
        <div><label class="label">Cidade *</label><input type="text" class="input" data-cidade /></div>
        <div><label class="label">UF *</label><input type="text" class="input w-16" maxlength="2" data-uf /></div>
        <button type="button" class="btn-primary" data-registrar>Registrar</button>
      </div>
      <p class="hidden text-sm text-red-600" data-erro-loc></p>
      <div class="max-h-64 overflow-y-auto">
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">Cidade/UF</th><th class="py-1">Origem</th></tr></thead>
          <tbody>
            ${eventos.map((e) => `<tr class="border-b border-slate-100"><td class="py-1">${formatarDataBr(e.data_hora)}</td><td class="py-1">${e.cidade}/${e.uf}</td><td class="py-1">${e.origem}</td></tr>`).join('') || '<tr><td colspan="3" class="py-3 text-center text-slate-400">Sem historico.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    const veiculoAtual = veiculo.localizacao_cidade ? `${veiculo.localizacao_cidade}/${veiculo.localizacao_uf}` : 'nao informada';
    const overlay = abrirModal({ titulo: `Localizacao - ${veiculo.placa} (atual: ${veiculoAtual})`, conteudo: corpo, largura: 'max-w-lg' });
    overlay.querySelector('[data-registrar]').addEventListener('click', async () => {
      const erroEl = overlay.querySelector('[data-erro-loc]');
      erroEl.classList.add('hidden');
      const cidade = overlay.querySelector('[data-cidade]').value.trim();
      const uf = overlay.querySelector('[data-uf]').value.trim();
      if (!cidade || !uf) { erroEl.textContent = 'Preencha cidade e UF.'; erroEl.classList.remove('hidden'); return; }
      try {
        await post(`/veiculos/${veiculo.id}/localizacao`, { cidade, uf });
        fecharModal();
        mostrarToast('Localizacao atualizada.');
        recarregar();
      } catch (err) {
        erroEl.textContent = err.message;
        erroEl.classList.remove('hidden');
      }
    });
  } catch (err) {
    mostrarErro(err);
  }
}

let intervaloAtualizacao = null;

export async function render(container) {
  const gerenciar = podeGerenciar('veiculos');
  container.innerHTML = `
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold text-slate-900">Veiculos e Frota</h1>
      <div data-onixsat-botao></div>
    </div>
    <div data-tabela></div>
  `;

  const tabela = criarDataTable({
    colunas: [
      { chave: 'placa', titulo: 'Placa' },
      { chave: 'tipo', titulo: 'Tipo' },
      { chave: 'qtd_eixos', titulo: 'Eixos' },
      { chave: 'marca_modelo', titulo: 'Marca/Modelo', render: (r) => [r.marca, r.modelo].filter(Boolean).join(' ') || '-' },
      { chave: 'hodometro_atual', titulo: 'Hodometro', render: (r) => `${r.hodometro_atual.toLocaleString('pt-BR')} km` },
      {
        chave: 'localizacao', titulo: 'Localizacao',
        render: (r) => (r.localizacao_cidade ? `
          <details>
            <summary class="inline cursor-pointer">${r.localizacao_cidade}/${r.localizacao_uf}</summary>
            <div class="mt-1 text-xs text-slate-500">Atualizado em ${formatarDataHoraBr(r.localizacao_atualizado_em)}</div>
          </details>
        ` : '-'),
      },
      { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativo</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativo</span>') },
    ],
    buscarDados: (termo) => get(termo ? `/veiculos?search=${encodeURIComponent(termo)}` : '/veiculos'),
    onNovo: gerenciar ? () => abrirFormulario(null, tabela.recarregar) : undefined,
    onEditar: gerenciar ? (r) => abrirFormulario(r, tabela.recarregar) : undefined,
    onExcluir: gerenciar ? (r) => del(`/veiculos/${r.id}`) : undefined,
    onExcluirLote: gerenciar ? (ids) => post('/veiculos/batch-delete', { ids }) : undefined,
    acoesExtras: () => [
      { label: 'Hodometro', onClick: (r) => abrirHodometro(r, tabela.recarregar) },
      { label: 'Localizacao', onClick: (r) => abrirLocalizacao(r, tabela.recarregar) },
    ],
    tituloNovo: 'Veiculo',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  if (gerenciar) {
    container.querySelector('[data-onixsat-botao]').appendChild(criarBotaoSincronizarOnixsat({ onAtualizar: tabela.recarregar }));
  }

  // Onixsat sincroniza sozinho a cada 5min no backend, mas sem isso a tela
  // so refletiria os dados novos depois de um F5 ou clique manual no botao.
  if (intervaloAtualizacao) clearInterval(intervaloAtualizacao);
  const hashInicio = window.location.hash;
  intervaloAtualizacao = setInterval(() => {
    if (window.location.hash !== hashInicio) { clearInterval(intervaloAtualizacao); return; }
    tabela.recarregar();
  }, 5 * 60 * 1000);
}
