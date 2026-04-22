'use strict';
const express = require('express');
const router  = express.Router();
const { Curso, Disciplina, PlanoEstudo, Matricula, PedidoMatricula } = require('../models/mongoModels');
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

async function nextId(Model, field) {
  const last = await Model.findOne({ [field]: { $exists: true, $ne: null } }).sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

function toDateInput(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

async function getAlunoSessao(req) {
  const userId = parseInt(req.session.utilizador_id, 10) || 0;
  if (!userId) return null;
  const aluno = await Matricula.findOne({ IdAluno: userId }).select('IdAluno EstadoValidacao').lean();
  return aluno || null;
}

// ── GET /aluno ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const cursosArr = await Curso.find().sort({ Curso: 1 }).select('IdCurso Curso').lean();
  const disciplinasArr = await Disciplina.find().sort({ Disciplina: 1 }).select('IdDisciplina Disciplina').lean();
  const alunoSessao     = await getAlunoSessao(req);
  const estadoFicha     = normalizarEstadoValidacao(alunoSessao?.EstadoValidacao || '');
  const alunoIdSessao   = alunoSessao ? parseInt(alunoSessao.IdAluno, 10) : 0;
  const mensagem = req.query.message || '';
  const tipo     = req.query.type === 'success' ? 'success' : 'error';

  // Último pedido de matrícula
  let ultimoPedido = null;
  if (alunoIdSessao) {
    ultimoPedido = await PedidoMatricula.findOne({ IdAluno: alunoIdSessao })
      .sort({ IdPedido: -1, _id: -1 })
      .select('IdPedido Estado ObservacaoDecisao DecididoPor DataPedido DataDecisao IdCurso')
      .lean();
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
    const row = await Matricula.findOne({ IdAluno: alunoIdSessao }).select('Foto').lean();
    if (!row || !row.Foto) return res.sendStatus(404);
    res.set('Content-Type', 'image/jpeg');
    return res.send(row.Foto);
  }

  // ── FICHA ─────────────────────────────────────────────────────
  let fichaAluno = null;
  let fichaDisciplinas = [];
  let turmaColegas = [];

  if (alunoIdSessao) {
    const fa = await Matricula.findOne({ IdAluno: alunoIdSessao }).lean();
    if (fa) {
      const curso = await Curso.findOne({ IdCurso: fa.IdCurso }).select('Curso').lean();
      fichaAluno = {
        ...fa,
        Curso: curso?.Curso || '',
        DataNascimento: toDateInput(fa.DataNascimento),
      };
    }

    if (fichaAluno) {
      const plano = await PlanoEstudo.find({ IdCurso: fichaAluno.IdCurso }).select('IdDisciplina').lean();
      const ids = plano.map((p) => p.IdDisciplina);
      fichaDisciplinas = await Disciplina.find({ IdDisciplina: { $in: ids } })
        .sort({ Disciplina: 1 })
        .select('Disciplina Sigla -_id')
        .lean();
    }

    if (action === 'minha_turma' && alunoMatriculaEfetivada && fichaAluno) {
      turmaColegas = await Matricula.find({ IdCurso: fichaAluno.IdCurso, EstadoValidacao: 'Aprovada' })
        .sort({ Nome: 1 })
        .select('IdAluno Nome -_id')
        .lean();
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

      const exists = await Matricula.findOne({ IdAluno: userId }).select('_id').lean();
      if (exists) return redirectMsg(res, 'matriculas', 'error', 'Já tens uma ficha associada.');

      await Matricula.create({
        IdAluno: userId,
        IdUser: userId,
        Nome: nome,
        IdCurso: idCurso,
        DataNascimento: dataNasc,
        Morada: morada,
        Email: email,
        Telefone: telefone,
        Foto: foto,
        EstadoValidacao: 'Pendente',
      });
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

      const payload = {
        Nome: nome,
        IdCurso: idCurso,
        DataNascimento: dataNasc,
        Morada: morada,
        Email: email,
        Telefone: telefone,
      };
      if (foto) payload.Foto = foto;

      await Matricula.updateOne({ IdAluno: alunoIdSessao }, { $set: payload });
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

    const obs     = String(req.body.Observacoes || '').trim();
    const matricula = await Matricula.findOne({ IdAluno: alunoIdSessao }).select('Nome Email IdCurso').lean();
    if (!matricula) return redirectMsg(res, 'pedidos', 'error', 'Sem ficha associada.');

    await PedidoMatricula.create({
      IdPedido: await nextId(PedidoMatricula, 'IdPedido'),
      IdAluno: alunoIdSessao,
      NomeCandidato: matricula.Nome,
      Email: matricula.Email || null,
      IdCurso: matricula.IdCurso || null,
      Observacoes: obs || null,
      Estado: 'Pendente',
      DataPedido: new Date(),
    });
    return redirectMsg(res, 'pedidos', 'success', 'Pedido de matrícula submetido com sucesso.');
  }

  redirectMsg(res, 'matriculas', 'error', 'Ação inválida.');
});

module.exports = router;
