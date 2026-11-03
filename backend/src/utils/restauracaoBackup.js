const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Restauracao de um backup NA SUBIDA do servidor, antes de o banco ser aberto - no Railway nao da pra
// trocar o arquivo do banco com o app rodando (ele e o processo principal do container). Passo a passo
// no README ("Restaurar um backup"):
//   1. o arquivo precisa estar na pasta de backups (os automaticos ja estao; um da copia externa e
//      baixado com database/scripts/baixar_backup_externo.js);
//   2. variavel RESTAURAR_BACKUP=<nome do arquivo> + reiniciar o servico;
//   3. depois, apagar a variavel.
// Seguranca: o banco atual nunca e apagado (vira frotista-antes-da-restauracao-<data>.db na mesma pasta),
// o backup e conferido (quick_check) antes, e um marcador impede restaurar de novo a cada restart se
// alguem esquecer a variavel ligada - o que apagaria tudo o que foi lancado depois.
function restaurarSePedido({ dbPath, dirBackups, arquivo, log = console }) {
  if (!arquivo) return { restaurado: false };
  if (!/^[\w.-]+\.db$/.test(arquivo)) throw new Error(`RESTAURAR_BACKUP invalido: "${arquivo}" (so o nome do arquivo .db da pasta de backups).`);
  const origem = path.join(dirBackups, arquivo);
  const marcador = path.join(dirBackups, `.restaurado-${arquivo}`);
  if (fs.existsSync(marcador)) {
    log.log(`RESTAURAR_BACKUP=${arquivo} ignorado: esse backup ja foi restaurado em ${fs.readFileSync(marcador, 'utf8')}. Apague a variavel.`);
    return { restaurado: false, jaRestaurado: true };
  }
  if (!fs.existsSync(origem)) throw new Error(`RESTAURAR_BACKUP: arquivo ${origem} nao existe.`);

  const conferencia = new DatabaseSync(origem, { readOnly: true });
  let resultado;
  try {
    resultado = conferencia.prepare('PRAGMA quick_check').get();
  } finally {
    conferencia.close();
  }
  if (!resultado || resultado.quick_check !== 'ok') throw new Error(`RESTAURAR_BACKUP: ${arquivo} esta corrompido (quick_check = ${resultado && resultado.quick_check}).`);

  const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  let copiaDoAtual = null;
  if (fs.existsSync(dbPath)) {
    copiaDoAtual = path.join(dirBackups, `frotista-antes-da-restauracao-${carimbo}.db`);
    fs.copyFileSync(dbPath, copiaDoAtual);
  }
  for (const sufixo of ['-wal', '-shm', '-journal']) fs.rmSync(`${dbPath}${sufixo}`, { force: true });
  fs.copyFileSync(origem, dbPath);
  fs.writeFileSync(marcador, carimbo);
  log.log(`Banco RESTAURADO a partir de ${arquivo}.${copiaDoAtual ? ` O banco anterior foi guardado em ${path.basename(copiaDoAtual)}.` : ''} Apague a variavel RESTAURAR_BACKUP.`);
  return { restaurado: true, copiaDoAtual };
}

module.exports = { restaurarSePedido };
