import { get, post, podeGerenciar, ehAdmin } from '../api.js';
import { abrirModal } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, setMoedaValue, formatarDataBr, attachUppercaseInput } from '../masks.js';
import { navegar } from '../router.js';
import { criarOcorrencias } from '../components/ocorrencias.js';
import { esqueletoPagina } from '../components/skeleton.js';
import { criarTimelineAuditoria } from '../components/auditoriaTimeline.js';

function linha(label, valor, destaque = false, chave = null) {
  return `<div class="flex items-center justify-between py-1.5 ${destaque ? 'text-base font-semibold text-slate-900' : 'text-sm text-slate-600'}"${chave ? ` data-linha="${chave}"` : ''}><span>${label}</span><span>${valor}</span></div>`;
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
          <div><label class="label">Reembolsos ao motorista</label><input type="text" name="reembolsos" class="input" /></div>
          <div><label class="label">Descontos (multas/avarias/despesas do motorista)</label><input type="text" name="descontos" class="input" /></div>
          <div><label class="label">Observacoes do ajuste</label><textarea name="observacoes" class="input" rows="2"></textarea></div>
        </form>
        ${gerenciar ? '<button type="button" class="btn-primary mt-4 w-full" data-fechar>Fechar Acerto</button>' : ''}
        <p class="hidden text-sm text-red-600" data-erro></p>
      </div>
    </div>
    <div class="card mt-6 p-4" data-ocorrencias></div>
  `;
  container.querySelector('[data-ocorrencias]').appendChild(
    criarOcorrencias({ entidadeTipo: 'AcertoViagem', entidadeId: viagem.id, podeGerenciar: gerenciar }).el,
  );

  const resumoEl = container.querySelector('[data-resumo]');
  const form = container.querySelector('[data-form]');
  const erroEl = container.querySelector('[data-erro]');
  const avisoPendentesEl = container.querySelector('[data-aviso-pendentes]');
  const avisoComissaoEl = container.querySelector('[data-aviso-comissao]');
  const btnFecharEl = container.querySelector('[data-fechar]');

  const valoresAnteriores = {};
  function renderResumo(p) {
    if (btnFecharEl) {
      const bloqueado = p.despesasPendentes > 0;
      avisoPendentesEl.classList.toggle('hidden', !bloqueado);
      if (bloqueado) {
        avisoPendentesEl.innerHTML = `${p.despesasPendentes} despesa(s) desta viagem ainda ${p.despesasPendentes === 1 ? 'esta' : 'estao'} pendente(s) de validacao. <a href="#/viagens/${viagem.id}" class="font-medium underline">Valide-as na tela da viagem</a> antes de fechar o acerto.`;
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
      linha('Frete bruto total', formatarMoeda(p.freteBrutoTotal)),
      p.valorImposto > 0 ? linha(`Imposto (${p.empresa.razao_social})`, `- ${formatarMoeda(p.valorImposto)}`) : '',
      p.valorImposto > 0 ? linha('Base de calculo da comissao (bruto - imposto)', formatarMoeda(p.baseCalculoComissao)) : '',
      linha('Media de consumo', p.mediaConsumoKmL ? `${p.mediaConsumoKmL.toFixed(2)} km/l` : '-'),
      linha('% comissao sugerido', p.percentualSugerido !== null ? `${p.percentualSugerido}%` : '-'),
      linha('Valor da comissao', formatarMoeda(p.valorComissao), false, 'comissao'),
      linha('Adiantamentos tomados', formatarMoeda(p.adiantamentosTotal)),
      linha('Desconto sugerido (despesas do motorista)', formatarMoeda(p.valorDescontosSugerido)),
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

  // Primeira carga: sem overrides, para o backend aplicar os defaults dele
  // (percentual sugerido, reembolso 0, desconto sugerido). Chamadas
  // seguintes (apos o usuario mexer no formulario) enviam os valores atuais
  // dos campos como override.
  async function buscarPreview(comOverrides) {
    let query = '';
    if (comOverrides) {
      const params = new URLSearchParams();
      if (form.percentual.value !== '') params.set('percentual_comissao_aplicado', form.percentual.value);
      params.set('valor_reembolsos', getMoedaValue(form.reembolsos));
      params.set('valor_descontos', getMoedaValue(form.descontos));
      query = `?${params.toString()}`;
    }
    try {
      const p = await get(`/acertos/viagem/${viagem.id}/preview${query}`);
      renderResumo(p);
      return p;
    } catch (err) {
      mostrarErro(err);
    }
  }

  const inicial = await buscarPreview(false);
  form.percentual.value = inicial.percentualAplicado ?? '';
  setMoedaValue(form.reembolsos, inicial.valorReembolsos || 0);
  attachMoedaMaskReais(form.reembolsos, inicial.valorReembolsos || 0);
  setMoedaValue(form.descontos, inicial.valorDescontosSugerido || 0);
  attachMoedaMaskReais(form.descontos, inicial.valorDescontosSugerido || 0);
  attachUppercaseInput(form.observacoes);

  // Rascunho automatico (localStorage): esta tela e conferida ao vivo com o
  // motorista, com bastante coisa lancada/editada a mao - perder isso por um
  // refresh acidental ou aba fechada sem querer custa caro. So restaura se
  // houver um rascunho salvo (o usuario mexeu em algo antes); a primeira
  // carga, sem rascunho, so usa os defaults do backend normalmente.
  const rascunho = gerenciar ? lerRascunho(viagem.id) : null;
  if (rascunho) {
    if (rascunho.percentual !== undefined) form.percentual.value = rascunho.percentual;
    if (rascunho.reembolsosCentavos !== undefined) setMoedaValue(form.reembolsos, rascunho.reembolsosCentavos);
    if (rascunho.descontosCentavos !== undefined) setMoedaValue(form.descontos, rascunho.descontosCentavos);
    if (rascunho.observacoes !== undefined) form.observacoes.value = rascunho.observacoes;
    const horario = new Date(rascunho.salvoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    mostrarToast(`Rascunho restaurado (auto-salvo as ${horario}).`);
    await buscarPreview(true);
  }

  // Aviso de saida sem salvar: so entra em vigor depois que o usuario de fato
  // mexeu em algo (setar valores do backend/rascunho acima nao conta) - e
  // se desliga sozinho quando a SPA navega pra outra rota (o fechamento do
  // acerto tambem desliga, ver abaixo), pra nao vazar o aviso pra outras telas.
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

  form.addEventListener('input', () => {
    sujo = true;
    salvarRascunho(viagem.id, {
      percentual: form.percentual.value,
      reembolsosCentavos: getMoedaValue(form.reembolsos),
      descontosCentavos: getMoedaValue(form.descontos),
      observacoes: form.observacoes.value,
    });
    clearTimeout(debounceId);
    debounceId = setTimeout(() => buscarPreview(true), 300);
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
          valor_reembolsos: getMoedaValue(form.reembolsos),
          valor_descontos: getMoedaValue(form.descontos),
          observacoes_ajustes: form.observacoes.value || null,
        });
        limparRascunho(viagem.id);
        sujo = false;
        pararDeObservarSaida();
        mostrarToast('Acerto fechado com sucesso.');
        renderFechado(container, { ...viagem, status: 'Finalizada' }, motorista, acerto, gerenciar);
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
// o saldo final (e o imposto, se houver) viram Contas a Pagar normais (ver
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
  const freteBrutoTotal = (viagem.fretes || []).reduce((t, f) => t + f.frete_bruto, 0);
  const baseCalculoComissao = freteBrutoTotal - (acerto.valor_imposto || 0);

  // Split-pane creditos/debitos (sem rodape fixo): agrupa o que aumenta o
  // que vai pro motorista (comissao, reembolsos) de um lado e o que reduz
  // (adiantamentos ja tomados, descontos) do outro - mais facil de conferir
  // com o motorista do que uma lista unica de +/- misturados. Frete/imposto/
  // base ficam num bloco informativo acima (nao sao credito nem debito, so
  // contexto de como a comissao foi calculada).
  const totalCreditos = acerto.valor_comissao + acerto.valor_reembolsos;
  const totalDebitos = acerto.valor_adiantamentos + acerto.valor_descontos;
  container.querySelector('[data-resumo]').innerHTML = `
    <div class="mb-4 space-y-1">
      ${linha('Frete bruto total', formatarMoeda(freteBrutoTotal))}
      ${acerto.valor_imposto > 0 ? linha(`Imposto (${acerto.percentual_imposto_aplicado}%)`, `- ${formatarMoeda(acerto.valor_imposto)}`) : ''}
      ${acerto.valor_imposto > 0 ? linha('Base de calculo da comissao (bruto - imposto)', formatarMoeda(baseCalculoComissao)) : ''}
    </div>
    <div class="grid grid-cols-1 gap-6 border-t border-slate-200 pt-4 sm:grid-cols-2">
      <div>
        <h3 class="mb-2 text-sm font-semibold uppercase text-emerald-600">Creditos ao motorista</h3>
        <div class="space-y-1">
          ${linha(`Comissao (${acerto.percentual_comissao_aplicado}%)`, formatarMoeda(acerto.valor_comissao))}
          ${acerto.valor_reembolsos > 0 ? linha('Reembolsos', formatarMoeda(acerto.valor_reembolsos)) : ''}
        </div>
        <hr class="my-2 border-slate-200" />
        ${linha('Total creditos', formatarMoeda(totalCreditos), true)}
      </div>
      <div>
        <h3 class="mb-2 text-sm font-semibold uppercase text-red-600">Debitos do motorista</h3>
        <div class="space-y-1">
          ${acerto.valor_adiantamentos > 0 ? linha('Adiantamentos tomados na viagem', formatarMoeda(acerto.valor_adiantamentos)) : ''}
          ${acerto.valor_descontos > 0 ? linha('Descontos (multas/avarias/despesas)', formatarMoeda(acerto.valor_descontos)) : ''}
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
    ${acerto.observacoes_ajustes ? `<p class="mt-3 text-sm text-slate-500">Obs.: ${acerto.observacoes_ajustes}</p>` : ''}
  `;

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
        <textarea class="input font-mono text-xs" rows="16" readonly>${texto}</textarea>
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
