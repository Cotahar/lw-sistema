import { get, post } from '../api.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { criarNovoFornecedor } from '../components/fornecedorQuickCreate.js';
import { mostrarToast } from '../components/toast.js';
import { confirmarAcao } from '../components/modal.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../masks.js';

// Importacao da fatura do Sem Parar (administracao): le o relatorio .xlsx da fatura no
// navegador (SheetJS, ja carregado no index.html), manda as abas para a API calcular o
// valor liquido de cada placa e lanca UMA conta a pagar com o total da fatura, rateada
// entre os centros de custo das placas (mesmo "lancamento rateado" das Despesas Fixas).

// Abas que a API usa; a primeira (resumo) vai inteira, as de detalhe so com as colunas
// de que a conta precisa (placa, tag, valor, tipo) - o arquivo tem centenas de passagens.
const ABAS_NECESSARIAS = [
  'RESUMO DA FATURA', 'PASSAGENS PEDAGIO', 'PASSAGENS VALE-PEDAGIO', 'PASSAGENS ESTACIONAMENTO',
  'TRANSACOES ESTABELECIMENTOS', 'ADESOES', 'MENSALIDADES', 'OUTROS SERVICOS', 'CREDITOS',
];
const COLUNAS_DETALHE = ['PLACA', 'TAG', 'VALOR', 'TIPO'];

function norm(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function lerPlanilha(arquivo) {
  if (typeof XLSX === 'undefined') throw new Error('A biblioteca de leitura de planilhas ainda esta carregando. Tente de novo em instantes.');
  const livro = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  const abas = {};
  for (const nome of livro.SheetNames) {
    const chave = norm(nome);
    if (!ABAS_NECESSARIAS.includes(chave)) continue;
    const linhas = XLSX.utils.sheet_to_json(livro.Sheets[nome], { header: 1, raw: true, defval: null });
    if (chave === 'RESUMO DA FATURA') { abas[nome] = linhas; continue; }
    const manter = (linhas[0] || []).map(norm).map((c, i) => (COLUNAS_DETALHE.includes(c) ? i : -1)).filter((i) => i >= 0);
    abas[nome] = linhas.map((l) => manter.map((i) => (l[i] === undefined ? null : l[i])));
  }
  if (!Object.keys(abas).some((n) => norm(n) === 'RESUMO DA FATURA')) {
    throw new Error('Este arquivo nao parece ser a fatura do Sem Parar (aba "RESUMO DA FATURA" nao encontrada).');
  }
  return abas;
}

function linhaPlaca(p, totalLiquido) {
  const c = p.componentes;
  const passagens = c.pedagio + c.vale_pedagio + c.estacionamento + c.estabelecimentos;
  const servicos = c.adesao + c.mensalidade + c.outros_servicos;
  const pct = totalLiquido > 0 ? ((p.liquido / totalLiquido) * 100).toFixed(1).replace('.', ',') : '0,0';
  const centro = p.encontrado
    ? esc(p.centro_custo_nome)
    : '<span class="badge-critico">Sem cadastro</span>';
  return `
    <tr>
      <td class="table-td font-medium">${esc(p.placa)}</td>
      <td class="table-td">${centro}</td>
      <td class="table-td text-right">${formatarMoeda(passagens)}</td>
      <td class="table-td text-right">${formatarMoeda(servicos)}</td>
      <td class="table-td text-right">${p.creditos ? `- ${formatarMoeda(p.creditos)}` : formatarMoeda(0)}</td>
      <td class="table-td text-right font-bold">${formatarMoeda(p.liquido)}</td>
      <td class="table-td text-right text-slate-500">${pct}%</td>
    </tr>
  `;
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Importar fatura do Sem Parar</h1>
    <p class="mb-4 text-sm text-slate-500">Carregue o relatorio da fatura (.xlsx). O sistema lanca a fatura inteira como <strong>uma conta a pagar</strong> e divide o valor entre os centros de custo das placas (cada placa fica com o liquido dela: passagens + mensalidade + servicos - creditos de vale-pedagio).</p>
    <div class="card mb-4 p-4">
      <label class="label">Arquivo da fatura (.xlsx)</label>
      <input type="file" accept=".xlsx,.xls" class="input" data-arquivo />
      <p class="mt-2 hidden text-sm text-red-600" data-erro></p>
    </div>
    <div data-resultado></div>
  `;
  const arquivoEl = container.querySelector('[data-arquivo]');
  const erroEl = container.querySelector('[data-erro]');
  const resultadoEl = container.querySelector('[data-resultado]');
  const mostrarErroArquivo = (msg) => { erroEl.textContent = msg; erroEl.classList.remove('hidden'); };

  arquivoEl.addEventListener('change', async () => {
    erroEl.classList.add('hidden');
    resultadoEl.innerHTML = '';
    const arquivo = arquivoEl.files[0];
    if (!arquivo) return;
    resultadoEl.innerHTML = '<div class="card p-4 text-sm text-slate-500">Lendo a fatura...</div>';
    try {
      const abas = await lerPlanilha(arquivo);
      const analise = await post('/admin/importacoes/sem-parar/analisar', { abas });
      await mostrarAnalise(resultadoEl, abas, analise);
    } catch (err) {
      resultadoEl.innerHTML = '';
      mostrarErroArquivo(err.message);
    }
  });
}

async function mostrarAnalise(resultadoEl, abas, analise) {
  const { fatura, placas, conferencias, avisos, sugestoes, ja_importada: jaImportada } = analise;
  const comValor = placas.filter((p) => p.liquido !== 0);
  const totalLiquido = placas.filter((p) => p.liquido > 0).reduce((t, p) => t + p.liquido, 0);
  const bloqueios = [];
  if (jaImportada) bloqueios.push('fatura ja importada');
  if (placas.some((p) => !p.encontrado && p.liquido !== 0)) bloqueios.push('placa sem cadastro');
  if (placas.some((p) => p.liquido < 0)) bloqueios.push('placa com valor negativo');
  if (conferencias.some((c) => !c.ok)) bloqueios.push('abas nao fecham com o resumo');
  const temDiferenca = analise.diferenca !== 0;
  const categorias = await get('/categorias-despesa');

  resultadoEl.innerHTML = `
    <div class="card mb-4 grid gap-3 p-4 sm:grid-cols-4">
      <div><p class="text-xs uppercase tracking-wide text-slate-500">Fatura</p><p class="font-semibold text-slate-900">${esc(fatura.numero)}</p></div>
      <div><p class="text-xs uppercase tracking-wide text-slate-500">Emissao</p><p class="font-semibold text-slate-900">${formatarDataBr(fatura.emissao) || '-'}</p></div>
      <div><p class="text-xs uppercase tracking-wide text-slate-500">Vencimento</p><p class="font-semibold text-slate-900">${formatarDataBr(fatura.vencimento) || '-'}</p></div>
      <div><p class="text-xs uppercase tracking-wide text-slate-500">Valor total da fatura</p><p class="text-lg font-bold text-brand-yellow">${formatarMoeda(fatura.total)}</p></div>
    </div>
    ${jaImportada ? `<div class="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">Esta fatura ja foi importada${jaImportada.conta_pagar_id ? ` (conta a pagar #${jaImportada.conta_pagar_id}, ${esc(jaImportada.conta_status || '')})` : ''}. Para importar de novo, exclua antes o lancamento rateado em Despesas Fixas.</div>` : ''}
    ${avisos.length ? `<div class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400"><ul class="list-disc pl-5">${avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
    <div class="card mb-4 overflow-x-auto">
      <p class="px-4 pt-3 text-sm font-semibold text-slate-900">Rateio por placa / centro de custo</p>
      <table class="min-w-full divide-y divide-slate-200">
        <thead><tr>
          <th class="table-th">Placa</th><th class="table-th">Centro de custo</th>
          <th class="table-th text-right">Passagens</th><th class="table-th text-right">Mensalidade e servicos</th>
          <th class="table-th text-right">Creditos</th><th class="table-th text-right">Valor a ratear</th><th class="table-th text-right">%</th>
        </tr></thead>
        <tbody class="divide-y divide-slate-200">${comValor.map((p) => linhaPlaca(p, totalLiquido)).join('') || '<tr><td class="table-td text-slate-400" colspan="7">Nenhuma placa com valor.</td></tr>'}</tbody>
        <tfoot><tr>
          <td class="table-td font-bold" colspan="5">Soma das placas</td>
          <td class="table-td text-right font-bold">${formatarMoeda(analise.soma_placas)}</td><td class="table-td"></td>
        </tr></tfoot>
      </table>
    </div>
    <details class="card mb-4 p-4">
      <summary class="cursor-pointer text-sm font-semibold text-slate-900">Conferencia com o resumo da fatura</summary>
      <table class="mt-3 min-w-full divide-y divide-slate-200">
        <thead><tr><th class="table-th">Item</th><th class="table-th text-right">Resumo da fatura</th><th class="table-th text-right">Soma das abas</th><th class="table-th"></th></tr></thead>
        <tbody class="divide-y divide-slate-200">${conferencias.map((c) => `
          <tr><td class="table-td">${esc(c.rotulo)}</td><td class="table-td text-right">${formatarMoeda(c.resumo)}</td><td class="table-td text-right">${formatarMoeda(c.planilha)}</td>
          <td class="table-td">${c.ok ? '<span class="badge-sucesso">Confere</span>' : '<span class="badge-critico">Diverge</span>'}</td></tr>`).join('')}</tbody>
      </table>
    </details>
    <form class="card space-y-4 p-4" data-form>
      <p class="text-sm font-semibold text-slate-900">Lancamento</p>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label">Categoria da despesa *</label>
          <select name="categoria_id" class="input" required>${categorias.map((c) => `<option value="${c.id}" ${c.id === sugestoes.categoria_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
        </div>
        <div><label class="label">Fornecedor</label><div data-fornecedor></div></div>
        <div><label class="label">Data da despesa (DRE)</label><input type="text" name="data" class="input" /></div>
        <div><label class="label">Vencimento da conta a pagar *</label><input type="text" name="data_vencimento" class="input" required /></div>
      </div>
      <label class="flex items-start gap-2 text-sm"><input type="checkbox" name="ja_paga" class="mt-0.5 h-4 w-4" /><span>Fatura <strong>ja paga</strong> (de um mes anterior): baixar sem lancar movimento de caixa, na data do vencimento. O custo continua entrando no DRE.</span></label>
      ${temDiferenca ? `<label class="flex items-start gap-2 text-sm"><input type="checkbox" name="ratear_diferenca" class="mt-0.5 h-4 w-4" /><span>Ratear a diferenca de ${formatarMoeda(analise.diferenca)} (total da fatura menos a soma das placas) proporcionalmente entre as placas.</span></label>` : ''}
      <p class="hidden text-sm text-red-600" data-erro-form></p>
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs text-slate-500">Cria 1 conta a pagar de ${formatarMoeda(fatura.total)} e ${comValor.filter((p) => p.liquido > 0).length} lancamentos de despesa (um por centro de custo).</p>
        <button type="submit" class="btn-primary" ${bloqueios.length ? 'disabled' : ''}>Importar e lancar</button>
      </div>
      ${bloqueios.length ? `<p class="text-xs text-amber-400">Importacao bloqueada: ${esc(bloqueios.join('; '))}.</p>` : ''}
    </form>
  `;

  const form = resultadoEl.querySelector('[data-form]');
  attachDataMask(form.data, sugestoes.data);
  attachDataMask(form.data_vencimento, sugestoes.data_vencimento);
  const fornecedorSelect = criarSearchableSelect({
    buscar: async (termo) => (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome })),
    placeholder: 'Pesquisar fornecedor (ex.: Sem Parar)...',
    valorInicial: sugestoes.fornecedor_id,
    labelInicial: sugestoes.fornecedor_nome || '',
    criarNovo: { label: 'Cadastrar novo fornecedor', abrir: criarNovoFornecedor },
  });
  form.querySelector('[data-fornecedor]').appendChild(fornecedorSelect.el);

  const erroForm = form.querySelector('[data-erro-form]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erroForm.classList.add('hidden');
    const vencimento = parseDataBrParaIso(form.data_vencimento.value);
    if (!vencimento) { erroForm.textContent = 'Informe o vencimento (dd/mm/aaaa).'; erroForm.classList.remove('hidden'); return; }
    if (form.data.value && !parseDataBrParaIso(form.data.value)) { erroForm.textContent = 'Data da despesa invalida (dd/mm/aaaa).'; erroForm.classList.remove('hidden'); return; }
    const ok = await confirmarAcao({
      titulo: 'Importar fatura',
      mensagem: `Lancar a fatura ${esc(fatura.numero)} de <strong>${formatarMoeda(fatura.total)}</strong> (vencimento ${formatarDataBr(vencimento)}) como uma conta a pagar, rateada entre ${comValor.filter((p) => p.liquido > 0).length} centros de custo?`,
      textoConfirmar: 'Importar',
      perigo: false,
    });
    if (!ok) return;
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      const r = await post('/admin/importacoes/sem-parar', {
        abas,
        categoria_id: Number(form.categoria_id.value),
        fornecedor_id: fornecedorSelect.getValue(),
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        data_vencimento: vencimento,
        ratear_diferenca: Boolean(form.ratear_diferenca && form.ratear_diferenca.checked),
        ja_paga: form.ja_paga.checked,
      });
      mostrarToast(`Fatura ${fatura.numero} importada: ${formatarMoeda(r.valor_total)} rateados em ${r.despesas.length} centros de custo.`);
      resultadoEl.innerHTML = `
        <div class="card space-y-3 p-4">
          <p class="font-semibold text-emerald-500">Fatura importada com sucesso.</p>
          <p class="text-sm text-slate-600">Conta a pagar #${r.conta_pagar_id} de ${formatarMoeda(r.valor_total)}, rateada entre: ${r.rateio.map((x) => `${esc(x.centro_custo_nome)} (${formatarMoeda(x.valor)})`).join(', ')}.</p>
          <div class="flex gap-2">
            <a href="#/contas-pagar" class="btn-primary btn-sm">Ver em Contas a Pagar</a>
            <a href="#/despesas-fixas" class="btn-secondary btn-sm">Ver em Despesas Fixas</a>
          </div>
        </div>
      `;
    } catch (err) {
      botao.disabled = Boolean(bloqueios.length);
      erroForm.textContent = err.message;
      erroForm.classList.remove('hidden');
    }
  });
}
