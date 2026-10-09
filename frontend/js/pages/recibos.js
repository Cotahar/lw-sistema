import { get, getUsuario } from '../api.js';
import { formatarMoeda, formatarDataBr, formatarCpfCnpj, hojeIsoLocal } from '../masks.js';
import { navegar } from '../router.js';
import { esqueletoPagina } from '../components/skeleton.js';

// RECIBOS de valores pagos ao motorista (adiantamentos da viagem e saldo do acerto), para
// impressao e assinatura. Usa a paleta zinc (nao remapeada) porque e uma pagina impressa em
// fundo branco - mesmo motivo do relatorio do acerto (ver acertoRelatorio.js).

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// "7 de outubro de 2026" (o mes em portugues, sem depender do locale do navegador).
function dataPorExtenso(iso) {
  const [ano, mes, dia] = String(iso || hojeIsoLocal()).split(' ')[0].split('-');
  return `${Number(dia)} de ${MESES[Number(mes) - 1]} de ${ano}`;
}

const TITULO_POR_TIPO = { Adiantamento: 'Recibo de Adiantamento de Viagem', Acerto: 'Recibo de Pagamento de Acerto' };

// Um recibo (bloco impresso). Duas linhas de assinatura: motorista (quem recebe) e empresa
// (quem entrega o valor).
export function htmlRecibo(dados, recibo) {
  const { empresa, motorista } = dados;
  const local = empresa.endereco_cidade ? `${esc(empresa.endereco_cidade)}${empresa.endereco_uf ? `/${esc(empresa.endereco_uf)}` : ''}, ` : '';
  const discriminacao = recibo.discriminacao && recibo.discriminacao.length ? `
    <div class="mt-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600">
      ${recibo.discriminacao.map((l) => `<div class="flex justify-between py-0.5"><span>${l.sinal === '-' ? '(-)' : '(+)'} ${esc(l.rotulo)}</span><span>${formatarMoeda(l.valor)}</span></div>`).join('')}
      <div class="flex justify-between border-t border-zinc-300 pt-0.5 font-semibold text-zinc-800"><span>Valor liquido recebido</span><span>${formatarMoeda(recibo.valor)}</span></div>
    </div>
  ` : '';
  return `
    <section class="recibo mb-6 rounded-lg border-2 border-zinc-800 bg-white p-5 text-zinc-900">
      <div class="flex items-start justify-between gap-4 border-b border-zinc-300 pb-2">
        <div>
          <h2 class="text-base font-extrabold uppercase tracking-wide">${TITULO_POR_TIPO[recibo.tipo] || 'Recibo'}</h2>
          <p class="text-xs text-zinc-500">${esc(empresa.razao_social)} &middot; CNPJ ${formatarCpfCnpj(empresa.cnpj)}</p>
        </div>
        <div class="text-right">
          <p class="text-xs font-semibold uppercase text-zinc-500">N&ordm;</p>
          <p class="text-base font-bold">${esc(recibo.numero)}</p>
        </div>
      </div>
      <p class="mt-3 text-2xl font-extrabold">${formatarMoeda(recibo.valor)}</p>
      <p class="mt-2 text-sm leading-relaxed text-zinc-800">
        Recebi de <strong>${esc(empresa.razao_social)}</strong> a import&acirc;ncia de <strong>${formatarMoeda(recibo.valor)}</strong>
        (<em>${esc(recibo.valor_extenso)}</em>), referente a <strong>${esc(recibo.referente)}</strong>.
      </p>
      <p class="mt-1 text-xs text-zinc-500">Forma de pagamento: ${esc(recibo.forma_pagamento)}</p>
      ${discriminacao}
      <p class="mt-3 text-sm text-zinc-800">Motorista: <strong>${esc(motorista.nome)}</strong> &middot; CPF ${formatarCpfCnpj(motorista.cpf)}</p>
      <p class="mt-3 text-sm text-zinc-700">${local}${dataPorExtenso(recibo.data)}.</p>
      <div class="mt-9 grid grid-cols-2 gap-10 text-center text-xs text-zinc-600">
        <div><div class="border-t border-zinc-700 pt-1">${esc(motorista.nome)}<br />Assinatura do motorista (recebedor)</div></div>
        <div><div class="border-t border-zinc-700 pt-1">${esc(empresa.razao_social)}<br />Assinatura de quem entregou o valor</div></div>
      </div>
    </section>
  `;
}

// Quadro-resumo dos adiantamentos (lista de conferencia no topo da impressao com varios recibos).
function htmlResumoAdiantamentos(dados) {
  const adiantamentos = dados.recibos.filter((r) => r.tipo === 'Adiantamento');
  if (adiantamentos.length < 2) return '';
  return `
    <section class="mb-6 rounded-lg border border-zinc-300 p-4 text-zinc-900">
      <h2 class="mb-2 text-sm font-bold uppercase tracking-wide">Adiantamentos da viagem #${dados.viagem.id} &middot; ${esc(dados.motorista.nome)}</h2>
      <table class="w-full border-collapse text-xs">
        <thead><tr class="bg-zinc-100 text-left uppercase text-zinc-600"><th class="whitespace-nowrap px-2 py-1">Recibo</th><th class="px-2 py-1">Data</th><th class="px-2 py-1">Descricao</th><th class="px-2 py-1">Forma</th><th class="px-2 py-1 text-right">Valor</th></tr></thead>
        <tbody>
          ${adiantamentos.map((r) => `<tr class="border-b border-zinc-100"><td class="whitespace-nowrap px-2 py-1">${esc(r.numero)}</td><td class="px-2 py-1">${formatarDataBr(r.data)}</td><td class="px-2 py-1">${esc(r.referente)}</td><td class="px-2 py-1">${esc(r.forma_pagamento)}</td><td class="px-2 py-1 text-right font-medium">${formatarMoeda(r.valor)}</td></tr>`).join('')}
          <tr class="bg-zinc-100 font-bold"><td colspan="4" class="px-2 py-1 text-right">Total de adiantamentos (${dados.qtdAdiantamentos})</td><td class="px-2 py-1 text-right">${formatarMoeda(dados.totalAdiantamentos)}</td></tr>
        </tbody>
      </table>
      <p class="mt-2 text-[11px] text-zinc-500">Cada adiantamento tem o proprio recibo abaixo: o motorista assina todos no acerto, comprovando o recebimento do dinheiro.</p>
    </section>
  `;
}

// Todos os recibos de uma viagem (resumo + um bloco por recibo). Reaproveitado pelo
// relatorio do acerto ("com recibos").
export function htmlRecibosDaViagem(dados) {
  if (!dados.recibos.length) return '<p class="rounded-lg border border-zinc-200 p-4 text-center text-sm text-zinc-500">Nenhum recibo a emitir para esta viagem (nenhum adiantamento lancado e acerto sem saldo a pagar).</p>';
  return `${htmlResumoAdiantamentos(dados)}${dados.recibos.map((r) => htmlRecibo(dados, r)).join('')}`;
}

export const ESTILO_IMPRESSAO_RECIBOS = `
  <style>
    @media print {
      .pagina-recibos, .pagina-recibos * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .recibo { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
`;

// Pagina de impressao: /viagens/:viagemId/recibos?adiantamento=ID | ?tipo=adiantamentos|acerto
export async function renderRecibos(root, params, query) {
  if (!localStorage.getItem('frotista_token')) {
    navegar('/login');
    return;
  }
  const viagemId = params.viagemId;
  root.innerHTML = `<div class="p-8">${esqueletoPagina()}</div>`;
  const qs = new URLSearchParams();
  if (query.adiantamento) qs.set('adiantamento_id', query.adiantamento);
  if (query.tipo) qs.set('tipo', query.tipo);
  let dados;
  try {
    dados = await get(`/recibos/viagem/${viagemId}${qs.toString() ? `?${qs}` : ''}`);
  } catch (err) {
    root.innerHTML = `<div class="p-8 text-center text-sm text-red-600">${esc(err.message)}</div>`;
    return;
  }
  const usuario = getUsuario();
  root.innerHTML = `
    ${ESTILO_IMPRESSAO_RECIBOS}
    <div class="pagina-recibos mx-auto max-w-3xl p-6 print:max-w-none print:p-0">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" class="btn-secondary btn-sm" data-voltar>&larr; Voltar</button>
        <button type="button" class="btn-primary btn-sm" data-imprimir>Imprimir / Salvar PDF</button>
      </div>
      <div class="rounded-xl border border-zinc-200 bg-white p-6 text-zinc-900 print:border-0 print:p-0">
        <div class="mb-4 flex items-end justify-between border-b-4 border-brand-yellow pb-2 print:hidden">
          <h1 class="text-lg font-extrabold">Recibos &middot; Viagem #${dados.viagem.id}</h1>
          <p class="text-xs text-zinc-500">Gerado em ${formatarDataBr(hojeIsoLocal())}${usuario ? ` por ${esc(usuario.nome)}` : ''}</p>
        </div>
        ${htmlRecibosDaViagem(dados)}
      </div>
    </div>
  `;
  root.querySelector('[data-voltar]').addEventListener('click', () => {
    // Aberta em outra aba (window.open): fecha; senao volta para a viagem.
    if (window.history.length <= 1) window.close();
    else navegar(`/viagens/${viagemId}`);
  });
  root.querySelector('[data-imprimir]').addEventListener('click', () => window.print());
}
