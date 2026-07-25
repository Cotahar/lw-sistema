require('dotenv').config();
const path = require('node:path');
const express = require('express');
const cors = require('cors');

require('./config/db'); // garante que o banco/tabelas existam antes de subir as rotas

const { autenticar } = require('./middleware/auth');
const { resolverEmpresa } = require('./middleware/empresa');
const errorHandler = require('./middleware/errorHandler');

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
const dashboardRoutes = require('./routes/dashboard.routes');
const ocorrenciasRoutes = require('./routes/ocorrencias.routes');
const adminRoutes = require('./routes/admin.routes');
const drivvoRoutes = require('./routes/drivvo.routes');
const empresasRoutes = require('./routes/empresas.routes');
const cnpjRoutes = require('./routes/cnpj.routes');
const onixsatRoutes = require('./routes/onixsat.routes');
const multasRoutes = require('./routes/multas.routes');
const calculoFreteRoutes = require('./routes/calculoFrete.routes');
const motoristaMobileRoutes = require('./routes/motorista.routes');

const app = express();
app.use(cors());
app.use(express.json());

// Frontend (HTML/CSS/JS estatico) e a API rodam no mesmo servidor/porta -
// simplifica o "rodar localmente" (um so `npm start`). O roteamento de tela
// no frontend e via hash (#/modulo), entao servir os arquivos estaticos
// normalmente (sem fallback de SPA) e suficiente.
app.use(express.static(path.resolve(__dirname, '../../frontend')));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.resolve(__dirname, '../uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

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
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ocorrencias', ocorrenciasRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/drivvo', drivvoRoutes);
app.use('/api/empresas', empresasRoutes);
app.use('/api/cnpj', cnpjRoutes);
app.use('/api/onixsat', onixsatRoutes);
app.use('/api/multas', multasRoutes);
app.use('/api/calculo-frete', calculoFreteRoutes);
app.use('/api/motorista', motoristaMobileRoutes);

app.use((req, res) => res.status(404).json({ erro: 'Rota nao encontrada.' }));
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API do Sistema Frottex rodando em http://localhost:${PORT}`);
});

// Sincronizacao automatica de posicao/hodometro via Onixsat. Cada empresa
// pode ter seu proprio intervalo (empresas.onixsat_poll_minutos, cadastro de
// Empresas - padrao 3min se nao configurado); ONIXSAT_POLL_MINUTOS aqui e so
// a granularidade do "tick" que verifica quem ja esta devendo sincronizar
// (default 1min, bem mais fino que qualquer intervalo razoavel por empresa)
// - ONIXSAT_POLL_MINUTOS=0 desativa o agendador inteiro.
const { iniciarAgendadorOnixsat } = require('./utils/onixsatScheduler');
iniciarAgendadorOnixsat(process.env.ONIXSAT_POLL_MINUTOS !== undefined ? Number(process.env.ONIXSAT_POLL_MINUTOS) : 1);
