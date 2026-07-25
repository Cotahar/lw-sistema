-- =====================================================================
-- SISTEMA DE GESTAO DE FROTA E TRANSPORTE RODOVIARIO (FROTTEX)
-- PASSO 1 - MODELAGEM DO BANCO DE DADOS (SQLite)
-- =====================================================================
-- Convencoes gerais:
--   * Nomes de tabelas/colunas em portugues (snake_case), alinhados ao
--     vocabulario do negocio usado no PRD.
--   * Toda tabela de cadastro/operacao possui "id" INTEGER PRIMARY KEY
--     (rowid do SQLite, mais eficiente para FKs).
--   * Valores monetarios sao armazenados em CENTAVOS (INTEGER), nunca
--     em ponto flutuante, para evitar erros de arredondamento em
--     somas financeiras (DRE, acertos, contas a pagar/receber). A
--     camada de API (Passo 2) converte para R$ na entrada/saida e o
--     frontend aplica a mascara "R$ 0.000,00" (Passo 3).
--   * Datas armazenadas em formato ISO-8601 ("AAAA-MM-DD" ou
--     "AAAA-MM-DD HH:MM:SS") por ser o formato nativo de ordenacao e
--     filtro do SQLite. A mascara DD/MM/AAAA e responsabilidade da UI.
--   * Booleanos: INTEGER 0/1 (SQLite nao possui tipo boolean nativo).
--   * "Enums" fechados (poucas opcoes, regra de negocio depende deles)
--     usam CHECK. Listas abertas/gerenciaveis pelo Admin (ex.: tipos de
--     fornecedor, categorias de despesa) viram tabelas de dominio.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- =====================================================================
-- 0. USUARIOS, PERMISSOES E AUDITORIA
-- =====================================================================

CREATE TABLE usuarios (
    id              INTEGER PRIMARY KEY,
    nome            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    -- Login passou a ser por username (mais pratico pro motorista digitar no
    -- celular do que um e-mail) - email vira so um dado de contato. Nullable
    -- no banco (obrigatoriedade fica na aplicacao) pra nao exigir rebuild
    -- de tabela toda vez; UNIQUE ja aceita varios NULL sem conflito.
    username        TEXT UNIQUE,
    senha_hash      TEXT NOT NULL,
    -- "perfil" e o PERFIL BASE do usuario (o que ele tem por padrao em todo
    -- modulo que nao tiver uma excecao especifica em usuario_permissoes):
    -- Admin sempre tem acesso total (nao passa pela matriz de permissoes);
    -- Comum tem Gerenciar (ver + cadastrar) em tudo por padrao; Visualizacao
    -- tem so leitura em tudo por padrao. Ver usuario_permissoes para os casos
    -- em que um usuario Comum/Visualizacao precisa de um nivel diferente do
    -- padrao em um modulo especifico (ex.: sem acesso nenhum a Financeiro).
    -- Motorista e um perfil a parte: nao passa pela matriz de permissoes (fica
    -- de fora, nivel sempre 'Nenhum' la) e sim pelo modulo mobile proprio
    -- (ver motorista.routes.js), restrito aos dados do motorista_id vinculado.
    perfil          TEXT NOT NULL CHECK (perfil IN ('Admin', 'Comum', 'Visualizacao', 'Motorista')),
    -- Preenchido somente quando perfil='Motorista': liga este login ao
    -- cadastro do motorista (tabela motoristas) cuja viagem atual ele pode
    -- ver/lancar abastecimento. NULL para os demais perfis.
    motorista_id    INTEGER REFERENCES motoristas(id),
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    atualizado_em   TEXT
);

-- Catalogo dos modulos/telas do sistema, usado para montar a matriz de
-- permissoes por usuario e o menu do frontend. Adicionar um modulo novo no
-- futuro = uma linha aqui + o middleware correspondente nas rotas daquele
-- modulo (nao e algo que o usuario final cria pela tela).
CREATE TABLE modulos_sistema (
    chave   TEXT PRIMARY KEY,   -- identificador estavel usado no codigo (ex.: 'viagens')
    nome    TEXT NOT NULL,      -- rotulo exibido na tela de permissoes
    ordem   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO modulos_sistema (chave, nome, ordem) VALUES
    ('fornecedores', 'Fornecedores', 10),
    ('motoristas', 'Motoristas', 20),
    ('veiculos', 'Veiculos e Frota', 30),
    ('conjuntos', 'Composicoes (Conjuntos)', 40),
    ('estoque', 'Estoque', 50),
    ('pneus', 'Pneus', 60),
    ('manutencao', 'Manutencao (Ordens de Servico)', 70),
    ('alertas', 'Alertas de Manutencao', 80),
    ('checklist', 'Checklist de Bordo', 90),
    ('viagens', 'Viagens e Fretes', 100),
    ('contas_bancarias', 'Contas Bancarias (Caixa)', 110),
    ('contas_pagar', 'Contas a Pagar', 120),
    ('contas_receber', 'Contas a Receber', 130),
    ('despesas_fixas', 'Despesas Fixas', 140),
    ('financiamentos', 'Financiamentos', 150),
    ('acertos', 'Acerto de Viagem', 160),
    ('multas', 'Multas de Transito', 165),
    ('dre', 'DRE e Relatorios', 170);

-- Excecoes ao perfil base, por usuario e por modulo. Se nao houver linha
-- aqui para (usuario, modulo), vale o nivel padrao do perfil base dele.
-- 'Nenhum' = nem acessa a tela; 'Visualizar' = so leitura; 'Gerenciar' = ve
-- e cadastra/edita/exclui. Nao existe excecao para Admin (sempre Gerenciar).
CREATE TABLE usuario_permissoes (
    id           INTEGER PRIMARY KEY,
    usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    modulo       TEXT NOT NULL REFERENCES modulos_sistema(chave),
    nivel        TEXT NOT NULL CHECK (nivel IN ('Nenhum', 'Visualizar', 'Gerenciar')),
    UNIQUE (usuario_id, modulo)
);

-- Quais empresas (tenants) cada usuario pode acessar/trocar no seletor do
-- cabecalho - eixo ortogonal a usuario_permissoes (isso e "o que"; aquilo e
-- "onde"). Sem excecao para Admin (acesso implicito a todas, mesma logica
-- ja aplicada a usuario_permissoes).
CREATE TABLE usuario_empresas (
    id          INTEGER PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    UNIQUE (usuario_id, empresa_id)
);

-- Log de auditoria generico (quem cadastrou/alterou o que).
-- "tabela_afetada" + "registro_id" apontam para qualquer linha do
-- banco sem precisar de uma tabela de log por entidade.
CREATE TABLE logs_auditoria (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    usuario_id      INTEGER REFERENCES usuarios(id),
    tabela_afetada  TEXT NOT NULL,
    registro_id     INTEGER NOT NULL,
    acao            TEXT NOT NULL CHECK (acao IN ('INSERT', 'UPDATE', 'DELETE')),
    dados_antes     TEXT,   -- JSON serializado do registro antes da acao
    dados_depois    TEXT,   -- JSON serializado do registro depois da acao
    -- Preenchidos quando um Admin reverte esta acao (ver backend/src/routes/admin.routes.js).
    -- Uma acao so pode ser revertida uma vez, e so quando for a mais recente
    -- registrada para aquele registro_id (evita sobrescrever mudancas mais novas).
    revertido_em    TEXT,
    revertido_por   INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_logs_auditoria_tabela_registro ON logs_auditoria(tabela_afetada, registro_id);

-- =====================================================================
-- 1. CADASTROS BASICOS
-- =====================================================================

-- Lista de tipos de fornecedor gerenciavel pelo Admin (PRD cita "etc."
-- como sinal de que a lista deve ser extensivel, nao fixa em CHECK).
CREATE TABLE fornecedor_tipos (
    id      INTEGER PRIMARY KEY,
    nome    TEXT NOT NULL UNIQUE  -- Posto, Oficina, Borracharia, Concessionaria, Seguradora...
);

CREATE TABLE fornecedores (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    nome            TEXT NOT NULL,
    cnpj            TEXT UNIQUE,        -- somente digitos
    tipo_id         INTEGER NOT NULL REFERENCES fornecedor_tipos(id),
    telefone        TEXT,
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    atualizado_em   TEXT
);
CREATE INDEX idx_fornecedores_nome ON fornecedores(nome);

CREATE TABLE motoristas (
    id                      INTEGER PRIMARY KEY,
    empresa_id              INTEGER NOT NULL REFERENCES empresas(id),
    nome                    TEXT NOT NULL,
    cpf                     TEXT NOT NULL UNIQUE,   -- somente digitos
    cnh                     TEXT NOT NULL,
    cnh_validade            TEXT NOT NULL,           -- AAAA-MM-DD
    -- Saldo em cache (centavos). Positivo = motorista deve a empresa
    -- (pegou mais do que tinha direito e ainda nao foi abatido).
    -- E o "espelho" da ultima linha de motorista_conta_corrente_lancamentos;
    -- ver secao 7 para o razao completo (auditavel) desse saldo.
    saldo_conta_corrente    INTEGER NOT NULL DEFAULT 0,
    ativo                   INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em               TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    atualizado_em           TEXT
);
CREATE INDEX idx_motoristas_nome ON motoristas(nome);

CREATE TABLE veiculos (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    placa               TEXT NOT NULL UNIQUE,
    tipo                TEXT NOT NULL CHECK (tipo IN ('Cavalo', 'Carreta', 'Dolly', 'Truck', 'Toco')),
    qtd_eixos           INTEGER NOT NULL,
    marca               TEXT,
    modelo              TEXT,
    ano_fabricacao      INTEGER,
    -- Somente preenchido quando tipo = 'Cavalo': carreta sugerida por
    -- padrao ao montar um conjunto (nao impede compor com outra).
    carreta_padrao_id   INTEGER REFERENCES veiculos(id),
    hodometro_atual     INTEGER NOT NULL DEFAULT 0,  -- km; atualizado por hodometro_eventos
    -- Cache da localizacao mais recente (atualizado por localizacao_eventos),
    -- mesmo padrao do hodometro_atual. origem_id preenchido implicitamente:
    -- ver localizacao_eventos para o historico completo e a origem (Onixsat/Manual).
    localizacao_cidade      TEXT,
    localizacao_uf          TEXT,
    localizacao_atualizado_em TEXT,
    -- Cache do nivel de combustivel mais recente (campo "lt" da Onixsat),
    -- mesmo padrao do hodometro_atual - ver hodometro_eventos.nivel_tanque_litros
    -- para o historico completo.
    nivel_tanque_litros REAL,
    ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    atualizado_em       TEXT,
    CHECK (tipo = 'Cavalo' OR carreta_padrao_id IS NULL)
);
CREATE INDEX idx_veiculos_placa ON veiculos(placa);
CREATE INDEX idx_veiculos_tipo ON veiculos(tipo);

-- =====================================================================
-- 2. ENGATES / COMPOSICOES (CONJUNTOS)
-- =====================================================================

-- Um "conjunto" e uma composicao de veiculos (Cavalo + Carreta(s) +
-- Dolly...) que opera uma viagem. E salvo/reutilizavel: o usuario pode
-- montar um novo na hora ou reaproveitar um ja existente.
CREATE TABLE conjuntos (
    id          INTEGER PRIMARY KEY,
    empresa_id  INTEGER NOT NULL REFERENCES empresas(id),
    nome        TEXT,               -- rotulo opcional, ex.: "Rodotrem 01"
    ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

-- Itens do conjunto. O "papel" de cada veiculo (Cavalo, Carreta 1,
-- Carreta 2, Dolly...) e inferido de veiculos.tipo + a posicao "ordem"
-- (ordem 1 = mais a frente), evitando guardar um papel redundante que
-- poderia contradizer o tipo cadastrado do veiculo.
CREATE TABLE conjunto_itens (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    conjunto_id     INTEGER NOT NULL REFERENCES conjuntos(id) ON DELETE CASCADE,
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    ordem           INTEGER NOT NULL,  -- 1, 2, 3... posicao na composicao
    UNIQUE (conjunto_id, ordem),
    UNIQUE (conjunto_id, veiculo_id)
);
CREATE INDEX idx_conjunto_itens_veiculo ON conjunto_itens(veiculo_id);

-- =====================================================================
-- 3. ESTOQUE CENTRAL E PNEUS
-- =====================================================================

CREATE TABLE estoque_itens (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    nome                TEXT NOT NULL,
    categoria           TEXT NOT NULL CHECK (categoria IN ('Peca', 'Acessorio', 'EPI', 'Utensilio')),
    unidade_medida      TEXT NOT NULL DEFAULT 'UN',
    quantidade_atual    REAL NOT NULL DEFAULT 0,
    custo_medio         INTEGER NOT NULL DEFAULT 0,  -- centavos
    estoque_minimo      REAL NOT NULL DEFAULT 0,
    ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    atualizado_em       TEXT
);
CREATE INDEX idx_estoque_itens_nome ON estoque_itens(nome);

-- Toda entrada/saida do almoxarifado passa por aqui. Isso e o que
-- separa Fluxo de Caixa (a compra gera conta a pagar na hora) de DRE
-- (o custo so vira despesa do veiculo quando a peca "sai" do estoque
-- com destino a um veiculo). Ver contas_pagar.origem_tipo = 'EstoqueMovimentacao'.
CREATE TABLE estoque_movimentacoes (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    item_id             INTEGER NOT NULL REFERENCES estoque_itens(id),
    tipo                TEXT NOT NULL CHECK (tipo IN ('Entrada', 'Saida')),
    quantidade          REAL NOT NULL,
    custo_unitario      INTEGER NOT NULL,  -- centavos, obrigatorio nas duas pontas
    fornecedor_id       INTEGER REFERENCES fornecedores(id),  -- quem vendeu, em Entradas (compra)
    -- Preenchido apenas em saidas por instalacao direta (sem OS): e o
    -- gatilho que lanca o custo no DRE do veiculo. Quando a saida vem
    -- de uma OS (os_id preenchido), o custo ja esta representado em
    -- ordens_servico.valor_pecas, entao essa linha NAO entra de novo
    -- no DRE (evita contar o mesmo custo duas vezes).
    veiculo_destino_id  INTEGER REFERENCES veiculos(id),
    os_id               INTEGER REFERENCES ordens_servico(id),
    data                TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    observacao          TEXT,
    criado_por          INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_estoque_mov_item ON estoque_movimentacoes(item_id);
CREATE INDEX idx_estoque_mov_veiculo ON estoque_movimentacoes(veiculo_destino_id);

CREATE TABLE pneus (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    numero_fogo         TEXT NOT NULL UNIQUE,   -- numero de serie/fogo
    marca               TEXT,
    modelo              TEXT,
    medida              TEXT NOT NULL,
    custo_unitario      INTEGER NOT NULL,       -- centavos (custo de aquisicao, historico/informativo)
    -- 'EmRecapagem' = fora da frota e fora do estoque, na recapadora.
    status              TEXT NOT NULL CHECK (status IN ('Estoque', 'EmRecapagem', 'Sucata', 'Instalado')),
    -- Posicao atual (somente quando status = 'Instalado'):
    veiculo_id          INTEGER REFERENCES veiculos(id),
    eixo                INTEGER,
    lado                TEXT CHECK (lado IN ('Esquerdo', 'Direito')),
    numero_recapagens   INTEGER NOT NULL DEFAULT 0,  -- 0 = Novo, 1 = Recapado 1, ...
    -- Custo (centavos) ainda nao lancado no DRE de nenhum veiculo.
    -- Definido pela aplicacao como custo_unitario na Aquisicao (1a vida)
    -- e como o valor da recapagem apos um RetornoRecapagem (vidas
    -- seguintes). E zerado assim que consumido pelo proximo evento de
    -- Instalacao, que e o unico ponto onde o custo de pneu bate no DRE
    -- do veiculo. Isso garante que uma reinstalacao sem recapagem no
    -- meio nao gera custo duplicado, e que uma recapagem so carrega o
    -- valor da propria recapagem (o custo de aquisicao original ja foi
    -- reconhecido na primeira instalacao).
    custo_pendente_dre  INTEGER NOT NULL DEFAULT 0,
    fornecedor_id       INTEGER REFERENCES fornecedores(id),  -- fornecedor da compra original
    data_aquisicao      TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    CHECK (status = 'Instalado' OR (veiculo_id IS NULL AND eixo IS NULL AND lado IS NULL))
);
CREATE INDEX idx_pneus_veiculo ON pneus(veiculo_id);
CREATE INDEX idx_pneus_status ON pneus(status);

-- Historico de vida do pneu: cada aquisicao, instalacao, remocao, envio
-- e retorno de recapagem ou sucateamento vira uma linha aqui,
-- preservando o rastro completo mesmo depois que "pneus" reflete so a
-- posicao atual. "custo" e o valor pago naquele evento especifico
-- (Aquisicao = compra do pneu novo; RetornoRecapagem = valor da
-- recapadora; Instalacao = o custo_pendente_dre consumido nesse
-- ciclo, muitas vezes zero em reinstalacoes sem recapagem no meio).
CREATE TABLE pneu_eventos (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    pneu_id         INTEGER NOT NULL REFERENCES pneus(id),
    tipo_evento     TEXT NOT NULL CHECK (tipo_evento IN ('Aquisicao', 'Instalacao', 'Remocao', 'EnvioRecapagem', 'RetornoRecapagem', 'Sucateamento')),
    veiculo_id      INTEGER REFERENCES veiculos(id),
    eixo            INTEGER,
    lado            TEXT CHECK (lado IN ('Esquerdo', 'Direito')),
    km_veiculo      INTEGER,
    fornecedor_id   INTEGER REFERENCES fornecedores(id),  -- recapadora, no caso de Envio/RetornoRecapagem
    custo           INTEGER,   -- centavos; ver regra de custo_pendente_dre acima
    data            TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    observacao      TEXT,
    criado_por      INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_pneu_eventos_pneu ON pneu_eventos(pneu_id);

-- =====================================================================
-- 4. MANUTENCAO, ALERTAS E INVENTARIO DE BORDO
-- =====================================================================

CREATE TABLE ordens_servico (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    data            TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    hodometro       INTEGER NOT NULL,
    tipo            TEXT NOT NULL CHECK (tipo IN ('Preventiva', 'Corretiva')),
    fornecedor_id   INTEGER REFERENCES fornecedores(id),  -- oficina
    valor_pecas     INTEGER NOT NULL DEFAULT 0,   -- centavos (totalizador rapido)
    valor_mao_obra  INTEGER NOT NULL DEFAULT 0,   -- centavos
    -- Parcelamento opcional (peca/servico pago parcelado ao fornecedor). NULL
    -- = sem parcelamento (comportamento original: valor_pecas + valor_mao_obra
    -- gera 1 unica conta_pagar). Preenchido = (valor_pecas + valor_mao_obra) e
    -- dividido em qtd_parcelas parcelas mensais - ver os_parcelas.
    -- valor_parcelado existe por simetria com despesas_fixas mas nao e usado
    -- hoje (o total parcelado e sempre valor_pecas + valor_mao_obra).
    valor_parcelado INTEGER,
    qtd_parcelas    INTEGER,
    descricao       TEXT,
    criado_por      INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_os_veiculo ON ordens_servico(veiculo_id);
CREATE INDEX idx_os_data ON ordens_servico(data);

-- Parcelas de uma OS parcelada (mesmo padrao de financiamento_parcelas).
CREATE TABLE os_parcelas (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    os_id               INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    numero_parcela      INTEGER NOT NULL,
    data_vencimento     TEXT NOT NULL,
    valor_parcela       INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Paga')),
    data_pagamento      TEXT
);

-- Itens detalhados da OS (o que foi trocado/realizado). Quando
-- "estoque_item_id" e preenchido, a baixa correspondente deve existir
-- em estoque_movimentacoes (tipo='Saida', os_id=esta OS).
CREATE TABLE os_itens (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    os_id               INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    estoque_item_id     INTEGER REFERENCES estoque_itens(id),
    pneu_id             INTEGER REFERENCES pneus(id),
    descricao           TEXT NOT NULL,
    quantidade          REAL NOT NULL DEFAULT 1,
    valor_unitario      INTEGER NOT NULL DEFAULT 0  -- centavos
);
CREATE INDEX idx_os_itens_os ON os_itens(os_id);

-- Regras de alerta programavel por KM (ex.: revisao a cada 50.000 km).
CREATE TABLE alertas_regras (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    veiculo_id      INTEGER REFERENCES veiculos(id),  -- NULL = regra generica p/ toda a frota
    descricao       TEXT NOT NULL,
    intervalo_km    INTEGER NOT NULL,
    km_referencia   INTEGER NOT NULL DEFAULT 0,  -- ultimo km em que a regra foi cumprida/resetada
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

-- Ocorrencias geradas quando km_atual - km_referencia >= intervalo_km.
-- Guardar a ocorrencia (em vez de so calcular on-the-fly) permite
-- historico de alertas resolvidos/pendentes no Dashboard.
CREATE TABLE alertas_ocorrencias (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    regra_id            INTEGER NOT NULL REFERENCES alertas_regras(id),
    veiculo_id          INTEGER NOT NULL REFERENCES veiculos(id),
    km_atual_no_disparo INTEGER NOT NULL,
    data_disparo        TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Resolvido')),
    resolvido_em        TEXT
);
CREATE INDEX idx_alertas_ocorrencias_veiculo ON alertas_ocorrencias(veiculo_id, status);

-- Catalogo de itens fixos de checklist (Defletores, Geladeira, Radio
-- PX, Rastreador Onixsat, Caixa de Cozinha...).
CREATE TABLE checklist_itens_catalogo (
    id      INTEGER PRIMARY KEY,
    nome    TEXT NOT NULL UNIQUE,
    ativo   INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

-- Estado do checklist por placa (ultimo valor conhecido de cada item - usado
-- como ponto de partida ao abrir uma vistoria nova, ver checklist_vistorias).
CREATE TABLE veiculo_checklist (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    item_id         INTEGER NOT NULL REFERENCES checklist_itens_catalogo(id),
    presente        INTEGER NOT NULL DEFAULT 1 CHECK (presente IN (0, 1)),
    observacao      TEXT,
    atualizado_em   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    UNIQUE (veiculo_id, item_id)
);

-- Vistoria periodica do checklist (a cada ~30 dias, em media) - um registro
-- por "rodada" feita no CONJUNTO, para ter historico no tempo (antes so
-- existia o estado atual mutavel em veiculo_checklist). E do conjunto porque
-- e assim que o motorista pensa na vistoria (o rodotrem inteiro), mas os
-- itens em si (checklist_vistoria_itens) sao por veiculo/placa, porque
-- carretas podem trocar de conjunto e o item pertence a placa fisica.
CREATE TABLE checklist_vistorias (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    conjunto_id     INTEGER NOT NULL REFERENCES conjuntos(id),
    data_vistoria   TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
    criado_por      INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_checklist_vistorias_conjunto ON checklist_vistorias(conjunto_id, data_vistoria);

-- Estado de cada item na vistoria, por veiculo (nao por conjunto - ver
-- comentario acima). O conjunto de veiculo_id distintos aqui e o "retrato" da
-- composicao do conjunto no momento da vistoria; se divergir da composicao
-- atual (conjunto_itens), o frontend avisa o usuario (troca de carreta/cavalo
-- entre a vistoria e hoje).
CREATE TABLE checklist_vistoria_itens (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    vistoria_id     INTEGER NOT NULL REFERENCES checklist_vistorias(id) ON DELETE CASCADE,
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    item_id         INTEGER NOT NULL REFERENCES checklist_itens_catalogo(id),
    presente        INTEGER NOT NULL DEFAULT 1 CHECK (presente IN (0, 1)),
    observacao      TEXT,
    UNIQUE (vistoria_id, veiculo_id, item_id)
);
CREATE INDEX idx_checklist_vistoria_itens_vistoria ON checklist_vistoria_itens(vistoria_id);

-- Registro fotografico do veiculo no Recebimento (motorista pega o caminhao) e
-- na Entrega (motorista devolve), para comparar o estado antes/depois. item_id
-- e opcional: preenchido quando a foto documenta um item especifico do
-- catalogo, em branco quando e uma foto geral do veiculo. Arquivos ficam em
-- disco (backend/uploads/checklist/), so o nome do arquivo fica no banco.
CREATE TABLE veiculo_checklist_fotos (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    item_id         INTEGER REFERENCES checklist_itens_catalogo(id),
    momento         TEXT NOT NULL CHECK (momento IN ('Recebimento', 'Entrega')),
    arquivo         TEXT NOT NULL,
    criado_por      INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_checklist_fotos_veiculo ON veiculo_checklist_fotos(veiculo_id, momento);

-- =====================================================================
-- 5. VIAGENS E FRETES
-- =====================================================================

CREATE TABLE viagens (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    data_inicio     TEXT NOT NULL,
    data_fim        TEXT,
    conjunto_id     INTEGER NOT NULL REFERENCES conjuntos(id),
    motorista_id    INTEGER NOT NULL REFERENCES motoristas(id),
    status          TEXT NOT NULL DEFAULT 'EmAndamento' CHECK (status IN ('EmAndamento', 'AguardandoAcerto', 'Finalizada')),
    -- Sugerido automaticamente = km_final da ultima viagem do mesmo
    -- Cavalo (resolvido pela API no momento da criacao), mas editavel.
    km_inicial      INTEGER NOT NULL,
    km_final        INTEGER,   -- preenchido no fechamento; diferenca = km_total (absorve trechos vazios)
    criado_por      INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    CHECK (km_final IS NULL OR km_final >= km_inicial)
);
CREATE INDEX idx_viagens_conjunto ON viagens(conjunto_id);
CREATE INDEX idx_viagens_motorista ON viagens(motorista_id);
CREATE INDEX idx_viagens_status ON viagens(status);

-- Leituras de hodometro: tanto os eventos futuros da API Onixsat
-- quanto os lancamentos manuais (fallback obrigatorio) caem aqui,
-- dando log completo de quem/quando alterou o KM de um veiculo.
CREATE TABLE hodometro_eventos (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    km              INTEGER NOT NULL,
    origem          TEXT NOT NULL CHECK (origem IN ('Onixsat', 'Manual')),
    usuario_id      INTEGER REFERENCES usuarios(id),  -- obrigatorio quando origem='Manual'
    data_hora       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    observacao      TEXT,
    -- Litros no tanque nesse instante (campo "lt" que a Onixsat ja manda em
    -- toda RequestMensagemCB, junto do hodometro) - NULL em lancamentos
    -- Manual. Usado pra estimar consumo "ao vivo" no painel do motorista.
    nivel_tanque_litros REAL
);
CREATE INDEX idx_hodometro_eventos_veiculo ON hodometro_eventos(veiculo_id, data_hora);

-- Leituras de localizacao: mesmo padrao do hodometro_eventos - eventos
-- futuros da API Onixsat (que traria lat/lng) e lancamentos manuais
-- (fallback, so cidade/UF) caem aqui. veiculos.localizacao_* e so a cache
-- da leitura mais recente, para nao precisar de subquery a cada listagem.
CREATE TABLE localizacao_eventos (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    cidade          TEXT NOT NULL,
    uf              TEXT NOT NULL,
    latitude        REAL,
    longitude       REAL,
    origem          TEXT NOT NULL CHECK (origem IN ('Onixsat', 'Manual')),
    usuario_id      INTEGER REFERENCES usuarios(id),  -- obrigatorio quando origem='Manual'
    data_hora       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    observacao      TEXT
);
CREATE INDEX idx_localizacao_eventos_veiculo ON localizacao_eventos(veiculo_id, data_hora);

CREATE TABLE fretes (
    id                          INTEGER PRIMARY KEY,
    empresa_id                  INTEGER NOT NULL REFERENCES empresas(id),
    viagem_id                   INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
    -- Transportadora contratante deste frete (o frotista e sempre contratado
    -- por uma). Reaproveita o cadastro de fornecedores (tipo 'Transportadora',
    -- gerenciavel em Config > Tipos de Fornecedor) em vez de uma tabela nova.
    transportadora_id           INTEGER REFERENCES fornecedores(id),
    origem_cidade               TEXT NOT NULL,
    origem_uf                   TEXT NOT NULL,
    destino_cidade              TEXT NOT NULL,
    destino_uf                  TEXT NOT NULL,
    peso_carga_kg               INTEGER,
    frete_bruto                 INTEGER NOT NULL,  -- centavos; valor base do recebivel (ver contas_receber_baixas)
    data_carregamento           TEXT,  -- data em que a carga foi carregada (distinta de criado_em)
    criado_em                    TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_fretes_viagem ON fretes(viagem_id);

-- Adiantamentos tomados PELO MOTORISTA a qualquer momento durante a viagem
-- (nao mais atrelados a um frete especifico - podem ocorrer antes de existir
-- qualquer frete cadastrado). Independente das baixas do recebivel do cliente
-- (contas_receber_baixas). Usado no Acerto de Viagem como deducao da comissao.
-- conta_bancaria_id e opcional, no mesmo padrao de contas_receber_baixas: se
-- informado, sai dinheiro de verdade do caixa (movimentacoes_caixa); se em
-- branco, e so um registro contabil (ex.: dinheiro vivo/malote da viagem).
CREATE TABLE viagem_adiantamentos (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    viagem_id           INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
    conta_bancaria_id   INTEGER REFERENCES contas_bancarias(id),
    descricao           TEXT,
    criado_por          INTEGER REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_viagem_adiantamentos_viagem ON viagem_adiantamentos(viagem_id);

-- =====================================================================
-- 6. CENTROS DE CUSTO, COMISSAO E DESPESAS
-- =====================================================================

-- Toda despesa "avulsa" (nao-viagem) e financiamento precisa apontar
-- para Placa OU Base/Administrativo. Modelar como tabela (em vez de um
-- veiculo_id nullable + flag) da um FK unico para as tabelas de
-- despesa/financeiro e deixa a consulta de DRE (uniao de custos por
-- centro) mais simples.
CREATE TABLE centros_custo (
    id          INTEGER PRIMARY KEY,
    empresa_id  INTEGER NOT NULL REFERENCES empresas(id),
    tipo        TEXT NOT NULL CHECK (tipo IN ('Veiculo', 'Base')),
    veiculo_id  INTEGER UNIQUE REFERENCES veiculos(id),
    nome        TEXT NOT NULL,  -- para tipo='Base': "Base/Administrativo"; para 'Veiculo': a placa
    CHECK ((tipo = 'Veiculo' AND veiculo_id IS NOT NULL) OR (tipo = 'Base' AND veiculo_id IS NULL))
);
-- Cada empresa tem exatamente 1 centro "Base" (garantido pelo indice unico
-- parcial abaixo); criado automaticamente pelo backend quando a empresa e
-- cadastrada (ver POST /empresas), nao mais como seed fixa aqui - antes so
-- existia 1 empresa implicita, agora o insert depende de qual empresa.
CREATE UNIQUE INDEX idx_centros_custo_base_por_empresa ON centros_custo(empresa_id) WHERE tipo = 'Base';

CREATE TABLE categorias_despesa (
    id              INTEGER PRIMARY KEY,
    nome            TEXT NOT NULL UNIQUE,  -- Abastecimento, Chapa, Borracharia, Pedagio, Seguro, Rastreamento...
    -- Categoria continua existindo/valida (relatorios, historico), so nao
    -- aparece na busca do formulario de despesa. Usado pela 'Arla', que
    -- passou a ser lancada via bloco expansivel dentro de Abastecimento.
    oculta_na_busca INTEGER NOT NULL DEFAULT 0 CHECK (oculta_na_busca IN (0, 1))
);

-- Faixas de KM/L -> % de comissao sobre o Frete Bruto. Cadastro restrito
-- a Admin (aplicado na regra de permissao, nao no schema). marca NULL
-- funciona como fallback "qualquer marca" (faixas antigas continuam
-- valendo sem precisar recadastrar); marca preenchida so vale para
-- veiculos daquela marca especifica.
CREATE TABLE comissao_faixas (
    id                  INTEGER PRIMARY KEY,
    marca               TEXT,
    km_l_de             REAL NOT NULL,
    km_l_ate            REAL NOT NULL,
    percentual_comissao REAL NOT NULL,  -- ex.: 10 = 10%
    ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    CHECK (km_l_ate >= km_l_de)
);

CREATE TABLE despesas_viagem (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    viagem_id           INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
    -- Frete ao qual esta despesa pertence (para o relatorio de custo por
    -- frete). Preenchido automaticamente com o ultimo frete cadastrado da
    -- viagem; despesas lancadas antes do primeiro frete ficam com frete_id
    -- NULL ate serem associadas retroativamente a ele.
    frete_id            INTEGER REFERENCES fretes(id),
    centro_custo_id     INTEGER NOT NULL REFERENCES centros_custo(id),
    categoria_id        INTEGER NOT NULL REFERENCES categorias_despesa(id),
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
    pago_por            TEXT NOT NULL CHECK (pago_por IN ('Empresa', 'Motorista', 'AdminOutros')),
    pago_por_usuario_id INTEGER REFERENCES usuarios(id),  -- obrigatorio quando pago_por='AdminOutros'
    -- Campos especificos de Abastecimento (NULL para as demais categorias):
    posto_fornecedor_id INTEGER REFERENCES fornecedores(id),
    preco_litro         INTEGER,   -- centavos
    litragem             REAL,
    km_abastecimento    INTEGER,
    -- Despesa faturada com vencimento futuro: gera um lancamento em
    -- contas_pagar (contas_pagar_id aponta pra ele) em vez de ja considerar
    -- paga na hora do lancamento.
    data_vencimento     TEXT,
    contas_pagar_id     INTEGER REFERENCES contas_pagar(id),
    descricao           TEXT,
    -- Foto da NFe/cupom fiscal (nome do arquivo, mesmo padrao de
    -- veiculo_checklist_fotos.arquivo) - preenchida quando o abastecimento
    -- vem do app do motorista; NULL nos lancamentos feitos pelo escritorio.
    foto_recibo         TEXT,
    -- Chave gerada no celular do motorista (crypto.randomUUID) pra evitar
    -- duplicar o lancamento se a sincronizacao offline reenviar a mesma
    -- despesa depois de uma resposta perdida. NULL nos demais lancamentos;
    -- UNIQUE aceita varios NULL sem conflito.
    idempotency_key     TEXT UNIQUE,
    -- Só relevante para abastecimento lançado pelo app do motorista: se o
    -- posto fatura depois ("assinar nota"), o vencimento real só é
    -- conhecido na validação pelo escritório - ver validado_em abaixo.
    forma_pagamento_posto TEXT CHECK (forma_pagamento_posto IN ('Imediato', 'AssinarNota')),
    -- NULL = pendente de validação (só lançamentos do app do motorista
    -- nascem assim; escritório e importação Drivvo já nascem validados).
    validado_por        INTEGER REFERENCES usuarios(id),
    validado_em         TEXT,
    -- Liga a despesa de diesel a sua Arla irmã (mesmo lançamento unificado,
    -- 2 linhas sem elo hoje) - usado na validação pra somar os dois valores
    -- numa única conta a pagar combinada quando forma_pagamento_posto for
    -- 'AssinarNota' (contas_pagar_id fica NULL em ambas até validar).
    despesa_arla_id     INTEGER REFERENCES despesas_viagem(id),
    criado_por          INTEGER REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_despesas_viagem_viagem ON despesas_viagem(viagem_id);
CREATE INDEX idx_despesas_viagem_centro ON despesas_viagem(centro_custo_id);
CREATE INDEX idx_despesas_viagem_frete ON despesas_viagem(frete_id);

-- Despesas fixas/recorrentes nao ligadas a uma viagem especifica
-- (seguro, rastreamento, salario administrativo, aluguel da base...).
CREATE TABLE despesas_fixas (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    centro_custo_id     INTEGER NOT NULL REFERENCES centros_custo(id),
    categoria_id        INTEGER NOT NULL REFERENCES categorias_despesa(id),
    valor               INTEGER NOT NULL,  -- centavos (total, mesmo quando parcelada)
    data                TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
    recorrente          INTEGER NOT NULL DEFAULT 0 CHECK (recorrente IN (0, 1)),
    -- Parcelamento opcional. NULL = lancamento avulso (comportamento
    -- original: gera 1 unica conta_pagar). Preenchido = valor e dividido em
    -- qtd_parcelas parcelas mensais - ver despesa_fixa_parcelas.
    qtd_parcelas        INTEGER,
    descricao           TEXT,
    criado_por          INTEGER REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_despesas_fixas_centro ON despesas_fixas(centro_custo_id);

-- Parcelas de uma despesa fixa parcelada (mesmo padrao de financiamento_parcelas).
CREATE TABLE despesa_fixa_parcelas (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    despesa_fixa_id     INTEGER NOT NULL REFERENCES despesas_fixas(id) ON DELETE CASCADE,
    numero_parcela      INTEGER NOT NULL,
    data_vencimento     TEXT NOT NULL,
    valor_parcela       INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Paga')),
    data_pagamento      TEXT
);

CREATE TABLE financiamentos (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    centro_custo_id     INTEGER NOT NULL REFERENCES centros_custo(id),
    descricao           TEXT NOT NULL,
    credor_fornecedor_id INTEGER REFERENCES fornecedores(id),
    valor_total         INTEGER NOT NULL,  -- centavos
    qtd_parcelas        INTEGER NOT NULL,
    data_contrato       TEXT NOT NULL DEFAULT (date('now', '-3 hours'))
);

-- Por decisao do usuario, nao separamos juros de principal: o valor
-- cheio da parcela afeta tanto o caixa quanto o DRE do centro de custo.
CREATE TABLE financiamento_parcelas (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    financiamento_id    INTEGER NOT NULL REFERENCES financiamentos(id) ON DELETE CASCADE,
    numero_parcela      INTEGER NOT NULL,
    data_vencimento     TEXT NOT NULL,
    valor_parcela       INTEGER NOT NULL,  -- centavos (valor cheio, considerado integralmente no DRE)
    data_pagamento      TEXT,
    status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Paga', 'Atrasada')),
    UNIQUE (financiamento_id, numero_parcela)
);
CREATE INDEX idx_financiamento_parcelas_financiamento ON financiamento_parcelas(financiamento_id);

-- =====================================================================
-- 7. FINANCEIRO: CAIXA, CONTAS A PAGAR/RECEBER
-- =====================================================================

CREATE TABLE contas_bancarias (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    nome            TEXT NOT NULL,
    banco           TEXT,
    agencia         TEXT,
    conta           TEXT,
    saldo_atual     INTEGER NOT NULL DEFAULT 0,  -- centavos, cache; ver movimentacoes_caixa p/ razao
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

-- Contas a pagar de qualquer origem (compra de estoque, OS, despesa de
-- viagem paga pela empresa, despesa fixa, parcela de financiamento,
-- reembolso a admin/terceiro). "origem_tipo" + "origem_id" evitam uma
-- FK diferente por tipo de origem.
CREATE TABLE contas_pagar (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    fornecedor_id       INTEGER REFERENCES fornecedores(id),
    centro_custo_id     INTEGER REFERENCES centros_custo(id),
    descricao           TEXT NOT NULL,
    valor               INTEGER NOT NULL,  -- centavos
    data_vencimento     TEXT NOT NULL,
    data_pagamento      TEXT,
    valor_pago          INTEGER NOT NULL DEFAULT 0,  -- centavos
    valor_descontado    INTEGER NOT NULL DEFAULT 0,  -- centavos; desconto concedido na baixa (nao movimenta caixa)
    status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Parcial', 'Pago', 'Atrasado')),
    origem_tipo         TEXT CHECK (origem_tipo IN ('EstoqueMovimentacao', 'PneuEvento', 'OrdemServico', 'OrdemServicoParcela', 'DespesaViagem', 'DespesaFixa', 'DespesaFixaParcela', 'FinanciamentoParcela', 'ReembolsoMotorista', 'AcertoViagem', 'Outro')),
    origem_id           INTEGER,
    conta_bancaria_id   INTEGER REFERENCES contas_bancarias(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_contas_pagar_status ON contas_pagar(status);
CREATE INDEX idx_contas_pagar_origem ON contas_pagar(origem_tipo, origem_id);

-- Contas a receber: hoje a unica origem e o Frete, mas o padrao
-- origem_tipo/origem_id fica pronto para outras fontes futuras. O valor e o
-- valor BRUTO do frete; ele e "baixado" aos poucos via contas_receber_baixas
-- (adiantamento ja recebido, pedagio deduzido, saldo pago, desconto concedido)
-- ate fechar o saldo em aberto, em vez de uma unica baixa total.
CREATE TABLE contas_receber (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    frete_id            INTEGER NOT NULL REFERENCES fretes(id),
    centro_custo_id     INTEGER NOT NULL REFERENCES centros_custo(id),  -- unidade tratora da viagem do frete
    valor               INTEGER NOT NULL,  -- centavos, valor bruto do frete
    data_prevista       TEXT NOT NULL,
    data_recebimento    TEXT,  -- data da baixa mais recente
    valor_recebido      INTEGER NOT NULL DEFAULT 0,   -- centavos; soma das baixas exceto tipo Desconto
    valor_descontado    INTEGER NOT NULL DEFAULT 0,   -- centavos; soma das baixas tipo Desconto
    status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Parcial', 'Recebido', 'Atrasado')),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_contas_receber_status ON contas_receber(status);
CREATE INDEX idx_contas_receber_frete ON contas_receber(frete_id);

-- Cada baixa e um abatimento parcial do recebivel (pode haver varias ate
-- fechar o saldo). "conta_bancaria_id" e opcional: se preenchido, a baixa
-- movimenta caixa de verdade (entrada na conta); se em branco, e so um
-- abatimento contabil (ex.: pedagio pago direto no vale, sem passar pela
-- conta da empresa). Desconto NUNCA movimenta caixa (forcado pelo CHECK).
CREATE TABLE contas_receber_baixas (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    contas_receber_id   INTEGER NOT NULL REFERENCES contas_receber(id) ON DELETE CASCADE,
    tipo                TEXT NOT NULL CHECK (tipo IN ('Adiantamento', 'Pedagio', 'Saldo', 'Desconto', 'Outro')),
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
    conta_bancaria_id   INTEGER REFERENCES contas_bancarias(id),
    descricao           TEXT,
    criado_por          INTEGER REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    CHECK (tipo != 'Desconto' OR conta_bancaria_id IS NULL)
);
CREATE INDEX idx_contas_receber_baixas_receber ON contas_receber_baixas(contas_receber_id);

-- Movimento real de caixa (o que efetivamente entrou/saiu do banco).
-- Uma baixa em contas_pagar gera uma linha aqui (origem_id = contas_pagar.id);
-- uma baixa de contas_receber_baixas com conta_bancaria_id preenchido tambem
-- (origem_id = contas_receber_baixas.id). Baixas de recebivel sem conta
-- bancaria (abatimento contabil) ou do tipo Desconto NAO geram linha aqui.
CREATE TABLE movimentacoes_caixa (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    conta_bancaria_id   INTEGER NOT NULL REFERENCES contas_bancarias(id),
    tipo                TEXT NOT NULL CHECK (tipo IN ('Entrada', 'Saida')),
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
    descricao           TEXT,
    origem_tipo         TEXT CHECK (origem_tipo IN ('ContaPagar', 'ContaReceber', 'ViagemAdiantamento', 'Ajuste')),
    origem_id           INTEGER,
    criado_por          INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_movimentacoes_caixa_conta ON movimentacoes_caixa(conta_bancaria_id, data);

-- =====================================================================
-- 8. ACERTO DE VIAGEM E CONTA CORRENTE DO MOTORISTA
-- =====================================================================

CREATE TABLE acertos_viagem (
    id                          INTEGER PRIMARY KEY,
    empresa_id                  INTEGER NOT NULL REFERENCES empresas(id),
    viagem_id                   INTEGER NOT NULL UNIQUE REFERENCES viagens(id),
    data_acerto                 TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    media_consumo_km_l          REAL,             -- calculado a partir dos abastecimentos + km_total
    percentual_comissao_sugerido REAL,            -- resolvido via comissao_faixas pela media acima
    percentual_comissao_aplicado REAL NOT NULL,    -- copiado da sugestao, mas editavel pelo operador
    valor_comissao               INTEGER NOT NULL, -- centavos, = frete_bruto_total * percentual_aplicado
    -- Imposto da empresa sobre o frete bruto (empresas.percentual_desconto_geral).
    -- Reduz a base sobre a qual valor_comissao incide (base = frete_bruto -
    -- valor_imposto): o motorista nao recebe comissao sobre a parte que e
    -- imposto da empresa. Tambem gera um lancamento separado em contas_pagar
    -- (a empresa "deve" esse imposto pra si mesma/reserva).
    percentual_imposto_aplicado  REAL,
    valor_imposto                INTEGER NOT NULL DEFAULT 0,  -- centavos
    valor_reembolsos             INTEGER NOT NULL DEFAULT 0,  -- centavos
    valor_adiantamentos          INTEGER NOT NULL DEFAULT 0,  -- centavos
    valor_descontos              INTEGER NOT NULL DEFAULT 0,  -- centavos (multas, avarias...)
    saldo_conta_corrente_anterior INTEGER NOT NULL DEFAULT 0, -- centavos, snapshot do saldo do motorista antes deste acerto
    saldo_final                  INTEGER NOT NULL, -- centavos; formula na secao 7 do PRD
    status                       TEXT NOT NULL DEFAULT 'Aberto' CHECK (status IN ('Aberto', 'Fechado')),
    observacoes_ajustes          TEXT,   -- "fechamento livre": justificativa de ajustes manuais de caixa
    criado_por                   INTEGER REFERENCES usuarios(id),
    criado_em                    TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

-- Razao (ledger) da conta corrente do motorista: toda vez que um saldo
-- residual (positivo ou negativo) transita entre viagens, uma linha e
-- gravada aqui com o saldo antes/depois. motoristas.saldo_conta_corrente
-- e sempre igual ao "saldo_posterior" da linha mais recente deste
-- motorista - o campo na tabela motoristas e so uma cache de leitura
-- rapida (dashboard/listagens); esta tabela e a fonte de verdade
-- auditavel exigida pelo PRD.
CREATE TABLE motorista_conta_corrente_lancamentos (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    motorista_id        INTEGER NOT NULL REFERENCES motoristas(id),
    acerto_id            INTEGER REFERENCES acertos_viagem(id),
    tipo                 TEXT NOT NULL CHECK (tipo IN ('DebitoResidual', 'CreditoAbatido', 'AjusteManual')),
    valor                INTEGER NOT NULL,  -- centavos, sempre positivo; o "tipo" indica o sentido
    saldo_anterior       INTEGER NOT NULL,  -- centavos
    saldo_posterior      INTEGER NOT NULL,  -- centavos
    data                 TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    descricao            TEXT,
    criado_por           INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_motorista_cc_motorista ON motorista_conta_corrente_lancamentos(motorista_id, data);

-- =====================================================================
-- 8.1 MULTAS DE TRANSITO
-- =====================================================================

-- Lancamento manual (nao ha integracao automatica com orgaos de transito
-- ainda). motorista_id fica NULL ate a empresa identificar o condutor
-- responsavel; prazo_indicacao e calculado no insert (data_notificacao + 30
-- dias, art. 257 par. 8 do CTB) e valor_nao_indicacao (2x o valor original)
-- e calculado quando a multa e marcada como NaoIndicado.
CREATE TABLE multas (
    id                      INTEGER PRIMARY KEY,
    empresa_id              INTEGER NOT NULL REFERENCES empresas(id),
    veiculo_id              INTEGER NOT NULL REFERENCES veiculos(id),
    motorista_id            INTEGER REFERENCES motoristas(id),
    orgao_autuador          TEXT,
    numero_ait              TEXT,
    descricao               TEXT NOT NULL,
    valor_original          INTEGER NOT NULL,  -- centavos
    data_infracao           TEXT,
    data_notificacao        TEXT NOT NULL,
    prazo_indicacao         TEXT NOT NULL,      -- data_notificacao + 30 dias
    status                  TEXT NOT NULL DEFAULT 'AguardandoIndicacao'
                             CHECK (status IN ('AguardandoIndicacao', 'CondutorIndicado', 'NaoIndicado', 'Paga', 'Recorrida', 'Cancelada')),
    condutor_indicado_em    TEXT,
    valor_nao_indicacao     INTEGER,  -- centavos, 2x valor_original quando status = NaoIndicado
    observacoes             TEXT,
    criado_por              INTEGER REFERENCES usuarios(id),
    criado_em               TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    atualizado_em           TEXT
);
CREATE INDEX idx_multas_veiculo ON multas(veiculo_id);
CREATE INDEX idx_multas_prazo ON multas(prazo_indicacao) WHERE status = 'AguardandoIndicacao';

-- =====================================================================
-- 9. OCORRENCIAS (HISTORICO LIVRE POR REGISTRO)
-- =====================================================================

-- Linha do tempo de anotacoes livres (problema, desentendimento, ajuste,
-- justificativa...) anexada a qualquer registro de negocio, para consulta
-- futura. Generica via entidade_tipo + entidade_id (mesmo padrao de
-- contas_pagar.origem_tipo/origem_id) em vez de uma tabela por entidade.
CREATE TABLE ocorrencias (
    id              INTEGER PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    entidade_tipo   TEXT NOT NULL CHECK (entidade_tipo IN ('Viagem', 'Frete', 'DespesaViagem', 'ContaPagar', 'ContaReceber', 'AcertoViagem', 'Multa')),
    entidade_id     INTEGER NOT NULL,
    texto           TEXT NOT NULL,
    criado_por      INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_ocorrencias_entidade ON ocorrencias(entidade_tipo, entidade_id);

-- =====================================================================
-- 10. IMPORTACAO DRIVVO
-- =====================================================================

-- Cada linha de um relatorio Drivvo (abastecimento/despesa/receita) vira
-- uma linha aqui, seja ela lancada automaticamente ou pendente de revisao
-- manual. "chave_externa" e um fingerprint estavel da linha original
-- (veiculo+data+valor+secao+timestamp interno do Drivvo) - a razao de
-- existir: o export do Drivvo e sempre um dump historico completo, entao
-- reimportar o mesmo arquivo (ou um mais novo que sobrepoe periodo) nao
-- pode duplicar o que ja foi processado.
CREATE TABLE importacoes_drivvo (
    id                  INTEGER PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    chave_externa       TEXT NOT NULL UNIQUE,
    secao               TEXT NOT NULL CHECK (secao IN ('Abastecimento', 'Despesa', 'Receita')),
    status              TEXT NOT NULL CHECK (status IN ('Importado', 'Ignorado', 'PendenteRevisao')),
    entidade_tipo       TEXT CHECK (entidade_tipo IN ('DespesaViagem', 'ViagemAdiantamento', 'Frete')),
    entidade_id         INTEGER,
    dados_brutos        TEXT NOT NULL,  -- JSON da linha original do Drivvo, para exibir/reprocessar na revisao
    motivo_pendencia    TEXT,           -- por que caiu em revisao (veiculo nao encontrado, sem viagem aberta no periodo, etc.)
    criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    resolvido_em        TEXT,
    resolvido_por       INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_importacoes_drivvo_status ON importacoes_drivvo(status);

-- =====================================================================
-- 11. EMPRESAS (CNPJs proprios da operacao)
-- =====================================================================

-- Cadastro da(s) empresa(s) donas da frota (nao confundir com fornecedores,
-- que sao terceiros). Existe desde ja como tabela (nao um registro fixo
-- unico) para comportar filiais/CNPJs adicionais no futuro sem migrar o
-- modelo depois. Onixsat e por empresa porque cada CNPJ pode ter contrato
-- proprio com o rastreador.
CREATE TABLE empresas (
    id                      INTEGER PRIMARY KEY,
    razao_social            TEXT NOT NULL,
    nome_fantasia           TEXT,
    cnpj                    TEXT NOT NULL UNIQUE,   -- somente digitos
    inscricao_estadual      TEXT,
    endereco_logradouro     TEXT,
    endereco_numero         TEXT,
    endereco_complemento    TEXT,
    endereco_bairro         TEXT,
    endereco_cidade         TEXT,
    endereco_uf             TEXT,
    endereco_cep            TEXT,
    telefone                TEXT,
    email                   TEXT,
    onixsat_usuario         TEXT,
    onixsat_senha           TEXT,
    onixsat_ultimo_mid      INTEGER, -- cursor de paginacao do RequestMensagemCB (ver onixsatClient.js)
    -- Intervalo (minutos) da sincronizacao automatica de posicao/hodometro
    -- desta empresa (ver onixsatScheduler.js) - NULL usa o padrao do sistema.
    onixsat_poll_minutos    INTEGER,
    -- % de imposto a descontar do frete bruto no fechamento do Acerto (varia
    -- por empresa). Quando preenchido, o Acerto lanca/destaca "Imposto (nome
    -- da empresa)" sobre o frete bruto da viagem - ver acertos.routes.js.
    percentual_desconto_geral REAL,
    ativo                   INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em               TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    atualizado_em           TEXT
);

-- Ultimo calculo da tela "Calculo de Frete" de cada usuario (sem
-- historico - so o mais recente, usado para pre-preencher o formulario).
CREATE TABLE calculo_frete_preferencias (
    usuario_id      INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    peso            REAL,
    valor_tonelada  INTEGER,
    frete_total     INTEGER,
    valor_diesel    INTEGER,
    media           REAL,
    km              INTEGER,
    pedagio         INTEGER,
    descarga        INTEGER,
    comissao_pct    REAL,
    atualizado_em   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
