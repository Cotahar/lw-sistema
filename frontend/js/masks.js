// Mascaras pt_BR exigidas pelo PRD: Moeda (R$ 0.000,00), Peso (00.000 kg),
// Data (DD/MM/AAAA) e CPF/CNPJ. Moeda e Peso usam o padrao "digita da
// direita pra esquerda" (como caixa de loja); Data e CPF/CNPJ inserem os
// separadores conforme o usuario digita da esquerda pra direita.

export function apenasDigitos(str) {
  return String(str || '').replace(/\D/g, '');
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
    // deixa o cursor sempre no fim, coerente com o modelo "digita da direita"
    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
  });
  aplicar(centavosIniciais);
}

export function getMoedaValue(input) {
  return parseInt(input.dataset.valorCentavos || '0', 10);
}

export function setMoedaValue(input, centavos) {
  input.dataset.valorCentavos = String(centavos || 0);
  input.value = formatarMoeda(centavos || 0);
}

// ---- Peso (kg inteiro <-> "00.000 kg") ----
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
    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
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

export function parseDataBrParaIso(valorBr) {
  const digitos = apenasDigitos(valorBr);
  if (digitos.length !== 8) return null;
  const dia = digitos.slice(0, 2);
  const mes = digitos.slice(2, 4);
  const ano = digitos.slice(4, 8);
  const data = new Date(`${ano}-${mes}-${dia}T00:00:00`);
  if (Number.isNaN(data.getTime()) || data.getUTCDate() !== Number(dia) || data.getUTCMonth() + 1 !== Number(mes)) return null;
  return `${ano}-${mes}-${dia}`;
}

function formatarDigitosData(digitos) {
  if (digitos.length > 4) return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
  if (digitos.length > 2) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return digitos;
}

export function attachDataMask(input, isoInicial) {
  input.placeholder = 'DD/MM/AAAA';
  input.addEventListener('input', () => {
    const digitos = apenasDigitos(input.value).slice(0, 8);
    input.value = formatarDigitosData(digitos);
  });
  // Completa mes/ano (ou so ano) com a data atual quando o usuario sai do
  // campo tendo digitado so o dia, ou so dia+mes - agiliza o preenchimento
  // sem impedir que ele digite a data completa se quiser.
  input.addEventListener('blur', () => {
    const digitos = apenasDigitos(input.value).slice(0, 8);
    const agora = new Date();
    if (digitos.length === 1 || digitos.length === 2) {
      const dia = digitos.padStart(2, '0');
      const mes = String(agora.getMonth() + 1).padStart(2, '0');
      input.value = formatarDigitosData(`${dia}${mes}${agora.getFullYear()}`);
    } else if (digitos.length === 3 || digitos.length === 4) {
      const dia = digitos.slice(0, 2);
      const mes = digitos.slice(2, 4).padStart(2, '0');
      input.value = formatarDigitosData(`${dia}${mes}${agora.getFullYear()}`);
    }
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
