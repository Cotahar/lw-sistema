require('dotenv').config();
const path = require('node:path');
const express = require('express');
const cors = require('cors');

require('./config/db'); // garante que o banco/tabelas existam antes de subir as rotas

const { autenticar } = require('./middleware/auth');
const { resolverEmpresa } = require('./middleware/empresa');
const errorHandler = require('./middleware/errorHandler');
const limparQuery = require('./middleware/limparQuery');

const authRoutes = require('./routes/auth.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const modulosRoutes = require('./routes/modulos.routes');
const centrosCustoRoutes = require('./routes/centrosCusto.routes');
const fornecedorTiposRoutes = require('./routes/fornecedorTipos.routes');
const fornecedoresRoutes = require('./routes/fornecedores.routes');
const motoristasRoutes = require('./routes/motoristas.routes');
const veiculosRoutes = require('./routes/veiculos.routes');
const conjuntosRoutes = require('./routes/conjuntos.routes');
const estoqueRoutes = require('./routes/estoque.routes');
const pneusRoutes = require('./routes/pneus.routes');
const ordensServicoRoutes = require('./routes/ordensServico.routes');
const alertasRoutes = require('./routes/alertas.routes');
const checklistRoutes = require('./routes/checklist.routes');
const viagensRoutes = require('./routes/viagens.routes');
const categoriasDespesaRoutes = require('./routes/categoriasDespesa.routes');
const comissaoFaixasRoutes = require('./routes/comissaoFaixas.routes');
const despesasFixasRoutes = require('./routes/despesasFixas.routes');
const financiamentosRoutes = require('./routes/financiamentos.routes');
const contasBancariasRoutes = require('./routes/contasBancarias.routes');
const contasPagarRoutes = require('./routes/contasPagar.routes');
const contasReceberRoutes = require('./routes/contasReceber.routes');
const acertosRoutes = require('./routes/acertos.routes');
const dreRoutes = require('./routes/dre.routes');
const relatoriosRoutes = require('./routes/relatorios.routes');
const relatoriosSalvosRoutes = require('./routes/relatoriosSalvos.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const ocorrenciasRoutes = require('./routes/ocorrencias.routes');
const anexosRoutes = require('./routes/anexos.routes');
const adminRoutes = require('./routes/admin.routes');
const importacaoFaturaRoutes = require('./routes/importacaoFatura.routes');
const empresasRoutes = require('./routes/empresas.routes');
const cnpjRoutes = require('./routes/cnpj.routes');
const onixsatRoutes = require('./routes/onixsat.routes');
const multasRoutes = require('./routes/multas.routes');
const calculoFreteRoutes = require('./routes/calculoFrete.routes');
const motoristaMobileRoutes = require('./routes/motorista.routes');
const recibosRoutes = require('./routes/recibos.routes');

const backupsRoutes = require('./routes/backups.routes');
const saudeRoutes = require('./routes/saude.routes');
const { VERSAO_APP } = require('./utils/versaoApp');

const app = express();
// Atras do proxy do Railway: req.ip/req.secure passam a refletir o cliente de verdade (limite de login, HSTS).
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    // Um anexo nunca e "interpretado" como outro tipo (ex.: HTML disfarcado de imagem).
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(cors());
// Limite maior que o padrao (100kb): a importacao de fatura do Sem Parar (administracao)
// manda as abas da planilha (centenas de passagens) num unico JSON.
app.use(express.json({ limit: '5mb' }));
// Parametro de query "null"/"undefined" (texto) = parametro nao enviado.
app.use('/api', limparQuery);

// Frontend (HTML/CSS/JS estatico) e a API rodam no mesmo servidor/porta -
// simplifica o "rodar localmente" (um so `npm start`). O roteamento de tela
// no frontend e via hash (#/modulo), entao servir os arquivos estaticos
// normalmente (sem fallback de SPA) e suficiente.
// So o que o navegador precisa - a pasta frontend/ tambem tem package.json, testes e
// configuracoes que nao tem por que ficar publicos.
const FRONTEND = path.resolve(__dirname, '../../frontend');
for (const pasta of ['js', 'dist', 'img', 'data']) app.use(`/${pasta}`, express.static(path.join(FRONTEND, pasta)));
for (const arquivo of ['index.html', 'sw.js', 'manifest.json']) app.get(`/${arquivo}`, (req, res) => res.sendFile(path.join(FRONTEND, arquivo)));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.resolve(__dirname, '../uploads')));

// Versao do frontend em toda resposta da API (ver utils/versaoApp.js e frontend/js/versao.js).
app.use('/api', (req, res, next) => { res.set('X-App-Versao', VERSAO_APP); next(); });

app.use('/api/health', saudeRoutes);

app.use('/api/auth', authRoutes);

// Tudo abaixo exige login.
app.use('/api', autenticar);
app.use('/api', resolverEmpresa);

app.use('/api/usuarios', usuariosRoutes);
app.use('/api/modulos', modulosRoutes);
app.use('/api/centros-custo', centrosCustoRoutes);
app.use('/api/fornecedor-tipos', fornecedorTiposRoutes);
app.use('/api/fornecedores', fornecedoresRoutes);
app.use('/api/motoristas', motoristasRoutes);
app.use('/api/veiculos', veiculosRoutes);
app.use('/api/conjuntos', conjuntosRoutes);
app.use('/api/estoque', estoqueRoutes);
app.use('/api/pneus', pneusRoutes);
app.use('/api/ordens-servico', ordensServicoRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/checklist', checklistRoutes);
app.use('/api/viagens', viagensRoutes);
app.use('/api/categorias-despesa', categoriasDespesaRoutes);
app.use('/api/comissao-faixas', comissaoFaixasRoutes);
app.use('/api/despesas-fixas', despesasFixasRoutes);
app.use('/api/financiamentos', financiamentosRoutes);
app.use('/api/contas-bancarias', contasBancariasRoutes);
app.use('/api/contas-pagar', contasPagarRoutes);
app.use('/api/contas-receber', contasReceberRoutes);
app.use('/api/acertos', acertosRoutes);
app.use('/api/dre', dreRoutes);
app.use('/api/relatorios', relatoriosRoutes);
app.use('/api/relatorios-salvos', relatoriosSalvosRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ocorrencias', ocorrenciasRoutes);
app.use('/api/anexos', anexosRoutes);
app.use('/api/admin/importacoes', importacaoFaturaRoutes);
app.use('/api/admin/backups', backupsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/empresas', empresasRoutes);
app.use('/api/cnpj', cnpjRoutes);
app.use('/api/onixsat', onixsatRoutes);
app.use('/api/multas', multasRoutes);
app.use('/api/calculo-frete', calculoFreteRoutes);
app.use('/api/motorista', motoristaMobileRoutes);
app.use('/api/recibos', recibosRoutes);

app.use((req, res) => res.status(404).json({ erro: 'Rota nao encontrada.' }));
app.use(errorHandler);

module.exports = app;
