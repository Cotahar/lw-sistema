import { get, post, put, del, podeGerenciar, ehAdmin } from '../api.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, setMoedaValue, formatarDataBr, attachUppercaseInput } from '../masks.js';
import { navegar } from '../router.js';
import { criarOcorrencias } from '../components/ocorrencias.js';
import { esqueletoPagina } from '../components/skeleton.js';
import { criarTimelineAuditoria } from '../components/auditoriaTimeline.js';
import {
  abrirNovoFrete, abrirEditarFrete, abrirNovaDespesa, abrirEditarDespesa, abrirValidarDespesa,
  abrirNovoAdiantamento, abrirEditarAdiantamento, removerAdiantamento,
} from './viagemDetalhe.js';

const TIPOS_TRATORA = ['Cavalo', 'Truck', 'Toco'];

// Descricoes de reembolso/desconto sao texto livre digitado pelo usuario.
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function linha(label, valor, destaque = false, chave = null) {
  return `<div class="flex items-center justify-between py-1.5 ${destaque ? 'text-base font-semibold text-slate-900' : 'text-sm text-slate-600'}"${chave ? ` data-linha="${chave}"` : ''}><span>${label}</span><span>${valor}</span></div>`;
}

// Linha de item (reembolso/desconto individual) - recuada e mais discreta que
// o total da categoria acima dela.
function linhaItem(label, valor) {
  return `<div class="flex items-center justify-between py-0.5 pl-3 text-xs text-slate-500"><span>&bull; ${label}</span><span>${valor}</span></div>`;
}

// Resultado da viagem (Receitas - Despesas), com cor pelo sinal.
function valorResultado(valor) {
  return `<span class="${valor >= 0 ? 'text-emerald-500' : 'text-red-500'}">${formatarMoeda(valor)}</span>`;
}

function chaveRascunho(viagemId) {
  return `frottex-rascunho-acerto-${viagemId}`;
}

function lerRascunho(viagemId) {
  try {
    const bruto = localStorage.getItem(chaveRascunho(viagemId));
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function salvarRascunho(viagemId, dados) {
  try {
    localStorage.setItem(chaveRascunho(viagemId), JSON.stringify({ ...dados, salvoEm: Date.now() }));
  } catch {
    // localStorage indisponivel (modo privado, quota cheia etc.) - o
    // rascunho e uma conveniencia, nao pode quebrar o formulario por isso.
  }
}

function limparRascunho(viagemId) {
  try { localStorage.removeItem(chaveRascunho(viagemId)); } catch { /* idem acima */ }
}

// Tabela das secoes editaveis (mesmo visual das tabelas da tela da viagem).
// `linhas`: array de arrays de HTML de celula; a ultima celula costuma ser
// as acoes. `rodape`: HTML opcional de uma <tr> de total.
function tabelaSecao({ colunas, linhas, vazio, rodape = '' }) {
  return `
    <div class="card overflow-x-auto border-gray-300 p-0">
      <table class="w-full min-w-max border-collapse">
        <thead class="bg-brand-black"><tr>${colunas.map((c) => `<th class="table-th ${c.direita ? 'text-right' : ''}">${c.titulo}</th>`).join('')}</tr></thead>
        <tbody>
          ${linhas.map((cel) => `<tr class="border-b border-slate-100">${cel.map((c, i) => `<td class="table-td ${colunas[i] && colunas[i].direita ? 'text-right' : ''}">${c}</td>`).join('')}</tr>`).join('')
            || `<tr><td colspan="${colunas.length}" class="table-td py-6 text-center text-slate-400">${vazio}</td></tr>`}
          ${linhas.length ? rodape : ''}
        </tbody>
      </table>
    </div>
  `;
}

function linhaTotal(colspan, rotulo, valor) {
  return `<tr class="bg-slate-50 font-semibold"><td colspan="${colspan}" class="table-td text-right">${rotulo}</td><td class="table-td text-right">${valor}</td><td class="table-td"></td></tr>`;
}

function botoesAcao(acoes, id) {
  return acoes.map((a) => `<button type="button" class="mr-3 text-xs ${a.perigo ? 'text-red-600' : 'text-gray-900'} hover:underline" data-acao="${a.acao}" data-id="${id}">${a.rotulo}</button>`).join('');
}

// Modal de reembolso/desconto ("caixinha: 50,00", "avaria na lona: 20,00").
function abrirModalItem({ viagemId, tipo, item = null, aoSalvar }) {
  const rotulo = tipo === 'Reembolso' ? 'reembolso' : 'desconto';
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Descricao *</label><input type="text" name="descricao" class="input" required placeholder="${tipo === 'Reembolso' ? 'Ex.: caixinha, reaperto de rodas' : 'Ex.: avaria na lona, multa'}" /></div>
    <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${item ? 'Salvar alteracoes' : `Adicionar ${rotulo}`}</button></div>
  `;
  form.descricao.value = item ? item.descricao : '';
  attachUppercaseInput(form.descricao);
  attachMoedaMaskReais(form.valor, item ? item.valor : 0);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const valor = getMoedaValue(form.valor);
    if (!form.descricao.value.trim()) { erro.textContent = 'Informe a descricao.'; erro.classList.remove('hidden'); return; }
    if (valor <= 0) { erro.textContent = 'Informe um valor maior que zero.'; erro.classList.remove('hidden'); return; }
    try {
      if (item) await put(`/acertos/itens/${item.id}`, { descricao: form.descricao.value, valor });
      else await post(`/acertos/viagem/${viagemId}/itens`, { tipo, descricao: form.descricao.value, valor });
      fecharModal();
      mostrarToast(item ? 'Item atualizado.' : `${tipo === 'Reembolso' ? 'Reembolso' : 'Desconto'} adicionado.`);
      aoSalvar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: item ? `Editar ${rotulo}` : `Novo ${rotulo} ao motorista`, conteudo: form, largura: 'max-w-md' });
}

async function renderPreview(container, viagem, motorista, gerenciar) {
  let debounceId = null;

  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Acerto - Viagem #${viagem.id}</h1>
    <p class="mb-4 text-sm text-slate-500">${motorista.nome} · ${formatarDataBr(viagem.data_inicio)} a ${formatarDataBr(viagem.data_fim)} · ${(viagem.km_final - viagem.km_inicial).toLocaleString('pt-BR')} km</p>
    <div class="mb-4 hidden rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-400" data-aviso-pendentes></div>
    <div class="mb-4 hidden rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-400" data-aviso-comissao></div>
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div class="card p-4">
        <h2 class="mb-3 font-semibold text-slate-900">Dados calculados</h2>
        <div data-resumo></div>
      </div>
      <div class="card p-4">
        <h2 class="mb-3 font-semibold text-slate-900">Ajustes (fechamento livre)</h2>
        <form class="space-y-4" data-form ${gerenciar ? '' : 'inert'}>
          <div><label class="label">% Comissao aplicado</label><input type="number" step="0.01" name="percentual" class="input" /></div>
          <div>
            <label class="label">Pedagio da viagem (so informativo)</label>
            <input type="text" name="pedagio" class="input" />
            <p class="mt-1 text-xs text-slate-400">Fica salvo so como informacao nos relatorios - nao gera lancamento nem altera o saldo.</p>
          </div>
          <div><label class="label">Observacoes do ajuste</label><textarea name="observacoes" class="input" rows="2"></textarea></div>
        </form>
        <p class="mt-3 text-xs text-slate-400">Reembolsos, descontos, fretes, despesas e adiantamentos sao lancados nas secoes abaixo.</p>
        ${gerenciar ? '<button type="button" class="btn-primary mt-4 w-full" data-fechar>Fechar Acerto</button>' : ''}
        <p class="hidden text-sm text-red-600" data-erro></p>
      </div>
    </div>
    <div class="mt-6 space-y-6" data-secoes></div>
    <div class="card mt-6 p-4" data-ocorrencias></div>
  `;
  container.querySelector('[data-ocorrencias]').appendChild(
    criarOcorrencias({ entidadeTipo: 'AcertoViagem', entidadeId: viagem.id, podeGerenciar: gerenciar }).el,
  );

  const resumoEl = container.querySelector('[data-resumo]');
  const secoesEl = container.querySelector('[data-secoes]');
  const form = container.querySelector('[data-form]');
  const erroEl = container.querySelector('[data-erro]');
  const avisoPendentesEl = container.querySelector('[data-aviso-pendentes]');
  const avisoComissaoEl = container.querySelector('[data-aviso-comissao]');
  const btnFecharEl = container.querySelector('[data-fechar]');

  // Dados de apoio (nomes), carregados uma vez - as listas de fretes/despesas/
  // adiantamentos/itens vem do proprio preview, que e recalculado a cada
  // alteracao.
  const [conjunto, categorias, fornecedores, centrosCusto] = await Promise.all([
    get(`/conjuntos/${viagem.conjunto_id}`),
    get('/categorias-despesa'),
    get('/fornecedores'),
    get('/centros-custo'),
  ]);
  let contasBancarias = [];
  try { contasBancarias = await get('/contas-bancarias'); } catch { /* sem permissao no modulo: so nao mostra o nome do caixa */ }
  const nomeCategoria = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
  const nomeFornecedor = Object.fromEntries(fornecedores.map((f) => [f.id, f.nome]));
  const nomeCentroCusto = Object.fromEntries(centrosCusto.map((c) => [c.id, c.nome]));
  const nomeContaBancaria = Object.fromEntries(contasBancarias.map((c) => [c.id, c.nome]));
  const tratora = conjunto.itens.find((i) => TIPOS_TRATORA.includes(i.tipo));
  const centroCustoPadrao = tratora ? centrosCusto.find((c) => c.veiculo_id === tratora.veiculo_id) || null : null;

  let calculo = null;
  const valoresAnteriores = {};

  function renderResumo(p) {
    if (btnFecharEl) {
      const bloqueado = p.despesasPendentes > 0;
      avisoPendentesEl.classList.toggle('hidden', !bloqueado);
      if (bloqueado) {
        avisoPendentesEl.innerHTML = `${p.despesasPendentes} despesa(s) desta viagem ainda ${p.despesasPendentes === 1 ? 'esta' : 'estao'} pendente(s) de validacao. Valide-${p.despesasPendentes === 1 ? 'a' : 'as'} na secao Despesas abaixo antes de fechar o acerto.`;
      }
      btnFecharEl.disabled = bloqueado;
      btnFecharEl.classList.toggle('opacity-50', bloqueado);
      btnFecharEl.classList.toggle('cursor-not-allowed', bloqueado);
    }
    // Sem nenhuma faixa de comissao configurada (ou nenhuma que cubra essa
    // media de consumo), o percentual aplicado cai pra 0% em silencio - achado
    // testando o fluxo completo do zero. So avisa enquanto o campo de ajuste
    // manual estiver vazio: se o usuario ja digitou um percentual, ele esta
    // no controle e o aviso vira ruido.
    const semFaixaEComSemAjuste = p.percentualSugerido === null && form.percentual.value === '';
    avisoComissaoEl.classList.toggle('hidden', !semFaixaEComSemAjuste);
    if (semFaixaEComSemAjuste) {
      avisoComissaoEl.innerHTML = 'Nenhuma faixa de comissao cadastrada cobre a media de consumo desta viagem - a comissao vai ficar em <strong>0%</strong> a nao ser que voce digite um percentual manual ao lado, ou <a href="#/config/comissao-faixas" class="font-medium underline">cadastre uma faixa</a> antes de fechar.';
    }
    resumoEl.innerHTML = [
      linha('Receitas (frete bruto total)', formatarMoeda(p.freteBrutoTotal)),
      linha(p.valorPedagio > 0 ? 'Despesas lancadas' : 'Despesas da viagem', formatarMoeda(p.despesasLancadasTotal)),
      p.valorPedagio > 0 ? linha('Pedagio da viagem (custo; nao altera o saldo do motorista)', formatarMoeda(p.valorPedagio)) : '',
      p.valorPedagio > 0 ? linha('Despesas da viagem (total)', formatarMoeda(p.despesasTotal)) : '',
      linha('Receitas &minus; Despesas', valorResultado(p.receitasMenosDespesas), true, 'resultado'),
      linha('% de sobra (do faturamento)', p.percentualSobra !== null ? `<span class="${p.percentualSobra >= 0 ? 'text-emerald-500' : 'text-red-500'}">${p.percentualSobra.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>` : '-'),
      '<hr class="my-2 border-slate-200" />',
      p.valorImposto > 0 ? linha(`Imposto (${p.empresa.razao_social})`, `- ${formatarMoeda(p.valorImposto)}`) : '',
      p.valorImposto > 0 ? linha('Base de calculo da comissao (bruto - imposto)', formatarMoeda(p.baseCalculoComissao)) : '',
      linha('Media de consumo', p.mediaConsumoKmL ? `${p.mediaConsumoKmL.toFixed(2)} km/l` : '-'),
      linha('% comissao sugerido', p.percentualSugerido !== null ? `${p.percentualSugerido}%` : '-'),
      linha('Valor da comissao', formatarMoeda(p.valorComissao), false, 'comissao'),
      linha('Reembolsos ao motorista', formatarMoeda(p.valorReembolsos), false, 'reembolsos'),
      linha('Adiantamentos tomados', formatarMoeda(p.adiantamentosTotal)),
      linha('Descontos (despesas do motorista + lancados)', formatarMoeda(p.valorDescontos), false, 'descontos'),
      linha('Saldo conta corrente anterior', formatarMoeda(p.saldoContaCorrenteAnterior)),
      '<hr class="my-2 border-slate-200" />',
      linha('Saldo final', `${formatarMoeda(Math.abs(p.saldoFinal))} ${p.saldoFinal >= 0 ? '(a pagar)' : '(fica em conta corrente)'}`, true, 'saldoFinal'),
    ].join('');

    // Destaca (flash amarelo) so os valores que dependem do que o usuario
    // acabou de digitar - da pra ver de relance o que mudou sem reler o
    // resumo inteiro a cada debounce. So pisca a partir do 2o calculo (senao
    // a tela inteira "piscaria" ja na primeira carga, sem nada ter mudado).
    for (const el of resumoEl.querySelectorAll('[data-linha]')) {
      const chave = el.dataset.linha;
      const textoAtual = el.textContent;
      if (valoresAnteriores[chave] !== undefined && valoresAnteriores[chave] !== textoAtual) {
        el.classList.remove('flash-recalculo'); void el.offsetWidth; el.classList.add('flash-recalculo');
      }
      valoresAnteriores[chave] = textoAtual;
    }
  }

  // ---- Secoes editaveis (fretes, despesas, adiantamentos, reembolsos, descontos) ----

  function secao(titulo, botaoAcao, rotuloBotao, conteudo, dica = '') {
    return `
      <section class="card p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="font-semibold text-slate-900">${titulo}</h2>
            ${dica ? `<p class="text-xs text-slate-400">${dica}</p>` : ''}
          </div>
          ${gerenciar ? `<button type="button" class="btn-primary btn-sm" data-acao="${botaoAcao}">${rotuloBotao}</button>` : ''}
        </div>
        ${conteudo}
      </section>
    `;
  }

  function htmlFretes(p) {
    const acoes = gerenciar ? [{ acao: 'editar-frete', rotulo: 'Editar' }, { acao: 'excluir-frete', rotulo: 'Excluir', perigo: true }] : [];
    const linhas = p.fretes.map((f) => [
      f.transportadora_id ? esc(nomeFornecedor[f.transportadora_id] || `#${f.transportadora_id}`) : '-',
      `${esc(f.origem_cidade)}/${esc(f.origem_uf)} &rarr; ${esc(f.destino_cidade)}/${esc(f.destino_uf)}`,
      f.data_carregamento ? formatarDataBr(f.data_carregamento) : '-',
      f.peso_carga_kg ? `${f.peso_carga_kg.toLocaleString('pt-BR')} kg` : '-',
      formatarMoeda(f.frete_bruto),
      botoesAcao(acoes, f.id),
    ]);
    return secao('Receitas (fretes)', 'novo-frete', '+ Frete', tabelaSecao({
      colunas: [{ titulo: 'Transportadora' }, { titulo: 'Rota' }, { titulo: 'Carregamento' }, { titulo: 'Peso' }, { titulo: 'Frete bruto', direita: true }, { titulo: '' }],
      linhas,
      vazio: 'Nenhum frete lancado nesta viagem.',
      rodape: linhaTotal(4, 'Total (Receitas)', formatarMoeda(p.freteBrutoTotal)),
    }));
  }

  // Despesas de Arla ficam vinculadas a abastecida (diesel) via
  // despesa_arla_id e sao editadas/excluidas juntas - aparecem fundidas na
  // linha da abastecida, igual a tela da viagem.
  function despesasPrincipaisEArla(p) {
    const porId = new Map(p.despesas.map((d) => [d.id, d]));
    const arlaPorPaiId = new Map(p.despesas.filter((d) => d.despesa_arla_id).map((d) => [d.id, porId.get(d.despesa_arla_id)]));
    const idsArlaFilhas = new Set(p.despesas.filter((d) => d.despesa_arla_id).map((d) => d.despesa_arla_id));
    const principais = [...p.despesas.filter((d) => !idsArlaFilhas.has(d.id))].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.id - a.id));
    return { principais, arlaPorPaiId };
  }

  const PAGO_POR_LABEL = { Empresa: 'Empresa', Motorista: '<span class="badge-atencao">Motorista (desconto)</span>', AdminOutros: 'Admin/Outros' };

  function htmlDespesas(p) {
    const { principais, arlaPorPaiId } = despesasPrincipaisEArla(p);
    const acoesBase = gerenciar ? [{ acao: 'excluir-despesa', rotulo: 'Excluir', perigo: true }] : [];
    const linhas = principais.map((d) => {
      const arla = arlaPorPaiId.get(d.id);
      const total = d.valor + (arla ? arla.valor : 0);
      const principal = gerenciar ? [d.validado_em ? { acao: 'editar-despesa', rotulo: 'Editar' } : { acao: 'validar-despesa', rotulo: 'Validar' }] : [];
      return [
        `#${d.id}`,
        formatarDataBr(d.data),
        esc(nomeCategoria[d.categoria_id] || d.categoria_id) + (d.descricao ? ` <span class="text-xs text-slate-400">${esc(d.descricao)}</span>` : ''),
        d.posto_fornecedor_id ? esc(nomeFornecedor[d.posto_fornecedor_id] || `#${d.posto_fornecedor_id}`) : '-',
        formatarMoeda(total) + (arla ? ` <span class="text-xs text-slate-400">(diesel ${formatarMoeda(d.valor)} + Arla ${formatarMoeda(arla.valor)})</span>` : ''),
        PAGO_POR_LABEL[d.pago_por] || d.pago_por,
        d.validado_em ? '<span class="text-xs text-slate-400">Validada</span>' : '<span class="badge-atencao">Pendente de validacao</span>',
        botoesAcao([...principal, ...acoesBase], d.id),
      ];
    });
    return secao('Despesas', 'nova-despesa', '+ Despesa', tabelaSecao({
      colunas: [{ titulo: 'Cod.' }, { titulo: 'Data' }, { titulo: 'Categoria' }, { titulo: 'Fornecedor' }, { titulo: 'Valor', direita: true }, { titulo: 'Pago por' }, { titulo: 'Status' }, { titulo: '' }],
      linhas,
      vazio: 'Nenhuma despesa lancada nesta viagem.',
      rodape: linhaTotal(7, p.valorPedagio > 0 ? 'Total (despesas lancadas)' : 'Total (Despesas)', formatarMoeda(p.despesasLancadasTotal))
        + (p.valorPedagio > 0 ? linhaTotal(7, 'Pedagio da viagem (informativo no saldo)', formatarMoeda(p.valorPedagio)) + linhaTotal(7, 'Total das despesas', formatarMoeda(p.despesasTotal)) : ''),
    }), 'Despesas pagas pelo motorista viram desconto no acerto.');
  }

  function htmlAdiantamentos(p) {
    const acoes = gerenciar ? [{ acao: 'editar-adiantamento', rotulo: 'Editar' }, { acao: 'excluir-adiantamento', rotulo: 'Excluir', perigo: true }] : [];
    const linhas = p.adiantamentos.map((a) => [
      formatarDataBr(a.data),
      esc(a.descricao || '-'),
      a.conta_bancaria_id ? esc(nomeContaBancaria[a.conta_bancaria_id] || 'Caixa') : 'Em especie',
      formatarMoeda(a.valor),
      botoesAcao(acoes, a.id),
    ]);
    return secao('Adiantamentos ao motorista', 'novo-adiantamento', '+ Adiantamento', tabelaSecao({
      colunas: [{ titulo: 'Data' }, { titulo: 'Descricao' }, { titulo: 'Saiu de' }, { titulo: 'Valor', direita: true }, { titulo: '' }],
      linhas,
      vazio: 'Nenhum adiantamento lancado.',
      rodape: linhaTotal(3, 'Total (Adiantamentos)', formatarMoeda(p.adiantamentosTotal)),
    }));
  }

  function htmlItens(p, tipo) {
    const ehReembolso = tipo === 'Reembolso';
    const itens = ehReembolso ? p.itensReembolso : p.itensDesconto;
    const acoes = gerenciar ? [{ acao: `editar-item`, rotulo: 'Editar' }, { acao: `excluir-item`, rotulo: 'Excluir', perigo: true }] : [];
    const linhasManuais = itens.map((i) => [esc(i.descricao), formatarMoeda(i.valor), botoesAcao(acoes, i.id)]);
    // Descontos tambem inclui, so pra leitura, as despesas por conta do
    // motorista (editadas/excluidas na secao Despesas).
    const linhasDespesa = ehReembolso ? [] : p.despesas.filter((d) => d.pago_por === 'Motorista').map((d) => [
      `${esc(nomeCategoria[d.categoria_id] || 'Despesa')}${d.descricao ? ` - ${esc(d.descricao)}` : ''} <span class="badge-neutro">Despesa #${d.id}</span>`,
      formatarMoeda(d.valor),
      '<span class="text-xs text-slate-400">ajuste na secao Despesas</span>',
    ]);
    const total = ehReembolso ? p.valorReembolsos : p.valorDescontos;
    return secao(
      ehReembolso ? 'Reembolsos ao motorista' : 'Descontos ao motorista',
      ehReembolso ? 'novo-reembolso' : 'novo-desconto',
      ehReembolso ? '+ Reembolso' : '+ Desconto',
      tabelaSecao({
        colunas: [{ titulo: 'Descricao' }, { titulo: 'Valor', direita: true }, { titulo: '' }],
        linhas: [...linhasDespesa, ...linhasManuais],
        vazio: ehReembolso ? 'Nenhum reembolso lancado (ex.: caixinha, reaperto de rodas).' : 'Nenhum desconto lancado (ex.: multas, avarias).',
        rodape: linhaTotal(1, ehReembolso ? 'Total (Reembolsos)' : 'Total (Descontos)', formatarMoeda(total)),
      }),
      ehReembolso ? 'Somam ao que o motorista recebe.' : 'Reduzem o que o motorista recebe.',
    );
  }

  function renderSecoes(p) {
    secoesEl.innerHTML = [htmlFretes(p), htmlDespesas(p), htmlAdiantamentos(p), htmlItens(p, 'Reembolso'), htmlItens(p, 'Desconto')].join('');
  }

  // ---- Dados: preview (recalculado a cada alteracao) ----

  async function buscarPreview() {
    const params = new URLSearchParams();
    if (form.percentual.value !== '') params.set('percentual_comissao_aplicado', form.percentual.value);
    const query = params.toString();
    try {
      calculo = await get(`/acertos/viagem/${viagem.id}/preview${query ? `?${query}` : ''}`);
      renderResumo(calculo);
      renderSecoes(calculo);
      return calculo;
    } catch (err) {
      mostrarErro(err);
      return null;
    }
  }

  // Chamado depois de qualquer alteracao feita nas secoes (modais da viagem,
  // itens, exclusoes): refaz o calculo e as listas.
  async function atualizarTudo() {
    await buscarPreview();
  }

  const inicial = await buscarPreview();
  if (!inicial) return;
  form.percentual.value = inicial.percentualAplicado ?? '';
  attachMoedaMaskReais(form.pedagio, inicial.valorPedagio || 0);
  setMoedaValue(form.pedagio, inicial.valorPedagio || 0);
  attachUppercaseInput(form.observacoes);

  // Rascunho automatico (localStorage): esta tela e conferida ao vivo com o
  // motorista - perder o percentual/observacoes digitados por um refresh
  // acidental ou aba fechada sem querer custa caro. Itens, pedagio, fretes,
  // despesas e adiantamentos ja sao gravados no servidor na hora, nao
  // dependem disto. So restaura se houver um rascunho salvo.
  const rascunho = gerenciar ? lerRascunho(viagem.id) : null;
  if (rascunho) {
    if (rascunho.percentual !== undefined) form.percentual.value = rascunho.percentual;
    if (rascunho.observacoes !== undefined) form.observacoes.value = rascunho.observacoes;
    const horario = new Date(rascunho.salvoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    mostrarToast(`Rascunho restaurado (auto-salvo as ${horario}).`);
    await buscarPreview();
  }

  // Aviso de saida sem salvar: so entra em vigor depois que o usuario de fato
  // mexeu no percentual/observacoes (setar valores do backend/rascunho acima
  // nao conta) - e se desliga sozinho quando a SPA navega pra outra rota (o
  // fechamento do acerto tambem desliga, ver abaixo), pra nao vazar o aviso
  // pra outras telas.
  let sujo = false;
  const hashInicio = window.location.hash;
  function aoTentarSair(ev) {
    if (!sujo) return;
    ev.preventDefault();
    ev.returnValue = '';
  }
  function pararDeObservarSaida() {
    window.removeEventListener('beforeunload', aoTentarSair);
    window.removeEventListener('hashchange', aoTrocarDeRota);
  }
  function aoTrocarDeRota() {
    if (window.location.hash !== hashInicio) pararDeObservarSaida();
  }
  if (gerenciar) {
    window.addEventListener('beforeunload', aoTentarSair);
    window.addEventListener('hashchange', aoTrocarDeRota);
  }

  form.addEventListener('input', (ev) => {
    if (ev.target === form.pedagio) return; // pedagio e gravado no 'change', nao a cada tecla
    sujo = true;
    salvarRascunho(viagem.id, { percentual: form.percentual.value, observacoes: form.observacoes.value });
    clearTimeout(debounceId);
    debounceId = setTimeout(() => buscarPreview(), 300);
  });

  // Pedagio: so informativo, gravado direto na viagem ao sair do campo.
  form.pedagio.addEventListener('change', async () => {
    try {
      await put(`/acertos/viagem/${viagem.id}/pedagio`, { valor: getMoedaValue(form.pedagio) });
      mostrarToast('Pedagio salvo (informativo).');
      await buscarPreview();
    } catch (err) {
      mostrarErro(err);
    }
  });

  // ---- Acoes das secoes (delegacao: as secoes sao re-renderizadas a cada alteracao) ----

  async function excluirComConfirmacao({ titulo, mensagem, url }) {
    const ok = await confirmarAcao({ titulo, mensagem, textoConfirmar: 'Excluir' });
    if (!ok) return;
    try {
      await del(url);
      mostrarToast('Removido.');
      await atualizarTudo();
    } catch (err) {
      mostrarErro(err);
    }
  }

  function argsDespesa(d, p) {
    const { arlaPorPaiId } = despesasPrincipaisEArla(p);
    return [
      d,
      arlaPorPaiId.get(d.id) || null,
      nomeCategoria[d.categoria_id],
      d.posto_fornecedor_id ? nomeFornecedor[d.posto_fornecedor_id] : '',
      d.centro_custo_id ? nomeCentroCusto[d.centro_custo_id] : '',
      atualizarTudo,
    ];
  }

  secoesEl.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-acao]');
    if (!btn || !gerenciar || !calculo) return;
    const id = Number(btn.dataset.id);
    const p = calculo;
    switch (btn.dataset.acao) {
      case 'novo-frete': return abrirNovoFrete(viagem.id, atualizarTudo);
      case 'editar-frete': {
        const f = p.fretes.find((x) => x.id === id);
        return abrirEditarFrete(f, f.transportadora_id ? nomeFornecedor[f.transportadora_id] : '', atualizarTudo);
      }
      case 'excluir-frete':
        return excluirComConfirmacao({ titulo: 'Excluir frete', mensagem: 'Excluir este frete? O recebivel gerado por ele tambem e removido (so e possivel se nao tiver baixas lancadas).', url: `/viagens/fretes/${id}` });
      case 'nova-despesa': return abrirNovaDespesa(viagem.id, atualizarTudo, centroCustoPadrao);
      case 'editar-despesa': return abrirEditarDespesa(...argsDespesa(p.despesas.find((x) => x.id === id), p));
      case 'validar-despesa': return abrirValidarDespesa(...argsDespesa(p.despesas.find((x) => x.id === id), p));
      case 'excluir-despesa':
        return excluirComConfirmacao({ titulo: 'Excluir despesa', mensagem: `Excluir a despesa #${id}? Se ela tiver Arla vinculada, a Arla tambem e removida (so e possivel se a conta a pagar dela ainda nao tiver pagamento).`, url: `/viagens/despesas/${id}` });
      case 'novo-adiantamento': return abrirNovoAdiantamento(viagem.id, atualizarTudo);
      case 'editar-adiantamento': return abrirEditarAdiantamento(p.adiantamentos.find((x) => x.id === id), atualizarTudo);
      case 'excluir-adiantamento': return removerAdiantamento(p.adiantamentos.find((x) => x.id === id), atualizarTudo);
      case 'novo-reembolso': return abrirModalItem({ viagemId: viagem.id, tipo: 'Reembolso', aoSalvar: atualizarTudo });
      case 'novo-desconto': return abrirModalItem({ viagemId: viagem.id, tipo: 'Desconto', aoSalvar: atualizarTudo });
      case 'editar-item': {
        const item = [...p.itensReembolso, ...p.itensDesconto].find((x) => x.id === id);
        return abrirModalItem({ viagemId: viagem.id, tipo: item.tipo, item, aoSalvar: atualizarTudo });
      }
      case 'excluir-item': {
        const item = [...p.itensReembolso, ...p.itensDesconto].find((x) => x.id === id);
        return excluirComConfirmacao({ titulo: 'Excluir item', mensagem: `Excluir "${esc(item.descricao)}" (${formatarMoeda(item.valor)})?`, url: `/acertos/itens/${id}` });
      }
      default: return undefined;
    }
  });

  const btnFechar = container.querySelector('[data-fechar]');
  if (btnFechar) {
    const textoOriginalBtn = btnFechar.textContent;
    btnFechar.addEventListener('click', async () => {
      erroEl.classList.add('hidden');
      btnFechar.disabled = true;
      // Feedback de latencia: em conexao lenta, sem isso o botao so fica
      // desabilitado e parece travado - depois de 1.5s avisa que ainda esta
      // trabalhando, em vez de deixar o usuario achando que precisa clicar de novo.
      const avisoLentidao = setTimeout(() => { btnFechar.textContent = 'Ainda processando...'; }, 1500);
      try {
        const acerto = await post(`/acertos/viagem/${viagem.id}/fechar`, {
          percentual_comissao_aplicado: form.percentual.value !== '' ? Number(form.percentual.value) : undefined,
          observacoes_ajustes: form.observacoes.value || null,
          valor_pedagio: getMoedaValue(form.pedagio), // vai junto: nao depende do 'change' do campo
        });
        limparRascunho(viagem.id);
        sujo = false;
        pararDeObservarSaida();
        mostrarToast('Acerto fechado com sucesso.');
        // Os fretes/despesas podem ter sido alterados nesta tela - recarrega a
        // viagem pra tela do acerto fechado nunca mostrar valor desatualizado.
        const viagemAtual = await get(`/viagens/${viagem.id}`);
        renderFechado(container, viagemAtual, motorista, acerto, gerenciar);
      } catch (err) {
        erroEl.textContent = err.message;
        erroEl.classList.remove('hidden');
      } finally {
        clearTimeout(avisoLentidao);
        btnFechar.disabled = false;
        btnFechar.textContent = textoOriginalBtn;
      }
    });
  }
}

const STATUS_BADGE_PAGAMENTO = { Pendente: 'badge-atencao', Parcial: 'badge-atencao', Pago: 'badge-sucesso' };

// A pergunta mais comum depois de fechar um acerto e "como eu baixo isso?" -
// o saldo final vira Conta a Pagar normal (o imposto e so informativo e nao gera conta; ver
// POST /acertos/viagem/:viagemId/fechar), a baixa e feita LA (Contas a Pagar
// -> Baixar), nao aqui. Sem este bloco a tela do acerto fechado nunca
// refletia se aquele pagamento ja tinha sido baixado ou nao - ficava
// parecendo "pendente para sempre" mesmo depois de pago, so porque o rotulo
// "(a pagar)" no resumo acima e fixo (baseado so no sinal do saldo).
async function renderSituacaoPagamento(el, acerto) {
  el.innerHTML = '<p class="text-sm text-slate-400">Carregando situacao do pagamento...</p>';
  try {
    const contas = await get(`/contas-pagar?acerto_id=${acerto.id}`);
    if (!contas.length) {
      el.innerHTML = `
        <h2 class="mb-1 font-semibold text-slate-900">Situacao do pagamento</h2>
        <p class="text-sm text-slate-500">Este acerto nao gerou nenhuma conta a pagar (saldo final ficou so na conta corrente do motorista, sem valor a desembolsar agora).</p>
      `;
      return;
    }
    el.innerHTML = `
      <h2 class="mb-2 font-semibold text-slate-900">Situacao do pagamento</h2>
      <p class="mb-3 text-sm text-slate-500">A baixa e feita na tela de Contas a Pagar (botao "Baixar" na linha da conta), nao aqui no acerto.</p>
      <div class="space-y-2">
        ${contas.map((c) => `
          <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span>${c.descricao}</span>
            <span class="flex items-center gap-2">
              <span class="font-medium">${formatarMoeda(c.valor)}</span>
              <span class="${STATUS_BADGE_PAGAMENTO[c.status] || 'badge-neutro'}">${c.status}</span>
            </span>
          </div>
        `).join('')}
      </div>
      <a href="#/contas-pagar?acerto_id=${acerto.id}" class="mt-3 inline-block text-sm text-gray-900 hover:underline">Ir para Contas a Pagar &rarr;</a>
    `;
  } catch (err) {
    el.innerHTML = '<p class="text-sm text-red-600">Erro ao carregar a situacao do pagamento.</p>';
  }
}

// Reembolsos/descontos linha a linha. Despesa por conta do motorista mostra
// o codigo da despesa; "SemDetalhe" cobre acertos fechados antes da listagem
// existir (so o total ficou gravado).
function linhasDetalhe(itens) {
  return itens.map((i) => linhaItem(`${esc(i.descricao)}${i.origem === 'Despesa' ? ` (despesa #${i.despesa_id})` : ''}`, formatarMoeda(i.valor))).join('');
}

async function renderFechado(container, viagem, motorista, acerto, gerenciar) {
  container.innerHTML = `
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-slate-900">Acerto - Viagem #${viagem.id}</h1>
        <p class="text-sm text-slate-500">${motorista.nome} · Fechado em ${formatarDataBr(acerto.data_acerto)}</p>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" data-relatorio="resumido">Relatorio resumido (PDF)</button>
        <button type="button" class="btn-secondary" data-relatorio="detalhado">Relatorio detalhado (PDF)</button>
        <button type="button" class="btn-primary" data-whatsapp>Gerar resumo WhatsApp</button>
      </div>
    </div>
    <div class="card max-w-3xl p-4" data-resumo></div>
    <div class="card mt-6 max-w-3xl p-4" data-pagamento></div>
    ${ehAdmin() ? '<div class="card mt-6 max-w-3xl p-4" data-secao-auditoria><h2 class="mb-3 font-semibold text-slate-900">Historico (auditoria)</h2><div data-timeline-auditoria></div></div>' : ''}
    <div class="card mt-6 max-w-3xl p-4" data-ocorrencias></div>
  `;
  container.querySelector('[data-ocorrencias]').appendChild(
    criarOcorrencias({ entidadeTipo: 'AcertoViagem', entidadeId: viagem.id, podeGerenciar: gerenciar }).el,
  );
  await renderSituacaoPagamento(container.querySelector('[data-pagamento]'), acerto);
  if (ehAdmin()) {
    container.querySelector('[data-timeline-auditoria]').appendChild(
      criarTimelineAuditoria({ tabela: 'acertos_viagem', registroId: acerto.id }).el,
    );
  }
  const [detalhamento, despesas] = await Promise.all([
    get(`/acertos/viagem/${viagem.id}/detalhamento`),
    get(`/viagens/${viagem.id}/despesas`),
  ]);
  const freteBrutoTotal = (viagem.fretes || []).reduce((t, f) => t + f.frete_bruto, 0);
  const valorPedagio = detalhamento.valorPedagio || 0;
  const despesasLancadasTotal = despesas.reduce((t, d) => t + d.valor, 0);
  // Pedagio: informativo no acerto (nao altera o saldo), mas e custo da viagem.
  const despesasTotal = despesasLancadasTotal + valorPedagio;
  const percentualSobra = freteBrutoTotal > 0 ? ((freteBrutoTotal - despesasTotal) / freteBrutoTotal) * 100 : null;
  const baseCalculoComissao = freteBrutoTotal - (acerto.valor_imposto || 0);

  // Split-pane creditos/debitos (sem rodape fixo): agrupa o que aumenta o
  // que vai pro motorista (comissao, reembolsos) de um lado e o que reduz
  // (adiantamentos ja tomados, descontos) do outro - mais facil de conferir
  // com o motorista do que uma lista unica de +/- misturados. Frete/despesas/
  // imposto/base ficam num bloco informativo acima (nao sao credito nem
  // debito, so contexto de como a comissao foi calculada e do resultado da
  // viagem).
  const totalCreditos = acerto.valor_comissao + acerto.valor_reembolsos;
  const totalDebitos = acerto.valor_adiantamentos + acerto.valor_descontos;
  container.querySelector('[data-resumo]').innerHTML = `
    <div class="mb-4 space-y-1">
      ${linha('Receitas (frete bruto total)', formatarMoeda(freteBrutoTotal))}
      ${linha(valorPedagio > 0 ? 'Despesas lancadas' : 'Despesas da viagem', formatarMoeda(despesasLancadasTotal))}
      ${valorPedagio > 0 ? linha('Pedagio da viagem (custo; nao altera o saldo do motorista)', formatarMoeda(valorPedagio)) : ''}
      ${valorPedagio > 0 ? linha('Despesas da viagem (total)', formatarMoeda(despesasTotal)) : ''}
      ${linha('Receitas &minus; Despesas', valorResultado(freteBrutoTotal - despesasTotal), true)}
      ${linha('% de sobra (do faturamento)', percentualSobra !== null ? `<span class="${percentualSobra >= 0 ? 'text-emerald-500' : 'text-red-500'}">${percentualSobra.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>` : '-')}
      ${acerto.valor_imposto > 0 ? linha(`Imposto (${acerto.percentual_imposto_aplicado}%)`, `- ${formatarMoeda(acerto.valor_imposto)}`) : ''}
      ${acerto.valor_imposto > 0 ? linha('Base de calculo da comissao (bruto - imposto)', formatarMoeda(baseCalculoComissao)) : ''}
      <div class="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm text-slate-600" data-linha-pedagio>
        <span>Pedagio da viagem (custo da viagem; nao altera o saldo do motorista)</span>
        <span class="flex items-center gap-2">
          <span class="font-medium" data-pedagio-valor>${formatarMoeda(detalhamento.valorPedagio)}</span>
          ${gerenciar ? '<button type="button" class="text-xs text-gray-900 hover:underline" data-editar-pedagio>Informar/editar</button>' : ''}
        </span>
      </div>
    </div>
    <div class="grid grid-cols-1 gap-6 border-t border-slate-200 pt-4 sm:grid-cols-2">
      <div>
        <h3 class="mb-2 text-sm font-semibold uppercase text-emerald-600">Creditos ao motorista</h3>
        <div class="space-y-1">
          ${linha(`Comissao (${acerto.percentual_comissao_aplicado}%)`, formatarMoeda(acerto.valor_comissao))}
          ${acerto.valor_reembolsos > 0 ? linha('Reembolsos', formatarMoeda(acerto.valor_reembolsos)) : ''}
          ${acerto.valor_reembolsos > 0 ? linhasDetalhe(detalhamento.reembolsos) : ''}
        </div>
        <hr class="my-2 border-slate-200" />
        ${linha('Total creditos', formatarMoeda(totalCreditos), true)}
      </div>
      <div>
        <h3 class="mb-2 text-sm font-semibold uppercase text-red-600">Debitos do motorista</h3>
        <div class="space-y-1">
          ${acerto.valor_adiantamentos > 0 ? linha('Adiantamentos tomados na viagem', formatarMoeda(acerto.valor_adiantamentos)) : ''}
          ${acerto.valor_descontos > 0 ? linha('Descontos (multas/avarias/despesas)', formatarMoeda(acerto.valor_descontos)) : ''}
          ${acerto.valor_descontos > 0 ? linhasDetalhe(detalhamento.descontos) : ''}
          ${totalDebitos === 0 ? '<p class="text-sm text-slate-400">Nenhum.</p>' : ''}
        </div>
        <hr class="my-2 border-slate-200" />
        ${linha('Total debitos', formatarMoeda(totalDebitos), true)}
      </div>
    </div>
    <div class="mt-4 space-y-1 border-t border-slate-200 pt-3">
      ${linha('Saldo conta corrente anterior', formatarMoeda(acerto.saldo_conta_corrente_anterior))}
      ${linha('Saldo final', `${formatarMoeda(Math.abs(acerto.saldo_final))} ${acerto.saldo_final >= 0 ? '(a pagar)' : '(fica em conta corrente)'}`, true)}
    </div>
    ${acerto.observacoes_ajustes ? `<p class="mt-3 text-sm text-slate-500">Obs.: ${esc(acerto.observacoes_ajustes)}</p>` : ''}
  `;

  // Pedagio e so informativo: pode ser informado/corrigido mesmo com o acerto fechado.
  const btnEditarPedagio = container.querySelector('[data-editar-pedagio]');
  if (btnEditarPedagio) {
    btnEditarPedagio.addEventListener('click', () => {
      const form = document.createElement('form');
      form.className = 'space-y-4';
      form.innerHTML = `
        <p class="text-sm text-slate-500">Valor do pedagio desta viagem. Fica so como informacao nos relatorios do acerto - nao gera lancamento nem altera o saldo.</p>
        <div class="max-w-[12rem]"><label class="label">Pedagio da viagem</label><input type="text" name="valor" class="input" /></div>
        <p class="hidden text-sm text-red-600" data-erro></p>
        <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Salvar pedagio</button></div>
      `;
      attachMoedaMaskReais(form.valor, detalhamento.valorPedagio || 0);
      const erro = form.querySelector('[data-erro]');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        erro.classList.add('hidden');
        try {
          const res = await put(`/acertos/viagem/${viagem.id}/pedagio`, { valor: getMoedaValue(form.valor) });
          fecharModal();
          mostrarToast('Pedagio salvo.');
          await renderFechado(container, viagem, motorista, acerto, gerenciar);
        } catch (err) {
          erro.textContent = err.message;
          erro.classList.remove('hidden');
        }
      });
      abrirModal({ titulo: 'Pedagio da viagem', conteudo: form, largura: 'max-w-sm' });
    });
  }

  container.querySelectorAll('[data-relatorio]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.open(`${window.location.pathname}#/acertos/${viagem.id}/relatorio?tipo=${btn.dataset.relatorio}`, '_blank');
    });
  });

  container.querySelector('[data-whatsapp]').addEventListener('click', async () => {
    try {
      const texto = await get(`/acertos/${acerto.id}/whatsapp`);
      const corpo = document.createElement('div');
      corpo.innerHTML = `
        <textarea class="input font-mono text-xs" rows="16" readonly>${esc(texto)}</textarea>
        <div class="mt-3 flex justify-end gap-2">
          <button type="button" class="btn-secondary" data-copiar>Copiar texto</button>
          <a class="btn-primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(texto)}">Abrir no WhatsApp</a>
        </div>
      `;
      const overlay = abrirModal({ titulo: 'Resumo para WhatsApp', conteudo: corpo, largura: 'max-w-lg' });
      overlay.querySelector('[data-copiar]').addEventListener('click', async () => {
        await navigator.clipboard.writeText(texto);
        mostrarToast('Texto copiado.');
      });
    } catch (err) {
      mostrarErro(err);
    }
  });
}

export async function render(container, params) {
  const viagemId = params.viagemId;
  container.innerHTML = esqueletoPagina();
  const gerenciar = podeGerenciar('acertos');

  let viagem;
  try {
    viagem = await get(`/viagens/${viagemId}`);
  } catch (err) {
    mostrarErro(err);
    return;
  }
  const motorista = await get(`/motoristas/${viagem.motorista_id}`);

  if (viagem.status === 'EmAndamento') {
    container.innerHTML = `
      <div class="card p-8 text-center text-slate-400">
        <p>Esta viagem ainda esta em andamento.</p>
        <p class="mt-1 text-sm">Finalize a viagem (km final) antes de fazer o acerto.</p>
        <button type="button" class="btn-secondary mt-4" data-voltar>Voltar para a viagem</button>
      </div>
    `;
    container.querySelector('[data-voltar]').addEventListener('click', () => navegar(`/viagens/${viagemId}`));
    return;
  }

  if (viagem.status === 'Finalizada') {
    const todos = await get('/acertos');
    const acerto = todos.find((a) => a.viagem_id === Number(viagemId));
    if (!acerto) {
      container.innerHTML = '<div class="card p-8 text-center text-slate-400">Acerto nao encontrado.</div>';
      return;
    }
    await renderFechado(container, viagem, motorista, acerto, gerenciar);
    return;
  }

  await renderPreview(container, viagem, motorista, gerenciar);
}
