'use strict';
const express = require('express');
const router  = express.Router();
const { Disciplina, Curso, PlanoEstudo, Matricula, NotaAvaliacao, PedidoMatricula } = require('../models/mongoModels');
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

async function nextId(Model, field) {
  const last = await Model.findOne({ [field]: { $exists: true, $ne: null } }).sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

function toDateInput(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

async function getLookups() {
  const disciplinas = await Disciplina.find().sort({ Disciplina: 1 }).select('IdDisciplina Disciplina Sigla').lean();
  const cursos = await Curso.find().sort({ Curso: 1 }).select('IdCurso Curso Sigla').lean();
  return { disciplinas, cursos };
}

// ── GET /gestor ───────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const requestedTable = String(req.query.table || '');
  const table   = ['disciplina', 'cursos', 'matriculas_aceites', 'matriculas_pendentes', 'matriculas', 'plano_estudos'].includes(requestedTable)
    ? (requestedTable === 'matriculas' ? 'matriculas_aceites' : requestedTable)
    : 'disciplina';
  const action  = req.query.action || 'list';
  const mensagem = req.query.message || '';
  const tipo     = req.query.type === 'success' ? 'success' : 'error';
  const { disciplinas, cursos } = await getLookups();

  // ── FOTO ──────────────────────────────────────────────────────
  if ((table === 'matriculas_aceites' || table === 'matriculas_pendentes') && action === 'foto') {
    const id = parseInt(req.query.id_aluno, 10);
    const row = await Matricula.findOne({ IdAluno: id }).select('Foto').lean();
    if (!row || !row.Foto) return res.sendStatus(404);
    res.set('Content-Type', 'image/jpeg');
    return res.send(row.Foto);
  }

  let editData = null;
  let rowsMatriculasAceites = [];
  let rowsMatriculasPendentesRejeitadas = [];
  let rowsPlano = [];
  let fichaDetalhes = null;
  let fichaDisciplinas = [];

  if (table === 'disciplina' && action === 'edit') {
    editData = await Disciplina.findOne({ IdDisciplina: parseInt(req.query.id, 10) }).lean();
  }

  if (table === 'cursos' && action === 'edit') {
    editData = await Curso.findOne({ IdCurso: parseInt(req.query.id, 10) }).lean();
  }

  if (table === 'matriculas_aceites' || table === 'matriculas_pendentes') {
    const q = String(req.query.q || '').trim();
    const fc = parseInt(req.query.filtro_curso, 10) || 0;
    const filtro = {};
    if (q) {
      filtro.$or = [{ Nome: new RegExp(q, 'i') }];
      const asNum = parseInt(q, 10);
      if (!Number.isNaN(asNum)) filtro.$or.push({ IdAluno: asNum });
    }
    if (fc) filtro.IdCurso = fc;

    const raw = await Matricula.find(filtro).sort({ IdAluno: -1 }).lean();
    const courseMap = new Map((await Curso.find().select('IdCurso Curso').lean()).map((c) => [c.IdCurso, c.Curso]));
    const planoRows = await PlanoEstudo.find().select('IdCurso IdDisciplina').lean();
    const disciplinasByCurso = new Map();
    const disciplinaMap = new Map((await Disciplina.find().select('IdDisciplina Disciplina').lean()).map((d) => [d.IdDisciplina, d.Disciplina]));
    for (const row of planoRows) {
      if (!disciplinasByCurso.has(row.IdCurso)) disciplinasByCurso.set(row.IdCurso, []);
      const nomeDisciplina = disciplinaMap.get(row.IdDisciplina);
      if (nomeDisciplina) disciplinasByCurso.get(row.IdCurso).push(nomeDisciplina);
    }
    const mappedRows = raw.map((r) => ({
      ...r,
      Curso: courseMap.get(r.IdCurso) || '',
      DisciplinasCurso: disciplinasByCurso.get(r.IdCurso) || [],
      DataNascimento: toDateInput(r.DataNascimento),
    }));
    rowsMatriculasAceites = mappedRows.filter((r) => r.EstadoValidacao === 'Aprovada');
    rowsMatriculasPendentesRejeitadas = mappedRows.filter((r) => r.EstadoValidacao !== 'Aprovada');

    if (action === 'ficha') {
      const idAluno = parseInt(req.query.id_aluno, 10);
      const row = await Matricula.findOne(
        table === 'matriculas_aceites'
          ? { IdAluno: idAluno, EstadoValidacao: 'Aprovada' }
          : { IdAluno: idAluno, EstadoValidacao: { $ne: 'Aprovada' } }
      ).lean();
      if (!row) {
        return redirectMsg(res, table, 'error', 'Matrícula não encontrada.');
      }

      const curso = await Curso.findOne({ IdCurso: row.IdCurso }).select('Curso').lean();
      const plano = await PlanoEstudo.find({ IdCurso: row.IdCurso }).select('IdDisciplina').lean();
      const ids = plano.map((p) => p.IdDisciplina);
      const disciplinas = await Disciplina.find({ IdDisciplina: { $in: ids } })
        .sort({ Disciplina: 1 })
        .select('Disciplina Sigla -_id')
        .lean();

      fichaDetalhes = {
        ...row,
        Curso: curso?.Curso || '-',
        DataNascimentoFmt: formatDatePt(row.DataNascimento),
        FotoBase64: row.Foto ? `data:image/jpeg;base64,${Buffer.from(row.Foto).toString('base64')}` : null,
      };
      fichaDisciplinas = disciplinas;
    }
  }

  if (table === 'plano_estudos') {
    const rows = await PlanoEstudo.find().sort({ IdCurso: 1, Ano: 1, Semestre: 1, IdDisciplina: 1 }).lean();
    const discMap = new Map(disciplinas.map((d) => [d.IdDisciplina, d.Disciplina]));
    const cursoMap = new Map(cursos.map((c) => [c.IdCurso, c.Curso]));
    rowsPlano = rows.map((r) => ({
      ...r,
      Disciplina: discMap.get(r.IdDisciplina) || '',
      Curso: cursoMap.get(r.IdCurso) || '',
    }));

    if (action === 'edit') {
      editData = await PlanoEstudo.findOne({
        IdDisciplina: parseInt(req.query.id_disciplina, 10),
        IdCurso: parseInt(req.query.id_curso, 10),
      }).lean();
    }
  }

  res.render('gestor/index', {
    table, action, mensagem, tipo, editData,
    disciplinas, cursos,
    rowsMatriculasAceites, rowsMatriculasPendentesRejeitadas, rowsPlano,
    fichaDetalhes, fichaDisciplinas,
    dataMaximaNascimento: dataMaximaNascimento(),
    formatDatePt,
    sessao: req.session,
  });
});

// ── POST /gestor ──────────────────────────────────────────────────────────────
router.post('/', upload.single('Foto'), async (req, res) => {
  const postTable  = String(req.body.table || '');
  const postAction = String(req.body.action || '');
  const allowed    = ['disciplina', 'cursos', 'matriculas_aceites', 'matriculas_pendentes', 'matriculas', 'plano_estudos'];

  if (!allowed.includes(postTable)) return redirectMsg(res, 'disciplina', 'error', 'Tabela inválida.');

  const matriculasPage = postTable === 'matriculas_pendentes' ? 'matriculas_pendentes' : 'matriculas_aceites';

  // ── DISCIPLINA ────────────────────────────────────────────────
  if (postTable === 'disciplina') {
    const disciplina = String(req.body.Disciplina || '').trim();
    const sigla      = String(req.body.Sigla || '').trim();

    if (postAction === 'create') {
      await Disciplina.create({ IdDisciplina: await nextId(Disciplina, 'IdDisciplina'), Disciplina: disciplina, Sigla: sigla });
      return redirectMsg(res, 'disciplina', 'success', 'Disciplina criada com sucesso.');
    }
    if (postAction === 'update') {
      const id = parseInt(req.body.IdDisciplina, 10);
      await Disciplina.updateOne({ IdDisciplina: id }, { $set: { Disciplina: disciplina, Sigla: sigla } });
      return redirectMsg(res, 'disciplina', 'success', 'Disciplina atualizada com sucesso.');
    }
    if (postAction === 'delete') {
      const id = parseInt(req.body.IdDisciplina, 10);
      await Disciplina.deleteOne({ IdDisciplina: id });
      await PlanoEstudo.deleteMany({ IdDisciplina: id });
      return redirectMsg(res, 'disciplina', 'success', 'Disciplina removida com sucesso.');
    }
  }

  // ── CURSOS ────────────────────────────────────────────────────
  if (postTable === 'cursos') {
    const curso = String(req.body.Curso || '').trim();
    const sigla = String(req.body.Sigla || '').trim();

    if (postAction === 'create') {
      await Curso.create({ IdCurso: await nextId(Curso, 'IdCurso'), Curso: curso, Sigla: sigla });
      return redirectMsg(res, 'cursos', 'success', 'Curso criado com sucesso.');
    }
    if (postAction === 'update') {
      const id = parseInt(req.body.IdCurso, 10);
      await Curso.updateOne({ IdCurso: id }, { $set: { Curso: curso, Sigla: sigla } });
      return redirectMsg(res, 'cursos', 'success', 'Curso atualizado com sucesso.');
    }
    if (postAction === 'delete') {
      const id = parseInt(req.body.IdCurso, 10);
      await Curso.deleteOne({ IdCurso: id });
      await PlanoEstudo.deleteMany({ IdCurso: id });
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
      await PlanoEstudo.create({ IdDisciplina: idDisciplina, IdCurso: idCurso, Ano: ano, Semestre: semestre });
      return redirectMsg(res, 'plano_estudos', 'success', 'Ligação criada com sucesso.');
    }
    if (postAction === 'update') {
      const oldId  = parseInt(req.body.old_IdDisciplina, 10);
      const oldCurso = parseInt(req.body.old_IdCurso, 10);
      await PlanoEstudo.updateOne(
        { IdDisciplina: oldId, IdCurso: oldCurso },
        { $set: { IdDisciplina: idDisciplina, IdCurso: idCurso, Ano: ano, Semestre: semestre } }
      );
      return redirectMsg(res, 'plano_estudos', 'success', 'Ligação atualizada com sucesso.');
    }
    if (postAction === 'delete') {
      const idD = parseInt(req.body.IdDisciplina, 10);
      const idC = parseInt(req.body.IdCurso, 10);
      await PlanoEstudo.deleteOne({ IdDisciplina: idD, IdCurso: idC });
      return redirectMsg(res, 'plano_estudos', 'success', 'Ligação removida com sucesso.');
    }
  }

  // ── MATRÍCULAS (gestor: validar/rejeitar/remover) ─────────────
  if (postTable === 'matriculas' || postTable === 'matriculas_aceites' || postTable === 'matriculas_pendentes') {
    if (postAction === 'set_validation') {
      const idAluno = parseInt(req.body.IdAluno, 10);
      const estado  = normalizarEstadoValidacao(req.body.EstadoValidacao || '');
      const obs     = String(req.body.ObservacoesValidacao || '').trim();
      if (!estado) return redirectMsg(res, matriculasPage, 'error', 'Estado inválido.');

      await Matricula.updateOne({ IdAluno: idAluno }, {
        $set: {
          EstadoValidacao: estado,
          ObservacoesValidacao: obs || null,
          ValidadoPor: req.session.utilizador_nome,
          DataValidacao: new Date(),
        },
      });
      return redirectMsg(res, matriculasPage, 'success', 'Estado de validação atualizado.');
    }

    if (postAction === 'delete') {
      const idAluno = parseInt(req.body.IdAluno, 10);
      await Matricula.deleteOne({ IdAluno: idAluno });
      await NotaAvaliacao.deleteMany({ IdAluno: idAluno });
      await PedidoMatricula.updateMany({ IdAluno: idAluno }, { $set: { IdAluno: null } });
      return redirectMsg(res, matriculasPage, 'success', 'Matrícula removida com sucesso.');
    }

    if (postAction === 'create') {
      try {
        const idAluno  = parseInt(req.body.IdAluno, 10);
        const nome     = String(req.body.Nome || '').trim();
        const idCurso  = parseInt(req.body.IdCurso, 10);
        const dataNasc = validarDataNascimento(req.body.DataNascimento);
        const morada   = String(req.body.Morada || '').trim();
        const email    = validarEmail(req.body.Email);
        const telefone = validarTelefone(req.body.Telefone);
        const foto     = req.file ? req.file.buffer : null;

        if (!idAluno) throw new Error('O ID do aluno é obrigatório.');
        if (!nome) throw new Error('O nome é obrigatório.');
        if (!idCurso) throw new Error('O curso é obrigatório.');
        if (!morada) throw new Error('A morada é obrigatória.');
        if (!foto) throw new Error('A foto é obrigatória.');

        await Matricula.create({
          IdAluno: idAluno,
          IdUser: idAluno,
          Nome: nome,
          IdCurso: idCurso,
          EstadoValidacao: 'Aprovada',
          DataNascimento: dataNasc,
          Morada: morada,
          Email: email,
          Telefone: telefone,
          Foto: foto,
        });
        return redirectMsg(res, matriculasPage, 'success', 'Matrícula criada com sucesso.');
      } catch (e) {
        return redirectMsg(res, matriculasPage, 'error', e.message);
      }
    }
  }

  redirectMsg(res, 'disciplina', 'error', 'Ação inválida.');
});

module.exports = router;
