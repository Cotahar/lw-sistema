import { get, post, del, authHeaders, podeGerenciar } from '../api.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataHoraBr } from '../masks.js';
import { renderizarAcessoNegado } from '../components/acessoNegado.js';

const PAGO_POR = ['Empresa', 'Motorista', 'AdminOutros'];

async function buscarViagensAbertas(termo) {
  const [viagens, motoristas] = await Promise.all([get('/viagens?status='), get('/motoristas')]);
  const nomeMotorista = Object.fromEntries(motoristas.map((m) => [m.id, m.nome]));
  const abertas = viagens.filter((v) => v.status !== 'Finalizada');
  const termoLower = (termo || '').toLowerCase();
  const filtradas = termo
    ? abertas.filter((v) => (nomeMotorista[v.motorista_id] || '').toLowerCase().includes(termoLower)
        || (v.placa_tratora || '').toLowerCase().includes(termoLower)
        || String(v.id).includes(termoLower))
    : abertas;
  return filtradas.map((v) => ({ value: v.id, label: `Viagem #${v.id} - ${v.placa_tratora || '?'} - ${nomeMotorista[v.motorista_id] || '?'} (${v.status})` }));
}
const CRIAR_CATEGORIA_PREFIXO = '__criar__:';

async function buscarCategorias(termo) {
  const categorias = await get('/categorias-despesa');
  const filtradas = termo ? categorias.filter((c) => c.nome.toLowerCase().includes(termo.toLowerCase())) : categorias;
  const opcoes = filtradas.map((c) => ({ value: c.id, label: c.nome }));
  const existeExata = termo && categorias.some((c) => c.nome.trim().toLowerCase() === termo.trim().toLowerCase());
  if (termo && !existeExata) {
    opcoes.push({ value: `${CRIAR_CATEGORIA_PREFIXO}${termo}`, label: `+ Criar categoria "${termo}"` });
  }
  return opcoes;
}

// Resolve o id da categoria a partir do valor selecionado no searchable select.
// Cobre 3 casos: (1) categoria existente escolhida na lista (valor = id numerico);
// (2) opcao "+ Criar categoria X" escolhida (valor prefixado); (3) usuario nao
// mexeu no campo e manteve so o nome pre-preenchido do Drivvo (valor nulo, so
// o label) - nesse caso busca por nome exato ou cria.
async function resolverCategoriaId(valorSelecionado, nomeFallback) {
  if (typeof valorSelecionado === 'string' && valorSelecionado.startsWith(CRIAR_CATEGORIA_PREFIXO)) {
    const nome = valorSelecionado.slice(CRIAR_CATEGORIA_PREFIXO.length);
    const nova = await post('/categorias-despesa', { nome });
    return nova.id;
  }
  if (!valorSelecionado && nomeFallback) {
    const categorias = await get('/categorias-despesa');
    const existente = categorias.find((c) => c.nome.trim().toLowerCase() === nomeFallback.trim().toLowerCase());
    if (existente) return existente.id;
    const nova = await post('/categorias-despesa', { nome: nomeFallback });
    return nova.id;
  }
  return valorSelecionado;
}
async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}
async function buscarUsuarios(termo) {
  try {
    const usuarios = await get('/usuarios');
    const filtrados = termo ? usuarios.filter((u) => u.nome.toLowerCase().includes(termo.toLowerCase())) : usuarios;
    return filtrados.map((u) => ({ value: u.id, label: u.nome }));
  } catch { return []; }
}

async function enviarArquivo(arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  const res = await fetch('/api/drivvo/importar', { method: 'POST', headers: authHeaders(), body: formData });
  const dados = await res.json().catch(() => null);
  if (!res.ok) throw new Error((dados && dados.erro) || `Erro ${res.status}`);
  return dados;
}

function montarResumoTexto(resumo) {
  const partes = [];
  for (const [secao, r] of Object.entries(resumo)) {
    partes.push(`${secao}: ${r.importados} lancados, ${r.pendentes} para revisar, ${r.jaExistiam} ja importados antes`);
  }
  return partes.join(' · ');
}

function abrirResolverPendencia(pendencia, recarregar) {
  const bruto = pendencia.dados_brutos;
  const form = document.createElement('form');
  form.className = 'space-y-4';

  if (pendencia.secao === 'Receita') {
    const obsOriginal = bruto.observacao || '';
    form.innerHTML = `
      <p class="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">Original do Drivvo: "${obsOriginal}" &middot; ${formatarMoeda(Math.round((parseFloat(bruto.valor) || 0) * 100))}</p>
      <div><label class="label">Viagem *</label><div data-viagem></div></div>
      <div><label class="label">Transportadora</label><div data-transportadora></div></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Origem (cidade) *</label><input type="text" name="origem_cidade" class="input" required /></div>
        <div><label class="label">UF *</label><input type="text" name="origem_uf" class="input" maxlength="2" required /></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Destino (cidade) *</label><input type="text" name="destino_cidade" class="input" required /></div>
        <div><label class="label">UF *</label><input type="text" name="destino_uf" class="input" maxlength="2" required /></div>
      </div>
      <div><label class="label">Frete Bruto *</label><input type="text" name="frete_bruto" class="input" required /></div>
      <p class="hidden text-sm text-red-600" data-erro></p>
      <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Lancar frete</button></div>
    `;
    attachMoedaMask(form.frete_bruto, Math.round((parseFloat(bruto.valor) || 0) * 100));
    const viagemSelect = criarSearchableSelect({ buscar: buscarViagensAbertas, placeholder: 'Selecione a viagem...' });
    form.querySelector('[data-viagem]').appendChild(viagemSelect.el);
    const transpSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar transportadora...' });
    form.querySelector('[data-transportadora]').appendChild(transpSelect.el);

    const erro = form.querySelector('[data-erro]');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erro.classList.add('hidden');
      const viagemId = viagemSelect.getValue();
      if (!viagemId) { erro.textContent = 'Selecione a viagem.'; erro.classList.remove('hidden'); return; }
      try {
        const frete = await post(`/viagens/${viagemId}/fretes`, {
          transportadora_id: transpSelect.getValue(),
          origem_cidade: form.origem_cidade.value,
          origem_uf: form.origem_uf.value.toUpperCase(),
          destino_cidade: form.destino_cidade.value,
          destino_uf: form.destino_uf.value.toUpperCase(),
          frete_bruto: getMoedaValue(form.frete_bruto),
        });
        await post(`/drivvo/pendencias/${pendencia.id}/resolver`, { entidade_tipo: 'Frete', entidade_id: frete.id });
        fecharModal();
        mostrarToast('Frete lancado.');
        recarregar();
      } catch (err) {
        erro.textContent = err.message;
        erro.classList.remove('hidden');
      }
    });
  } else {
    const ehAbastecimento = pendencia.secao === 'Abastecimento';
    const valorCentavos = Math.round((parseFloat(ehAbastecimento ? bruto.valor_total_1 : bruto['valor total']) || 0) * 100);
    const dataIso = null; // usuario confere/reescolhe a data no form
    form.innerHTML = `
      <p class="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">Original do Drivvo: ${ehAbastecimento ? (bruto.posto || '-') : (bruto['tipo de despesa'] || '-')} &middot; ${formatarMoeda(valorCentavos)} &middot; ${bruto.data || bruto['data'] || ''}</p>
      <div><label class="label">Viagem *</label><div data-viagem></div></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Categoria *</label><div data-categoria></div></div>
        <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Data</label><input type="text" name="data" class="input" /></div>
        <div><label class="label">Pago por *</label><select name="pago_por" class="input" required>${PAGO_POR.map((p) => `<option value="${p}">${p}</option>`).join('')}</select></div>
      </div>
      <div data-bloco-usuario class="hidden"><label class="label">Quem desembolsou *</label><div data-usuario-select></div></div>
      <p class="hidden text-sm text-red-600" data-erro></p>
      <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Lancar despesa</button></div>
    `;
    attachMoedaMask(form.valor, valorCentavos);
    attachDataMask(form.data, dataIso);
    form.data.value = (bruto.data || '').split(' ')[0];
    const viagemSelect = criarSearchableSelect({ buscar: buscarViagensAbertas, placeholder: 'Selecione a viagem...' });
    form.querySelector('[data-viagem]').appendChild(viagemSelect.el);
    const categoriaSelect = criarSearchableSelect({
      buscar: buscarCategorias,
      placeholder: 'Pesquisar categoria...',
      labelInicial: ehAbastecimento ? 'Abastecimento' : (bruto['tipo de despesa'] || ''),
    });
    form.querySelector('[data-categoria]').appendChild(categoriaSelect.el);
    const usuarioSelect = criarSearchableSelect({ buscar: buscarUsuarios, placeholder: 'Pesquisar usuario...' });
    form.querySelector('[data-usuario-select]').appendChild(usuarioSelect.el);
    form.pago_por.addEventListener('change', () => {
      form.querySelector('[data-bloco-usuario]').classList.toggle('hidden', form.pago_por.value !== 'AdminOutros');
    });

    const erro = form.querySelector('[data-erro]');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erro.classList.add('hidden');
      const viagemId = viagemSelect.getValue();
      if (!viagemId) { erro.textContent = 'Selecione a viagem.'; erro.classList.remove('hidden'); return; }
      if (!categoriaSelect.getValue() && !categoriaSelect.getLabel()) { erro.textContent = 'Selecione a categoria.'; erro.classList.remove('hidden'); return; }
      if (form.pago_por.value === 'AdminOutros' && !usuarioSelect.getValue()) { erro.textContent = 'Selecione quem desembolsou.'; erro.classList.remove('hidden'); return; }
      try {
        const categoriaId = await resolverCategoriaId(categoriaSelect.getValue(), categoriaSelect.getLabel());
        const despesa = await post(`/viagens/${viagemId}/despesas`, {
          categoria_id: categoriaId,
          valor: getMoedaValue(form.valor),
          data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
          pago_por: form.pago_por.value,
          pago_por_usuario_id: usuarioSelect.getValue(),
          litragem: ehAbastecimento ? (parseFloat(bruto.volume_1) || null) : null,
          preco_litro: ehAbastecimento ? Math.round((parseFloat(bruto.preco_litro_1) || 0) * 100) || null : null,
        });
        await post(`/drivvo/pendencias/${pendencia.id}/resolver`, { entidade_tipo: 'DespesaViagem', entidade_id: despesa.id });
        fecharModal();
        mostrarToast('Despesa lancada.');
        recarregar();
      } catch (err) {
        erro.textContent = err.message;
        erro.classList.remove('hidden');
      }
    });
  }

  abrirModal({ titulo: `Resolver pendencia - ${pendencia.secao}`, conteudo: form, largura: 'max-w-lg' });
}

async function ignorarPendencia(pendencia, recarregar) {
  const ok = await confirmarAcao({ titulo: 'Ignorar pendencia', mensagem: 'Esta linha do Drivvo nao sera lancada no Frottex. Continuar?', textoConfirmar: 'Ignorar', perigo: false });
  if (!ok) return;
  try {
    await post(`/drivvo/pendencias/${pendencia.id}/ignorar`, {});
    mostrarToast('Pendencia ignorada.');
    recarregar();
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  if (!podeGerenciar('viagens')) return renderizarAcessoNegado(container);

  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Importar do Drivvo</h1>
    <p class="mb-4 text-sm text-slate-500">Suba o arquivo CSV exportado do Drivvo ("Reports"). Abastecimentos e adiantamentos salariais com viagem identificada sao lancados automaticamente; o resto fica pendente de revisao abaixo.</p>
    <div class="card mb-6 p-4">
      <div class="flex items-center gap-3">
        <input type="file" accept=".csv" data-arquivo class="input" />
        <button type="button" class="btn-primary shrink-0" data-enviar>Importar</button>
      </div>
      <p class="mt-2 hidden text-sm" data-resumo></p>
    </div>
    <h2 class="mb-3 font-semibold text-slate-900">Pendentes de revisao</h2>
    <div class="card overflow-x-auto border-gray-300 p-0">
      <table class="w-full min-w-max border-collapse">
        <thead class="bg-brand-black"><tr>
          <th class="table-th">Data</th><th class="table-th">Secao</th><th class="table-th">Descricao</th>
          <th class="table-th">Valor</th><th class="table-th">Motivo</th><th class="table-th"></th>
        </tr></thead>
        <tbody data-linhas></tbody>
      </table>
    </div>
  `;

  const inputArquivo = container.querySelector('[data-arquivo]');
  const resumoEl = container.querySelector('[data-resumo]');

  async function carregarPendencias() {
    const tbody = container.querySelector('[data-linhas]');
    tbody.innerHTML = '<tr><td colspan="6" class="table-td py-6 text-center text-slate-400">Carregando...</td></tr>';
    try {
      const pendencias = await get('/drivvo/pendencias');
      tbody.innerHTML = pendencias.length ? pendencias.map((p) => {
        const b = p.dados_brutos;
        const data = p.secao === 'Abastecimento' ? b.data : (b.data || '');
        const valorBruto = p.secao === 'Abastecimento' ? b.valor_total_1 : (b['valor total'] ?? b.valor);
        const descricao = p.secao === 'Abastecimento' ? (b.posto || 'Abastecimento') : (b['tipo de despesa'] || b['tipo de receita'] || b.observacao || '-');
        return `
          <tr class="border-b border-slate-100">
            <td class="table-td">${data}</td>
            <td class="table-td">${p.secao}</td>
            <td class="table-td">${descricao}</td>
            <td class="table-td">${formatarMoeda(Math.round((parseFloat(valorBruto) || 0) * 100))}</td>
            <td class="table-td text-xs text-slate-500">${p.motivo_pendencia || '-'}</td>
            <td class="table-td text-right whitespace-nowrap">
              <button type="button" class="btn-secondary btn-sm mr-1" data-resolver="${p.id}">Resolver</button>
              <button type="button" class="btn-secondary btn-sm" data-ignorar="${p.id}">Ignorar</button>
            </td>
          </tr>
        `;
      }).join('') : '<tr><td colspan="6" class="table-td py-6 text-center text-slate-400">Nenhuma pendencia.</td></tr>';

      tbody.querySelectorAll('[data-resolver]').forEach((btn) => {
        const pendencia = pendencias.find((p) => String(p.id) === btn.dataset.resolver);
        btn.addEventListener('click', () => abrirResolverPendencia(pendencia, carregarPendencias));
      });
      tbody.querySelectorAll('[data-ignorar]').forEach((btn) => {
        const pendencia = pendencias.find((p) => String(p.id) === btn.dataset.ignorar);
        btn.addEventListener('click', () => ignorarPendencia(pendencia, carregarPendencias));
      });
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-td py-6 text-center text-red-600">Erro ao carregar.</td></tr>';
      mostrarErro(err);
    }
  }

  container.querySelector('[data-enviar]').addEventListener('click', async () => {
    const arquivo = inputArquivo.files[0];
    if (!arquivo) { mostrarToast('Selecione um arquivo primeiro.'); return; }
    try {
      const resumo = await enviarArquivo(arquivo);
      resumoEl.textContent = montarResumoTexto(resumo);
      resumoEl.classList.remove('hidden');
      inputArquivo.value = '';
      mostrarToast('Arquivo processado.');
      carregarPendencias();
    } catch (err) {
      mostrarErro(err);
    }
  });

  await carregarPendencias();
}
