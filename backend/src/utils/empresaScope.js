// Helper minimo para as rotas escritas a mao (nao usam o crud.js generico):
// empurra a condicao "empresa_id = ?" numa lista de condicoes/params que a
// propria rota ja monta (mesmo padrao usado em toda listagem com filtros
// opcionais - ver viagens.routes.js). Sem abstracao de query-builder de
// proposito: o codebase nao tem nenhuma, e nao vale introduzir uma so por
// causa disso.
function condicaoEmpresa(condicoes, params, req) {
  condicoes.push('empresa_id = ?');
  params.push(req.empresaId);
}

module.exports = { condicaoEmpresa };
