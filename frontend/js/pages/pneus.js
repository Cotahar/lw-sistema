import { get, post, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { criarNovoFornecedor } from '../components/fornecedorQuickCreate.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, formatarDataBr, attachUppercaseInput } from '../masks.js';
import { ICONE_SUCESSO, ICONE_ATENCAO, ICONE_CRITICO, ICONE_NEUTRO } from '../components/statusIcons.js';

const STATUS_BADGE = {
  Estoque: 'badge-neutro',
  Instalado: 'badge-sucesso',
  EmRecapagem: 'badge-atencao',
  Sucata: 'badge-critico',
};
const STATUS_ICONE = {
  Estoque: ICONE_NEUTRO,
  Instalado: ICONE_SUCESSO,
  EmRecapagem: ICONE_ATENCAO,
  Sucata: ICONE_CRITICO,
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
    <div class="grid grid-cols-2 gap-3">
      <div>${campoTexto('Marca', 'marca')}</div>
      <div>${campoTexto('Modelo', 'modelo')}</div>
    </div>
    <div>${campoTexto('Medida *', 'medida').replace('/>', 'required value="295/80R22.5" />')}</div>
    <div><label class="label">Custo de aquisicao *</label><input type="text" name="custo_unitario" class="input" required /></div>
    <div><label class="label">Fornecedor</label><div data-fornecedor></div></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar</button></div>
  `;
  attachMoedaMask(form.custo_unitario, 0);
  attachUppercaseInput(form.numero_fogo);
  attachUppercaseInput(form.marca);
  attachUppercaseInput(form.modelo);
  attachUppercaseInput(form.medida);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar fornecedor...', criarNovo: { label: 'Cadastrar novo fornecedor', abrir: criarNovoFornecedor } });
  form.querySelector('[data-fornecedor]').appendChild(fornecedorSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    try {
      await post('/pneus', {
        numero_fogo: form.numero_fogo.value,
        marca: form.marca.value || null,
        modelo: form.modelo.value || null,
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
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar recapadora...', criarNovo: { label: 'Cadastrar novo fornecedor', abrir: criarNovoFornecedor } });
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
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar recapadora...', criarNovo: { label: 'Cadastrar novo fornecedor', abrir: criarNovoFornecedor } });
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

// Quais eixos tracionam, a partir de qtd_eixos + tipo_tracao (ver
// schema.sql). Eixo 1 = dianteiro/direcional, nunca traciona - so os
// subsequentes, conforme a configuracao.
function eixosDeTracao(tipoTracao) {
  if (tipoTracao === '6x4') return [2, 3];
  if (tipoTracao === '6x2' || tipoTracao === '4x2') return [2];
  return [];
}

// Diagrama de eixos (Bloco 4 do parecer de refatoracao): top-down, chassi no
// centro, um par de pneus por eixo. Eixo de tracao vem destacado em
// amarelo. Cada pneu instalado e clicavel (abre o historico); posicao vazia
// so avisa que esta livre - instalar continua pela tabela (escolhe o pneu
// de estoque primeiro, ai sim a posicao).
function svgDiagramaEixos(qtdEixos, tipoTracao, pneusPorPosicao) {
  const tracao = eixosDeTracao(tipoTracao);
  const espacamento = 64;
  const altura = 32 + qtdEixos * espacamento;
  const linhasEixo = [];
  const circulos = [];
  for (let eixo = 1; eixo <= qtdEixos; eixo += 1) {
    const y = 32 + (eixo - 1) * espacamento + espacamento / 2 - 32;
    linhasEixo.push(`<line x1="26" y1="${y}" x2="134" y2="${y}" stroke="#54525c" stroke-width="3" />`);
    for (const [lado, x] of [['Esquerdo', 26], ['Direito', 134]]) {
      const pneu = pneusPorPosicao[`${eixo}-${lado}`];
      const ehTracao = tracao.includes(eixo);
      const cor = pneu ? (ehTracao ? '#F5C518' : '#8B8894') : '#2B2A30';
      const cursor = pneu ? 'cursor-pointer' : '';
      circulos.push(`
        <circle data-eixo="${eixo}" data-lado="${lado}" cx="${x}" cy="${y}" r="16" fill="${cor}" stroke="#54525c" stroke-width="1.5" class="${cursor}" />
        <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" fill="#131217" font-weight="700" style="pointer-events:none">${pneu ? pneu.numero_fogo.slice(-3) : ''}</text>
      `);
    }
  }
  return `
    <svg viewBox="0 0 160 ${altura}" style="max-width:220px" class="mx-auto">
      <line x1="80" y1="16" x2="80" y2="${altura - 16}" stroke="#3D3B42" stroke-width="4" />
      ${linhasEixo.join('')}
      ${circulos.join('')}
    </svg>
  `;
}

async function abrirDiagramaEixos() {
  const corpo = document.createElement('div');
  corpo.innerHTML = `
    <div class="mb-4"><label class="label">Veiculo</label><div data-veiculo-diagrama></div></div>
    <div data-diagrama-resultado class="text-center text-sm text-slate-400">Selecione um veiculo.</div>
  `;
  const veiculoSelect = criarSearchableSelect({
    buscar: buscarVeiculos,
    placeholder: 'Pesquisar placa...',
    onChange: async (veiculoId) => {
      const resultadoEl = corpo.querySelector('[data-diagrama-resultado]');
      if (!veiculoId) { resultadoEl.innerHTML = 'Selecione um veiculo.'; return; }
      resultadoEl.innerHTML = '<p class="text-sm text-slate-400">Carregando...</p>';
      try {
        const [veiculo, pneus] = await Promise.all([get(`/veiculos/${veiculoId}`), get(`/pneus?veiculo_id=${veiculoId}`)]);
        const instalados = pneus.filter((p) => p.status === 'Instalado' && p.veiculo_id === Number(veiculoId));
        const pneusPorPosicao = {};
        for (const p of instalados) pneusPorPosicao[`${p.eixo}-${p.lado}`] = p;
        resultadoEl.innerHTML = `
          <p class="mb-2 text-xs uppercase text-slate-500">${veiculo.placa} - ${veiculo.qtd_eixos} eixo(s)${veiculo.tipo_tracao ? ` - tracao ${veiculo.tipo_tracao}` : ''}</p>
          ${svgDiagramaEixos(veiculo.qtd_eixos, veiculo.tipo_tracao, pneusPorPosicao)}
          <p class="mt-2 text-xs text-slate-500">Amarelo = eixo de tracao. Clique num pneu instalado pra ver o historico.</p>
        `;
        resultadoEl.querySelectorAll('circle[data-eixo]').forEach((circulo) => {
          const pneu = pneusPorPosicao[`${circulo.dataset.eixo}-${circulo.dataset.lado}`];
          if (pneu) circulo.addEventListener('click', () => abrirHistorico(pneu));
        });
      } catch (err) {
        mostrarErro(err);
      }
    },
  });
  corpo.querySelector('[data-veiculo-diagrama]').appendChild(veiculoSelect.el);
  abrirModal({ titulo: 'Diagrama de eixos', conteudo: corpo, largura: 'max-w-md' });
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
  container.innerHTML = `
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold text-slate-900">Pneus</h1>
      <button type="button" class="btn-secondary btn-sm" data-diagrama>Ver diagrama de eixos</button>
    </div>
    <div data-tabela></div>
  `;
  container.querySelector('[data-diagrama]').addEventListener('click', abrirDiagramaEixos);
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
      { chave: 'marca_modelo', titulo: 'Marca/Modelo', render: (r) => [r.marca, r.modelo].filter(Boolean).join(' ') || '-' },
      { chave: 'medida', titulo: 'Medida' },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="${STATUS_BADGE[r.status]}">${STATUS_ICONE[r.status] || ''}${r.status}</span>` },
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
