// Mascaras pt_BR exigidas pelo PRD: Moeda (R$ 0.000,00), Peso (00.000 kg),
// Data (DD/MM/AAAA) e CPF/CNPJ. Moeda e Peso usam o padrao "digita da
// direita pra esquerda" (como caixa de loja); Data e CPF/CNPJ inserem os
// separadores conforme o usuario digita da esquerda pra direita.

export function apenasDigitos(str) {
  return String(str || '').replace(/\D/g, '');
}

// ---- Caixa alta (padronizacao de cadastros - nome, placa, marca, cidade...) ----
// Forca o VALOR digitado pra maiuscula (nao so a exibicao via CSS
// text-transform, que deixaria o dado salvo em minuscula por baixo) mantendo
// a posicao do cursor - sem isso, digitar no meio do texto jogava o cursor
// pro final a cada tecla.
export function attachUppercaseInput(input) {
  input.addEventListener('input', () => {
    const inicio = input.selectionStart;
    const fim = input.selectionEnd;
    input.value = input.value.toUpperCase();
    if (inicio !== null) input.setSelectionRange(inicio, fim);
  });
}

// ---- Moeda (centavos <-> "R$ 1.234,56") ----
export function formatarMoeda(centavos) {
  const valor = (Number(centavos) || 0) / 100;
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function attachMoedaMask(input, centavosIniciais = 0) {
  const aplicar = (centavos) => {
    input.dataset.valorCentavos = String(centavos);
    input.value = formatarMoeda(centavos);
  };
  input.addEventListener('input', () => {
    const digitos = apenasDigitos(input.value);
    aplicar(digitos ? parseInt(digitos, 10) : 0);
  });
  input.addEventListener('focus', () => {
    // seleciona tudo ao focar - digitar direto substitui o "R$ 0,00" (ou
    // qualquer valor ja preenchido) em vez de acrescentar por cima; quem
    // quiser editar em vez de retypar clica de novo pra reposicionar o cursor.
    requestAnimationFrame(() => input.select());
  });
  aplicar(centavosIniciais);
}

// Variante para valores totais (frete, financiamento, conta a pagar/receber
// etc.) - digitar "150" preenche direto "R$ 150,00" (reais inteiros, os dois
// zeros de centavos ficam implicitos); so entra em modo centavos quando o
// usuario digita a virgula ele mesmo. Ao contrario da mascara "de caixa"
// acima (attachMoedaMask), que serve pra valores por unidade digitados com
// frequencia em centavos (preco/litro de combustivel) - nao trocar essa.
export function attachMoedaMaskReais(input, centavosIniciais = 0) {
  const aplicarFinal = (centavos) => {
    input.dataset.valorCentavos = String(centavos);
    input.value = formatarMoeda(centavos);
  };
  input.addEventListener('input', () => {
    const [parteInteira, ...resto] = input.value.split(',');
    const temVirgula = resto.length > 0;
    const inteiros = apenasDigitos(parteInteira);
    const decimais = temVirgula ? apenasDigitos(resto.join('')).slice(0, 2) : '';
    const centavos = (inteiros ? parseInt(inteiros, 10) : 0) * 100 + (decimais ? parseInt(decimais.padEnd(2, '0'), 10) : 0);
    input.dataset.valorCentavos = String(centavos);
    const inteirosFormatados = inteiros ? Number(inteiros).toLocaleString('pt-BR') : '0';
    input.value = temVirgula ? `${inteirosFormatados},${decimais}` : inteirosFormatados;
  });
  input.addEventListener('blur', () => aplicarFinal(getMoedaValue(input)));
  input.addEventListener('focus', () => {
    requestAnimationFrame(() => input.select());
  });
  aplicarFinal(centavosIniciais);
}

export function getMoedaValue(input) {
  return parseInt(input.dataset.valorCentavos || '0', 10);
}

export function setMoedaValue(input, centavos) {
  input.dataset.valorCentavos = String(centavos || 0);
  input.value = formatarMoeda(centavos || 0);
}

// ---- Peso (kg inteiro <-> "00.000 kg") ----
// ---- Litragem (diesel e Arla): 3 casas decimais ----
// Muitos postos vendem com 3 casas (ex.: 100,125 L); com 2 o total do cupom
// divergia do calculo. Sempre exibir/aceitar/arredondar em 3 casas.
export function arredondarLitros(valor) {
  return Math.round((Number(valor) || 0) * 1000) / 1000;
}

export function formatarLitros(valor) {
  return arredondarLitros(valor).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function formatarPeso(kg) {
  if (kg === null || kg === undefined || kg === '') return '';
  return `${Number(kg).toLocaleString('pt-BR')} kg`;
}

export function attachPesoMask(input, kgInicial) {
  const aplicar = (kg) => {
    input.dataset.valorKg = String(kg);
    input.value = kg ? formatarPeso(kg) : '';
  };
  input.addEventListener('input', () => {
    const digitos = apenasDigitos(input.value);
    aplicar(digitos ? parseInt(digitos, 10) : 0);
  });
  input.addEventListener('focus', () => {
    requestAnimationFrame(() => input.select());
  });
  if (kgInicial) aplicar(kgInicial);
}

export function getPesoValue(input) {
  return parseInt(input.dataset.valorKg || '0', 10);
}

// ---- Data (ISO "AAAA-MM-DD" <-> "DD/MM/AAAA") ----
export function formatarDataBr(iso) {
  if (!iso) return '';
  const [data] = String(iso).split(' ');
  const [ano, mes, dia] = data.split('-');
  if (!ano || !mes || !dia) return '';
  return `${dia}/${mes}/${ano}`;
}

export function formatarDataHoraBr(isoDataHora) {
  if (!isoDataHora) return '';
  const [data, hora] = String(isoDataHora).split(' ');
  const dataBr = formatarDataBr(data);
  if (!dataBr) return '';
  return hora ? `${dataBr} ${hora.slice(0, 5)}` : dataBr;
}

// "Hoje" no fuso do proprio navegador (local do usuario, que esta no
// Brasil) - usar isto em vez de `new Date().toISOString().slice(0,10)`, que
// forca UTC e pode mostrar o dia seguinte entre ~21h e 23h59 no horario de
// Brasilia (mesma classe de bug do `datetime('now')` sem ajuste no backend).
export function hojeIsoLocal() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}

// Soma dias a uma data ISO ("AAAA-MM-DD"), devolvendo outra data ISO. Usa UTC
// so como calendario (sem efeito de fuso/horario de verao).
export function somarDiasIso(iso, dias) {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

export function parseDataBrParaIso(valorBr) {
  const digitos = apenasDigitos(valorBr);
  if (digitos.length !== 8) return null;
  const dia = digitos.slice(0, 2);
  const mes = digitos.slice(2, 4);
  const ano = digitos.slice(4, 8);
  // UTC so como calendario (sem depender do fuso do navegador). Rejeita dia/mes que
  // "viram" outra data (31/02) e anos fora de 1900-2999 (evita 0026 -> 1926).
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  if (Number.isNaN(data.getTime()) || data.getUTCFullYear() !== Number(ano) || data.getUTCMonth() + 1 !== Number(mes) || data.getUTCDate() !== Number(dia)) return null;
  if (Number(ano) < 1900) return null;
  return `${ano}-${mes}-${dia}`;
}

function formatarDigitosData(digitos) {
  if (digitos.length > 4) return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
  if (digitos.length > 2) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return digitos;
}

// Completa uma data digitada pela metade (so dia; dia+mes; dia+mes+ano de 2 digitos) com o
// mes/ano atuais - agiliza o preenchimento sem impedir a data completa.
function completarDigitosData(digitos) {
  const agora = new Date();
  const ano = String(agora.getFullYear());
  const mesAtual = String(agora.getMonth() + 1).padStart(2, '0');
  if (digitos.length === 1 || digitos.length === 2) return `${digitos.padStart(2, '0')}${mesAtual}${ano}`;
  if (digitos.length === 3 || digitos.length === 4) return `${digitos.slice(0, 2)}${digitos.slice(2).padStart(2, '0')}${ano}`;
  if (digitos.length === 6) return `${digitos.slice(0, 4)}${ano.slice(0, 2)}${digitos.slice(4)}`; // 31/10/26 -> 31/10/2026
  return digitos;
}

export function attachDataMask(input, isoInicial) {
  input.placeholder = 'DD/MM/AAAA';

  // Marca em vermelho uma data completa que nao existe (ex.: 31/02/2026) ou incompleta.
  function sinalizarInvalida() {
    const invalida = Boolean(input.value) && !parseDataBrParaIso(input.value);
    input.classList.toggle('input-data-invalida', invalida);
    input.title = invalida ? 'Data invalida - use dd/mm/aaaa' : '';
  }

  function completar() {
    const digitos = apenasDigitos(input.value).slice(0, 8);
    const completo = completarDigitosData(digitos);
    if (completo !== digitos) input.value = formatarDigitosData(completo);
    sinalizarInvalida();
  }

  input.addEventListener('input', () => {
    const digitos = apenasDigitos(input.value).slice(0, 8);
    input.value = formatarDigitosData(digitos);
    input.classList.remove('input-data-invalida');
    input.title = '';
  });
  // O navegador dispara 'change' ANTES do 'blur'. Completar a data ja no 'change' (este
  // listener e registrado antes dos das telas) faz os filtros lerem a data completa; antes,
  // a busca saia com a data pela metade ("06/10" virava "null") e, ao sair do campo, a
  // mascara completava o texto sem refazer a busca - a lista nao batia com o filtro mostrado.
  input.addEventListener('change', completar);
  // Rede de seguranca: se por algum motivo o 'change' nao completou, completa no 'blur' e
  // avisa quem escuta 'change' (so quando o texto realmente mudou).
  input.addEventListener('blur', () => {
    const antes = input.value;
    completar();
    if (input.value !== antes) input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  if (isoInicial) input.value = formatarDataBr(isoInicial);
}

// ---- CPF/CNPJ (detecta pelo numero de digitos) ----
export function formatarCpfCnpj(digitos) {
  const d = apenasDigitos(digitos);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function attachCpfCnpjMask(input, valorInicial) {
  input.addEventListener('input', () => {
    input.value = formatarCpfCnpj(input.value);
  });
  if (valorInicial) input.value = formatarCpfCnpj(valorInicial);
}

export function validarCpf(cpf) {
  const d = apenasDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calcDv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) soma += Number(base[i]) * (base.length + 1 - i);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = calcDv(d.slice(0, 9));
  const dv2 = calcDv(d.slice(0, 9) + dv1);
  return d === d.slice(0, 9) + String(dv1) + String(dv2);
}

export function validarCnpj(cnpj) {
  const d = apenasDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calcDv = (base, pesos) => {
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) soma += Number(base[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = calcDv(d.slice(0, 12), pesos1);
  const dv2 = calcDv(d.slice(0, 12) + dv1, pesos2);
  return d === d.slice(0, 12) + String(dv1) + String(dv2);
}

export function validarCpfOuCnpj(valor) {
  const d = apenasDigitos(valor);
  if (d.length <= 11) return validarCpf(d);
  return validarCnpj(d);
}
