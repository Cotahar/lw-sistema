# Frotista — Sistema de Gestão de Frota e Transporte Rodoviário

Sistema completo (modelo frotista) para gestão de frota, viagens, fretes, manutenção, pneus, estoque, financeiro e DRE, com controle de acesso granular por módulo.

## Stack

- **Backend:** Node.js + Express, banco **SQLite** (via módulo nativo `node:sqlite` do Node — sem dependências nativas para compilar).
- **Frontend:** HTML/CSS/JS puro (sem framework/bundler), **TailwindCSS**.
- Backend e frontend rodam no **mesmo servidor/porta** — um único `npm start` sobe tudo.

## Requisitos

- **Node.js 22.5 ou superior** (para o módulo `node:sqlite`). Verifique com `node --version`.

## Passo a passo para rodar localmente

### 1. Instalar as dependências do backend

```bash
cd backend
npm install
```

### 2. Configurar variáveis de ambiente

Copie o arquivo de exemplo e ajuste se quiser:

```bash
copy .env.example .env      # Windows (PowerShell/cmd)
# ou: cp .env.example .env  # Git Bash/WSL
```

O `.env` já vem com valores padrão que funcionam localmente:

```
PORT=3000
JWT_SECRET=troque-este-valor-para-um-segredo-forte-em-producao
DB_PATH=./data/frotista.db
ADMIN_EMAIL=admin@frotista.local
ADMIN_SENHA=admin123
```

Na primeira execução, se o banco (`data/frotista.db`) não existir, ele é **criado automaticamente** a partir de `database/schema.sql`, e um usuário **Admin** inicial é criado com o e-mail/senha definidos em `ADMIN_EMAIL`/`ADMIN_SENHA`.

### 3. Rodar o servidor

```bash
npm start
```

Acesse **http://localhost:3000** no navegador e entre com o usuário Admin criado no passo 2.

> Use `npm run dev` em vez de `npm start` durante desenvolvimento: ele reinicia o servidor automaticamente a cada alteração de arquivo (`node --watch`).

### 4. (Opcional) Alterar o visual do frontend

O CSS já vem pré-compilado em `frontend/dist/output.css`, então **não é necessário** nenhum passo extra para rodar o sistema. Só rode o build do Tailwind se for **editar** classes/estilos:

```bash
cd frontend
npm install
npm run build     # gera frontend/dist/output.css uma vez
npm run watch      # ou: recompila automaticamente a cada alteração
```

## Estrutura do projeto

```
lw-sistema/
├── database/
│   └── schema.sql        # DDL completo do banco (SQLite)
├── backend/
│   ├── src/
│   │   ├── server.js      # ponto de entrada (API + arquivos estaticos do frontend)
│   │   ├── config/db.js   # conexao SQLite + criacao automatica do banco
│   │   ├── middleware/     # autenticacao, permissoes por modulo, erros
│   │   ├── routes/         # uma rota por dominio (viagens, pneus, financeiro...)
│   │   └── utils/          # CRUD generico, auditoria, transacoes, mascaras
│   └── data/frotista.db   # banco SQLite (criado automaticamente)
└── frontend/
    ├── index.html
    ├── js/
    │   ├── main.js         # shell, router e menu por permissao
    │   ├── api.js           # cliente HTTP + sessao
    │   ├── masks.js          # mascaras pt_BR (moeda, peso, data, CPF/CNPJ)
    │   ├── components/       # tabela, modal, select pesquisavel, formulario
    │   └── pages/             # uma tela por modulo
    └── dist/output.css     # CSS compilado do Tailwind
```

## Módulos do sistema

| Área | Telas |
|---|---|
| Cadastros | Fornecedores, Motoristas, Veículos, Composições (conjuntos) |
| Frota | Estoque, Pneus, Manutenção (OS), Alertas por KM, Checklist de bordo |
| Operação | Viagens e Fretes, Acerto de Viagem (com geração de texto para WhatsApp) |
| Financeiro | Contas Bancárias, Contas a Pagar, Contas a Receber, Despesas Fixas, Financiamentos |
| Relatórios | DRE por viagem, por veículo e geral da empresa |
| Administração | Usuários e matriz de permissões por módulo (só Admin) |

## Usuários e permissões

Cada usuário tem um **perfil base** (Admin / Comum / Visualização):

- **Admin**: acesso total a tudo, incluindo gestão de usuários e configurações do sistema (tipos de fornecedor, categorias de despesa, faixas de comissão, catálogo de checklist).
- **Comum**: gerencia (vê + cadastra) todos os módulos operacionais por padrão.
- **Visualização**: só leitura em todos os módulos por padrão.

Um Admin pode abrir **exceções por módulo** para qualquer usuário (tela Usuários e Permissões → botão "Permissões"), definindo Nenhum/Visualizar/Gerenciar tela a tela — por exemplo, um usuário Comum sem nenhum acesso ao módulo Financiamentos, mas só leitura em Estoque.

## Notas técnicas importantes

- **Valores monetários** são armazenados em **centavos** (inteiros) no banco, para evitar erros de arredondamento em somas financeiras. A interface sempre exibe/recebe em Reais formatados.
- **Regra contábil de estoque/pneus:** a compra gera uma Conta a Pagar imediatamente (fluxo de caixa), mas o custo só entra no DRE do veículo quando o item sai do estoque e é instalado. Pneus recapados só lançam no DRE o valor da recapagem na reinstalação (o custo de aquisição original já foi reconhecido na primeira instalação).
- **Recebíveis de frete:** cada frete gera um recebível pelo valor bruto, que é baixado aos poucos (Adiantamento, Pedágio, Saldo, Desconto), cada baixa decidindo se movimenta uma conta bancária de verdade ou é só um abatimento contábil.
- **Conta corrente do motorista:** saldos residuais entre viagens (motorista pegou mais que a comissão) ficam registrados em um razão auditável e são descontados automaticamente no próximo acerto.

## Resetar o banco de dados

Para começar do zero, pare o servidor e apague o arquivo `backend/data/frotista.db`. Ele será recriado (vazio, só com o usuário Admin) na próxima vez que o servidor for iniciado.
