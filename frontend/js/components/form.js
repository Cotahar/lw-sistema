import { attachMoedaMask, getMoedaValue, setMoedaValue, attachPesoMask, getPesoValue, attachDataMask, parseDataBrParaIso, attachCpfCnpjMask, apenasDigitos } from '../masks.js';
import { criarSearchableSelect } from './searchableSelect.js';

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
    }
    form.appendChild(bloco);
  }

  const erro = document.createElement('p');
  erro.className = 'hidden text-sm text-red-600';
  form.appendChild(erro);

  const rodape = document.createElement('div');
  rodape.className = 'flex justify-end gap-2 pt-2';
  rodape.innerHTML = `<button type="submit" class="btn-primary">${textoSalvar}</button>`;
  form.appendChild(rodape);

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
      else if (campo.tipo === 'cpf_cnpj') valores[campo.nome] = apenasDigitos(el.value);
      else if (campo.tipo === 'numero') valores[campo.nome] = el.value === '' ? null : Number(el.value);
      else valores[campo.nome] = el.value;

      if (campo.obrigatorio && (valores[campo.nome] === '' || valores[campo.nome] === null || valores[campo.nome] === undefined)) {
        erro.textContent = `Preencha o campo "${campo.label}".`;
        erro.classList.remove('hidden');
        return;
      }
      if (campo.tipo === 'data' && el.value && !valores[campo.nome]) {
        erro.textContent = `Data invalida em "${campo.label}".`;
        erro.classList.remove('hidden');
        return;
      }
    }
    try {
      await aoSalvar(valores);
    } catch (err) {
      erro.textContent = err.message || 'Erro ao salvar.';
      erro.classList.remove('hidden');
    }
  });

  return form;
}
