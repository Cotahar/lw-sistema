import { get, getUsuario } from '../api.js';
import { formatarMoeda, formatarDataBr, formatarPeso, hojeIsoLocal } from '../masks.js';
import { navegar } from '../router.js';

const STATUS_LABEL = { EmAndamento: 'Em Andamento', AguardandoAcerto: 'Aguardando Acerto', Finalizada: 'Finalizada' };

function linha(label, valor, destaque = false) {
  return `<div class="flex items-center justify-between py-1.5 ${destaque ? 'text-base font-semibold text-slate-900' : 'text-sm text-slate-600'}"><span>${label}</span><span>${valor}</span></div>`;
}

export async function renderRelatorio(root, params, query) {
  if (!localStorage.getItem('frotista_token')) {
    navegar('/login');
    return;
  }
  const viagemId = params.viagemId;
  const tipo = query.tipo === 'detalhado' ? 'detalhado' : 'resumido';
  root.innerHTML = '<p class="p-8 text-slate-400">Carregando...</p>';

  const [viagem, motoristas, categorias, fornecedores, todosAcertos] = await Promise.all([
    get(`/viagens/${viagemId}`),
    get('/motoristas'),
    get('/categorias-despesa'),
    get('/fornecedores'),
    get('/acertos'),
  ]);
  const motorista = motoristas.find((m) => m.id === viagem.motorista_id);
  const conjunto = await get(`/conjuntos/${viagem.conjunto_id}`);
  const [despesas, adiantamentos] = await Promise.all([
    get(`/viagens/${viagemId}/despesas`),
    get(`/viagens/${viagemId}/adiantamentos`),
  ]);
  const acerto = todosAcertos.find((a) => a.viagem_id === Number(viagemId));
  const nomeCategoria = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
  const nomeFornecedor = Object.fromEntries(fornecedores.map((f) => [f.id, f.nome]));

  const fretes = viagem.fretes || [];
  const freteBrutoTotal = fretes.reduce((t, f) => t + f.frete_bruto, 0);
  const totalDespesas = despesas.reduce((t, d) => t + d.valor, 0);
  const totalAdiantamentos = adiantamentos.reduce((t, a) => t + a.valor, 0);
  const kmRodado = viagem.km_final ? viagem.km_final - viagem.km_inicial : null;
  const usuario = getUsuario();

  root.innerHTML = `
    <div class="mx-auto max-w-3xl p-6 print:max-w-none print:p-0">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" class="btn-secondary btn-sm" data-voltar>&larr; Voltar para o acerto</button>
        <div class="flex flex-wrap gap-2">
          <a href="#/acertos/${viagemId}/relatorio?tipo=resumido" class="btn-sm ${tipo === 'resumido' ? 'btn-primary' : 'btn-secondary'}">Resumido</a>
          <a href="#/acertos/${viagemId}/relatorio?tipo=detalhado" class="btn-sm ${tipo === 'detalhado' ? 'btn-primary' : 'btn-secondary'}">Detalhado</a>
          <button type="button" class="btn-primary btn-sm" data-imprimir>Imprimir / Salvar PDF</button>
        </div>
      </div>

      <div class="rounded-xl border border-slate-200 bg-white p-8 print:border-0 print:p-0">
        <div class="mb-6 border-b border-slate-200 pb-4">
          <h1 class="text-xl font-bold text-slate-900">Relatorio de Acerto - Viagem #${viagem.id}</h1>
          <p class="text-sm text-slate-500">${tipo === 'detalhado' ? 'Detalhado' : 'Resumido'} &middot; Gerado em ${formatarDataBr(hojeIsoLocal())}${usuario ? ` por ${usuario.nome}` : ''}</p>
        </div>

        <div class="mb-6 grid grid-cols-2 gap-3 text-sm">
          <p><span class="font-medium">Motorista:</span> ${motorista ? motorista.nome : '-'}</p>
          <p><span class="font-medium">Composicao:</span> ${conjunto.itens.map((i) => i.placa).join(' + ')}</p>
          <p><span class="font-medium">Periodo:</span> ${formatarDataBr(viagem.data_inicio)}${viagem.data_fim ? ` a ${formatarDataBr(viagem.data_fim)}` : ' (em andamento)'}</p>
          <p><span class="font-medium">KM rodado:</span> ${kmRodado !== null ? `${kmRodado.toLocaleString('pt-BR')} km` : '-'}</p>
          <p><span class="font-medium">Status:</span> ${STATUS_LABEL[viagem.status]}</p>
        </div>

        ${tipo === 'detalhado' ? `
          <h2 class="mb-2 mt-6 font-semibold text-slate-900">Fretes</h2>
          <table class="mb-4 w-full text-sm">
            <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th class="py-1">Transportadora</th><th class="py-1">Rota</th><th class="py-1">Peso</th><th class="py-1 text-right">Frete Bruto</th>
            </tr></thead>
            <tbody>
              ${fretes.map((f) => `
                <tr class="border-b border-slate-100">
                  <td class="py-1">${f.transportadora_id ? nomeFornecedor[f.transportadora_id] || '-' : '-'}</td>
                  <td class="py-1">${f.origem_cidade}/${f.origem_uf} &rarr; ${f.destino_cidade}/${f.destino_uf}</td>
                  <td class="py-1">${f.peso_carga_kg ? formatarPeso(f.peso_carga_kg) : '-'}</td>
                  <td class="py-1 text-right">${formatarMoeda(f.frete_bruto)}</td>
                </tr>
              `).join('') || '<tr><td colspan="4" class="py-2 text-center text-slate-400">Nenhum frete.</td></tr>'}
            </tbody>
          </table>

          <h2 class="mb-2 mt-6 font-semibold text-slate-900">Despesas por categoria</h2>
          ${(() => {
            const porCategoria = new Map();
            for (const d of despesas) {
              const catId = d.categoria_id;
              if (!porCategoria.has(catId)) porCategoria.set(catId, []);
              porCategoria.get(catId).push(d);
            }
            const categoriasOrdenadas = [...porCategoria.keys()].sort((a, b) => (nomeCategoria[a] || '').localeCompare(nomeCategoria[b] || ''));
            if (!categoriasOrdenadas.length) return '<p class="mb-4 text-sm text-slate-400">Nenhuma despesa.</p>';
            return categoriasOrdenadas.map((catId) => {
              const itens = porCategoria.get(catId);
              const subtotal = itens.reduce((t, d) => t + d.valor, 0);
              return `
                <h3 class="mb-1 mt-3 text-sm font-semibold text-slate-700">${nomeCategoria[catId] || '-'}</h3>
                <table class="mb-3 w-full text-sm">
                  <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th class="py-1">Data</th><th class="py-1">Pago por</th><th class="py-1 text-right">Valor</th>
                  </tr></thead>
                  <tbody>
                    ${itens.map((d) => `
                      <tr class="border-b border-slate-100">
                        <td class="py-1">${formatarDataBr(d.data)}</td>
                        <td class="py-1">${d.pago_por}</td>
                        <td class="py-1 text-right">${formatarMoeda(d.valor)}</td>
                      </tr>
                    `).join('')}
                    <tr class="font-medium"><td colspan="2" class="py-1 text-right">Subtotal ${nomeCategoria[catId] || ''}</td><td class="py-1 text-right">${formatarMoeda(subtotal)}</td></tr>
                  </tbody>
                </table>
              `;
            }).join('');
          })()}
          <div class="mb-4 flex items-center justify-between border-t border-slate-300 pt-2 text-sm font-semibold text-slate-900">
            <span>Total geral de despesas</span><span>${formatarMoeda(totalDespesas)}</span>
          </div>

          <h2 class="mb-2 mt-6 font-semibold text-slate-900">Adiantamentos ao motorista</h2>
          <table class="mb-4 w-full text-sm">
            <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th class="py-1">Data</th><th class="py-1">Descricao</th><th class="py-1 text-right">Valor</th>
            </tr></thead>
            <tbody>
              ${adiantamentos.map((a) => `
                <tr class="border-b border-slate-100">
                  <td class="py-1">${formatarDataBr(a.data)}</td>
                  <td class="py-1">${a.descricao || '-'}${a.conta_bancaria_id ? '' : ' (sem caixa)'}</td>
                  <td class="py-1 text-right">${formatarMoeda(a.valor)}</td>
                </tr>
              `).join('') || '<tr><td colspan="3" class="py-2 text-center text-slate-400">Nenhum adiantamento.</td></tr>'}
              <tr class="font-medium"><td colspan="2" class="py-1 text-right">Total de adiantamentos</td><td class="py-1 text-right">${formatarMoeda(totalAdiantamentos)}</td></tr>
            </tbody>
          </table>

          <h2 class="mb-2 mt-6 font-semibold text-slate-900">Valores medios</h2>
          <div class="mb-4 grid grid-cols-2 gap-2 text-sm">
            ${linha('Media de consumo', acerto && acerto.media_consumo_km_l ? `${acerto.media_consumo_km_l.toFixed(2)} km/l` : '-')}
            ${linha('Valor medio por frete', fretes.length ? formatarMoeda(Math.round(freteBrutoTotal / fretes.length)) : '-')}
            ${linha('Custo por KM (despesas)', kmRodado ? formatarMoeda(Math.round(totalDespesas / kmRodado)) : '-')}
          </div>
        ` : ''}

        <h2 class="mb-2 mt-6 font-semibold text-slate-900">Resumo financeiro</h2>
        <div class="rounded-lg bg-slate-50 p-4">
          ${linha('Frete bruto total', formatarMoeda(freteBrutoTotal))}
          ${acerto ? linha(`Comissao (${acerto.percentual_comissao_aplicado}%)`, formatarMoeda(acerto.valor_comissao)) : ''}
          ${acerto && acerto.valor_imposto > 0 ? linha(`Imposto (${acerto.percentual_imposto_aplicado}%) - nao afeta o motorista`, formatarMoeda(acerto.valor_imposto)) : ''}
          ${acerto && acerto.valor_reembolsos > 0 ? linha('Reembolsos', formatarMoeda(acerto.valor_reembolsos)) : ''}
          ${acerto ? linha('Adiantamentos tomados', formatarMoeda(acerto.valor_adiantamentos)) : linha('Adiantamentos tomados', formatarMoeda(totalAdiantamentos))}
          ${acerto && acerto.valor_descontos > 0 ? linha('Descontos', formatarMoeda(acerto.valor_descontos)) : ''}
          ${acerto && acerto.saldo_conta_corrente_anterior > 0 ? linha('Saldo conta corrente anterior', formatarMoeda(acerto.saldo_conta_corrente_anterior)) : ''}
          <hr class="my-2 border-slate-200" />
          ${acerto
            ? linha('Saldo final', `${formatarMoeda(Math.abs(acerto.saldo_final))} ${acerto.saldo_final >= 0 ? '(a pagar ao motorista)' : '(fica em conta corrente)'}`, true)
            : '<p class="text-sm text-slate-400">Acerto ainda nao fechado - valores sujeitos a alteracao.</p>'}
        </div>
        ${acerto && acerto.observacoes_ajustes ? `<p class="mt-3 text-sm text-slate-500">Obs.: ${acerto.observacoes_ajustes}</p>` : ''}
      </div>
    </div>
  `;

  root.querySelector('[data-voltar]').addEventListener('click', () => navegar(`/acertos/${viagemId}`));
  root.querySelector('[data-imprimir]').addEventListener('click', () => window.print());
}
