import { get, put } from '../api.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, setMoedaValue } from '../masks.js';

// Calculadora de frete - replica a planilha "Calculo de frete.xlsx" ja usada
// pela empresa. E uma ferramenta de apoio (nao persiste nada no banco, so
// calcula na hora) - ver PROMPT_NOVA_SESSAO.md/pedido original pra formula.
//
// Frete total = Peso x Valor/tonelada, MAS pode ser digitado direto (o
// usuario as vezes so sabe o total combinado, nao peso/valor separados) -
// nesse caso ele "trava" e para de recalcular a partir de peso/valor ate
// que peso ou valor sejam editados de novo.
// Litros = Quilometragem / Media (km/l).
// Diesel (gasto) = Litros x Valor do diesel.
// Comissao = Frete total x Comissao%.
// Total despesas = Pedagio + Descarga + Diesel + Comissao.
// Resultado = Frete total - Total despesas (e % = Resultado / Frete total).

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Calculo de Frete</h1>
    <p class="mb-4 text-sm text-slate-500">Ferramenta de apoio para simular o resultado de um frete - nao lanca nada no sistema.</p>
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <form class="card space-y-4 p-4" data-form>
        <h2 class="font-semibold text-slate-900">Frete</h2>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">Peso (toneladas)</label><input type="number" step="0.01" name="peso" class="input" /></div>
          <div><label class="label">Valor por tonelada</label><input type="text" name="valor_tonelada" class="input" /></div>
        </div>
        <div><label class="label">Frete total</label><input type="text" name="frete_total" class="input font-semibold" /></div>

        <h2 class="pt-2 font-semibold text-slate-900">Diesel</h2>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">Valor medio do diesel (R$/L)</label><input type="text" name="valor_diesel" class="input" /></div>
          <div><label class="label">Media (km/l)</label><input type="number" step="0.01" name="media" class="input" /></div>
        </div>
        <div><label class="label">Quilometragem (km)</label><input type="number" step="1" name="km" class="input" /></div>
        <div><label class="label">Litros de diesel (automatico)</label><input type="text" class="input bg-slate-50" data-litros readonly /></div>

        <h2 class="pt-2 font-semibold text-slate-900">Despesas</h2>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">Pedagio</label><input type="text" name="pedagio" class="input" /></div>
          <div><label class="label">Descarga</label><input type="text" name="descarga" class="input" /></div>
        </div>
        <div><label class="label">Comissao do motorista (%)</label><input type="number" step="0.01" name="comissao_pct" class="input max-w-[8rem]" value="12" /></div>
      </form>

      <div class="card h-fit space-y-2 p-4">
        <h2 class="mb-2 font-semibold text-slate-900">Resultado</h2>
        <div class="flex items-center justify-between py-1 text-sm text-slate-600"><span>Frete total</span><span data-out-frete>R$ 0,00</span></div>
        <div class="flex items-center justify-between py-1 text-sm text-slate-600"><span>Diesel (litros x valor)</span><span data-out-diesel>R$ 0,00</span></div>
        <div class="flex items-center justify-between py-1 text-sm text-slate-600"><span>Pedagio</span><span data-out-pedagio>R$ 0,00</span></div>
        <div class="flex items-center justify-between py-1 text-sm text-slate-600"><span>Descarga</span><span data-out-descarga>R$ 0,00</span></div>
        <div class="flex items-center justify-between py-1 text-sm text-slate-600"><span data-out-comissao-label>Comissao (12%)</span><span data-out-comissao>R$ 0,00</span></div>
        <hr class="my-2 border-slate-200" />
        <div class="flex items-center justify-between py-1 text-sm font-medium text-slate-900"><span>Total despesas</span><span data-out-despesas>R$ 0,00</span></div>
        <hr class="my-2 border-slate-200" />
        <div class="flex items-center justify-between py-2 text-lg font-bold" data-out-resultado-linha><span>Resultado do frete</span><span data-out-resultado>R$ 0,00</span></div>
        <div class="flex items-center justify-between py-1 text-sm text-slate-500"><span>Margem</span><span data-out-percentual>0%</span></div>
        <div class="hidden mt-2 border-t border-dashed border-slate-200 pt-2" data-bloco-imposto>
          <p class="text-xs text-slate-400" data-imposto-legenda></p>
          <div class="flex items-center justify-between py-0.5 text-xs text-slate-500"><span>Resultado considerando imposto</span><span data-out-resultado-imposto>R$ 0,00</span></div>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('[data-form]');
  const camposMoeda = ['valor_tonelada', 'frete_total', 'valor_diesel', 'pedagio', 'descarga'];
  for (const nome of camposMoeda) attachMoedaMask(form.elements[nome], 0);

  let freteTotalTravado = false; // true quando o usuario digita o total direto, ao inves de peso x valor/ton
  let empresaImposto = null; // { razao_social, percentual_desconto_geral }

  function recalcular() {
    const peso = Number(form.peso.value) || 0;
    const valorTonelada = getMoedaValue(form.valor_tonelada);
    if (!freteTotalTravado) {
      setMoedaValue(form.frete_total, Math.round(peso * valorTonelada));
    }
    const freteTotal = getMoedaValue(form.frete_total);

    const km = Number(form.km.value) || 0;
    const media = Number(form.media.value) || 0;
    const litros = media > 0 ? km / media : 0;
    container.querySelector('[data-litros]').value = litros ? `${litros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L` : '-';

    const valorDiesel = getMoedaValue(form.valor_diesel);
    const dieselGasto = Math.round(litros * valorDiesel);

    const pedagio = getMoedaValue(form.pedagio);
    const descarga = getMoedaValue(form.descarga);
    const comissaoPct = Number(form.comissao_pct.value) || 0;
    const comissao = Math.round(freteTotal * (comissaoPct / 100));

    const totalDespesas = pedagio + descarga + dieselGasto + comissao;
    const resultado = freteTotal - totalDespesas;
    const percentual = freteTotal > 0 ? (resultado / freteTotal) * 100 : 0;

    container.querySelector('[data-out-frete]').textContent = formatarMoeda(freteTotal);
    container.querySelector('[data-out-diesel]').textContent = formatarMoeda(dieselGasto);
    container.querySelector('[data-out-pedagio]').textContent = formatarMoeda(pedagio);
    container.querySelector('[data-out-descarga]').textContent = formatarMoeda(descarga);
    container.querySelector('[data-out-comissao-label]').textContent = `Comissao (${comissaoPct}%)`;
    container.querySelector('[data-out-comissao]').textContent = formatarMoeda(comissao);
    container.querySelector('[data-out-despesas]').textContent = formatarMoeda(totalDespesas);
    const resultadoEl = container.querySelector('[data-out-resultado]');
    resultadoEl.textContent = formatarMoeda(resultado);
    resultadoEl.className = resultado >= 0 ? 'text-emerald-600' : 'text-red-600';
    container.querySelector('[data-out-percentual]').textContent = `${percentual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

    // Mesma regra do Acerto: imposto reduz a base da comissao do motorista e
    // tambem e um custo a parte pra empresa - so exibido se a empresa ativa
    // tiver % de imposto cadastrado.
    const blocoImposto = container.querySelector('[data-bloco-imposto]');
    if (empresaImposto && empresaImposto.percentual_desconto_geral > 0 && freteTotal > 0) {
      const pctImposto = empresaImposto.percentual_desconto_geral;
      const valorImposto = Math.round(freteTotal * (pctImposto / 100));
      const baseComissao = freteTotal - valorImposto;
      const comissaoComImposto = Math.round(baseComissao * (comissaoPct / 100));
      const resultadoComImposto = freteTotal - pedagio - descarga - dieselGasto - comissaoComImposto - valorImposto;
      container.querySelector('[data-imposto-legenda]').textContent = `Com imposto de ${pctImposto}% (${empresaImposto.razao_social}) descontado do bruto antes da comissao:`;
      container.querySelector('[data-out-resultado-imposto]').textContent = formatarMoeda(resultadoComImposto);
      blocoImposto.classList.remove('hidden');
    } else {
      blocoImposto.classList.add('hidden');
    }

    salvarPreferenciasDebounced();
  }

  let salvarTimeoutId = null;
  function salvarPreferenciasDebounced() {
    clearTimeout(salvarTimeoutId);
    salvarTimeoutId = setTimeout(() => {
      put('/calculo-frete', {
        peso: Number(form.peso.value) || null,
        valor_tonelada: getMoedaValue(form.valor_tonelada) || null,
        frete_total: getMoedaValue(form.frete_total) || null,
        valor_diesel: getMoedaValue(form.valor_diesel) || null,
        media: Number(form.media.value) || null,
        km: Number(form.km.value) || null,
        pedagio: getMoedaValue(form.pedagio) || null,
        descarga: getMoedaValue(form.descarga) || null,
        comissao_pct: Number(form.comissao_pct.value) || null,
      }).catch(() => {});
    }, 500);
  }

  form.addEventListener('submit', (ev) => ev.preventDefault());
  form.peso.addEventListener('input', () => { freteTotalTravado = false; recalcular(); });
  form.valor_tonelada.addEventListener('input', () => { freteTotalTravado = false; recalcular(); });
  form.frete_total.addEventListener('input', () => { freteTotalTravado = true; recalcular(); });
  for (const nome of ['valor_diesel', 'media', 'km', 'pedagio', 'descarga', 'comissao_pct']) {
    form.elements[nome].addEventListener('input', recalcular);
  }

  const [prefs, imposto] = await Promise.all([
    get('/calculo-frete').catch(() => null),
    get('/empresas/ativa/imposto').catch(() => null),
  ]);
  empresaImposto = imposto;

  if (prefs) {
    if (prefs.peso !== null) form.peso.value = prefs.peso;
    if (prefs.valor_tonelada !== null) setMoedaValue(form.valor_tonelada, prefs.valor_tonelada);
    if (prefs.frete_total !== null) { setMoedaValue(form.frete_total, prefs.frete_total); freteTotalTravado = true; }
    if (prefs.valor_diesel !== null) setMoedaValue(form.valor_diesel, prefs.valor_diesel);
    if (prefs.media !== null) form.media.value = prefs.media;
    if (prefs.km !== null) form.km.value = prefs.km;
    if (prefs.pedagio !== null) setMoedaValue(form.pedagio, prefs.pedagio);
    if (prefs.descarga !== null) setMoedaValue(form.descarga, prefs.descarga);
    if (prefs.comissao_pct !== null) form.comissao_pct.value = prefs.comissao_pct;
  }

  recalcular();
}
