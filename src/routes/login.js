'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { Perfil, User } = require('../models/mongoModels');
const { validarPasswordForte } = require('../helpers/utils');

const DEFAULT_PERFIS = [
  { IdPerfis: 1, perfil: 'aluno' },
  { IdPerfis: 2, perfil: 'funcionario' },
  { IdPerfis: 3, perfil: 'gestor' },
];

async function ensureDefaultPerfis() {
  try {
    const total = await Perfil.countDocuments();
    if (total > 0) return;
    await Perfil.insertMany(DEFAULT_PERFIS, { ordered: true });
  } catch (err) {
    console.warn('⚠️  Não foi possível verificar perfis no banco. Usando defaults.');
  }
}

async function getPerfisDocs() {
  try {
    await ensureDefaultPerfis();
    return await Perfil.find().sort({ perfil: 1 }).lean();
  } catch (err) {
    console.warn('⚠️  Erro ao buscar perfis. Usando perfis padrão.');
    return DEFAULT_PERFIS;
  }
}

function mapPerfisForView(perfisDocs) {
  return perfisDocs.map((p) => ({
    IdPerfis: String(p.IdPerfis),
    perfil: p.perfil,
    _id: p._id,
  }));
}

async function nextLegacyUserId() {
  const last = await User.findOne({ IdUser: { $exists: true } })
    .sort({ IdUser: -1 })
    .select('IdUser')
    .lean();
  return (last?.IdUser || 0) + 1;
}

// GET /login
router.get('/', async (req, res) => {
  const perfis = mapPerfisForView(await getPerfisDocs());
  res.render('login', {
    perfis,
    mensagem:  req.flash('error')[0]   || req.query.message || '',
    tipo:      req.flash('success')[0] ? 'success' : (req.query.type === 'success' ? 'success' : 'error'),
    loginInput: '',
    novoUtilizadorInput: '',
    perfilSelecionado: 0,
    utilizadorEsqueceuInput: '',
    mostrarEsqueceu: false,
  });
});

// POST /login — três ações: login | register | forgot_password
router.post('/', async (req, res) => {
  const { form_action = 'login' } = req.body;
  const perfisDocs = await getPerfisDocs();
  const perfis = mapPerfisForView(perfisDocs);

  const render = (extra) =>
    res.render('login', {
      perfis,
      mensagem: '',
      tipo: 'error',
      loginInput: '',
      novoUtilizadorInput: '',
      perfilSelecionado: 0,
      utilizadorEsqueceuInput: '',
      mostrarEsqueceu: false,
      ...extra,
    });

  // ── LOGIN ────────────────────────────────────────────────────
  if (form_action === 'login') {
    const utilizador = String(req.body.utilizador || '').trim();
    const senha      = String(req.body.senha || '');

    if (!utilizador || !senha) {
      return render({ mensagem: 'Preenche utilizador e Password.', loginInput: utilizador });
    }

    const user = await User.findOne({ login: utilizador }).populate('perfil').lean();
    const hash = user?.passwordHash || '';

    if (!user || !hash || !(await bcrypt.compare(senha, hash))) {
      return render({ mensagem: 'Utilizador ou Password incorretos.', loginInput: utilizador });
    }

    // Rehash se necessário (custo actualizado)
    if (hash.startsWith('$2') && bcrypt.getRounds(hash) < 12) {
      const newHash = await bcrypt.hash(senha, 12);
      await User.updateOne({ _id: user._id }, { $set: { passwordHash: newHash } });
    }

    req.session.regenerate((err) => {
      if (err) return res.redirect('/login');
      req.session.utilizador_autenticado = true;
      req.session.utilizador_id          = Number.isInteger(user.IdUser) ? user.IdUser : String(user._id);
      req.session.utilizador_nome        = user.login;
      req.session.utilizador_perfil      = user.perfil?.perfil || '';
      req.session.save(() => res.redirect('/'));
    });
    return;
  }

  // ── REGISTER ─────────────────────────────────────────────────
  if (form_action === 'register') {
    const novoUtilizador  = String(req.body.novo_utilizador || '').trim();
    const novaSenha       = String(req.body.nova_senha || '');
    const confirmarSenha  = String(req.body.confirmar_senha || '');
    const perfilSelecionado = String(req.body.perfil || '').trim();

    if (!novoUtilizador || !novaSenha || !confirmarSenha) {
      return render({ mensagem: 'Preenche todos os campos para criar conta.', novoUtilizadorInput: novoUtilizador, perfilSelecionado });
    }
    if (novoUtilizador.length > 40) {
      return render({ mensagem: 'O utilizador não pode ter mais de 40 caracteres.', novoUtilizadorInput: novoUtilizador, perfilSelecionado });
    }
    if (novaSenha !== confirmarSenha) {
      return render({ mensagem: 'As Passwords não coincidem.', novoUtilizadorInput: novoUtilizador, perfilSelecionado });
    }

    try { validarPasswordForte(novaSenha, novoUtilizador); } catch (e) {
      return render({ mensagem: e.message, novoUtilizadorInput: novoUtilizador, perfilSelecionado });
    }

    const perfilDoc = perfisDocs.find((p) => String(p.IdPerfis) === perfilSelecionado);
    if (!perfilDoc) {
      return render({ mensagem: 'Perfil inválido.', novoUtilizadorInput: novoUtilizador, perfilSelecionado });
    }

    const existe = await User.findOne({ login: novoUtilizador }).select('_id').lean();
    if (existe) {
      return render({ mensagem: 'Esse utilizador já existe.', novoUtilizadorInput: novoUtilizador, perfilSelecionado });
    }

    const hash = await bcrypt.hash(novaSenha, 12);
    await User.create({
      IdUser: await nextLegacyUserId(),
      login: novoUtilizador,
      passwordHash: hash,
      perfil: perfilDoc._id,
    });

    return render({ mensagem: 'Conta criada com sucesso. Agora podes entrar.', tipo: 'success', loginInput: novoUtilizador });
  }

  // ── FORGOT PASSWORD ──────────────────────────────────────────
  if (form_action === 'forgot_password') {
    const utilizadorEsqueceu    = String(req.body.utilizador_esqueceu || '').trim();
    const novaSenhaEsqueceu     = String(req.body.nova_senha_esqueceu || '');
    const confirmarSenhaEsqueceu = String(req.body.confirmar_senha_esqueceu || '');

    if (!utilizadorEsqueceu || !novaSenhaEsqueceu || !confirmarSenhaEsqueceu) {
      return render({ mensagem: 'Preenche utilizador, nova palavra passe e confirmação.', mostrarEsqueceu: true, utilizadorEsqueceuInput: utilizadorEsqueceu });
    }
    if (novaSenhaEsqueceu !== confirmarSenhaEsqueceu) {
      return render({ mensagem: 'As Passwords não coincidem.', mostrarEsqueceu: true, utilizadorEsqueceuInput: utilizadorEsqueceu });
    }

    try { validarPasswordForte(novaSenhaEsqueceu, utilizadorEsqueceu); } catch (e) {
      return render({ mensagem: e.message, mostrarEsqueceu: true, utilizadorEsqueceuInput: utilizadorEsqueceu });
    }

    const user = await User.findOne({ login: utilizadorEsqueceu }).select('_id').lean();
    if (!user) {
      return render({ mensagem: 'Utilizador não encontrado.', mostrarEsqueceu: true, utilizadorEsqueceuInput: utilizadorEsqueceu });
    }

    const hash = await bcrypt.hash(novaSenhaEsqueceu, 12);
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: hash } });

    return render({ mensagem: 'Palavra passe atualizada com sucesso. Já podes entrar.', tipo: 'success', loginInput: utilizadorEsqueceu });
  }

  res.redirect('/login');
});

module.exports = router;
