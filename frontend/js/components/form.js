import { attachMoedaMask, getMoedaValue, setMoedaValue, attachPesoMask, getPesoValue, attachDataMask, parseDataBrParaIso, attachCpfCnpjMask, apenasDigitos, validarCpfOuCnpj } from '../masks.js';
import { criarSearchableSelect } from './searchableSelect.js';

// Mensagem de erro pro campo `campo` a partir do valor atual de `el`, ou null
// se estiver valido - usada tanto no blur (feedback cedo) quanto no submit.
function validarCampo(campo, el) {
  const vazio = el.value === '' || el.value === undefined;
  if (campo.obrigatorio && vazio) return `Preencha o campo "${campo.label}".`;
  if (vazio) return null;
  if (campo.tipo === 'data' && !parseDataBrParaIso(el.value)) return `Data invalida em "${campo.label}".`;
  if (campo.tipo === 'cpf_cnpj' && !validarCpfOuCnpj(apenasDigitos(el.value))) return `CPF/CNPJ invalido em "${campo.label}".`;
  return null;
}

// Construtor generico de formulario para os modais de cadastro simples.
// campo: { nome, label, tipo, obrigatorio, opcoes (select), buscar (searchable),
//          labelInicialFn (searchable: extrai o rotulo do valor inicial) }
export function criarFormulario({ campos, valoresIniciais = {}, aoSalvar, textoSalvar = 'Salvar' }) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  const searchables = {};

  for (const campo of campos) {
    const bloco = document.createElement('div');
    if (campo.tipo === 'checkbox') {
      bloco.className = 'flex items-center gap-2';
      bloco.innerHTML = `
        <input type="checkbox" id="campo-${campo.nome}" class="h-4 w-4 rounded border-slate-300" ${valoresIniciais[campo.nome] ? 'checked' : ''} />
        <label for="campo-${campo.nome}" class="text-sm text-slate-700">${campo.label}</label>
      `;
      form.appendChild(bloco);
      continue;
    }

    const label = document.createElement('label');
    label.className = 'label';
    label.textContent = campo.label + (campo.obrigatorio ? ' *' : '');
    bloco.appendChild(label);

    if (campo.tipo === 'select') {
      const select = document.createElement('select');
      select.className = 'input';
      select.name = campo.nome;
      select.required = Boolean(campo.obrigatorio);
      if (!campo.obrigatorio) select.appendChild(new Option('-- nao informado --', ''));
      for (const opcao of campo.opcoes || []) select.appendChild(new Option(opcao.label, opcao.value));
      if (valoresIniciais[campo.nome] !== undefined) select.value = valoresIniciais[campo.nome];
      bloco.appendChild(select);
    } else if (campo.tipo === 'searchable') {
      const instancia = criarSearchableSelect({
        buscar: campo.buscar,
        placeholder: campo.placeholder || 'Pesquisar...',
        valorInicial: valoresIniciais[campo.nome] ?? null,
        labelInicial: campo.labelInicial || '',
      });
      searchables[campo.nome] = instancia;
      bloco.appendChild(instancia.el);
    } else if (campo.tipo === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.className = 'input';
      textarea.name = campo.nome;
      textarea.rows = 3;
      textarea.value = valoresIniciais[campo.nome] ?? '';
      bloco.appendChild(textarea);
    } else {
      const input = document.createElement('input');
      input.className = 'input';
      input.name = campo.nome;
      input.type = 'text';
      if (campo.tipo === 'numero') input.type = 'number';
      bloco.appendChild(input);

      if (campo.tipo === 'moeda') setMoedaValue(input, valoresIniciais[campo.nome] || 0), attachMoedaMask(input, valoresIniciais[campo.nome] || 0);
      else if (campo.tipo === 'peso') attachPesoMask(input, valoresIniciais[campo.nome]);
      else if (campo.tipo === 'data') attachDataMask(input, valoresIniciais[campo.nome]);
      else if (campo.tipo === 'cpf_cnpj') attachCpfCnpjMask(input, valoresIniciais[campo.nome]);
      else input.value = valoresIniciais[campo.nome] ?? '';

      // Validacao no blur: feedback assim que o usuario sai do campo, em vez
      // de descobrir um erro so depois de preencher o formulario inteiro e
      // tentar salvar. Data/CPF-CNPJ so validam formato/digito verificador -
      // regras de negocio (ex.: duplicidade) continuam so no submit.
      if (['data', 'cpf_cnpj'].includes(campo.tipo) || campo.obrigatorio) {
        const erroCampo = document.createElement('p');
        erroCampo.className = 'mt-1 hidden text-xs text-red-500';
        bloco.appendChild(erroCampo);
        input.addEventListener('blur', () => {
          const msg = validarCampo(campo, input);
          input.classList.toggle('border-red-500', Boolean(msg));
          erroCampo.textContent = msg || '';
          erroCampo.classList.toggle('hidden', !msg);
        });
        input.addEventListener('input', () => {
          if (!erroCampo.classList.contains('hidden')) {
            input.classList.remove('border-red-500');
            erroCampo.classList.add('hidden');
          }
        });
      }
    }
    form.appendChild(bloco);
  }

  const erro = document.createElement('p');
  erro.className = 'hidden text-sm text-red-600';
  form.appendChild(erro);

  const rodape = document.createElement('div');
  rodape.className = 'flex justify-end gap-2 pt-2';
  rodape.innerHTML = `<button type="submit" class="btn-primary"><span data-texto-salvar>${textoSalvar}</span></button>`;
  form.appendChild(rodape);
  const btnSalvar = rodape.querySelector('button');
  const textoSalvarEl = rodape.querySelector('[data-texto-salvar]');
  const spinner = '<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>';

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const valores = {};
    for (const campo of campos) {
      if (campo.tipo === 'checkbox') {
        valores[campo.nome] = form.querySelector(`#campo-${campo.nome}`).checked ? 1 : 0;
        continue;
      }
      if (campo.tipo === 'searchable') {
        valores[campo.nome] = searchables[campo.nome].getValue();
        continue;
      }
      const el = form.elements[campo.nome];
      if (campo.tipo === 'moeda') valores[campo.nome] = getMoedaValue(el);
      else if (campo.tipo === 'peso') valores[campo.nome] = getPesoValue(el);
      else if (campo.tipo === 'data') valores[campo.nome] = el.value ? parseDataBrParaIso(el.value) : null;
      else if (campo.tipo === 'cpf_cnpj') valores[campo.nome] = apenasDigitos(el.value) || null;
      else if (campo.tipo === 'numero') valores[campo.nome] = el.value === '' ? null : Number(el.value);
      else valores[campo.nome] = el.value;

      const msgValidacao = validarCampo(campo, el);
      if (msgValidacao) {
        erro.textContent = msgValidacao;
        erro.classList.remove('hidden');
        return;
      }
    }
    btnSalvar.disabled = true;
    textoSalvarEl.innerHTML = spinner;
    try {
      await aoSalvar(valores);
    } catch (err) {
      erro.textContent = err.message || 'Erro ao salvar.';
      erro.classList.remove('hidden');
    } finally {
      btnSalvar.disabled = false;
      textoSalvarEl.textContent = textoSalvar;
    }
  });

  return form;
}
