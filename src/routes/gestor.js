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
  return new Date(d).toISOString().slice(0, 10);
}

async function getLookups() {
  const disciplinas = await Disciplina.find().sort({ Disciplina: 1 }).select('IdDisciplina Disciplina Sigla').lean();
  const cursos = await Curso.find().sort({ Curso: 1 }).select('IdCurso Curso Sigla').lean();
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
    const row = await Matricula.findOne({ IdAluno: id }).select('Foto').lean();
    if (!row || !row.Foto) return res.sendStatus(404);
    res.set('Content-Type', 'image/jpeg');
    return res.send(row.Foto);
  }

  let editData = null;
  let rowsMatriculas = [];
  let rowsPlano = [];

  if (table === 'disciplina' && action === 'edit') {
    editData = await Disciplina.findOne({ IdDisciplina: parseInt(req.query.id, 10) }).lean();
  }

  if (table === 'cursos' && action === 'edit') {
    editData = await Curso.findOne({ IdCurso: parseInt(req.query.id, 10) }).lean();
  }

  if (table === 'matriculas') {
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
    rowsMatriculas = raw.map((r) => ({
      ...r,
      Curso: courseMap.get(r.IdCurso) || '',
      DataNascimento: toDateInput(r.DataNascimento),
    }));

    if (action === 'edit') {
      const row = await Matricula.findOne({ IdAluno: parseInt(req.query.id_aluno, 10) }).lean();
      editData = row ? { ...row, DataNascimento: toDateInput(row.DataNascimento) } : null;
    }

    if (action === 'ficha') {
      return redirectMsg(res, 'matriculas', 'error', 'Vista de ficha não disponível nesta versão.');
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
  if (postTable === 'matriculas') {
    if (postAction === 'set_validation') {
      const idAluno = parseInt(req.body.IdAluno, 10);
      const estado  = normalizarEstadoValidacao(req.body.EstadoValidacao || '');
      const obs     = String(req.body.ObservacoesValidacao || '').trim();
      if (!estado) return redirectMsg(res, 'matriculas', 'error', 'Estado inválido.');

      await Matricula.updateOne({ IdAluno: idAluno }, {
        $set: {
          EstadoValidacao: estado,
          ObservacoesValidacao: obs || null,
          ValidadoPor: req.session.utilizador_nome,
          DataValidacao: new Date(),
        },
      });
      return redirectMsg(res, 'matriculas', 'success', 'Estado de validação atualizado.');
    }

    if (postAction === 'delete') {
      const idAluno = parseInt(req.body.IdAluno, 10);
      await Matricula.deleteOne({ IdAluno: idAluno });
      await NotaAvaliacao.deleteMany({ IdAluno: idAluno });
      await PedidoMatricula.updateMany({ IdAluno: idAluno }, { $set: { IdAluno: null } });
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

        const payload = {
          Nome: nome,
          IdCurso: idCurso,
          EstadoValidacao: estado,
          DataNascimento: dataNasc,
          Morada: morada,
          Email: email,
          Telefone: telefone,
        };
        if (foto) payload.Foto = foto;

        await Matricula.updateOne({ IdAluno: idAluno }, { $set: payload });
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

        await Matricula.create({
          IdAluno: idAluno,
          IdUser: idAluno,
          Nome: nome,
          IdCurso: idCurso,
          EstadoValidacao: estado,
          DataNascimento: dataNasc,
          Morada: morada,
          Email: email,
          Telefone: telefone,
          Foto: foto,
        });
        return redirectMsg(res, 'matriculas', 'success', 'Matrícula criada com sucesso.');
      } catch (e) {
        return redirectMsg(res, 'matriculas', 'error', e.message);
      }
    }
  }

  redirectMsg(res, 'disciplina', 'error', 'Ação inválida.');
});

module.exports = router;
