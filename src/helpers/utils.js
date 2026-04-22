'use strict';

/**
 * Formata uma data YYYY-MM-DD para DD/MM/YYYY (equivalente a formatDatePt)
 */
function formatDatePt(dateValue) {
  if (!dateValue) return '';
  const s = String(dateValue).trim().slice(0, 10);
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateValue;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Valida data de nascimento — equivalente a validarDataNascimento()
 * Retorna a data formatada YYYY-MM-DD ou lança um erro com mensagem
 */
function validarDataNascimento(value) {
  const s = String(value || '').trim();
  if (!s) throw new Error('A data de nascimento é obrigatória.');

  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Data de nascimento inválida.');

  const date = new Date(s);
  if (isNaN(date.getTime())) throw new Error('Data de nascimento inválida.');

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  if (date > hoje) throw new Error('A data de nascimento não pode ser superior ao dia de hoje.');

  const limiteMinimo = new Date(hoje);
  limiteMinimo.setFullYear(limiteMinimo.getFullYear() - 13);
  if (date > limiteMinimo) throw new Error('O aluno tem de ter no mínimo 13 anos.');

  return s;
}

/**
 * Valida email — equivalente a validarEmail()
 */
function validarEmail(value) {
  const email = String(value || '').trim();
  if (!email) throw new Error('O email é obrigatório.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email inválido.');
  if (email.length > 120) throw new Error('O email não pode ter mais de 120 caracteres.');
  return email;
}

/**
 * Valida telefone — equivalente a validarTelefone()
 */
function validarTelefone(value) {
  const tel = String(value || '').trim();
  if (!tel) throw new Error('O contacto telefónico é obrigatório.');
  if (tel.length < 9 || tel.length > 20) throw new Error('O contacto telefónico deve ter entre 9 e 20 caracteres.');
  if (!/^[0-9+\s()\-]+$/.test(tel)) throw new Error('O contacto telefónico contém caracteres inválidos.');
  return tel;
}

/**
 * Normaliza estado de validação — equivalente a normalizarEstadoValidacao()
 */
function normalizarEstadoValidacao(estado) {
  const s = String(estado || '').toLowerCase().trim();
  if (s === 'pendente') return 'Pendente';
  if (s === 'aprovada' || s === 'aprovado') return 'Aprovada';
  if (s === 'rejeitada' || s === 'rejeitado') return 'Rejeitada';
  return false;
}

/**
 * Valida password forte — equivalente a validarPasswordForte()
 */
function validarPasswordForte(password, username) {
  const pwd = String(password);
  const user = String(username || '').trim();

  if (pwd.length < 12) throw new Error('A Password deve ter pelo menos 12 caracteres.');
  if (pwd.length > 128) throw new Error('A Password não pode ter mais de 128 caracteres.');

  if (!/[A-Z]/.test(pwd) || !/[a-z]/.test(pwd) || !/\d/.test(pwd) || !/[^A-Za-z0-9]/.test(pwd)) {
    throw new Error('A Password deve incluir maiúsculas, minúsculas, números e símbolos.');
  }

  if (user && pwd.toLowerCase().includes(user.toLowerCase())) {
    throw new Error('A Password não pode conter o nome de utilizador.');
  }

  const comuns = ['123456', '123456789', 'qwerty', 'password', 'admin', 'abc123', '123123'];
  if (comuns.includes(pwd.toLowerCase())) throw new Error('A Password é demasiado comum.');
}

/**
 * Calcula o ano letivo atual (ex: 2024/2025)
 */
function anoLetivoAtual() {
  const now = new Date();
  const ano = now.getFullYear();
  const mes = now.getMonth() + 1; // 1-12
  return mes >= 9 ? `${ano}/${ano + 1}` : `${ano - 1}/${ano}`;
}

/**
 * Normaliza string de perfil (remove acentos, lowercase)
 */
function normalizePerfil(perfil) {
  return String(perfil || '').toLowerCase().trim()
    .replace(/[áàâã]/g, 'a')
    .replace(/[éê]/g, 'e')
    .replace(/[í]/g, 'i')
    .replace(/[óôõ]/g, 'o')
    .replace(/[ú]/g, 'u')
    .replace(/ç/g, 'c');
}

/**
 * Data máxima de nascimento (13 anos atrás, formato YYYY-MM-DD)
 */
function dataMaximaNascimento() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 13);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  formatDatePt,
  validarDataNascimento,
  validarEmail,
  validarTelefone,
  normalizarEstadoValidacao,
  validarPasswordForte,
  anoLetivoAtual,
  normalizePerfil,
  dataMaximaNascimento,
};
