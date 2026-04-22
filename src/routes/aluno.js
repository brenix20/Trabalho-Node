'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const upload  = require('../middleware/upload');
const { requireAuth, requirePerfil } = require('../middleware/auth');
const {
  validarDataNascimento, validarEmail, validarTelefone,
  normalizarEstadoValidacao, dataMaximaNascimento, formatDatePt,
} = require('../helpers/utils');

router.use(requireAuth, requirePerfil('aluno'));

function redirectMsg(res, section, type, message) {
  return res.redirect(`/aluno?table=${encodeURIComponent(section)}&type=${type}&message=${encodeURIComponent(message)}`);
}

async function getAlunoSessao(req) {
  const userId = parseInt(req.session.utilizador_id, 10) || 0;
  if (!userId) return null;
  const [[aluno]] = await db.query(
    'SELECT IdAluno, EstadoValidacao FROM matriculas WHERE IdAluno = ? LIMIT 1', [userId]
  );
  return aluno || null;
}

// ── GET /aluno ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const [cursosArr]     = await db.query('SELECT IdCurso, Curso FROM cursos ORDER BY Curso');
  const [disciplinasArr]= await db.query('SELECT IdDisciplina, Disciplina FROM disciplina ORDER BY Disciplina');
  const alunoSessao     = await getAlunoSessao(req);
  const estadoFicha     = normalizarEstadoValidacao(alunoSessao?.EstadoValidacao || '');
  const alunoIdSessao   = alunoSessao ? parseInt(alunoSessao.IdAluno, 10) : 0;
  const mensagem = req.query.message || '';
  const tipo     = req.query.type === 'success' ? 'success' : 'error';

  // Último pedido de matrícula
  let ultimoPedido = null;
  if (alunoIdSessao) {
    const [[p]] = await db.query(
      `SELECT IdPedido, Estado, ObservacaoDecisao, DecididoPor, DataPedido, DataDecisao, IdCurso
       FROM pedidos_matricula WHERE IdAluno = ? ORDER BY IdPedido DESC LIMIT 1`,
      [alunoIdSessao]
    );
    ultimoPedido = p || null;
  }

  const estadoPedido         = ultimoPedido?.Estado || '';
  const alunoTemPedidoPendente = estadoPedido === 'Pendente';
  const alunoTemPedidoAprovado = estadoPedido === 'Aprovado';
  const alunoPodeCriarPedido   = estadoFicha === 'Aprovada' && !alunoTemPedidoPendente && !alunoTemPedidoAprovado;
  const alunoMatriculaEfetivada = estadoFicha === 'Aprovada' && alunoTemPedidoAprovado;

  const table  = req.query.table || 'matriculas';
  const action = req.query.action || (alunoIdSessao ? 'ficha' : 'list');

  // ── FOTO ──────────────────────────────────────────────────────
  if (table === 'matriculas' && action === 'foto') {
    const [[row]] = await db.query('SELECT Foto FROM matriculas WHERE IdAluno = ?', [alunoIdSessao]);
    if (!row || !row.Foto) return res.sendStatus(404);
    res.set('Content-Type', 'image/jpeg');
    return res.send(row.Foto);
  }

  // ── FICHA ─────────────────────────────────────────────────────
  let fichaAluno = null;
  let fichaDisciplinas = [];
  let turmaColegas = [];

  if (alunoIdSessao) {
    const [[fa]] = await db.query(
      `SELECT m.*, c.Curso FROM matriculas m JOIN cursos c ON c.IdCurso = m.IdCurso WHERE m.IdAluno = ?`,
      [alunoIdSessao]
    );
    fichaAluno = fa ? { ...fa, DataNascimento: fa.DataNascimento ? String(fa.DataNascimento).slice(0, 10) : '' } : null;

    if (fichaAluno) {
      [fichaDisciplinas] = await db.query(
        `SELECT d.Disciplina, d.Sigla FROM plano_estudos pe
         JOIN disciplina d ON d.IdDisciplina = pe.IdDisciplina
         WHERE pe.IdCurso = ?`,
        [fichaAluno.IdCurso]
      );
    }

    if (action === 'minha_turma' && alunoMatriculaEfetivada && fichaAluno) {
      [turmaColegas] = await db.query(
        `SELECT IdAluno, Nome FROM matriculas WHERE IdCurso = ? AND EstadoValidacao = 'Aprovada' ORDER BY Nome`,
        [fichaAluno.IdCurso]
      );
    }
  }

  res.render('aluno/index', {
    table, action, mensagem, tipo,
    cursos: cursosArr, disciplinas: disciplinasArr,
    alunoIdSessao, fichaAluno, fichaDisciplinas, turmaColegas,
    ultimoPedido, estadoFicha,
    alunoPodeCriarPedido, alunoMatriculaEfetivada,
    alunoTemPedidoPendente, alunoTemPedidoAprovado,
    dataMaximaNascimento: dataMaximaNascimento(),
    formatDatePt, sessao: req.session,
  });
});

// ── POST /aluno ───────────────────────────────────────────────────────────────
router.post('/', upload.single('Foto'), async (req, res) => {
  const postTable  = String(req.body.table || '');
  const postAction = String(req.body.action || '');
  const alunoSessao = await getAlunoSessao(req);
  const alunoIdSessao = alunoSessao ? parseInt(alunoSessao.IdAluno, 10) : 0;

  // ── Criar ficha (aluno ainda não tem ficha) ───────────────────
  if (postTable === 'matriculas' && postAction === 'create_self') {
    try {
      const nome     = String(req.body.Nome || '').trim();
      const idCurso  = parseInt(req.body.IdCurso, 10);
      const dataNasc = validarDataNascimento(req.body.DataNascimento);
      const morada   = String(req.body.Morada || '').trim();
      const email    = validarEmail(req.body.Email);
      const telefone = validarTelefone(req.body.Telefone);
      const foto     = req.file ? req.file.buffer : null;
      const userId   = parseInt(req.session.utilizador_id, 10);

      await db.query(
        `INSERT INTO matriculas (IdAluno, IdUser, Nome, IdCurso, DataNascimento, Morada, Email, Telefone, Foto, EstadoValidacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendente')`,
        [userId, userId, nome, idCurso, dataNasc, morada, email, telefone, foto]
      );
      return redirectMsg(res, 'matriculas', 'success', 'Ficha submetida para validação.');
    } catch (e) {
      return redirectMsg(res, 'matriculas', 'error', e.message);
    }
  }

  // ── Atualizar ficha (aluno atualiza os seus dados) ────────────
  if (postTable === 'matriculas' && postAction === 'update_self') {
    if (!alunoIdSessao) return redirectMsg(res, 'matriculas', 'error', 'Sem ficha associada.');
    try {
      const nome     = String(req.body.Nome || '').trim();
      const idCurso  = parseInt(req.body.IdCurso, 10);
      const dataNasc = validarDataNascimento(req.body.DataNascimento);
      const morada   = String(req.body.Morada || '').trim();
      const email    = validarEmail(req.body.Email);
      const telefone = validarTelefone(req.body.Telefone);
      const foto     = req.file ? req.file.buffer : null;

      const fields = ['Nome=?', 'IdCurso=?', 'DataNascimento=?', 'Morada=?', 'Email=?', 'Telefone=?'];
      const vals   = [nome, idCurso, dataNasc, morada, email, telefone];
      if (foto) { fields.push('Foto=?'); vals.push(foto); }
      vals.push(alunoIdSessao);

      await db.query(`UPDATE matriculas SET ${fields.join(',')} WHERE IdAluno = ?`, vals);
      return redirectMsg(res, 'matriculas', 'success', 'Ficha atualizada com sucesso.');
    } catch (e) {
      return redirectMsg(res, 'matriculas', 'error', e.message);
    }
  }

  // ── Criar pedido de matrícula ─────────────────────────────────
  if (postTable === 'pedidos' && postAction === 'create_self') {
    if (!alunoIdSessao) return redirectMsg(res, 'pedidos', 'error', 'Sem ficha associada.');
    const estado = normalizarEstadoValidacao(alunoSessao?.EstadoValidacao || '');
    if (estado !== 'Aprovada') return redirectMsg(res, 'pedidos', 'error', 'A tua ficha ainda não está aprovada.');

    const idCurso = parseInt(req.body.IdCurso, 10);
    const obs     = String(req.body.Observacoes || '').trim();

    await db.query(
      `INSERT INTO pedidos_matricula (IdAluno, NomeCandidato, Email, IdCurso, Observacoes, Estado)
       SELECT IdAluno, Nome, Email, IdCurso, ?, 'Pendente' FROM matriculas WHERE IdAluno = ?`,
      [obs || null, alunoIdSessao]
    );
    return redirectMsg(res, 'pedidos', 'success', 'Pedido de matrícula submetido com sucesso.');
  }

  redirectMsg(res, 'matriculas', 'error', 'Ação inválida.');
});

module.exports = router;
