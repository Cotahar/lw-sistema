-- =====================================================================
-- SISTEMA DE GESTAO DE FROTA E TRANSPORTE RODOVIARIO (MODELO FROTISTA)
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
    senha_hash      TEXT NOT NULL,
    -- "perfil" e o PERFIL BASE do usuario (o que ele tem por padrao em todo
    -- modulo que nao tiver uma excecao especifica em usuario_permissoes):
    -- Admin sempre tem acesso total (nao passa pela matriz de permissoes);
    -- Comum tem Gerenciar (ver + cadastrar) em tudo por padrao; Visualizacao
    -- tem so leitura em tudo por padrao. Ver usuario_permissoes para os casos
    -- em que um usuario Comum/Visualizacao precisa de um nivel diferente do
    -- padrao em um modulo especifico (ex.: sem acesso nenhum a Financeiro).
    perfil          TEXT NOT NULL CHECK (perfil IN ('Admin', 'Comum', 'Visualizacao')),
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
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

-- Log de auditoria generico (quem cadastrou/alterou o que).
-- "tabela_afetada" + "registro_id" apontam para qualquer linha do
-- banco sem precisar de uma tabela de log por entidade.
CREATE TABLE logs_auditoria (
    id              INTEGER PRIMARY KEY,
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
    criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
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
    nome            TEXT NOT NULL,
    cnpj            TEXT UNIQUE,        -- somente digitos
    tipo_id         INTEGER NOT NULL REFERENCES fornecedor_tipos(id),
    telefone        TEXT,
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em   TEXT
);
CREATE INDEX idx_fornecedores_nome ON fornecedores(nome);

CREATE TABLE motoristas (
    id                      INTEGER PRIMARY KEY,
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
    criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em           TEXT
);
CREATE INDEX idx_motoristas_nome ON motoristas(nome);

CREATE TABLE veiculos (
    id                  INTEGER PRIMARY KEY,
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
    ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
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
    nome        TEXT,               -- rotulo opcional, ex.: "Rodotrem 01"
    ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Itens do conjunto. O "papel" de cada veiculo (Cavalo, Carreta 1,
-- Carreta 2, Dolly...) e inferido de veiculos.tipo + a posicao "ordem"
-- (ordem 1 = mais a frente), evitando guardar um papel redundante que
-- poderia contradizer o tipo cadastrado do veiculo.
CREATE TABLE conjunto_itens (
    id              INTEGER PRIMARY KEY,
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
    nome                TEXT NOT NULL,
    categoria           TEXT NOT NULL CHECK (categoria IN ('Peca', 'Acessorio', 'EPI', 'Utensilio')),
    unidade_medida      TEXT NOT NULL DEFAULT 'UN',
    quantidade_atual    REAL NOT NULL DEFAULT 0,
    custo_medio         INTEGER NOT NULL DEFAULT 0,  -- centavos
    estoque_minimo      REAL NOT NULL DEFAULT 0,
    ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em       TEXT
);
CREATE INDEX idx_estoque_itens_nome ON estoque_itens(nome);

-- Toda entrada/saida do almoxarifado passa por aqui. Isso e o que
-- separa Fluxo de Caixa (a compra gera conta a pagar na hora) de DRE
-- (o custo so vira despesa do veiculo quando a peca "sai" do estoque
-- com destino a um veiculo). Ver contas_pagar.origem_tipo = 'EstoqueMovimentacao'.
CREATE TABLE estoque_movimentacoes (
    id                  INTEGER PRIMARY KEY,
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
    data                TEXT NOT NULL DEFAULT (datetime('now')),
    observacao          TEXT,
    criado_por          INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_estoque_mov_item ON estoque_movimentacoes(item_id);
CREATE INDEX idx_estoque_mov_veiculo ON estoque_movimentacoes(veiculo_destino_id);

CREATE TABLE pneus (
    id                  INTEGER PRIMARY KEY,
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
    data_aquisicao      TEXT NOT NULL DEFAULT (date('now')),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
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
    pneu_id         INTEGER NOT NULL REFERENCES pneus(id),
    tipo_evento     TEXT NOT NULL CHECK (tipo_evento IN ('Aquisicao', 'Instalacao', 'Remocao', 'EnvioRecapagem', 'RetornoRecapagem', 'Sucateamento')),
    veiculo_id      INTEGER REFERENCES veiculos(id),
    eixo            INTEGER,
    lado            TEXT CHECK (lado IN ('Esquerdo', 'Direito')),
    km_veiculo      INTEGER,
    fornecedor_id   INTEGER REFERENCES fornecedores(id),  -- recapadora, no caso de Envio/RetornoRecapagem
    custo           INTEGER,   -- centavos; ver regra de custo_pendente_dre acima
    data            TEXT NOT NULL DEFAULT (datetime('now')),
    observacao      TEXT,
    criado_por      INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_pneu_eventos_pneu ON pneu_eventos(pneu_id);

-- =====================================================================
-- 4. MANUTENCAO, ALERTAS E INVENTARIO DE BORDO
-- =====================================================================

CREATE TABLE ordens_servico (
    id              INTEGER PRIMARY KEY,
    data            TEXT NOT NULL DEFAULT (date('now')),
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    hodometro       INTEGER NOT NULL,
    tipo            TEXT NOT NULL CHECK (tipo IN ('Preventiva', 'Corretiva')),
    fornecedor_id   INTEGER REFERENCES fornecedores(id),  -- oficina
    valor_pecas     INTEGER NOT NULL DEFAULT 0,   -- centavos (totalizador rapido)
    valor_mao_obra  INTEGER NOT NULL DEFAULT 0,   -- centavos
    descricao       TEXT,
    criado_por      INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_os_veiculo ON ordens_servico(veiculo_id);
CREATE INDEX idx_os_data ON ordens_servico(data);

-- Itens detalhados da OS (o que foi trocado/realizado). Quando
-- "estoque_item_id" e preenchido, a baixa correspondente deve existir
-- em estoque_movimentacoes (tipo='Saida', os_id=esta OS).
CREATE TABLE os_itens (
    id                  INTEGER PRIMARY KEY,
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
    regra_id            INTEGER NOT NULL REFERENCES alertas_regras(id),
    veiculo_id          INTEGER NOT NULL REFERENCES veiculos(id),
    km_atual_no_disparo INTEGER NOT NULL,
    data_disparo        TEXT NOT NULL DEFAULT (datetime('now')),
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

-- Estado do checklist por placa.
CREATE TABLE veiculo_checklist (
    id              INTEGER PRIMARY KEY,
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    item_id         INTEGER NOT NULL REFERENCES checklist_itens_catalogo(id),
    presente        INTEGER NOT NULL DEFAULT 1 CHECK (presente IN (0, 1)),
    observacao      TEXT,
    atualizado_em   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (veiculo_id, item_id)
);

-- Registro fotografico do veiculo no Recebimento (motorista pega o caminhao) e
-- na Entrega (motorista devolve), para comparar o estado antes/depois. item_id
-- e opcional: preenchido quando a foto documenta um item especifico do
-- catalogo, em branco quando e uma foto geral do veiculo. Arquivos ficam em
-- disco (backend/uploads/checklist/), so o nome do arquivo fica no banco.
CREATE TABLE veiculo_checklist_fotos (
    id              INTEGER PRIMARY KEY,
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    item_id         INTEGER REFERENCES checklist_itens_catalogo(id),
    momento         TEXT NOT NULL CHECK (momento IN ('Recebimento', 'Entrega')),
    arquivo         TEXT NOT NULL,
    criado_por      INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_checklist_fotos_veiculo ON veiculo_checklist_fotos(veiculo_id, momento);

-- =====================================================================
-- 5. VIAGENS E FRETES
-- =====================================================================

CREATE TABLE viagens (
    id              INTEGER PRIMARY KEY,
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
    criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
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
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    km              INTEGER NOT NULL,
    origem          TEXT NOT NULL CHECK (origem IN ('Onixsat', 'Manual')),
    usuario_id      INTEGER REFERENCES usuarios(id),  -- obrigatorio quando origem='Manual'
    data_hora       TEXT NOT NULL DEFAULT (datetime('now')),
    observacao      TEXT
);
CREATE INDEX idx_hodometro_eventos_veiculo ON hodometro_eventos(veiculo_id, data_hora);

-- Leituras de localizacao: mesmo padrao do hodometro_eventos - eventos
-- futuros da API Onixsat (que traria lat/lng) e lancamentos manuais
-- (fallback, so cidade/UF) caem aqui. veiculos.localizacao_* e so a cache
-- da leitura mais recente, para nao precisar de subquery a cada listagem.
CREATE TABLE localizacao_eventos (
    id              INTEGER PRIMARY KEY,
    veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
    cidade          TEXT NOT NULL,
    uf              TEXT NOT NULL,
    latitude        REAL,
    longitude       REAL,
    origem          TEXT NOT NULL CHECK (origem IN ('Onixsat', 'Manual')),
    usuario_id      INTEGER REFERENCES usuarios(id),  -- obrigatorio quando origem='Manual'
    data_hora       TEXT NOT NULL DEFAULT (datetime('now')),
    observacao      TEXT
);
CREATE INDEX idx_localizacao_eventos_veiculo ON localizacao_eventos(veiculo_id, data_hora);

CREATE TABLE fretes (
    id                          INTEGER PRIMARY KEY,
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
    criado_em                    TEXT NOT NULL DEFAULT (datetime('now'))
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
    viagem_id           INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now')),
    conta_bancaria_id   INTEGER REFERENCES contas_bancarias(id),
    descricao           TEXT,
    criado_por          INTEGER REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now'))
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
    tipo        TEXT NOT NULL CHECK (tipo IN ('Veiculo', 'Base')),
    veiculo_id  INTEGER UNIQUE REFERENCES veiculos(id),
    nome        TEXT NOT NULL,  -- para tipo='Base': "Base/Administrativo"; para 'Veiculo': a placa
    CHECK ((tipo = 'Veiculo' AND veiculo_id IS NOT NULL) OR (tipo = 'Base' AND veiculo_id IS NULL))
);
-- Linha fixa do centro de custo administrativo (id=1, seed obrigatoria).
INSERT INTO centros_custo (tipo, veiculo_id, nome) VALUES ('Base', NULL, 'Base/Administrativo');

CREATE TABLE categorias_despesa (
    id      INTEGER PRIMARY KEY,
    nome    TEXT NOT NULL UNIQUE  -- Abastecimento, Chapa, Borracharia, Pedagio, Seguro, Rastreamento...
);

-- Faixas de KM/L -> % de comissao sobre o Frete Bruto. Cadastro restrito
-- a Admin (aplicado na regra de permissao, nao no schema).
CREATE TABLE comissao_faixas (
    id                  INTEGER PRIMARY KEY,
    km_l_de             REAL NOT NULL,
    km_l_ate            REAL NOT NULL,
    percentual_comissao REAL NOT NULL,  -- ex.: 10 = 10%
    ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    CHECK (km_l_ate >= km_l_de)
);

CREATE TABLE despesas_viagem (
    id                  INTEGER PRIMARY KEY,
    viagem_id           INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
    centro_custo_id     INTEGER NOT NULL REFERENCES centros_custo(id),
    categoria_id        INTEGER NOT NULL REFERENCES categorias_despesa(id),
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now')),
    pago_por            TEXT NOT NULL CHECK (pago_por IN ('Empresa', 'Motorista', 'AdminOutros')),
    pago_por_usuario_id INTEGER REFERENCES usuarios(id),  -- obrigatorio quando pago_por='AdminOutros'
    -- Campos especificos de Abastecimento (NULL para as demais categorias):
    posto_fornecedor_id INTEGER REFERENCES fornecedores(id),
    preco_litro         INTEGER,   -- centavos
    litragem             REAL,
    km_abastecimento    INTEGER,
    descricao           TEXT,
    criado_por          INTEGER REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_despesas_viagem_viagem ON despesas_viagem(viagem_id);
CREATE INDEX idx_despesas_viagem_centro ON despesas_viagem(centro_custo_id);

-- Despesas fixas/recorrentes nao ligadas a uma viagem especifica
-- (seguro, rastreamento, salario administrativo, aluguel da base...).
CREATE TABLE despesas_fixas (
    id                  INTEGER PRIMARY KEY,
    centro_custo_id     INTEGER NOT NULL REFERENCES centros_custo(id),
    categoria_id        INTEGER NOT NULL REFERENCES categorias_despesa(id),
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now')),
    recorrente          INTEGER NOT NULL DEFAULT 0 CHECK (recorrente IN (0, 1)),
    descricao           TEXT,
    criado_por          INTEGER REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_despesas_fixas_centro ON despesas_fixas(centro_custo_id);

CREATE TABLE financiamentos (
    id                  INTEGER PRIMARY KEY,
    centro_custo_id     INTEGER NOT NULL REFERENCES centros_custo(id),
    descricao           TEXT NOT NULL,
    credor_fornecedor_id INTEGER REFERENCES fornecedores(id),
    valor_total         INTEGER NOT NULL,  -- centavos
    qtd_parcelas        INTEGER NOT NULL,
    data_contrato       TEXT NOT NULL DEFAULT (date('now'))
);

-- Por decisao do usuario, nao separamos juros de principal: o valor
-- cheio da parcela afeta tanto o caixa quanto o DRE do centro de custo.
CREATE TABLE financiamento_parcelas (
    id                  INTEGER PRIMARY KEY,
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
    fornecedor_id       INTEGER REFERENCES fornecedores(id),
    centro_custo_id     INTEGER REFERENCES centros_custo(id),
    descricao           TEXT NOT NULL,
    valor               INTEGER NOT NULL,  -- centavos
    data_vencimento     TEXT NOT NULL,
    data_pagamento      TEXT,
    valor_pago          INTEGER NOT NULL DEFAULT 0,  -- centavos
    status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Parcial', 'Pago', 'Atrasado')),
    origem_tipo         TEXT CHECK (origem_tipo IN ('EstoqueMovimentacao', 'PneuEvento', 'OrdemServico', 'DespesaViagem', 'DespesaFixa', 'FinanciamentoParcela', 'ReembolsoMotorista', 'AcertoViagem', 'Outro')),
    origem_id           INTEGER,
    conta_bancaria_id   INTEGER REFERENCES contas_bancarias(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now'))
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
    frete_id            INTEGER NOT NULL REFERENCES fretes(id),
    centro_custo_id     INTEGER NOT NULL REFERENCES centros_custo(id),  -- unidade tratora da viagem do frete
    valor               INTEGER NOT NULL,  -- centavos, valor bruto do frete
    data_prevista       TEXT NOT NULL,
    data_recebimento    TEXT,  -- data da baixa mais recente
    valor_recebido      INTEGER NOT NULL DEFAULT 0,   -- centavos; soma das baixas exceto tipo Desconto
    valor_descontado    INTEGER NOT NULL DEFAULT 0,   -- centavos; soma das baixas tipo Desconto
    status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Parcial', 'Recebido', 'Atrasado')),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now'))
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
    contas_receber_id   INTEGER NOT NULL REFERENCES contas_receber(id) ON DELETE CASCADE,
    tipo                TEXT NOT NULL CHECK (tipo IN ('Adiantamento', 'Pedagio', 'Saldo', 'Desconto', 'Outro')),
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now')),
    conta_bancaria_id   INTEGER REFERENCES contas_bancarias(id),
    descricao           TEXT,
    criado_por          INTEGER REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
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
    conta_bancaria_id   INTEGER NOT NULL REFERENCES contas_bancarias(id),
    tipo                TEXT NOT NULL CHECK (tipo IN ('Entrada', 'Saida')),
    valor               INTEGER NOT NULL,  -- centavos
    data                TEXT NOT NULL DEFAULT (date('now')),
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
    viagem_id                   INTEGER NOT NULL UNIQUE REFERENCES viagens(id),
    data_acerto                 TEXT NOT NULL DEFAULT (datetime('now')),
    media_consumo_km_l          REAL,             -- calculado a partir dos abastecimentos + km_total
    percentual_comissao_sugerido REAL,            -- resolvido via comissao_faixas pela media acima
    percentual_comissao_aplicado REAL NOT NULL,    -- copiado da sugestao, mas editavel pelo operador
    valor_comissao               INTEGER NOT NULL, -- centavos, = frete_bruto_total * percentual_aplicado
    valor_reembolsos             INTEGER NOT NULL DEFAULT 0,  -- centavos
    valor_adiantamentos          INTEGER NOT NULL DEFAULT 0,  -- centavos
    valor_descontos              INTEGER NOT NULL DEFAULT 0,  -- centavos (multas, avarias...)
    saldo_conta_corrente_anterior INTEGER NOT NULL DEFAULT 0, -- centavos, snapshot do saldo do motorista antes deste acerto
    saldo_final                  INTEGER NOT NULL, -- centavos; formula na secao 7 do PRD
    status                       TEXT NOT NULL DEFAULT 'Aberto' CHECK (status IN ('Aberto', 'Fechado')),
    observacoes_ajustes          TEXT,   -- "fechamento livre": justificativa de ajustes manuais de caixa
    criado_por                   INTEGER REFERENCES usuarios(id),
    criado_em                    TEXT NOT NULL DEFAULT (datetime('now'))
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
    motorista_id        INTEGER NOT NULL REFERENCES motoristas(id),
    acerto_id            INTEGER REFERENCES acertos_viagem(id),
    tipo                 TEXT NOT NULL CHECK (tipo IN ('DebitoResidual', 'CreditoAbatido', 'AjusteManual')),
    valor                INTEGER NOT NULL,  -- centavos, sempre positivo; o "tipo" indica o sentido
    saldo_anterior       INTEGER NOT NULL,  -- centavos
    saldo_posterior      INTEGER NOT NULL,  -- centavos
    data                 TEXT NOT NULL DEFAULT (datetime('now')),
    descricao            TEXT,
    criado_por           INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_motorista_cc_motorista ON motorista_conta_corrente_lancamentos(motorista_id, data);

-- =====================================================================
-- 9. OCORRENCIAS (HISTORICO LIVRE POR REGISTRO)
-- =====================================================================

-- Linha do tempo de anotacoes livres (problema, desentendimento, ajuste,
-- justificativa...) anexada a qualquer registro de negocio, para consulta
-- futura. Generica via entidade_tipo + entidade_id (mesmo padrao de
-- contas_pagar.origem_tipo/origem_id) em vez de uma tabela por entidade.
CREATE TABLE ocorrencias (
    id              INTEGER PRIMARY KEY,
    entidade_tipo   TEXT NOT NULL CHECK (entidade_tipo IN ('Viagem', 'Frete', 'DespesaViagem', 'ContaPagar', 'ContaReceber', 'AcertoViagem')),
    entidade_id     INTEGER NOT NULL,
    texto           TEXT NOT NULL,
    criado_por      INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
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
    chave_externa       TEXT NOT NULL UNIQUE,
    secao               TEXT NOT NULL CHECK (secao IN ('Abastecimento', 'Despesa', 'Receita')),
    status              TEXT NOT NULL CHECK (status IN ('Importado', 'Ignorado', 'PendenteRevisao')),
    entidade_tipo       TEXT CHECK (entidade_tipo IN ('DespesaViagem', 'ViagemAdiantamento', 'Frete')),
    entidade_id         INTEGER,
    dados_brutos        TEXT NOT NULL,  -- JSON da linha original do Drivvo, para exibir/reprocessar na revisao
    motivo_pendencia    TEXT,           -- por que caiu em revisao (veiculo nao encontrado, sem viagem aberta no periodo, etc.)
    criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
    resolvido_em        TEXT,
    resolvido_por       INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_importacoes_drivvo_status ON importacoes_drivvo(status);
