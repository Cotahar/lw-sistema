// Multas: de onde veio o motorista preenchido.
//   condutor_origem NULL          = informado/identificado normalmente (pelo operador ou pelas viagens do Frottex)
//   condutor_origem 'DadosAntigos' = sugerido a partir de documentos/registros fora do Frottex (acertos, cargas, contratos...)
//   condutor_fonte                 = de onde saiu e o grau de confianca, para o operador conferir
// Ao indicar o condutor pela tela ("Indicar condutor"), a marca some: o operador confirmou.
module.exports.up = function up(db) {
  const colunas = db.prepare('PRAGMA table_info(multas)').all().map((c) => c.name);
  if (!colunas.includes('condutor_origem')) db.exec('ALTER TABLE multas ADD COLUMN condutor_origem TEXT');
  if (!colunas.includes('condutor_fonte')) db.exec('ALTER TABLE multas ADD COLUMN condutor_fonte TEXT');
};
