# Frottex — Sistema de Gestão de Frota e Transporte Rodoviário

Sistema completo (modelo frotista) para gestão de frota, viagens, fretes, manutenção, pneus, estoque, financeiro e DRE, com várias empresas no mesmo sistema, app do motorista (funciona offline) e controle de acesso por módulo. Em produção no Railway.

> **Continuando este projeto em outra máquina ou numa sessão nova do Claude Code?**
> Depois de rodar o setup abaixo, leia o [`CONTEXTO_PROJETO.md`](CONTEXTO_PROJETO.md) —
> ele traz as decisões de arquitetura e regras de negócio não-óbvias que não
> aparecem só lendo o código. O [`PROMPT_NOVA_SESSAO.md`](PROMPT_NOVA_SESSAO.md)
> tem o estado mais recente e um prompt pronto para colar como primeira mensagem.

## Stack

- **Backend:** Node.js + Express, banco **SQLite** (via módulo nativo `node:sqlite` do Node — sem dependências nativas para compilar).
- **Frontend:** HTML/CSS/JS puro (módulos ES, sem framework/bundler), **TailwindCSS** compilado.
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

```bash
copy .env.example .env      # Windows (PowerShell/cmd)
# ou: cp .env.example .env  # Git Bash/WSL
```

Os valores do `.env.example` funcionam localmente. Na primeira execução, se o banco (`data/frotista.db`) não existir, ele é **criado automaticamente** a partir de `database/schema.sql`, com um usuário **Admin** inicial (`ADMIN_USERNAME`/`ADMIN_SENHA`, padrão `admin`).

### 3. Rodar o servidor

```bash
npm run dev
```

Acesse **http://localhost:3000**. O `npm run dev` reinicia o servidor a cada alteração de arquivo do backend (`node --watch`); em produção é `npm start`.

### 4. (Só se editar estilos) Recompilar o CSS

O CSS já vem compilado em `frontend/dist/output.css` (versionado). Classe Tailwind **nova** só aparece depois de recompilar:

```bash
cd frontend
npm install
npm run build
```

## Testes

```bash
cd backend
npm test
```

São ~275 testes de API (cada arquivo roda num banco temporário próprio). O CI do GitHub (`.github/workflows/ci.yml`) roda a cada push: testes do backend, build do CSS, checagem de sintaxe de todos os módulos do frontend e um teste ponta a ponta com Playwright (`frontend/e2e`).

## Variáveis de ambiente

| Variável | Para que serve | Padrão |
|---|---|---|
| `PORT` | Porta HTTP | `3000` |
| `JWT_SECRET` | Assina as sessões. **Obrigatória** — o servidor não sobe sem ela. Trocar desloga todo mundo. | — |
| `DB_PATH` | Arquivo do banco (relativo a `backend/`) | `./data/frotista.db` |
| `UPLOAD_DIR` | Pasta de anexos e fotos. Em produção, dentro do volume. | `backend/uploads` |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_SENHA` | Admin criado **só** num banco novo e vazio (trocar depois não muda a senha de quem já existe) | `admin` / `admin@frotista.local` / `admin123` |
| `ONIXSAT_POLL_MINUTOS` | Intervalo do agendador do Onixsat; `0` desliga | `1` |
| `BACKUP_DIARIO` | `0` desliga o backup automático | ligado |
| `BACKUP_DIR` | Pasta dos backups | `<pasta do banco>/backups` |
| `BACKUP_HORA` | Hora (Brasília) a partir da qual o backup do dia é gerado | `3` |
| `BACKUP_MANTER` / `BACKUP_MANTER_MENSAL` | Quantos backups diários / mensais ficam na pasta | `7` / `3` |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | Ligam a **cópia externa** (as 4 juntas) | desligada |
| `BACKUP_S3_REGION` / `BACKUP_S3_PREFIXO` / `BACKUP_S3_PATH_STYLE` | Ajustes da cópia externa | `auto` / `frottex/` / `1` |
| `RESTAURAR_BACKUP` | Nome de um backup a restaurar na próxima subida (ver abaixo) | — |

## Produção (Railway)

- Cada push na `main` faz deploy automático. O banco e os anexos ficam no volume montado em `/data` (`DB_PATH=/data/frotista.db`, `UPLOAD_DIR=/data/uploads`).
- **Migrações automáticas** (da 037 em diante): rodam sozinhas na subida do servidor, uma vez cada, numa transação e com cópia do banco antes. Se uma falhar, o servidor não sobe e o erro aparece no log do Railway. Como criar uma: [`database/migrations/LEIAME.md`](database/migrations/LEIAME.md). As 000–036 são os scripts manuais antigos, já aplicados, e nunca rodam de novo.
- **Health check do deploy:** o Railway só considera o deploy pronto quando `/api/health` responde com o banco ok (`railway.json`).
- **Versão nova do frontend:** toda resposta da API leva o cabeçalho `X-App-Versao` (hash dos arquivos do frontend). Quem estava com o sistema aberto durante um deploy vê o aviso "Saiu uma versão nova" e a aba recarrega sozinha na próxima troca de tela. Não é mais preciso pedir F5.

## Backups e restauração

### O que acontece sozinho

- Todo dia, a partir das 3h (Brasília), o servidor gera `frottex-auto-AAAA-MM-DD.db` na pasta de backups (cópia consistente com `VACUUM INTO`, conferida com `PRAGMA quick_check`). Também gera ao subir, se o do dia ainda não existir.
- Na pasta ficam os **7 diários mais recentes + o primeiro backup de cada um dos 3 últimos meses**. Arquivos com outro nome (backups manuais) nunca são apagados. Se o disco não tiver folga (2× o tamanho do banco), o backup não é tentado — encher o volume derrubaria o sistema — e o erro aparece na tela de Backups.
- **Cópia externa (fora do Railway)**, quando configurada: logo depois de cada backup, o banco vai comprimido para um bucket compatível com S3 (`frottex/banco/diario/…` todo dia e `frottex/banco/mensal/…` no primeiro backup de cada mês). Anexos e fotos novos vão para `frottex/uploads/…`. Se o envio falhar, ele é tentado de novo a cada 10 minutos.
- Tela **Administração → Backups** (Admin): lista os backups, mostra a situação do último backup e do último envio externo, tem o botão "Executar agora" e **baixa** qualquer backup para o computador.

> Sem a cópia externa configurada, os backups ficam no **mesmo volume** do banco: protegem contra erro de operação, não contra perder o volume. Enquanto ela não for ligada, baixe um backup por semana pela tela de Backups.

### Ligar a cópia externa (Cloudflare R2, recomendado)

R2 é de outro provedor (a conta Cloudflare já é usada no DNS) e tem 10 GB grátis. Para ativar o R2 o Cloudflare pede um meio de pagamento, mas este uso fica dentro do gratuito.

1. Cloudflare → **R2 Object Storage** → *Create bucket* → nome `frottex-backup` (privado, que é o padrão).
2. R2 → **Manage R2 API Tokens** → *Create API token* → permissão **Object Read & Write**, só nesse bucket. Anote o *Access Key ID*, o *Secret Access Key* e o endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. (Opcional) No bucket → *Settings* → *Object lifecycle rules*: apagar objetos com prefixo `frottex/banco/diario/` após 35 dias. Os mensais ficam para sempre.
4. Railway → serviço → *Variables*: `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET=frottex-backup`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`. O serviço reinicia sozinho.
5. Tela de Backups → **Executar agora** → deve aparecer "Último envio externo: ok".

Funciona igual com Backblaze B2, AWS S3 ou um Bucket do próprio Railway (para AWS, informe `BACKUP_S3_REGION`).

### Restaurar um backup

1. O arquivo precisa estar na pasta de backups do servidor:
   - um automático (`frottex-auto-AAAA-MM-DD.db`) já está lá;
   - um da cópia externa é baixado no container com `railway ssh` e depois `node database/scripts/baixar_backup_externo.js 2026-11-02` (ou `2026-09` para o mensal).
     Ele grava `frottex-externo-<data>.db` na pasta de backups e confere o arquivo.
2. Railway → *Variables*: `RESTAURAR_BACKUP=<nome do arquivo>`. O serviço reinicia e, **antes de abrir o banco**:
   - confere o backup;
   - guarda o banco atual como `frotista-antes-da-restauracao-<data-hora>.db`;
   - coloca o backup no lugar.
3. Apague a variável. Se você esquecer, um marcador impede que o mesmo backup seja restaurado de novo a cada reinício.

Localmente é igual: `RESTAURAR_BACKUP=<arquivo>` no `.env` e reinicie.

## Conferência de saldo bancário

O saldo de cada conta (`saldo_atual`) é atualizado junto com cada lançamento. Em **Financeiro → Contas Bancárias → Conferir saldos**, o sistema confere se:

> saldo registrado = saldo inicial + entradas − saídas do extrato

Se alguma conta não bate, aparece um aviso no topo da tela. O Admin acerta escolhendo qual lado está certo:
- **Usar o calculado**: o extrato está certo e o saldo passa a ser o calculado;
- **Lançar diferença**: o saldo registrado bate com o banco e falta um lançamento no extrato.

Contas que já existiam em 03/11/2026 tiveram o saldo inicial calculado a partir do estado daquele dia (a conferência vale dali para frente). Conta nova usa o saldo informado no cadastro.

## Monitoramento

| O quê | Como |
|---|---|
| `GET /api/health` | Sistema no ar **e** banco respondendo (503 se o banco falhar). Público, sem dado sensível. |
| `GET /api/health/backup` | 503 se o último backup tiver mais de 30h ou se a última cópia externa tiver falhado. |
| Deploy | O Railway espera `/api/health` responder antes de dar o deploy como pronto. |
| GitHub Actions (`.github/workflows/monitor.yml`) | De hora em hora, testa as duas rotas acima. Se falhar, o GitHub manda e-mail para quem fez o último commit desse arquivo. URL configurável na variável de repositório `FROTTEX_URL`. Dá para rodar na mão em *Actions → Monitor de produção → Run workflow*. |

Para ser avisado em até 5 minutos (recomendado), crie um monitor gratuito no **UptimeRobot**:
1. Crie a conta em uptimerobot.com.
2. *Add New Monitor* → tipo **HTTP(s)** → URL `https://frottex.com.br/api/health` → intervalo de 5 minutos.
3. Em *Alert Contacts*, use o seu e-mail ou o app do celular.

Um segundo monitor em `/api/health/backup`, de hora em hora, avisa de backup atrasado.

## Estrutura do projeto

```
lw-sistema/
├── database/
│   ├── schema.sql          # DDL completo e comentado (fonte de verdade do modelo)
│   ├── migrations/         # migracoes manuais, idempotentes, numeradas
│   └── scripts/            # scripts pontuais (importacoes, conferencias, backup externo)
├── backend/
│   ├── src/
│   │   ├── server.js       # ponto de entrada (agendadores: Onixsat, backup)
│   │   ├── app.js          # Express: API + arquivos do frontend
│   │   ├── config/db.js    # conexao SQLite, criacao do banco, restauracao
│   │   ├── middleware/     # autenticacao, permissoes, empresa ativa, erros
│   │   ├── routes/         # uma rota por dominio (viagens, acertos, contas a pagar...)
│   │   └── utils/          # regras compartilhadas (DRE, baixas, backup, CRUD generico...)
│   └── test/               # testes de API (node --test + supertest)
└── frontend/
    ├── index.html, sw.js   # pagina unica + service worker do app do motorista
    ├── js/
    │   ├── main.js         # shell, rotas e menu por permissao
    │   ├── api.js          # cliente HTTP, sessao, empresa ativa
    │   ├── versao.js       # aviso de versao nova
    │   ├── html.js         # esc(): escape de texto em HTML
    │   ├── components/     # tabela, modal, selects, anexos, ocorrencias...
    │   └── pages/          # uma tela por modulo (+ motorista/, financeiro/, relatorios/, config/)
    ├── e2e/                # teste ponta a ponta (Playwright)
    └── dist/output.css     # CSS compilado do Tailwind (versionado)
```

## Módulos do sistema

| Área | Telas |
|---|---|
| Painel | Viagens em andamento (km, média, faturamento, posição), alertas, contas vencidas |
| Operação | Viagens e Fretes, Acerto de Viagem (relatórios em PDF, recibos, resumo para WhatsApp), Multas, Cálculo de Frete |
| Financeiro | Contas Bancárias (com transferências), Contas a Pagar (baixa em lote, "sem pagamento", fatura consolidada), Contas a Receber, Despesas Fixas (com rateio), Financiamentos |
| Frota | Estoque, Pneus (com recapagem), Manutenção (OS), Alertas por KM, Checklist de bordo |
| Cadastros | Fornecedores (postos favoritos), Motoristas, Veículos, Conjuntos |
| Relatórios | DRE (por viagem, veículo, conjunto, geral, multi-período, comparativo) e ~20 relatórios operacionais e financeiros, com relatórios salvos e exportação XLSX/PDF |
| Administração | Usuários e Permissões, Auditoria e Reversão, Atividade por Usuário, Importar Fatura Sem Parar, **Backups**, Configurações (empresas, tipos, categorias, comissão, checklist) |
| App do motorista | Painel da viagem, lançamento de abastecimento com foto (offline), fretes, acertos, postos favoritos |

## Usuários e permissões

Cada usuário tem um **perfil base** (Admin / Comum / Visualização / Motorista):

- **Admin**: acesso total, inclusive usuários, configurações, auditoria e backups. O sistema não deixa o último Admin ativo se rebaixar ou se desativar.
- **Comum**: gerencia (vê + cadastra) todos os módulos operacionais por padrão.
- **Visualização**: só leitura em todos os módulos por padrão.
- **Motorista**: só o app do motorista, restrito à própria viagem.

Um Admin pode abrir **exceções por módulo** para qualquer usuário (Nenhum/Visualizar/Gerenciar tela a tela) e define em quais empresas cada usuário atua.

Login: depois de 10 senhas erradas seguidas para o mesmo usuário (a partir do mesmo IP), novas tentativas ficam bloqueadas por 15 minutos.

## Notas técnicas importantes

- **Valores monetários** são armazenados e trafegam em **centavos** (inteiros). A API recusa valor em texto ou com casas decimais nas rotas que movimentam caixa. A interface sempre exibe/recebe em Reais.
- **Regra caixa × DRE de estoque/pneus:** a compra gera Conta a Pagar na hora (caixa), mas o custo só entra no DRE do veículo quando o item é instalado.
- **Recebíveis de frete:** cada frete gera um recebível pelo valor bruto, baixado aos poucos (Adiantamento, Pedágio, Saldo, Desconto, Outro).
- **Conta corrente do motorista:** saldos residuais entre viagens ficam num razão auditável e são descontados no próximo acerto.
- Detalhes e o "porquê" de cada regra: [`CONTEXTO_PROJETO.md`](CONTEXTO_PROJETO.md).

## Resetar o banco de dados (local)

Pare o servidor e apague `backend/data/frotista.db`. Ele é recriado vazio (só com o Admin) na próxima subida.
