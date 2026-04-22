'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requirePerfil } = require('../middleware/auth');
const { anoLetivoAtual, formatDatePt } = require('../helpers/utils');

router.use(requireAuth, requirePerfil('funcionario', 'funcionário'));

function redirectMsg(res, section, type, message) {
  return res.redirect(`/funcionario?section=${encodeURIComponent(section)}&type=${type}&message=${encodeURIComponent(message)}`);
}

// ── GET /funcionario ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const section  = ['pedidos', 'notas', 'pautas', 'matriculas'].includes(req.query.section) ? req.query.section : 'pedidos';
  const mensagem = req.query.message || '';
  const tipo     = req.query.type === 'success' ? 'success' : 'error';
  const action   = req.query.action || 'list';

  const [disciplinas] = await db.query('SELECT IdDisciplina, Disciplina FROM disciplina ORDER BY Disciplina');
  const [cursos]      = await db.query('SELECT IdCurso, Curso FROM cursos ORDER BY Curso');

  // ── PEDIDOS ───────────────────────────────────────────────────
  let pedidos = [];
  if (section === 'pedidos') {
    const estadoFiltro = req.query.estado_pedido || 'Pendente';
    [pedidos] = await db.query(
      `SELECT p.*, m.Nome AS NomeAluno, c.Curso
       FROM pedidos_matricula p
       LEFT JOIN matriculas m ON m.IdAluno = p.IdAluno
       LEFT JOIN cursos c ON c.IdCurso = p.IdCurso
       WHERE p.Estado = ?
       ORDER BY p.DataPedido DESC`,
      [estadoFiltro]
    );
  }

  // ── MATRÍCULAS ────────────────────────────────────────────────
  let matriculas = [];
  if (section === 'matriculas') {
    const q  = String(req.query.q || '').trim();
    const fc = parseInt(req.query.filtro_curso, 10) || 0;
    let sql  = `SELECT m.*, c.Curso FROM matriculas m JOIN cursos c ON c.IdCurso = m.IdCurso`;
    const conds = []; const params = [];
    if (q)  { conds.push('(CAST(m.IdAluno AS CHAR) LIKE ? OR m.Nome LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (fc) { conds.push('m.IdCurso = ?'); params.push(fc); }
    const estadoFiltro = req.query.estado_mat || '';
    if (estadoFiltro) { conds.push('m.EstadoValidacao = ?'); params.push(estadoFiltro); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY m.IdAluno DESC';
    [matriculas] = await db.query(sql, params);
  }

  // ── NOTAS ─────────────────────────────────────────────────────
  let rowsNotas = []; let notaEdit = null;
  if (section === 'notas') {
    const q  = String(req.query.q_nota || '').trim();
    const fd = parseInt(req.query.f_disciplina, 10) || 0;
    let sql  = `SELECT n.*, m.Nome AS NomeAluno, d.Disciplina, c.Curso
                FROM notas_avaliacao n
                JOIN matriculas m ON m.IdAluno = n.IdAluno
                JOIN disciplina d ON d.IdDisciplina = n.IdDisciplina
                LEFT JOIN cursos c ON c.IdCurso = m.IdCurso`;
    const conds = []; const params = [];
    if (q)  { conds.push('(CAST(n.IdAluno AS CHAR) LIKE ? OR m.Nome LIKE ? OR d.Disciplina LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (fd) { conds.push('n.IdDisciplina = ?'); params.push(fd); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY n.AtualizadoEm DESC';
    [rowsNotas] = await db.query(sql, params);

    if (action === 'edit' && req.query.id_nota) {
      const [[n]] = await db.query('SELECT * FROM notas_avaliacao WHERE IdNota = ?', [req.query.id_nota]);
      notaEdit = n || null;
    }
  }

  // ── PAUTAS ────────────────────────────────────────────────────
  let rowsPauta = []; let pautaDisciplinaId = 0; let pautaEpoca = 'Normal'; let pautaAnoLetivo = anoLetivoAtual();
  if (section === 'pautas') {
    pautaDisciplinaId = parseInt(req.query.disciplina_id, 10) || 0;
    pautaEpoca        = req.query.epoca || 'Normal';
    pautaAnoLetivo    = req.query.ano_letivo || anoLetivoAtual();
    if (pautaDisciplinaId) {
      [rowsPauta] = await db.query(
        `SELECT n.IdAluno, m.Nome AS NomeAluno, c.Curso, n.Nota,
                IF(n.Nota >= 9.5, 'Aprovado', 'Reprovado') AS Resultado
         FROM notas_avaliacao n
         JOIN matriculas m ON m.IdAluno = n.IdAluno
         LEFT JOIN cursos c ON c.IdCurso = m.IdCurso
         WHERE n.IdDisciplina = ? AND n.Epoca = ? AND n.AnoLetivo = ?
         ORDER BY m.Nome`,
        [pautaDisciplinaId, pautaEpoca, pautaAnoLetivo]
      );
    }
  }

  // ── Alunos para select de notas ───────────────────────────────
  const [alunosSelect] = await db.query(
    `SELECT m.IdAluno, m.Nome, m.IdCurso FROM matriculas m WHERE m.EstadoValidacao = 'Aprovada' ORDER BY m.Nome`
  );

  res.render('funcionario/index', {
    section, mensagem, tipo, action,
    disciplinas, cursos,
    pedidos, matriculas, rowsNotas, notaEdit,
    rowsPauta, pautaDisciplinaId, pautaEpoca, pautaAnoLetivo,
    alunosSelect,
    anoLetivoAtual: anoLetivoAtual(),
    formatDatePt, sessao: req.session,
  });
});

// ── POST /funcionario ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const postAction = String(req.body.post_action || '');

  // ── Decidir pedido ────────────────────────────────────────────
  if (postAction === 'decidir_pedido') {
    const idPedido  = parseInt(req.body.IdPedido, 10);
    const decisao   = String(req.body.decisao || '');
    const observacao = String(req.body.observacao_decisao || '').trim();

    if (!idPedido || !['validar', 'rejeitar'].includes(decisao)) {
      return redirectMsg(res, 'pedidos', 'error', 'Pedido inválido.');
    }
    if (observacao.length > 255) return redirectMsg(res, 'pedidos', 'error', 'A observação não pode ultrapassar 255 caracteres.');

    const novoEstado = decisao === 'validar' ? 'Aprovado' : 'Rejeitado';
    const [result] = await db.query(
      `UPDATE pedidos_matricula SET Estado = ?, ObservacaoDecisao = ?, DecididoPor = ?, DataDecisao = NOW()
       WHERE IdPedido = ? AND Estado = 'Pendente'`,
      [novoEstado, observacao || null, req.session.utilizador_nome, idPedido]
    );

    if (result.affectedRows > 0) {
      return redirectMsg(res, 'pedidos', 'success', novoEstado === 'Aprovado' ? 'Pedido aprovado com sucesso.' : 'Pedido rejeitado com sucesso.');
    }
    return redirectMsg(res, 'pedidos', 'error', 'Não foi possível atualizar o pedido (pode já estar decidido).');
  }

  // ── Decidir matrícula ─────────────────────────────────────────
  if (postAction === 'decidir_matricula') {
    const idAluno   = parseInt(req.body.IdAluno, 10);
    const decisao   = String(req.body.decisao || '');
    const observacao = String(req.body.observacao_decisao || '').trim();

    if (!idAluno || !['validar', 'rejeitar'].includes(decisao)) {
      return redirectMsg(res, 'matriculas', 'error', 'Matrícula inválida.');
    }

    const novoEstado = decisao === 'validar' ? 'Aprovada' : 'Rejeitada';
    const [result] = await db.query(
      `UPDATE matriculas SET EstadoValidacao = ?, ObservacoesValidacao = ?, ValidadoPor = ?, DataValidacao = NOW()
       WHERE IdAluno = ? AND EstadoValidacao = 'Pendente'`,
      [novoEstado, observacao || null, req.session.utilizador_nome, idAluno]
    );

    if (result.affectedRows > 0) {
      return redirectMsg(res, 'matriculas', 'success', novoEstado === 'Aprovada' ? 'Matrícula aprovada com sucesso.' : 'Matrícula rejeitada com sucesso.');
    }
    return redirectMsg(res, 'matriculas', 'error', 'Não foi possível atualizar a matrícula (pode já estar decidida).');
  }

  // ── Guardar nota ──────────────────────────────────────────────
  if (postAction === 'guardar_nota') {
    const idNota       = parseInt(req.body.IdNota, 10) || 0;
    const idAluno      = parseInt(req.body.IdAluno, 10);
    const idDisciplina = parseInt(req.body.IdDisciplina, 10);
    const epoca        = String(req.body.Epoca || 'Normal').trim();
    const anoLetivo    = String(req.body.AnoLetivo || '').trim();
    const notaRaw      = String(req.body.Nota || '').replace(',', '.').trim();
    const observacoes  = String(req.body.Observacoes || '').trim();

    if (!idAluno || !idDisciplina || !anoLetivo || !notaRaw) {
      return redirectMsg(res, 'notas', 'error', 'Aluno, disciplina, ano letivo e nota são obrigatórios.');
    }
    if (!['Normal', 'Recurso', 'Especial'].includes(epoca)) {
      return redirectMsg(res, 'notas', 'error', 'Época inválida.');
    }
    if (!/^\d{4}\/\d{4}$/.test(anoLetivo)) {
      return redirectMsg(res, 'notas', 'error', 'Ano letivo inválido. Usa o formato AAAA/AAAA.');
    }
    const [a1, a2] = anoLetivo.split('/').map(Number);
    if (a2 !== a1 + 1) return redirectMsg(res, 'notas', 'error', 'Ano letivo inválido. O segundo ano deve ser o ano seguinte.');

    const nota = parseFloat(notaRaw);
    if (isNaN(nota) || nota < 0 || nota > 20) return redirectMsg(res, 'notas', 'error', 'Nota inválida (0 a 20).');

    // Valida que a disciplina pertence ao curso do aluno
    const [[valida]] = await db.query(
      `SELECT 1 FROM matriculas m JOIN plano_estudos pe ON pe.IdCurso = m.IdCurso
       WHERE m.IdAluno = ? AND pe.IdDisciplina = ? LIMIT 1`,
      [idAluno, idDisciplina]
    );
    if (!valida) return redirectMsg(res, 'notas', 'error', 'A disciplina não pertence ao curso do aluno.');

    try {
      if (idNota) {
        await db.query(
          `UPDATE notas_avaliacao SET IdAluno=?, IdDisciplina=?, Epoca=?, AnoLetivo=?, Nota=?, Observacoes=?, AtualizadoPor=?, AtualizadoEm=NOW()
           WHERE IdNota=?`,
          [idAluno, idDisciplina, epoca, anoLetivo, nota, observacoes || null, req.session.utilizador_nome, idNota]
        );
        return redirectMsg(res, 'notas', 'success', 'Nota atualizada com sucesso.');
      } else {
        await db.query(
          `INSERT INTO notas_avaliacao (IdAluno, IdDisciplina, Epoca, AnoLetivo, Nota, Observacoes, AtualizadoPor)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [idAluno, idDisciplina, epoca, anoLetivo, nota, observacoes || null, req.session.utilizador_nome]
        );
        return redirectMsg(res, 'notas', 'success', 'Nota registada com sucesso.');
      }
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return redirectMsg(res, 'notas', 'error', 'Já existe uma nota para este aluno/disciplina/época/ano letivo.');
      return redirectMsg(res, 'notas', 'error', 'Erro ao guardar a nota.');
    }
  }

  // ── Eliminar nota ─────────────────────────────────────────────
  if (postAction === 'eliminar_nota') {
    const idNota = parseInt(req.body.IdNota, 10);
    await db.query('DELETE FROM notas_avaliacao WHERE IdNota = ?', [idNota]);
    return redirectMsg(res, 'notas', 'success', 'Nota eliminada com sucesso.');
  }

  redirectMsg(res, 'pedidos', 'error', 'Ação inválida.');
});

module.exports = router;
