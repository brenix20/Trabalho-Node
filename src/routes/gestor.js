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

router.use(requireAuth, requirePerfil('gestor'));

// ── helpers ──────────────────────────────────────────────────────────────────
function redirectMsg(res, section, type, message) {
  return res.redirect(`/gestor?table=${encodeURIComponent(section)}&type=${type}&message=${encodeURIComponent(message)}`);
}

async function getLookups() {
  const [disciplinas] = await db.query('SELECT IdDisciplina, Disciplina, Sigla FROM disciplina ORDER BY Disciplina');
  const [cursos]      = await db.query('SELECT IdCurso, Curso, Sigla FROM cursos ORDER BY Curso');
  return { disciplinas, cursos };
}

// ── GET /gestor ───────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const table   = ['disciplina', 'cursos', 'matriculas', 'plano_estudos'].includes(req.query.table) ? req.query.table : 'disciplina';
  const action  = req.query.action || 'list';
  const mensagem = req.query.message || '';
  const tipo     = req.query.type === 'success' ? 'success' : 'error';
  const { disciplinas, cursos } = await getLookups();

  // ── FOTO ──────────────────────────────────────────────────────
  if (table === 'matriculas' && action === 'foto') {
    const id = parseInt(req.query.id_aluno, 10);
    const [[row]] = await db.query('SELECT Foto FROM matriculas WHERE IdAluno = ?', [id]);
    if (!row || !row.Foto) return res.sendStatus(404);
    res.set('Content-Type', 'image/jpeg');
    return res.send(row.Foto);
  }

  let editData = null;
  let rowsMatriculas = [];
  let rowsPlano = [];

  if (table === 'disciplina' && action === 'edit') {
    const [[row]] = await db.query('SELECT * FROM disciplina WHERE IdDisciplina = ?', [req.query.id]);
    editData = row || null;
  }

  if (table === 'cursos' && action === 'edit') {
    const [[row]] = await db.query('SELECT * FROM cursos WHERE IdCurso = ?', [req.query.id]);
    editData = row || null;
  }

  if (table === 'matriculas') {
    const q = String(req.query.q || '').trim();
    const fc = parseInt(req.query.filtro_curso, 10) || 0;
    let sql = `SELECT m.*, c.Curso FROM matriculas m JOIN cursos c ON c.IdCurso = m.IdCurso`;
    const params = [];
    const conds = [];
    if (q) { conds.push('(CAST(m.IdAluno AS CHAR) LIKE ? OR m.Nome LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (fc) { conds.push('m.IdCurso = ?'); params.push(fc); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY m.IdAluno DESC';
    [rowsMatriculas] = await db.query(sql, params);
    rowsMatriculas = rowsMatriculas.map(r => ({ ...r, DataNascimento: r.DataNascimento ? String(r.DataNascimento).slice(0, 10) : '' }));

    if (action === 'edit') {
      const [[row]] = await db.query('SELECT * FROM matriculas WHERE IdAluno = ?', [req.query.id_aluno]);
      editData = row ? { ...row, DataNascimento: row.DataNascimento ? String(row.DataNascimento).slice(0, 10) : '' } : null;
    }

    if (action === 'ficha') {
      const [[ficha]] = await db.query(
        `SELECT m.*, c.Curso FROM matriculas m JOIN cursos c ON c.IdCurso = m.IdCurso WHERE m.IdAluno = ?`,
        [req.query.id_aluno]
      );
      const [fichaDisciplinas] = await db.query(
        `SELECT d.Disciplina, d.Sigla FROM plano_estudos pe JOIN disciplina d ON d.IdDisciplina = pe.IdDisciplina WHERE pe.IdCurso = ?`,
        [ficha?.IdCurso]
      );
      return res.render('gestor/ficha', { ficha, fichaDisciplinas, formatDatePt, mensagem, tipo, table, action, disciplinas, cursos, dataMaximaNascimento: dataMaximaNascimento() });
    }
  }

  if (table === 'plano_estudos') {
    [rowsPlano] = await db.query(
      `SELECT pe.IdDisciplina, pe.IdCurso, pe.Ano, pe.Semestre, d.Disciplina, c.Curso
       FROM plano_estudos pe
       JOIN disciplina d ON d.IdDisciplina = pe.IdDisciplina
       JOIN cursos c ON c.IdCurso = pe.IdCurso
       ORDER BY c.Curso, pe.Ano, pe.Semestre, d.Disciplina`
    );
    if (action === 'edit') {
      const [[row]] = await db.query(
        'SELECT * FROM plano_estudos WHERE IdDisciplina = ? AND IdCurso = ?',
        [req.query.id_disciplina, req.query.id_curso]
      );
      editData = row || null;
    }
  }

  res.render('gestor/index', {
    table, action, mensagem, tipo, editData,
    disciplinas, cursos,
    rowsMatriculas, rowsPlano,
    dataMaximaNascimento: dataMaximaNascimento(),
    formatDatePt,
    sessao: req.session,
  });
});

// ── POST /gestor ──────────────────────────────────────────────────────────────
router.post('/', upload.single('Foto'), async (req, res) => {
  const postTable  = String(req.body.table || '');
  const postAction = String(req.body.action || '');
  const allowed    = ['disciplina', 'cursos', 'matriculas', 'plano_estudos'];

  if (!allowed.includes(postTable)) return redirectMsg(res, 'disciplina', 'error', 'Tabela inválida.');

  // ── DISCIPLINA ────────────────────────────────────────────────
  if (postTable === 'disciplina') {
    const disciplina = String(req.body.Disciplina || '').trim();
    const sigla      = String(req.body.Sigla || '').trim();

    if (postAction === 'create') {
      await db.query('INSERT INTO disciplina (Disciplina, Sigla) VALUES (?, ?)', [disciplina, sigla]);
      return redirectMsg(res, 'disciplina', 'success', 'Disciplina criada com sucesso.');
    }
    if (postAction === 'update') {
      const id = parseInt(req.body.IdDisciplina, 10);
      await db.query('UPDATE disciplina SET Disciplina = ?, Sigla = ? WHERE IdDisciplina = ?', [disciplina, sigla, id]);
      return redirectMsg(res, 'disciplina', 'success', 'Disciplina atualizada com sucesso.');
    }
    if (postAction === 'delete') {
      const id = parseInt(req.body.IdDisciplina, 10);
      await db.query('DELETE FROM disciplina WHERE IdDisciplina = ?', [id]);
      return redirectMsg(res, 'disciplina', 'success', 'Disciplina removida com sucesso.');
    }
  }

  // ── CURSOS ────────────────────────────────────────────────────
  if (postTable === 'cursos') {
    const curso = String(req.body.Curso || '').trim();
    const sigla = String(req.body.Sigla || '').trim();

    if (postAction === 'create') {
      await db.query('INSERT INTO cursos (Curso, Sigla) VALUES (?, ?)', [curso, sigla]);
      return redirectMsg(res, 'cursos', 'success', 'Curso criado com sucesso.');
    }
    if (postAction === 'update') {
      const id = parseInt(req.body.IdCurso, 10);
      await db.query('UPDATE cursos SET Curso = ?, Sigla = ? WHERE IdCurso = ?', [curso, sigla, id]);
      return redirectMsg(res, 'cursos', 'success', 'Curso atualizado com sucesso.');
    }
    if (postAction === 'delete') {
      const id = parseInt(req.body.IdCurso, 10);
      await db.query('DELETE FROM cursos WHERE IdCurso = ?', [id]);
      return redirectMsg(res, 'cursos', 'success', 'Curso removido com sucesso.');
    }
  }

  // ── PLANO DE ESTUDOS ──────────────────────────────────────────
  if (postTable === 'plano_estudos') {
    const idDisciplina = parseInt(req.body.IdDisciplina, 10);
    const idCurso      = parseInt(req.body.IdCurso, 10);
    const ano          = parseInt(req.body.Ano, 10) || 1;
    const semestre     = parseInt(req.body.Semestre, 10) || 1;

    if (postAction === 'create') {
      await db.query('INSERT INTO plano_estudos (IdDisciplina, IdCurso, Ano, Semestre) VALUES (?, ?, ?, ?)', [idDisciplina, idCurso, ano, semestre]);
      return redirectMsg(res, 'plano_estudos', 'success', 'Ligação criada com sucesso.');
    }
    if (postAction === 'update') {
      const oldId  = parseInt(req.body.old_IdDisciplina, 10);
      const oldCurso = parseInt(req.body.old_IdCurso, 10);
      await db.query(
        'UPDATE plano_estudos SET IdDisciplina = ?, IdCurso = ?, Ano = ?, Semestre = ? WHERE IdDisciplina = ? AND IdCurso = ?',
        [idDisciplina, idCurso, ano, semestre, oldId, oldCurso]
      );
      return redirectMsg(res, 'plano_estudos', 'success', 'Ligação atualizada com sucesso.');
    }
    if (postAction === 'delete') {
      const idD = parseInt(req.body.IdDisciplina, 10);
      const idC = parseInt(req.body.IdCurso, 10);
      await db.query('DELETE FROM plano_estudos WHERE IdDisciplina = ? AND IdCurso = ?', [idD, idC]);
      return redirectMsg(res, 'plano_estudos', 'success', 'Ligação removida com sucesso.');
    }
  }

  // ── MATRÍCULAS (gestor: validar/rejeitar/remover) ─────────────
  if (postTable === 'matriculas') {
    if (postAction === 'set_validation') {
      const idAluno = parseInt(req.body.IdAluno, 10);
      const estado  = normalizarEstadoValidacao(req.body.EstadoValidacao || '');
      const obs     = String(req.body.ObservacoesValidacao || '').trim();
      if (!estado) return redirectMsg(res, 'matriculas', 'error', 'Estado inválido.');

      await db.query(
        `UPDATE matriculas SET EstadoValidacao = ?, ObservacoesValidacao = ?, ValidadoPor = ?, DataValidacao = NOW() WHERE IdAluno = ?`,
        [estado, obs || null, req.session.utilizador_nome, idAluno]
      );
      return redirectMsg(res, 'matriculas', 'success', 'Estado de validação atualizado.');
    }

    if (postAction === 'delete') {
      const idAluno = parseInt(req.body.IdAluno, 10);
      await db.query('DELETE FROM matriculas WHERE IdAluno = ?', [idAluno]);
      return redirectMsg(res, 'matriculas', 'success', 'Matrícula removida com sucesso.');
    }

    if (postAction === 'update') {
      const idAluno = parseInt(req.body.IdAluno, 10);
      try {
        const nome    = String(req.body.Nome || '').trim();
        const idCurso = parseInt(req.body.IdCurso, 10);
        const estado  = normalizarEstadoValidacao(req.body.EstadoValidacao || 'Pendente') || 'Pendente';
        const dataNasc = validarDataNascimento(req.body.DataNascimento);
        const morada   = String(req.body.Morada || '').trim();
        const email    = validarEmail(req.body.Email);
        const telefone = validarTelefone(req.body.Telefone);
        const foto     = req.file ? req.file.buffer : null;

        const fields = ['Nome=?', 'IdCurso=?', 'EstadoValidacao=?', 'DataNascimento=?', 'Morada=?', 'Email=?', 'Telefone=?'];
        const vals   = [nome, idCurso, estado, dataNasc, morada, email, telefone];
        if (foto) { fields.push('Foto=?'); vals.push(foto); }
        vals.push(idAluno);

        await db.query(`UPDATE matriculas SET ${fields.join(',')} WHERE IdAluno = ?`, vals);
        return redirectMsg(res, 'matriculas', 'success', 'Matrícula atualizada com sucesso.');
      } catch (e) {
        return redirectMsg(res, 'matriculas', 'error', e.message);
      }
    }

    if (postAction === 'create') {
      try {
        const idAluno  = parseInt(req.body.IdAluno, 10);
        const nome     = String(req.body.Nome || '').trim();
        const idCurso  = parseInt(req.body.IdCurso, 10);
        const estado   = normalizarEstadoValidacao(req.body.EstadoValidacao || 'Pendente') || 'Pendente';
        const dataNasc = validarDataNascimento(req.body.DataNascimento);
        const morada   = String(req.body.Morada || '').trim();
        const email    = validarEmail(req.body.Email);
        const telefone = validarTelefone(req.body.Telefone);
        const foto     = req.file ? req.file.buffer : null;

        await db.query(
          `INSERT INTO matriculas (IdAluno, Nome, IdCurso, EstadoValidacao, DataNascimento, Morada, Email, Telefone, Foto)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [idAluno, nome, idCurso, estado, dataNasc, morada, email, telefone, foto]
        );
        return redirectMsg(res, 'matriculas', 'success', 'Matrícula criada com sucesso.');
      } catch (e) {
        return redirectMsg(res, 'matriculas', 'error', e.message);
      }
    }
  }

  redirectMsg(res, 'disciplina', 'error', 'Ação inválida.');
});

module.exports = router;
