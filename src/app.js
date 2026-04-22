'use strict';
require('dotenv').config();

const express        = require('express');
const session        = require('express-session');
const flash          = require('connect-flash');
const path           = require('path');
const { normalizePerfil } = require('./helpers/utils');
const { connectMongo } = require('./mongodb');

const loginRouter       = require('./routes/login');
const gestorRouter      = require('./routes/gestor');
const alunoRouter       = require('./routes/aluno');
const funcionarioRouter = require('./routes/funcionario');

const app = express();

// ── View engine ───────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Body parsers ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Static files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Session ───────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'ipcavnf-secret-dev',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   2 * 60 * 60 * 1000, // 2 horas
  },
}));

// ── Flash messages ────────────────────────────────────────────
app.use(flash());

// ── Locals globais para as views ──────────────────────────────
app.use((req, res, next) => {
  res.locals.sessao        = req.session;
  res.locals.flashSuccess  = req.flash('success');
  res.locals.flashError    = req.flash('error');
  next();
});

// ── Rotas ─────────────────────────────────────────────────────
app.use('/login', loginRouter);

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login?type=success&message=' + encodeURIComponent('Sessão terminada com sucesso.'));
  });
});

// Rota raiz: redireciona conforme perfil (equivalente a index.php)
app.get('/', (req, res) => {
  if (!req.session.utilizador_autenticado) return res.redirect('/login');
  const perfil = normalizePerfil(req.session.utilizador_perfil || '');
  if (perfil === 'aluno')       return res.redirect('/aluno');
  if (perfil === 'gestor')      return res.redirect('/gestor');
  if (perfil === 'funcionario') return res.redirect('/funcionario');
  res.redirect('/login');
});

app.use('/gestor',      gestorRouter);
app.use('/aluno',       alunoRouter);
app.use('/funcionario', funcionarioRouter);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).send('Página não encontrada.'));

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Erro interno do servidor.');
});

// ── Start ─────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;

async function start() {
  if (process.env.MONGODB_URI) {
    await connectMongo();
    console.log('✅  MongoDB ligado com sucesso.');
  } else {
    console.log('ℹ️  MONGODB_URI não definido; app em modo MySQL legado.');
  }

  app.listen(PORT, () => {
    console.log(`✅  Servidor IPCAVNF a correr em http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Erro ao iniciar aplicação:', err);
  process.exit(1);
});
