import { attachMoedaMask, getMoedaValue, setMoedaValue, attachPesoMask, getPesoValue, attachDataMask, parseDataBrParaIso, attachCpfCnpjMask, apenasDigitos, validarCpfOuCnpj } from '../masks.js';
import { criarSearchableSelect } from './searchableSelect.js';
import { fecharModal } from './modal.js';

// Mensagem de erro pro campo `campo` a partir do valor atual (string, ou o
// valor ja resolvido de um searchable) - usada tanto no blur (feedback cedo)
// quanto no submit. `valor` vazio cobre string vazia, null e undefined.
function validarCampo(campo, valor) {
  const vazio = valor === '' || valor === undefined || valor === null;
  if (campo.obrigatorio && vazio) return `Preencha o campo "${campo.label}".`;
  if (vazio) return null;
  if (campo.tipo === 'data' && !parseDataBrParaIso(valor)) return `Data invalida em "${campo.label}".`;
  if (campo.tipo === 'cpf_cnpj' && !validarCpfOuCnpj(apenasDigitos(valor))) return `CPF/CNPJ invalido em "${campo.label}".`;
  return null;
}

// Construtor generico de formulario para os modais de cadastro simples.
// campo: { nome, label, tipo, obrigatorio, opcoes (select), buscar (searchable),
//          labelInicialFn (searchable: extrai o rotulo do valor inicial) }
export function criarFormulario({ campos, valoresIniciais = {}, aoSalvar, textoSalvar = 'Salvar' }) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  const searchables = {};
  // campo.nome -> { valor: () => valor atual pro validarCampo, marcar: (msg|null) => void }
  // Todo campo com rotulo de erro proprio (obrigatorio, ou data/cpf_cnpj)
  // entra aqui - assim o submit consegue validar TODOS de uma vez em vez de
  // parar no primeiro, e cada campo mostra o proprio aviso embaixo dele.
  const validaveis = {};

  function criarBlocoErro(bloco, elParaBorda) {
    const erroCampo = document.createElement('p');
    erroCampo.className = 'mt-1 hidden text-xs text-red-500';
    bloco.appendChild(erroCampo);
    return (msg) => {
      elParaBorda.classList.toggle('border-red-500', Boolean(msg));
      erroCampo.textContent = msg || '';
      erroCampo.classList.toggle('hidden', !msg);
    };
  }

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
      // Select obrigatorio sem NENHUMA opcao pra escolher e um beco sem saida
      // silencioso - o formulario nao tem como ser enviado e nada explica o
      // motivo. Em vez de deixar o usuario adivinhar, avisa e linka pra onde
      // cadastrar isso (campo.avisoSemOpcoes: {mensagem, rota}).
      if (campo.obrigatorio && !(campo.opcoes || []).length && campo.avisoSemOpcoes) {
        const aviso = document.createElement('p');
        aviso.className = 'mt-1 text-xs text-amber-500';
        aviso.innerHTML = campo.avisoSemOpcoes.rota
          ? `${campo.avisoSemOpcoes.mensagem} <a href="#${campo.avisoSemOpcoes.rota}" class="font-medium underline" data-ir-cadastrar>Cadastrar agora</a>.`
          : campo.avisoSemOpcoes.mensagem;
        bloco.appendChild(aviso);
        // Fecha o modal antes de navegar - senao a lista de destino carrega
        // por baixo com o formulario (agora inutil) ainda aberto por cima.
        aviso.querySelector('[data-ir-cadastrar]')?.addEventListener('click', () => fecharModal());
      }
      if (campo.obrigatorio) {
        const marcar = criarBlocoErro(bloco, select);
        validaveis[campo.nome] = { valor: () => select.value, marcar };
        select.addEventListener('change', () => marcar(null));
      }
    } else if (campo.tipo === 'searchable') {
      const instancia = criarSearchableSelect({
        buscar: campo.buscar,
        placeholder: campo.placeholder || 'Pesquisar...',
        valorInicial: valoresIniciais[campo.nome] ?? null,
        labelInicial: campo.labelInicial || '',
        onChange: campo.obrigatorio ? () => marcarSearchable(null) : undefined,
      });
      searchables[campo.nome] = instancia;
      bloco.appendChild(instancia.el);
      let marcarSearchable = () => {};
      if (campo.obrigatorio) {
        // O wrapper (.el) e so um <div relative> sem borda propria - o campo
        // visivel de verdade e o <input> por dentro, que e onde a borda
        // vermelha de erro precisa aparecer.
        marcarSearchable = criarBlocoErro(bloco, instancia.el.querySelector('input'));
        validaveis[campo.nome] = { valor: () => instancia.getValue(), marcar: marcarSearchable };
      }
    } else if (campo.tipo === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.className = 'input';
      textarea.name = campo.nome;
      textarea.rows = 3;
      textarea.value = valoresIniciais[campo.nome] ?? '';
      bloco.appendChild(textarea);
      if (campo.obrigatorio) {
        const marcar = criarBlocoErro(bloco, textarea);
        validaveis[campo.nome] = { valor: () => textarea.value, marcar };
        textarea.addEventListener('input', () => marcar(null));
      }
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
        const marcar = criarBlocoErro(bloco, input);
        validaveis[campo.nome] = { valor: () => input.value, marcar };
        input.addEventListener('blur', () => marcar(validarCampo(campo, input.value)));
        input.addEventListener('input', () => marcar(null));
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
    // Valida TODOS os campos de uma vez (nao para no primeiro erro) - senao
    // o usuario corrige um, submete de novo, descobre o proximo, e assim por
    // diante num formulario com varios campos obrigatorios.
    let primeiroInvalido = null;
    let quantidadeInvalidos = 0;
    for (const campo of campos) {
      if (campo.tipo === 'checkbox') {
        valores[campo.nome] = form.querySelector(`#campo-${campo.nome}`).checked ? 1 : 0;
        continue;
      }
      if (campo.tipo === 'searchable') {
        valores[campo.nome] = searchables[campo.nome].getValue();
      } else {
        const el = form.elements[campo.nome];
        if (campo.tipo === 'moeda') valores[campo.nome] = getMoedaValue(el);
        else if (campo.tipo === 'peso') valores[campo.nome] = getPesoValue(el);
        else if (campo.tipo === 'data') valores[campo.nome] = el.value ? parseDataBrParaIso(el.value) : null;
        else if (campo.tipo === 'cpf_cnpj') valores[campo.nome] = apenasDigitos(el.value) || null;
        else if (campo.tipo === 'numero') valores[campo.nome] = el.value === '' ? null : Number(el.value);
        else valores[campo.nome] = el.value;
      }

      const validavel = validaveis[campo.nome];
      if (!validavel) continue;
      const msgValidacao = validarCampo(campo, validavel.valor());
      validavel.marcar(msgValidacao);
      if (msgValidacao) {
        quantidadeInvalidos += 1;
        if (!primeiroInvalido) primeiroInvalido = campo;
      }
    }
    if (primeiroInvalido) {
      erro.textContent = quantidadeInvalidos > 1
        ? `Corrija os ${quantidadeInvalidos} campos destacados abaixo.`
        : validarCampo(primeiroInvalido, validaveis[primeiroInvalido.nome].valor());
      erro.classList.remove('hidden');
      const elFoco = form.elements[primeiroInvalido.nome];
      if (elFoco && elFoco.focus) elFoco.focus();
      return;
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
