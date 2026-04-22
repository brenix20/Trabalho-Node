'use strict';
const { normalizePerfil } = require('../helpers/utils');

function requireAuth(req, res, next) {
  if (!req.session.utilizador_autenticado) {
    return res.redirect('/login');
  }
  next();
}

function requirePerfil(...perfis) {
  return (req, res, next) => {
    const perfilAtual = normalizePerfil(req.session.utilizador_perfil || '');
    if (perfis.map(normalizePerfil).includes(perfilAtual)) return next();
    req.flash('error', 'Acesso não autorizado.');
    return res.redirect('/');
  };
}

module.exports = { requireAuth, requirePerfil };
