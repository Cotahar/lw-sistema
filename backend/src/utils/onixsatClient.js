const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');

// Endpoint atual (o antigo "webservice.onixsat.com.br" foi descontinuado -
// a Onixsat migrou a marca/infra para "New Rastreamento Online"/TrucksControl).
// Protocolo documentado em https://suporte.truckscontrol.com.br/integracao/:
// HTTP POST puro com corpo XML (sem SOAP, sem WSDL), credenciais dentro do
// proprio XML (login/senha), resposta pode vir compactada em ZIP (DEFLATE).
const ENDPOINT = 'https://webservice.newrastreamentoonline.com.br';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });

function paraArray(valor) {
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

// As respostas maiores vem num arquivo .zip (formato ZIP local file header,
// PK\x03\x04) contendo um unico .txt com o XML - ver "Descompactacao" no
// manual. Metodo 0 = sem compressao, 8 = deflate (zlib raw).
function descompactarSeNecessario(buffer) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return buffer;
  const metodoCompressao = buffer.readUInt16LE(8);
  const tamanhoComprimido = buffer.readUInt32LE(18);
  const tamanhoNome = buffer.readUInt16LE(26);
  const tamanhoExtra = buffer.readUInt16LE(28);
  const inicioDados = 30 + tamanhoNome + tamanhoExtra;
  const dados = buffer.subarray(inicioDados, inicioDados + tamanhoComprimido);
  if (metodoCompressao === 0) return dados;
  if (metodoCompressao === 8) return zlib.inflateRawSync(dados);
  throw new Error(`Onixsat: metodo de compressao ZIP nao suportado (${metodoCompressao}).`);
}

async function chamarOnixsat(xmlRequisicao) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlRequisicao,
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const xmlResposta = descompactarSeNecessario(buffer).toString('utf8');
  const objeto = parser.parse(xmlResposta);

  if (objeto.ErrorRequest) {
    const erro = new Error(`Onixsat: ${objeto.ErrorRequest.erro || objeto.ErrorRequest.Erro || 'erro desconhecido'}`);
    erro.codigoOnixsat = objeto.ErrorRequest.codigo !== undefined ? Number(objeto.ErrorRequest.codigo) : null;
    throw erro;
  }
  return objeto;
}

// Lista os equipamentos (veiID + placa) vinculados a conta. Limite de 1
// requisicao a cada 5 minutos (ver tabela de intervalos do manual).
async function requestVeiculo(login, senha) {
  const xml = `<RequestVeiculo><login>${login}</login><senha>${senha}</senha></RequestVeiculo>`;
  const resposta = await chamarOnixsat(xml);
  return paraArray(resposta.ResponseVeiculo?.Veiculo);
}

// Mensagens (posicao/hodometro/eventos) desde o mId informado. Cursor global
// da conta, nao por veiculo - usar 1 na primeira chamada. Limite de 1
// requisicao a cada 30 segundos; no maximo 30 mensagens por resposta.
async function requestMensagemCB(login, senha, mId) {
  const xml = `<RequestMensagemCB><login>${login}</login><senha>${senha}</senha><mId>${mId}</mId></RequestMensagemCB>`;
  const resposta = await chamarOnixsat(xml);
  return paraArray(resposta.ResponseMensagemCB?.MensagemCB);
}

module.exports = { requestVeiculo, requestMensagemCB };
