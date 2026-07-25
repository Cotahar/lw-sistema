import { get, post, podeGerenciar } from '../api.js';
import { abrirModal } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, setMoedaValue, formatarDataBr } from '../masks.js';
import { navegar } from '../router.js';
import { criarOcorrencias } from '../components/ocorrencias.js';

function linha(label, valor, destaque = false) {
  return `<div class="flex items-center justify-between py-1.5 ${destaque ? 'text-base font-semibold text-slate-900' : 'text-sm text-slate-600'}"><span>${label}</span><span>${valor}</span></div>`;
}

async function renderPreview(container, viagem, motorista, gerenciar) {
  let debounceId = null;

  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Acerto - Viagem #${viagem.id}</h1>
    <p class="mb-4 text-sm text-slate-500">${motorista.nome} · ${formatarDataBr(viagem.data_inicio)} a ${formatarDataBr(viagem.data_fim)} · ${(viagem.km_final - viagem.km_inicial).toLocaleString('pt-BR')} km</p>
    <div class="mb-4 hidden rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" data-aviso-pendentes></div>
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
  const btnFecharEl = container.querySelector('[data-fechar]');

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
    resumoEl.innerHTML = [
      linha('Frete bruto total', formatarMoeda(p.freteBrutoTotal)),
      p.valorImposto > 0 ? linha(`Imposto (${p.empresa.razao_social})`, `- ${formatarMoeda(p.valorImposto)}`) : '',
      p.valorImposto > 0 ? linha('Base de calculo da comissao (bruto - imposto)', formatarMoeda(p.baseCalculoComissao)) : '',
      linha('Media de consumo', p.mediaConsumoKmL ? `${p.mediaConsumoKmL.toFixed(2)} km/l` : '-'),
      linha('% comissao sugerido', p.percentualSugerido !== null ? `${p.percentualSugerido}%` : '-'),
      linha('Valor da comissao', formatarMoeda(p.valorComissao)),
      linha('Adiantamentos tomados', formatarMoeda(p.adiantamentosTotal)),
      linha('Desconto sugerido (despesas do motorista)', formatarMoeda(p.valorDescontosSugerido)),
      linha('Saldo conta corrente anterior', formatarMoeda(p.saldoContaCorrenteAnterior)),
      '<hr class="my-2 border-slate-200" />',
      linha('Saldo final', `${formatarMoeda(Math.abs(p.saldoFinal))} ${p.saldoFinal >= 0 ? '(a pagar)' : '(fica em conta corrente)'}`, true),
    ].join('');
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
  attachMoedaMask(form.reembolsos, inicial.valorReembolsos || 0);
  setMoedaValue(form.descontos, inicial.valorDescontosSugerido || 0);
  attachMoedaMask(form.descontos, inicial.valorDescontosSugerido || 0);

  form.addEventListener('input', () => {
    clearTimeout(debounceId);
    debounceId = setTimeout(() => buscarPreview(true), 300);
  });

  const btnFechar = container.querySelector('[data-fechar]');
  if (btnFechar) {
    btnFechar.addEventListener('click', async () => {
      erroEl.classList.add('hidden');
      btnFechar.disabled = true;
      try {
        const acerto = await post(`/acertos/viagem/${viagem.id}/fechar`, {
          percentual_comissao_aplicado: form.percentual.value !== '' ? Number(form.percentual.value) : undefined,
          valor_reembolsos: getMoedaValue(form.reembolsos),
          valor_descontos: getMoedaValue(form.descontos),
          observacoes_ajustes: form.observacoes.value || null,
        });
        mostrarToast('Acerto fechado com sucesso.');
        renderFechado(container, { ...viagem, status: 'Finalizada' }, motorista, acerto, gerenciar);
      } catch (err) {
        erroEl.textContent = err.message;
        erroEl.classList.remove('hidden');
      } finally {
        btnFechar.disabled = false;
      }
    });
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
    <div class="card max-w-xl p-4" data-resumo></div>
    <div class="card mt-6 max-w-xl p-4" data-ocorrencias></div>
  `;
  container.querySelector('[data-ocorrencias]').appendChild(
    criarOcorrencias({ entidadeTipo: 'AcertoViagem', entidadeId: viagem.id, podeGerenciar: gerenciar }).el,
  );
  const freteBrutoTotal = (viagem.fretes || []).reduce((t, f) => t + f.frete_bruto, 0);
  const baseCalculoComissao = freteBrutoTotal - (acerto.valor_imposto || 0);
  container.querySelector('[data-resumo]').innerHTML = [
    linha('Frete bruto total', formatarMoeda(freteBrutoTotal)),
    acerto.valor_imposto > 0 ? linha(`Imposto (${acerto.percentual_imposto_aplicado}%)`, `- ${formatarMoeda(acerto.valor_imposto)}`) : '',
    acerto.valor_imposto > 0 ? linha('Base de calculo da comissao (bruto - imposto)', formatarMoeda(baseCalculoComissao)) : '',
    linha('Comissao aplicada', `${acerto.percentual_comissao_aplicado}% = ${formatarMoeda(acerto.valor_comissao)}`),
    linha('Reembolsos', formatarMoeda(acerto.valor_reembolsos)),
    linha('Adiantamentos', formatarMoeda(acerto.valor_adiantamentos)),
    linha('Descontos', formatarMoeda(acerto.valor_descontos)),
    linha('Saldo conta corrente anterior', formatarMoeda(acerto.saldo_conta_corrente_anterior)),
    '<hr class="my-2 border-slate-200" />',
    linha('Saldo final', `${formatarMoeda(Math.abs(acerto.saldo_final))} ${acerto.saldo_final >= 0 ? '(a pagar)' : '(fica em conta corrente)'}`, true),
    acerto.observacoes_ajustes ? `<p class="mt-3 text-sm text-slate-500">Obs.: ${acerto.observacoes_ajustes}</p>` : '',
  ].join('');

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
  container.innerHTML = '<p class="text-slate-400">Carregando...</p>';
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
