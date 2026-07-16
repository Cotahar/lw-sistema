import { get, post, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, formatarDataBr } from '../masks.js';

const STATUS_BADGE = {
  Estoque: 'bg-slate-100 text-slate-600',
  Instalado: 'bg-emerald-100 text-emerald-700',
  EmRecapagem: 'bg-amber-100 text-amber-700',
  Sucata: 'bg-red-100 text-red-700',
};

async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}
async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

function campoTexto(label, name, tipo = 'text') {
  return `<div><label class="label">${label}</label><input type="${tipo}" name="${name}" class="input" /></div>`;
}

async function abrirFormularioAquisicao(recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div>${campoTexto('Numero de fogo *', 'numero_fogo').replace('/>', 'required />')}</div>
    <div>${campoTexto('Medida * (ex.: 295/80R22.5)', 'medida').replace('/>', 'required />')}</div>
    <div><label class="label">Custo de aquisicao *</label><input type="text" name="custo_unitario" class="input" required /></div>
    <div><label class="label">Fornecedor</label><div data-fornecedor></div></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar</button></div>
  `;
  attachMoedaMask(form.custo_unitario, 0);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar fornecedor...' });
  form.querySelector('[data-fornecedor]').appendChild(fornecedorSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    try {
      await post('/pneus', {
        numero_fogo: form.numero_fogo.value,
        medida: form.medida.value,
        custo_unitario: getMoedaValue(form.custo_unitario),
        fornecedor_id: fornecedorSelect.getValue(),
      });
      fecharModal();
      mostrarToast('Pneu cadastrado (entrou em Estoque).');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Novo pneu (aquisicao)', conteudo: form });
}

async function abrirHistorico(pneu) {
  try {
    const eventos = await get(`/pneus/${pneu.id}/eventos`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <table class="w-full text-sm">
        <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">Evento</th><th class="py-1">Local</th><th class="py-1 text-right">Custo</th></tr></thead>
        <tbody>
          ${eventos.map((e) => `
            <tr class="border-b border-slate-100">
              <td class="py-1">${formatarDataBr(e.data)}</td>
              <td class="py-1">${e.tipo_evento}</td>
              <td class="py-1">${e.veiculo_id ? `Veiculo #${e.veiculo_id}${e.eixo ? ` - eixo ${e.eixo} ${e.lado || ''}` : ''}` : '-'}</td>
              <td class="py-1 text-right">${e.custo !== null ? formatarMoeda(e.custo) : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" class="py-3 text-center text-slate-400">Sem eventos.</td></tr>'}
        </tbody>
      </table>
    `;
    abrirModal({ titulo: `Historico - Pneu ${pneu.numero_fogo}`, conteudo: corpo, largura: 'max-w-xl' });
  } catch (err) {
    mostrarErro(err);
  }
}

async function abrirInstalar(pneu, recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Veiculo *</label><div data-veiculo></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Eixo *</label><input type="number" name="eixo" class="input" required min="1" /></div>
      <div><label class="label">Lado *</label><select name="lado" class="input" required><option value="Esquerdo">Esquerdo</option><option value="Direito">Direito</option></select></div>
    </div>
    <div><label class="label">KM do veiculo</label><input type="number" name="km_veiculo" class="input" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Instalar</button></div>
  `;
  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...' });
  form.querySelector('[data-veiculo]').appendChild(veiculoSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const veiculo_id = veiculoSelect.getValue();
    if (!veiculo_id) { erro.textContent = 'Selecione o veiculo.'; erro.classList.remove('hidden'); return; }
    try {
      await post(`/pneus/${pneu.id}/instalar`, { veiculo_id, eixo: Number(form.eixo.value), lado: form.lado.value, km_veiculo: form.km_veiculo.value ? Number(form.km_veiculo.value) : null });
      fecharModal();
      mostrarToast('Pneu instalado.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: `Instalar pneu ${pneu.numero_fogo}`, conteudo: form });
}

async function abrirRemover(pneu, recarregar) {
  const ok = await confirmarAcao({ titulo: 'Remover pneu', mensagem: `Remover o pneu ${pneu.numero_fogo} do veiculo? Ele volta para o Estoque.`, textoConfirmar: 'Remover', perigo: false });
  if (!ok) return;
  try {
    await post(`/pneus/${pneu.id}/remover`, {});
    mostrarToast('Pneu removido, voltou para o Estoque.');
    recarregar();
  } catch (err) {
    mostrarErro(err);
  }
}

async function abrirEnviarRecapagem(pneu, recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Recapadora *</label><div data-fornecedor></div></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Enviar</button></div>
  `;
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar recapadora...' });
  form.querySelector('[data-fornecedor]').appendChild(fornecedorSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fornecedor_id = fornecedorSelect.getValue();
    if (!fornecedor_id) { erro.textContent = 'Selecione a recapadora.'; erro.classList.remove('hidden'); return; }
    try {
      await post(`/pneus/${pneu.id}/enviar-recapagem`, { fornecedor_id });
      fecharModal();
      mostrarToast('Pneu enviado para recapagem.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: `Enviar para recapagem - ${pneu.numero_fogo}`, conteudo: form });
}

async function abrirRetornarRecapagem(pneu, recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Recapadora</label><div data-fornecedor></div></div>
    <div><label class="label">Custo da recapagem *</label><input type="text" name="custo" class="input" required /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Registrar retorno</button></div>
  `;
  attachMoedaMask(form.custo, 0);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar recapadora...' });
  form.querySelector('[data-fornecedor]').appendChild(fornecedorSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await post(`/pneus/${pneu.id}/retornar-recapagem`, { custo: getMoedaValue(form.custo), fornecedor_id: fornecedorSelect.getValue() });
      fecharModal();
      mostrarToast('Retorno da recapagem registrado. Custo entra no DRE na proxima instalacao.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: `Retorno da recapagem - ${pneu.numero_fogo}`, conteudo: form });
}

async function sucatear(pneu, recarregar) {
  const ok = await confirmarAcao({ titulo: 'Sucatear pneu', mensagem: `Marcar o pneu ${pneu.numero_fogo} como Sucata? Esta acao encerra a vida util dele no sistema.`, textoConfirmar: 'Sucatear' });
  if (!ok) return;
  try {
    await post(`/pneus/${pneu.id}/sucatear`, {});
    mostrarToast('Pneu marcado como Sucata.');
    recarregar();
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Pneus</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('pneus');

  const veiculosCache = {};
  async function nomeVeiculo(id) {
    if (!id) return '-';
    if (!veiculosCache[id]) {
      try { veiculosCache[id] = (await get(`/veiculos/${id}`)).placa; } catch { veiculosCache[id] = `#${id}`; }
    }
    return veiculosCache[id];
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'numero_fogo', titulo: 'Numero de Fogo' },
      { chave: 'medida', titulo: 'Medida' },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="badge ${STATUS_BADGE[r.status]}">${r.status}</span>` },
      { chave: 'posicao', titulo: 'Posicao', render: (r) => (r.status === 'Instalado' ? `${r.placa_veiculo || '#' + r.veiculo_id} - eixo ${r.eixo} ${r.lado}` : '-') },
      { chave: 'numero_recapagens', titulo: 'Recapagens' },
      { chave: 'custo_unitario', titulo: 'Custo Aquisicao', render: (r) => formatarMoeda(r.custo_unitario) },
    ],
    buscarDados: async (termo) => {
      const pneus = await get(`/pneus${termo ? `?search=${encodeURIComponent(termo)}` : ''}`);
      for (const p of pneus) if (p.status === 'Instalado') p.placa_veiculo = await nomeVeiculo(p.veiculo_id);
      return pneus;
    },
    onNovo: gerenciar ? () => abrirFormularioAquisicao(tabela.recarregar) : undefined,
    acoesExtras: (r) => {
      const acoes = [{ label: 'Historico', onClick: abrirHistorico }];
      if (!gerenciar) return acoes;
      if (r.status === 'Estoque') {
        acoes.push({ label: 'Instalar', onClick: (p) => abrirInstalar(p, tabela.recarregar) });
        acoes.push({ label: 'Enviar recapagem', onClick: (p) => abrirEnviarRecapagem(p, tabela.recarregar) });
        acoes.push({ label: 'Sucatear', onClick: (p) => sucatear(p, tabela.recarregar) });
      } else if (r.status === 'Instalado') {
        acoes.push({ label: 'Remover', onClick: (p) => abrirRemover(p, tabela.recarregar) });
        acoes.push({ label: 'Sucatear', onClick: (p) => sucatear(p, tabela.recarregar) });
      } else if (r.status === 'EmRecapagem') {
        acoes.push({ label: 'Retorno recapagem', onClick: (p) => abrirRetornarRecapagem(p, tabela.recarregar) });
      }
      return acoes;
    },
    tituloNovo: 'Pneu',
    vazio: 'Nenhum pneu cadastrado.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
