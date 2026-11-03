const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

// Copia FORA do volume do Railway (o banco e os anexos moram num volume so: se ele se perder, o backup
// diario local vai junto). Envia para qualquer armazenamento compativel com S3 - Cloudflare R2
// (recomendado: outro provedor, 10 GB gratis), Backblaze B2, AWS S3 ou um Bucket do proprio Railway.
// Assinatura AWS Signature V4 feita aqui mesmo (node:crypto), sem SDK: so precisamos de PUT.
//
// Variaveis (todas obrigatorias para ligar, menos as com padrao):
//   BACKUP_S3_ENDPOINT          ex.: https://<conta>.r2.cloudflarestorage.com
//   BACKUP_S3_BUCKET            nome do bucket (privado!)
//   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY
//   BACKUP_S3_REGION            padrao 'auto' (R2); AWS: ex. 'sa-east-1'
//   BACKUP_S3_PREFIXO           padrao 'frottex/' (pasta dentro do bucket)
//   BACKUP_S3_PATH_STYLE        padrao '1' (endpoint/bucket/chave); '0' = bucket.endpoint/chave
//
// O que vai pra la:
//   <prefixo>banco/diario/frottex-AAAA-MM-DD.db.gz   todo dia (regra de ciclo de vida no bucket apaga os antigos)
//   <prefixo>banco/mensal/frottex-AAAA-MM.db.gz      o primeiro backup de cada mes (guardado para sempre)
//   <prefixo>uploads/<caminho>                       anexos e fotos, so os que ainda nao foram enviados

function configDoAmbiente(env = process.env) {
  const cfg = {
    endpoint: (env.BACKUP_S3_ENDPOINT || '').replace(/\/+$/, ''),
    bucket: env.BACKUP_S3_BUCKET || '',
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID || '',
    secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY || '',
    region: env.BACKUP_S3_REGION || 'auto',
    prefixo: env.BACKUP_S3_PREFIXO !== undefined ? env.BACKUP_S3_PREFIXO : 'frottex/',
    pathStyle: env.BACKUP_S3_PATH_STYLE !== '0',
  };
  return cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey ? cfg : null;
}

const sha256Hex = (dados) => crypto.createHash('sha256').update(dados).digest('hex');
const hmac = (chave, dados) => crypto.createHmac('sha256', chave).update(dados).digest();

// Cada segmento do caminho codificado como o S3 espera (RFC 3986; '/' preservado entre segmentos).
function codificarCaminho(caminho) {
  return caminho.split('/').map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

// Cabecalhos assinados (Signature V4) para uma requisicao sem query string. `agora` injetavel para teste.
function assinarRequisicao({ metodo, url, cabecalhos = {}, corpoSha256, accessKeyId, secretAccessKey, region, servico = 's3', agora = new Date() }) {
  const u = new URL(url);
  const amzDate = agora.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dia = amzDate.slice(0, 8);
  const todos = { ...cabecalhos, host: u.host, 'x-amz-content-sha256': corpoSha256, 'x-amz-date': amzDate };
  const nomes = Object.keys(todos).map((n) => n.toLowerCase()).sort();
  const porNome = Object.fromEntries(Object.entries(todos).map(([n, v]) => [n.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonica = [
    metodo,
    u.pathname,
    '',
    ...nomes.map((n) => `${n}:${porNome[n]}`),
    '',
    nomes.join(';'),
    corpoSha256,
  ].join('\n');
  const escopo = `${dia}/${region}/${servico}/aws4_request`;
  const paraAssinar = ['AWS4-HMAC-SHA256', amzDate, escopo, sha256Hex(canonica)].join('\n');
  const chave = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dia), region), servico), 'aws4_request');
  const assinatura = crypto.createHmac('sha256', chave).update(paraAssinar).digest('hex');
  return {
    ...todos,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${escopo}, SignedHeaders=${nomes.join(';')}, Signature=${assinatura}`,
  };
}

function urlDoObjeto(cfg, chave) {
  const caminho = codificarCaminho(chave);
  if (cfg.pathStyle) return `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${caminho}`;
  const u = new URL(cfg.endpoint);
  return `${u.protocol}//${cfg.bucket}.${u.host}/${caminho}`;
}

async function enviarObjeto(cfg, chave, corpo, { contentType = 'application/octet-stream', fetchImpl = fetch } = {}) {
  const url = urlDoObjeto(cfg, chave);
  const headers = assinarRequisicao({
    metodo: 'PUT', url, cabecalhos: { 'content-type': contentType }, corpoSha256: sha256Hex(corpo),
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region,
  });
  delete headers.host; // o fetch preenche sozinho (e recusa o cabecalho)
  const resposta = await fetchImpl(url, { method: 'PUT', headers, body: corpo, signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!resposta.ok) {
    const detalhe = (await resposta.text().catch(() => '')).slice(0, 300);
    throw new Error(`Envio de ${chave} recusado (HTTP ${resposta.status}) ${detalhe}`.trim());
  }
}

// Leitura de um objeto (restauracao - ver database/scripts/baixar_backup_externo.js).
async function baixarObjeto(cfg, chave, { fetchImpl = fetch } = {}) {
  const url = urlDoObjeto(cfg, chave);
  const headers = assinarRequisicao({
    metodo: 'GET', url, corpoSha256: sha256Hex(''), accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region,
  });
  delete headers.host;
  const resposta = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!resposta.ok) throw new Error(`Leitura de ${chave} recusada (HTTP ${resposta.status}).`);
  return Buffer.from(await resposta.arrayBuffer());
}

// Banco: comprimido (SQLite encolhe ~70-80%). Mensal so quando este e o primeiro backup do mes.
async function enviarBanco(cfg, { arquivo, dataIso, primeiroDoMes, fetchImpl }) {
  const gz = zlib.gzipSync(fs.readFileSync(arquivo), { level: 9 });
  const enviados = [];
  const diario = `${cfg.prefixo}banco/diario/frottex-${dataIso}.db.gz`;
  await enviarObjeto(cfg, diario, gz, { contentType: 'application/gzip', fetchImpl });
  enviados.push(diario);
  if (primeiroDoMes) {
    const mensal = `${cfg.prefixo}banco/mensal/frottex-${dataIso.slice(0, 7)}.db.gz`;
    await enviarObjeto(cfg, mensal, gz, { contentType: 'application/gzip', fetchImpl });
    enviados.push(mensal);
  }
  return { enviados, bytes: gz.length };
}

function listarArquivosRecursivo(raiz, relativo = '') {
  const pasta = path.join(raiz, relativo);
  if (!fs.existsSync(pasta)) return [];
  const saida = [];
  for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
    const rel = relativo ? `${relativo}/${item.name}` : item.name;
    if (item.isDirectory()) saida.push(...listarArquivosRecursivo(raiz, rel));
    else if (item.isFile()) saida.push(rel);
  }
  return saida;
}

// Anexos/fotos: arquivos nunca sao reescritos (nome aleatorio por upload), entao basta mandar os que
// ainda nao foram - controlados por um manifesto local ao lado dos backups.
async function enviarUploadsNovos(cfg, { pastaUploads, manifesto, fetchImpl }) {
  let jaEnviados = new Set();
  try { jaEnviados = new Set(JSON.parse(fs.readFileSync(manifesto, 'utf8'))); } catch { /* primeiro envio */ }
  const pendentes = listarArquivosRecursivo(pastaUploads).filter((rel) => !jaEnviados.has(rel));
  let bytes = 0;
  for (const rel of pendentes) {
    const conteudo = fs.readFileSync(path.join(pastaUploads, rel));
    await enviarObjeto(cfg, `${cfg.prefixo}uploads/${rel}`, conteudo, { fetchImpl });
    jaEnviados.add(rel);
    bytes += conteudo.length;
    // Grava a cada arquivo: se cair no meio, o proximo ciclo continua de onde parou.
    fs.writeFileSync(manifesto, JSON.stringify([...jaEnviados]));
  }
  return { quantidade: pendentes.length, bytes };
}

module.exports = { configDoAmbiente, assinarRequisicao, urlDoObjeto, enviarObjeto, baixarObjeto, enviarBanco, enviarUploadsNovos, listarArquivosRecursivo };
