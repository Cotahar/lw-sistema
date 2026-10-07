import { get, getUsuario } from '../api.js';
import { formatarMoeda, formatarDataBr, formatarPeso, hojeIsoLocal } from '../masks.js';
import { navegar } from '../router.js';
import { esqueletoPagina } from '../components/skeleton.js';

const STATUS_LABEL = { EmAndamento: 'Em Andamento', AguardandoAcerto: 'Aguardando Acerto', Finalizada: 'Finalizada' };
const STATUS_CHIP = {
  EmAndamento: 'bg-amber-50 text-amber-700 border border-amber-200',
  AguardandoAcerto: 'bg-amber-50 text-amber-700 border border-amber-200',
  Finalizada: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

// Paleta desta tela: o resto do sistema usa slate/gray invertidos (ver
// tailwind.config.js) pro dark mode fixo do app - slate-900 vira quase
// branco (#F5F4F6). Isso e exatamente o oposto do que um relatorio
// impresso em fundo branco precisa, e e a causa raiz do relatorio "sem
// vida"/baixo contraste. Por isso esta tela usa zinc (nao remapeado) pro
// texto neutro, e emerald/red/blue/amber (tambem nao remapeados) pra dar
// cor com significado semantico - nunca slate/gray aqui.
function chip(texto, classes) {
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${classes}">${texto}</span>`;
}

function estatistica(label, valor, { destaque = false, corValor = 'text-zinc-900', sub = '' } = {}) {
  return `
    <div class="rounded-lg border border-zinc-200 ${destaque ? 'bg-blue-50 border-blue-200' : 'bg-zinc-50'} px-3 py-2">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">${label}</p>
      <p class="text-base font-bold ${destaque ? 'text-blue-700' : corValor}">${valor}</p>
      ${sub ? `<p class="text-[11px] text-zinc-400">${sub}</p>` : ''}
    </div>
  `;
}

// Descricoes de reembolso/desconto sao texto livre digitado pelo usuario.
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function linha(label, valor, destaque = false) {
  return `<div class="flex items-center justify-between py-1 ${destaque ? 'text-base font-bold text-zinc-900' : 'text-sm text-zinc-600'}"><span>${label}</span><span class="${destaque ? '' : 'font-medium text-zinc-900'}">${valor}</span></div>`;
}

function tabela({ colunas, linhasHtml, corHeader = 'bg-zinc-100 text-zinc-600', rodape = '' }) {
  return `
    <table class="mb-4 w-full border-collapse overflow-hidden rounded-lg text-sm">
      <thead>
        <tr class="${corHeader} text-left text-[11px] uppercase tracking-wide">
          ${colunas.map((c) => `<th class="px-2 py-1.5 ${c.alinhamento === 'right' ? 'text-right' : ''}">${c.label}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${linhasHtml}
        ${rodape}
      </tbody>
    </table>
  `;
}

function linhaTabela(celulas, { zebra = false } = {}) {
  return `<tr class="border-b border-zinc-100 ${zebra ? 'bg-zinc-50/60' : ''}">${celulas.map((c) => `<td class="px-2 py-1.5 ${c.alinhamento === 'right' ? 'text-right' : ''} ${c.classe || 'text-zinc-700'}">${c.valor}</td>`).join('')}</tr>`;
}

function semDados(texto, colunas) {
  return `<tr><td colspan="${colunas}" class="px-2 py-3 text-center text-sm text-zinc-400">${texto}</td></tr>`;
}

export async function renderRelatorio(root, params, query) {
  if (!localStorage.getItem('frotista_token')) {
    navegar('/login');
    return;
  }
  const viagemId = params.viagemId;
  const tipo = query.tipo === 'detalhado' ? 'detalhado' : 'resumido';
  root.innerHTML = `<div class="p-8">${esqueletoPagina()}</div>`;

  const [viagem, motoristas, categorias, fornecedores, todosAcertos] = await Promise.all([
    get(`/viagens/${viagemId}`),
    get('/motoristas'),
    get('/categorias-despesa'),
    get('/fornecedores'),
    get('/acertos'),
  ]);
  const motorista = motoristas.find((m) => m.id === viagem.motorista_id);
  const conjunto = await get(`/conjuntos/${viagem.conjunto_id}`);
  const [despesas, adiantamentos, detalhamento] = await Promise.all([
    get(`/viagens/${viagemId}/despesas`),
    get(`/viagens/${viagemId}/adiantamentos`),
    get(`/acertos/viagem/${viagemId}/detalhamento`),
  ]);
  const acerto = todosAcertos.find((a) => a.viagem_id === Number(viagemId));
  const nomeCategoria = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
  const nomeFornecedor = Object.fromEntries(fornecedores.map((f) => [f.id, f.nome]));

  const fretes = viagem.fretes || [];
  const freteBrutoTotal = fretes.reduce((t, f) => t + f.frete_bruto, 0);
  const pesoTotal = fretes.reduce((t, f) => t + (f.peso_carga_kg || 0), 0);
  const totalDespesasLancadas = despesas.reduce((t, d) => t + d.valor, 0);
  const totalAdiantamentos = adiantamentos.reduce((t, a) => t + a.valor, 0);
  const kmRodado = viagem.km_final ? viagem.km_final - viagem.km_inicial : null;
  const usuario = getUsuario();

  // Duracao/medias diarias: so fazem sentido com data_fim definida (viagem
  // finalizada) - Math.max(1, ...) pra nao dividir por zero numa viagem de
  // 1 dia so (data_fim === data_inicio), mesmo criterio ja usado no card de
  // "dias em viagem" do dashboard.
  const duracaoDias = viagem.data_fim
    ? Math.max(1, Math.round((new Date(`${viagem.data_fim}T00:00:00Z`) - new Date(`${viagem.data_inicio}T00:00:00Z`)) / 86400000))
    : null;
  const faturamentoPorDia = duracaoDias ? Math.round(freteBrutoTotal / duracaoDias) : null;
  const kmPorDia = duracaoDias && kmRodado !== null ? Math.round(kmRodado / duracaoDias) : null;
  // Prioriza o valor congelado no fechamento do acerto (foi o que definiu a
  // faixa de comissao aplicada); sem acerto fechado, cai pro valor "ao vivo"
  // que a tela da viagem ja calcula (ver bug de media cross-viagem corrigido
  // em mediaConsumoHelper.js).
  const mediaConsumo = acerto?.media_consumo_km_l ?? viagem.media_consumo_km_l ?? null;

  const categoriaAbastecimentoId = categorias.find((c) => c.nome.trim().toLowerCase() === 'abastecimento')?.id ?? null;
  const categoriaArlaId = categorias.find((c) => c.nome.trim().toLowerCase() === 'arla')?.id ?? null;
  const despesasAbastecimento = despesas.filter((d) => d.categoria_id === categoriaAbastecimentoId);
  const despesasArla = despesas.filter((d) => d.categoria_id === categoriaArlaId);
  const despesasOutras = despesas.filter((d) => d.categoria_id !== categoriaAbastecimentoId && d.categoria_id !== categoriaArlaId);
  // Reembolsos e descontos vem do detalhamento do acerto: lancamentos
  // manuais (ex.: caixinha, reaperto de rodas) + despesas pagas pelo
  // motorista (so nos descontos). Num acerto fechado a lista e reconciliada
  // com os totais gravados no fechamento.
  const totalReembolsos = detalhamento.totalReembolsos;
  const totalDescontosMotorista = detalhamento.totalDescontos;
  const valorPedagio = detalhamento.valorPedagio;
  // Pedagio: informativo no acerto (nao altera o saldo do motorista), mas e custo
  // da viagem - entra nas despesas, em Receitas - Despesas e no % de sobra.
  // A comissao do motorista (acerto fechado) tambem entra no somatorio de despesas.
  const valorComissaoDespesa = acerto ? acerto.valor_comissao : 0;
  const totalDespesas = totalDespesasLancadas + valorPedagio + valorComissaoDespesa;
  const receitasMenosDespesas = freteBrutoTotal - totalDespesas;
  const percentualSobra = freteBrutoTotal ? (receitasMenosDespesas / freteBrutoTotal) * 100 : null;

  const custoPorKm = kmRodado ? Math.round(totalDespesas / kmRodado) : null;
  const ticketMedioFrete = fretes.length ? Math.round(freteBrutoTotal / fretes.length) : null;
  const percentualComissaoSobreFaturamento = acerto && freteBrutoTotal ? (acerto.valor_comissao / freteBrutoTotal) * 100 : null;
  const percentualDescontosSobreFaturamento = freteBrutoTotal ? (totalDescontosMotorista / freteBrutoTotal) * 100 : null;

  function tabelaFretes() {
    const linhas = fretes.map((f, i) => linhaTabela([
      { valor: f.data_carregamento ? formatarDataBr(f.data_carregamento) : '-' },
      { valor: f.transportadora_id ? (nomeFornecedor[f.transportadora_id] || '-') : '-' },
      { valor: `${f.origem_cidade}/${f.origem_uf} &rarr; ${f.destino_cidade}/${f.destino_uf}` },
      { valor: f.peso_carga_kg ? formatarPeso(f.peso_carga_kg) : '-', alinhamento: 'right' },
      { valor: formatarMoeda(f.frete_bruto), alinhamento: 'right', classe: 'font-medium text-zinc-900' },
    ], { zebra: i % 2 === 1 })).join('') || semDados('Nenhum frete cadastrado nesta viagem.', 5);
    const rodape = fretes.length ? `
      <tr class="bg-emerald-50 font-bold text-emerald-800">
        <td colspan="3" class="px-2 py-1.5 text-right">Total</td>
        <td class="px-2 py-1.5 text-right">${pesoTotal ? formatarPeso(pesoTotal) : '-'}</td>
        <td class="px-2 py-1.5 text-right">${formatarMoeda(freteBrutoTotal)}</td>
      </tr>
    ` : '';
    return tabela({
      colunas: [
        { label: 'Data' }, { label: 'Transportadora' }, { label: 'Rota' },
        { label: 'Peso', alinhamento: 'right' }, { label: 'Frete Bruto', alinhamento: 'right' },
      ],
      linhasHtml: linhas,
      rodape,
    });
  }

  function tabelaCombustivel(lista, { comKm }) {
    const colunas = [
      { label: 'Data' }, { label: 'Posto' },
      ...(comKm ? [{ label: 'KM', alinhamento: 'right' }] : []),
      { label: 'Litros', alinhamento: 'right' }, { label: 'R$/Litro', alinhamento: 'right' },
      ...(comKm ? [{ label: 'Tanque' }] : []),
      { label: 'Valor', alinhamento: 'right' },
    ];
    const linhas = lista.map((d, i) => linhaTabela([
      { valor: formatarDataBr(d.data) },
      { valor: d.posto_fornecedor_id ? (nomeFornecedor[d.posto_fornecedor_id] || '-') : '-' },
      ...(comKm ? [{ valor: d.km_abastecimento !== null ? d.km_abastecimento.toLocaleString('pt-BR') : '-', alinhamento: 'right' }] : []),
      { valor: d.litragem !== null ? `${Number(d.litragem).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} L` : '-', alinhamento: 'right' },
      { valor: d.preco_litro !== null ? formatarMoeda(d.preco_litro) : '-', alinhamento: 'right' },
      ...(comKm ? [{ valor: d.tanque_completo ? chip('Cheio', 'bg-emerald-50 text-emerald-700 border border-emerald-200') : chip('Parcial', 'bg-zinc-100 text-zinc-500 border border-zinc-200') }] : []),
      { valor: formatarMoeda(d.valor), alinhamento: 'right', classe: 'font-medium text-zinc-900' },
    ], { zebra: i % 2 === 1 })).join('') || semDados('Nenhum lancamento.', colunas.length);
    const totalValor = lista.reduce((t, d) => t + d.valor, 0);
    const totalLitros = lista.reduce((t, d) => t + (d.litragem || 0), 0);
    // Colspan dinamico (a tabela de diesel tem 2 colunas a mais que a de
    // Arla - KM e Tanque): um rotulo so, com o total de litros embutido no
    // texto, evita ter que acertar em qual coluna intermediaria cada
    // subtotal cairia (isso desalinhava "litros" embaixo da coluna errada
    // quando KM/Tanque estavam presentes).
    const rodape = lista.length ? `
      <tr class="bg-zinc-100 font-bold text-zinc-800">
        <td colspan="${colunas.length - 1}" class="px-2 py-1.5 text-right">Total${totalLitros ? ` (${totalLitros.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} L)` : ''}</td>
        <td class="px-2 py-1.5 text-right">${formatarMoeda(totalValor)}</td>
      </tr>
    ` : '';
    return tabela({ colunas, linhasHtml: linhas, rodape });
  }

  function tabelaOutrasDespesas() {
    const porCategoria = new Map();
    for (const d of despesasOutras) {
      if (!porCategoria.has(d.categoria_id)) porCategoria.set(d.categoria_id, []);
      porCategoria.get(d.categoria_id).push(d);
    }
    const categoriasOrdenadas = [...porCategoria.keys()].sort((a, b) => (nomeCategoria[a] || '').localeCompare(nomeCategoria[b] || ''));
    if (!categoriasOrdenadas.length) return '<p class="mb-4 text-sm text-zinc-400">Nenhuma despesa adicional.</p>';
    return categoriasOrdenadas.map((catId) => {
      const itens = porCategoria.get(catId);
      const subtotal = itens.reduce((t, d) => t + d.valor, 0);
      const linhas = itens.map((d, i) => linhaTabela([
        { valor: formatarDataBr(d.data) },
        { valor: d.descricao || '-' },
        { valor: d.posto_fornecedor_id ? (nomeFornecedor[d.posto_fornecedor_id] || '-') : '-' },
        { valor: d.pago_por },
        { valor: formatarMoeda(d.valor), alinhamento: 'right', classe: 'font-medium text-zinc-900' },
      ], { zebra: i % 2 === 1 })).join('');
      const rodape = `
        <tr class="bg-zinc-100 font-bold text-zinc-800">
          <td colspan="4" class="px-2 py-1.5 text-right">Subtotal ${nomeCategoria[catId] || ''}</td>
          <td class="px-2 py-1.5 text-right">${formatarMoeda(subtotal)}</td>
        </tr>
      `;
      return `
        <h3 class="mb-1 mt-4 text-sm font-bold uppercase tracking-wide text-zinc-700">${nomeCategoria[catId] || '-'}</h3>
        ${tabela({
          colunas: [{ label: 'Data' }, { label: 'Descricao' }, { label: 'Fornecedor' }, { label: 'Pago por' }, { label: 'Valor', alinhamento: 'right' }],
          linhasHtml: linhas,
          rodape,
        })}
      `;
    }).join('');
  }

  // Reembolsos/descontos em lista. `origem` 'Despesa' = despesa paga pelo
  // motorista (mostra o codigo); 'SemDetalhe' = acerto fechado antes da
  // listagem existir (so o total ficou gravado).
  function tabelaItens(linhasItens, { vazio, rotuloTotal, total, classeValor, classeRodape }) {
    const linhas = linhasItens.map((l, i) => linhaTabela([
      { valor: `${esc(l.descricao)}${l.origem === 'Despesa' ? ` <span class="text-zinc-400">(despesa #${l.despesa_id})</span>` : ''}` },
      { valor: formatarMoeda(l.valor), alinhamento: 'right', classe: `font-medium ${classeValor}` },
    ], { zebra: i % 2 === 1 })).join('') || semDados(vazio, 2);
    const rodape = linhasItens.length ? `
      <tr class="${classeRodape} font-bold">
        <td class="px-2 py-1.5 text-right">${rotuloTotal}</td>
        <td class="px-2 py-1.5 text-right">${formatarMoeda(total)}</td>
      </tr>
    ` : '';
    return tabela({ colunas: [{ label: 'Descricao' }, { label: 'Valor', alinhamento: 'right' }], linhasHtml: linhas, rodape });
  }

  function tabelaReembolsos() {
    return tabelaItens(detalhamento.reembolsos, { vazio: 'Nenhum reembolso.', rotuloTotal: 'Total de reembolsos', total: totalReembolsos, classeValor: 'text-emerald-700', classeRodape: 'bg-emerald-50 text-emerald-800' });
  }

  function tabelaDescontosMotorista() {
    return tabelaItens(detalhamento.descontos, { vazio: 'Nenhum desconto.', rotuloTotal: 'Total de descontos', total: totalDescontosMotorista, classeValor: 'text-red-700', classeRodape: 'bg-red-50 text-red-800' });
  }

  // Linhas recuadas sob o total (reembolsos/descontos) nos blocos de
  // creditos/debitos do resumo financeiro - presentes nos dois tipos de
  // relatorio.
  function linhasDetalhe(linhasItens) {
    return linhasItens.map((l) => `<div class="flex items-center justify-between py-0.5 pl-3 text-xs"><span>&bull; ${esc(l.descricao)}${l.origem === 'Despesa' ? ` (despesa #${l.despesa_id})` : ''}</span><span>${formatarMoeda(l.valor)}</span></div>`).join('');
  }

  function tabelaAdiantamentos() {
    const linhas = adiantamentos.map((a, i) => linhaTabela([
      { valor: formatarDataBr(a.data) },
      { valor: `${a.descricao || '-'}${a.conta_bancaria_id ? '' : ' <span class="text-zinc-400">(sem caixa)</span>'}` },
      { valor: formatarMoeda(a.valor), alinhamento: 'right', classe: 'font-medium text-red-700' },
    ], { zebra: i % 2 === 1 })).join('') || semDados('Nenhum adiantamento.', 3);
    const rodape = adiantamentos.length ? `
      <tr class="bg-red-50 font-bold text-red-800">
        <td colspan="2" class="px-2 py-1.5 text-right">Total de adiantamentos</td>
        <td class="px-2 py-1.5 text-right">${formatarMoeda(totalAdiantamentos)}</td>
      </tr>
    ` : '';
    return tabela({
      colunas: [{ label: 'Data' }, { label: 'Descricao' }, { label: 'Valor', alinhamento: 'right' }],
      linhasHtml: linhas,
      rodape,
    });
  }

  const saldoFinalValor = acerto ? acerto.saldo_final : null;
  const saldoPositivo = saldoFinalValor !== null ? saldoFinalValor >= 0 : true;
  const totalCreditos = acerto ? acerto.valor_comissao + acerto.valor_reembolsos : null;
  const classeResultado = receitasMenosDespesas >= 0 ? 'text-emerald-700' : 'text-red-700';
  const totalDebitos = acerto ? acerto.valor_adiantamentos + acerto.valor_descontos : null;

  root.innerHTML = `
    <style>
      /* Forca o navegador a manter cores/fundos na impressao (por padrao a
         maioria descarta bg-color pra economizar tinta) - sem isto os
         acentos coloridos desta tela somem no "Imprimir/Salvar PDF". */
      @media print {
        .relatorio-acerto, .relatorio-acerto * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
      }
    </style>
    <div class="relatorio-acerto mx-auto max-w-4xl p-6 print:max-w-none print:p-0">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" class="btn-secondary btn-sm" data-voltar>&larr; Voltar para o acerto</button>
        <div class="flex flex-wrap gap-2">
          <a href="#/acertos/${viagemId}/relatorio?tipo=resumido" class="btn-sm ${tipo === 'resumido' ? 'btn-primary' : 'btn-secondary'}">Resumido</a>
          <a href="#/acertos/${viagemId}/relatorio?tipo=detalhado" class="btn-sm ${tipo === 'detalhado' ? 'btn-primary' : 'btn-secondary'}">Detalhado</a>
          <button type="button" class="btn-primary btn-sm" data-imprimir>Imprimir / Salvar PDF</button>
        </div>
      </div>

      <div class="rounded-xl border border-zinc-200 bg-white p-8 text-zinc-900 print:border-0 print:p-0">
        <div class="mb-5 flex items-start justify-between border-b-4 border-brand-yellow pb-4">
          <div>
            <h1 class="text-2xl font-extrabold text-zinc-900">Relatorio de Acerto <span class="text-zinc-400">&middot; Viagem #${viagem.id}</span></h1>
            <p class="mt-1 text-sm font-medium text-zinc-500">${tipo === 'detalhado' ? 'Detalhado' : 'Resumido'} &middot; Gerado em ${formatarDataBr(hojeIsoLocal())}${usuario ? ` por ${usuario.nome}` : ''}</p>
          </div>
          ${chip(STATUS_LABEL[viagem.status], STATUS_CHIP[viagem.status] || 'bg-zinc-100 text-zinc-500 border border-zinc-200')}
        </div>

        <div class="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <p><span class="font-semibold text-zinc-500">Motorista:</span> <span class="text-zinc-900">${motorista ? motorista.nome : '-'}</span></p>
          <p><span class="font-semibold text-zinc-500">Composicao:</span> <span class="text-zinc-900">${conjunto.itens.map((i) => i.placa).join(' + ')}</span></p>
          <p><span class="font-semibold text-zinc-500">Periodo:</span> <span class="text-zinc-900">${formatarDataBr(viagem.data_inicio)}${viagem.data_fim ? ` a ${formatarDataBr(viagem.data_fim)}` : ' (em andamento)'}</span></p>
          <p><span class="font-semibold text-zinc-500">KM rodado:</span> <span class="text-zinc-900">${kmRodado !== null ? `${kmRodado.toLocaleString('pt-BR')} km` : '-'}</span></p>
        </div>

        <div class="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          ${estatistica('Duracao', duracaoDias !== null ? `${duracaoDias} dia${duracaoDias > 1 ? 's' : ''}` : '-')}
          ${estatistica('Media KM/dia', kmPorDia !== null ? `${kmPorDia.toLocaleString('pt-BR')} km` : '-')}
          ${estatistica('Faturamento/dia', faturamentoPorDia !== null ? formatarMoeda(faturamentoPorDia) : '-', { corValor: 'text-emerald-700' })}
          ${estatistica('Media consumo', mediaConsumo ? `${mediaConsumo.toFixed(2)} km/l` : '-', { destaque: true })}
          ${estatistica('Faturamento total', formatarMoeda(freteBrutoTotal), { corValor: 'text-emerald-700' })}
          ${estatistica('Despesas totais', formatarMoeda(totalDespesas), { corValor: 'text-red-700' })}
          ${estatistica('Receitas - Despesas', formatarMoeda(receitasMenosDespesas), { corValor: classeResultado, sub: percentualSobra !== null ? `${percentualSobra.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de sobra` : '' })}
          ${estatistica('Pedagio (informativo)', valorPedagio > 0 ? formatarMoeda(valorPedagio) : '-', { sub: valorPedagio > 0 ? 'Nao altera o saldo' : '' })}
        </div>

        ${tipo === 'detalhado' ? `
          <h2 class="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-zinc-900"><span class="h-4 w-1.5 rounded-full bg-emerald-500"></span>Fretes</h2>
          ${tabelaFretes()}

          <h2 class="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-zinc-900"><span class="h-4 w-1.5 rounded-full bg-blue-500"></span>Abastecimento (Diesel)</h2>
          ${tabelaCombustivel(despesasAbastecimento, { comKm: true })}

          ${despesasArla.length ? `
            <h2 class="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-zinc-900"><span class="h-4 w-1.5 rounded-full bg-cyan-500"></span>Arla</h2>
            ${tabelaCombustivel(despesasArla, { comKm: false })}
          ` : ''}

          <h2 class="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-zinc-900"><span class="h-4 w-1.5 rounded-full bg-zinc-400"></span>Demais despesas</h2>
          ${tabelaOutrasDespesas()}
          <div class="mb-4 flex items-center justify-between border-t-2 border-zinc-300 pt-2 text-sm font-bold text-zinc-900">
            <span>${valorPedagio > 0 || valorComissaoDespesa > 0 ? 'Despesas lancadas' : 'Total geral de despesas'}</span><span>${formatarMoeda(totalDespesasLancadas)}</span>
          </div>
          ${valorPedagio > 0 || valorComissaoDespesa > 0 ? `
            ${valorPedagio > 0 ? `<div class="flex items-center justify-between py-1 text-sm text-zinc-700"><span>Pedagio da viagem (informado no acerto; nao altera o saldo do motorista)</span><span>${formatarMoeda(valorPedagio)}</span></div>` : ''}
            ${valorComissaoDespesa > 0 ? `<div class="flex items-center justify-between py-1 text-sm text-zinc-700"><span>Comissao do motorista</span><span>${formatarMoeda(valorComissaoDespesa)}</span></div>` : ''}
            <div class="mb-4 flex items-center justify-between border-t-2 border-zinc-300 pt-2 text-sm font-bold text-zinc-900"><span>Total geral de despesas</span><span>${formatarMoeda(totalDespesas)}</span></div>
          ` : ''}

          <h2 class="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-zinc-900"><span class="h-4 w-1.5 rounded-full bg-emerald-500"></span>Reembolsos ao motorista</h2>
          ${tabelaReembolsos()}

          <h2 class="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-zinc-900"><span class="h-4 w-1.5 rounded-full bg-red-500"></span>Descontos do motorista (despesas pagas por ele e lancamentos)</h2>
          ${tabelaDescontosMotorista()}

          <h2 class="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-zinc-900"><span class="h-4 w-1.5 rounded-full bg-red-500"></span>Adiantamentos ao motorista</h2>
          ${tabelaAdiantamentos()}

          <h2 class="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-zinc-900"><span class="h-4 w-1.5 rounded-full bg-blue-500"></span>Indicadores</h2>
          <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            ${estatistica('Valor medio por frete', ticketMedioFrete !== null ? formatarMoeda(ticketMedioFrete) : '-')}
            ${estatistica('Custo por KM (despesas)', custoPorKm !== null ? formatarMoeda(custoPorKm) : '-')}
            ${estatistica('% de sobra (receitas - despesas)', percentualSobra !== null ? `${percentualSobra.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-', { corValor: classeResultado, sub: 'do faturamento' })}
            ${percentualComissaoSobreFaturamento !== null ? estatistica('Comissao / Faturamento', `${percentualComissaoSobreFaturamento.toFixed(1)}%`, { corValor: 'text-emerald-700' }) : ''}
            ${percentualDescontosSobreFaturamento !== null ? estatistica('Descontos motorista / Faturamento', `${percentualDescontosSobreFaturamento.toFixed(1)}%`, { corValor: 'text-red-700' }) : ''}
          </div>
        ` : ''}

        <h2 class="mb-2 mt-6 text-base font-bold text-zinc-900">Resumo financeiro (romaneio ao motorista)</h2>
        <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          ${linha('Receitas (frete bruto total)', formatarMoeda(freteBrutoTotal))}
          ${valorPedagio > 0 || valorComissaoDespesa > 0 ? linha('Despesas lancadas', formatarMoeda(totalDespesasLancadas)) : ''}
          ${valorPedagio > 0 ? linha('Pedagio da viagem (nao altera o saldo do motorista)', formatarMoeda(valorPedagio)) : ''}
          ${valorComissaoDespesa > 0 ? linha('Comissao do motorista', formatarMoeda(valorComissaoDespesa)) : ''}
          ${linha('Despesas da viagem', formatarMoeda(totalDespesas))}
          <div class="flex items-center justify-between border-t border-zinc-200 py-1 text-base font-bold text-zinc-900"><span>Receitas - Despesas</span><span class="${classeResultado}">${formatarMoeda(receitasMenosDespesas)}</span></div>
          ${linha('% de sobra (do faturamento)', percentualSobra !== null ? `<span class="${classeResultado}">${percentualSobra.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>` : '-')}
          ${acerto && acerto.valor_imposto > 0 ? linha(`Imposto (${acerto.percentual_imposto_aplicado}%)`, `- ${formatarMoeda(acerto.valor_imposto)}`) : ''}
          ${acerto && acerto.valor_imposto > 0 ? linha('Base de calculo da comissao (bruto - imposto)', formatarMoeda(freteBrutoTotal - acerto.valor_imposto)) : ''}
        </div>

        ${acerto ? `
          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <h3 class="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-700">Creditos ao motorista</h3>
              <div class="space-y-0.5 text-sm text-emerald-900">
                ${linha(`Comissao (${acerto.percentual_comissao_aplicado}%)`, formatarMoeda(acerto.valor_comissao))}
                ${acerto.valor_reembolsos > 0 ? linha('Reembolsos', formatarMoeda(acerto.valor_reembolsos)) : ''}
                ${acerto.valor_reembolsos > 0 ? linhasDetalhe(detalhamento.reembolsos) : ''}
                ${acerto.valor_reembolsos === 0 && acerto.valor_comissao === 0 ? '<p class="text-sm text-emerald-700/60">Nenhum.</p>' : ''}
              </div>
              <div class="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2 text-sm font-bold text-emerald-800">
                <span>Total creditos</span><span>${formatarMoeda(totalCreditos)}</span>
              </div>
            </div>
            <div class="rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 class="mb-2 text-xs font-bold uppercase tracking-wide text-red-700">Debitos do motorista</h3>
              <div class="space-y-0.5 text-sm text-red-900">
                ${acerto.valor_adiantamentos > 0 ? linha('Adiantamentos tomados na viagem', formatarMoeda(acerto.valor_adiantamentos)) : ''}
                ${acerto.valor_descontos > 0 ? linha('Descontos (multas/avarias/despesas)', formatarMoeda(acerto.valor_descontos)) : ''}
                ${acerto.valor_descontos > 0 ? linhasDetalhe(detalhamento.descontos) : ''}
                ${totalDebitos === 0 ? '<p class="text-sm text-red-700/60">Nenhum.</p>' : ''}
              </div>
              <div class="mt-2 flex items-center justify-between border-t border-red-200 pt-2 text-sm font-bold text-red-800">
                <span>Total debitos</span><span>${formatarMoeda(totalDebitos)}</span>
              </div>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-600">
            <span>Saldo conta corrente anterior</span><span class="font-medium text-zinc-900">${formatarMoeda(acerto.saldo_conta_corrente_anterior)}</span>
          </div>
          <div class="mt-3 flex items-center justify-between rounded-lg border-2 ${saldoPositivo ? 'border-emerald-600' : 'border-red-600'} bg-white px-4 py-3">
            <span class="text-sm font-bold uppercase tracking-wide text-zinc-700">Saldo final ${saldoPositivo ? '(a pagar ao motorista)' : '(fica em conta corrente)'}</span>
            <span class="text-xl font-extrabold ${saldoPositivo ? 'text-emerald-700' : 'text-red-700'}">${formatarMoeda(Math.abs(acerto.saldo_final))}</span>
          </div>
          ${acerto.observacoes_ajustes ? `<p class="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800"><strong>Obs.:</strong> ${esc(acerto.observacoes_ajustes)}</p>` : ''}
        ` : `
          <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            ${linha('Reembolsos ao motorista', formatarMoeda(totalReembolsos))}
            ${linha('Adiantamentos tomados', formatarMoeda(totalAdiantamentos))}
            ${linha('Descontos ao motorista', formatarMoeda(totalDescontosMotorista))}
            <p class="mt-2 font-medium">Acerto ainda nao fechado - valores sujeitos a alteracao.</p>
          </div>
        `}
      </div>
    </div>
  `;

  root.querySelector('[data-voltar]').addEventListener('click', () => navegar(`/acertos/${viagemId}`));
  root.querySelector('[data-imprimir]').addEventListener('click', () => window.print());
}
