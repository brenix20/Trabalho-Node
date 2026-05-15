'use strict';
const express = require('express');
const router  = express.Router();
const { Disciplina, Curso, PlanoEstudo, Matricula, NotaAvaliacao, PedidoMatricula } = require('../models/mongoModels');
const { requireAuth, requirePerfil } = require('../middleware/auth');
const { anoLetivoAtual, formatDatePt } = require('../helpers/utils');

router.use(requireAuth, requirePerfil('funcionario', 'funcionário'));

function redirectMsg(res, section, type, message) {
  return res.redirect(`/funcionario?section=${encodeURIComponent(section)}&type=${type}&message=${encodeURIComponent(message)}`);
}

async function nextId(Model, field) {
  const last = await Model.findOne({ [field]: { $exists: true, $ne: null } }).sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

// ── GET FOTO ───────────────────────────────────────────────────────────────
router.get('/foto', async (req, res) => {
  const idAluno = parseInt(req.query.id, 10);
  if (!idAluno) return res.sendStatus(400);
  
  const row = await Matricula.findOne({ IdAluno: idAluno }).select('Foto').lean();
  if (!row || !row.Foto) return res.sendStatus(404);
  
  res.set('Content-Type', 'image/jpeg');
  return res.send(row.Foto);
});

// ── GET /funcionario ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const section  = ['pedidos', 'matriculas', 'pedidos_fichas', 'fichasaluno', 'notas', 'pautas'].includes(req.query.section) ? req.query.section : 'pedidos';
  const mensagem = req.query.message || '';
  const tipo     = req.query.type === 'success' ? 'success' : 'error';
  const action   = req.query.action || 'list';

  const plano = await PlanoEstudo.find().select('IdDisciplina IdCurso -_id').lean();
  const cursosByDisc = new Map();
  plano.forEach((p) => {
    if (!cursosByDisc.has(p.IdDisciplina)) cursosByDisc.set(p.IdDisciplina, []);
    cursosByDisc.get(p.IdDisciplina).push(String(p.IdCurso));
  });

  const disciplinas = (await Disciplina.find().sort({ Disciplina: 1 }).select('IdDisciplina Disciplina').lean())
    .map((d) => ({ ...d, cursos: (cursosByDisc.get(d.IdDisciplina) || []).join(',') }));
  const cursos = await Curso.find().sort({ Curso: 1 }).select('IdCurso Curso').lean();
  const courseMap = new Map(cursos.map((c) => [c.IdCurso, c.Curso]));

  // ── PEDIDOS ───────────────────────────────────────────────────
  let pedidos = [];
  if (section === 'pedidos') {
    const estadoFiltro = req.query.estado_pedido || 'Pendente';
    const rows = await PedidoMatricula.find({ Estado: estadoFiltro }).sort({ DataPedido: -1, IdPedido: -1 }).lean();
    const alunosMap = new Map((await Matricula.find().select('IdAluno Nome').lean()).map((m) => [m.IdAluno, m.Nome]));
    pedidos = rows.map((p) => ({
      ...p,
      NomeAluno: alunosMap.get(p.IdAluno) || null,
      Curso: courseMap.get(p.IdCurso) || null,
    }));
  }

  // ── MATRÍCULAS (Apenas aceites) ────────────────────────────────
  let matriculas = [];
  let alunoDetalhes = null;
  if (section === 'matriculas') {
    if (action === 'view' && req.query.id) {
      // Vista de ficha completa de um aluno
      const idAluno = parseInt(req.query.id, 10);
      alunoDetalhes = await Matricula.findOne({ IdAluno: idAluno, EstadoValidacao: 'Aprovada' }).lean();
      if (alunoDetalhes) {
        alunoDetalhes.Curso = courseMap.get(alunoDetalhes.IdCurso) || '';
        alunoDetalhes.DataNascimento = alunoDetalhes.DataNascimento ? formatDatePt(String(alunoDetalhes.DataNascimento).slice(0, 10)) : '-';
      }
    } else {
      // Lista de matrículas aceites
      const q  = String(req.query.q || '').trim();
      const fc = parseInt(req.query.filtro_curso, 10) || 0;

      const filtro = { EstadoValidacao: 'Aprovada' };
      if (q) {
        filtro.$or = [{ Nome: new RegExp(q, 'i') }];
        const qNum = parseInt(q, 10);
        if (!Number.isNaN(qNum)) filtro.$or.push({ IdAluno: qNum });
      }
      if (fc) filtro.IdCurso = fc;
      const rows = await Matricula.find(filtro).sort({ IdAluno: -1 }).lean();
      matriculas = rows.map((m) => ({ ...m, Curso: courseMap.get(m.IdCurso) || '' }));
    }
  }

  // ── PEDIDOS DE FICHA DE ALUNOS (Pendentes) ────────────────────
  let pedidosFichas = [];
  let pedidoFichaDetalhes = null;
  if (section === 'pedidos_fichas') {
    if (action === 'view' && req.query.id) {
      // Vista de pedido de ficha completo
      const idAluno = parseInt(req.query.id, 10);
      pedidoFichaDetalhes = await Matricula.findOne({ IdAluno: idAluno, EstadoValidacao: 'Pendente' }).lean();
      if (pedidoFichaDetalhes) {
        pedidoFichaDetalhes.Curso = courseMap.get(pedidoFichaDetalhes.IdCurso) || '';
        pedidoFichaDetalhes.DataNascimento = pedidoFichaDetalhes.DataNascimento ? formatDatePt(String(pedidoFichaDetalhes.DataNascimento).slice(0, 10)) : '-';
      }
    } else {
      // Lista de pedidos de fichas pendentes
      const q  = String(req.query.q || '').trim();
      const fc = parseInt(req.query.filtro_curso, 10) || 0;

      const filtro = { EstadoValidacao: 'Pendente' };
      if (q) {
        filtro.$or = [{ Nome: new RegExp(q, 'i') }];
        const qNum = parseInt(q, 10);
        if (!Number.isNaN(qNum)) filtro.$or.push({ IdAluno: qNum });
      }
      if (fc) filtro.IdCurso = fc;
      const rows = await Matricula.find(filtro).sort({ IdAluno: -1 }).lean();
      pedidosFichas = rows.map((m) => ({ ...m, Curso: courseMap.get(m.IdCurso) || '' }));
    }
  }

  // ── FICHAS DE ALUNO (Apenas aceites) ────────────────────────────
  let fichasAlunos = [];
  let fichaAlunoDetalhes = null;
  if (section === 'fichasaluno') {
    if (action === 'view' && req.query.id) {
      // Vista de ficha de aluno completa
      const idAluno = parseInt(req.query.id, 10);
      fichaAlunoDetalhes = await Matricula.findOne({ IdAluno: idAluno, EstadoValidacao: 'Aprovada' }).lean();
      if (fichaAlunoDetalhes) {
        fichaAlunoDetalhes.Curso = courseMap.get(fichaAlunoDetalhes.IdCurso) || '';
        fichaAlunoDetalhes.DataNascimento = fichaAlunoDetalhes.DataNascimento ? formatDatePt(String(fichaAlunoDetalhes.DataNascimento).slice(0, 10)) : '-';
      }
    } else {
      // Lista de fichas de aluno aceites
      const q  = String(req.query.q || '').trim();
      const fc = parseInt(req.query.filtro_curso, 10) || 0;

      const filtro = { EstadoValidacao: 'Aprovada' };
      if (q) {
        filtro.$or = [{ Nome: new RegExp(q, 'i') }];
        const qNum = parseInt(q, 10);
        if (!Number.isNaN(qNum)) filtro.$or.push({ IdAluno: qNum });
      }
      if (fc) filtro.IdCurso = fc;
      const rows = await Matricula.find(filtro).sort({ IdAluno: -1 }).lean();
      fichasAlunos = rows.map((m) => ({ ...m, Curso: courseMap.get(m.IdCurso) || '' }));
    }
  }

  // ── NOTAS ─────────────────────────────────────────────────────
  let rowsNotas = []; let notaEdit = null;
  if (section === 'notas') {
    const q  = String(req.query.q_nota || '').trim();
    const fd = parseInt(req.query.f_disciplina, 10) || 0;
    const filtro = {};
    if (fd) filtro.IdDisciplina = fd;
    const rawNotas = await NotaAvaliacao.find(filtro).sort({ AtualizadoEm: -1, IdNota: -1 }).lean();
    const alunosMap = new Map((await Matricula.find().select('IdAluno Nome IdCurso').lean()).map((m) => [m.IdAluno, m]));
    const discMap = new Map((await Disciplina.find().select('IdDisciplina Disciplina').lean()).map((d) => [d.IdDisciplina, d.Disciplina]));

    rowsNotas = rawNotas
      .map((n) => {
        const aluno = alunosMap.get(n.IdAluno);
        const nomeAluno = aluno?.Nome || '';
        const nomeDisc = discMap.get(n.IdDisciplina) || '';
        return {
          ...n,
          NomeAluno: nomeAluno,
          Disciplina: nomeDisc,
          Curso: courseMap.get(aluno?.IdCurso) || '',
        };
      })
      .filter((n) => {
        if (!q) return true;
        const qLow = q.toLowerCase();
        return String(n.IdAluno).includes(qLow) ||
          String(n.NomeAluno || '').toLowerCase().includes(qLow) ||
          String(n.Disciplina || '').toLowerCase().includes(qLow);
      });

    if (action === 'edit' && req.query.id_nota) {
      notaEdit = await NotaAvaliacao.findOne({ IdNota: parseInt(req.query.id_nota, 10) }).lean();
    }
  }

  // ── PAUTAS ────────────────────────────────────────────────────
  let rowsPauta = []; let pautaDisciplinaId = 0; let pautaEpoca = 'Normal'; let pautaAnoLetivo = anoLetivoAtual();
  if (section === 'pautas') {
    pautaDisciplinaId = parseInt(req.query.disciplina_id, 10) || 0;
    pautaEpoca        = req.query.epoca || 'Normal';
    pautaAnoLetivo    = req.query.ano_letivo || anoLetivoAtual();
    if (pautaDisciplinaId) {
      const rows = await NotaAvaliacao.find({
        IdDisciplina: pautaDisciplinaId,
        Epoca: pautaEpoca,
        AnoLetivo: pautaAnoLetivo,
      }).sort({ IdAluno: 1 }).lean();

      const alunosMap = new Map((await Matricula.find().select('IdAluno Nome IdCurso').lean()).map((m) => [m.IdAluno, m]));
      rowsPauta = rows.map((n) => {
        const aluno = alunosMap.get(n.IdAluno);
        return {
          IdAluno: n.IdAluno,
          NomeAluno: aluno?.Nome || '',
          Curso: courseMap.get(aluno?.IdCurso) || '',
          Nota: n.Nota,
          Resultado: parseFloat(n.Nota) >= 9.5 ? 'Aprovado' : 'Reprovado',
        };
      });
    }
  }

  // ── Alunos para select de notas ───────────────────────────────
  const alunosSelect = await Matricula.find({ EstadoValidacao: 'Aprovada' })
    .sort({ Nome: 1 })
    .select('IdAluno Nome IdCurso -_id')
    .lean();

  res.render('funcionario/index', {
    section, mensagem, tipo, action,
    disciplinas, cursos,
    pedidos, matriculas, alunoDetalhes, pedidosFichas, pedidoFichaDetalhes, fichasAlunos, fichaAlunoDetalhes,
    rowsNotas, notaEdit, rowsPauta, pautaDisciplinaId, pautaEpoca, pautaAnoLetivo,
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
    const result = await PedidoMatricula.updateOne(
      { IdPedido: idPedido, Estado: 'Pendente' },
      { $set: { Estado: novoEstado, ObservacaoDecisao: observacao || null, DecididoPor: req.session.utilizador_nome, DataDecisao: new Date() } }
    );

    if (result.modifiedCount > 0) {
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
    const result = await Matricula.updateOne(
      { IdAluno: idAluno, EstadoValidacao: 'Pendente' },
      { $set: { EstadoValidacao: novoEstado, ObservacoesValidacao: observacao || null, ValidadoPor: req.session.utilizador_nome, DataValidacao: new Date() } }
    );

    if (result.modifiedCount > 0) {
      return redirectMsg(res, 'matriculas', 'success', novoEstado === 'Aprovada' ? 'Matrícula aprovada com sucesso.' : 'Matrícula rejeitada com sucesso.');
    }
    return redirectMsg(res, 'matriculas', 'error', 'Não foi possível atualizar a matrícula (pode já estar decidida).');
  }

  // ── Decidir ficha de aluno ────────────────────────────────────
  if (postAction === 'decidir_ficha') {
    const idAluno   = parseInt(req.body.IdAluno, 10);
    const decisao   = String(req.body.decisao || '');
    const origem    = String(req.body.origem || 'fichasaluno').trim();
    const observacao = String(req.body.observacao_decisao || '').trim();

    if (!idAluno || !['validar', 'rejeitar'].includes(decisao)) {
      return redirectMsg(res, origem, 'error', 'Ficha inválida.');
    }

    const novoEstado = decisao === 'validar' ? 'Aprovada' : 'Rejeitada';
    const result = await Matricula.updateOne(
      { IdAluno: idAluno, EstadoValidacao: 'Pendente' },
      { $set: { EstadoValidacao: novoEstado, ObservacoesValidacao: observacao || null, ValidadoPor: req.session.utilizador_nome, DataValidacao: new Date() } }
    );

    if (result.modifiedCount > 0) {
      return redirectMsg(res, origem, 'success', novoEstado === 'Aprovada' ? 'Ficha aceite com sucesso.' : 'Ficha rejeitada com sucesso.');
    }
    return redirectMsg(res, origem, 'error', 'Não foi possível atualizar a ficha (pode já estar decidida).');
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
    const aluno = await Matricula.findOne({ IdAluno: idAluno }).select('IdCurso').lean();
    const valida = aluno ? await PlanoEstudo.findOne({ IdCurso: aluno.IdCurso, IdDisciplina: idDisciplina }).select('_id').lean() : null;
    if (!valida) return redirectMsg(res, 'notas', 'error', 'A disciplina não pertence ao curso do aluno.');

    try {
      if (idNota) {
        await NotaAvaliacao.updateOne(
          { IdNota: idNota },
          {
            $set: {
              IdAluno: idAluno,
              IdDisciplina: idDisciplina,
              Epoca: epoca,
              AnoLetivo: anoLetivo,
              Nota: nota,
              Observacoes: observacoes || null,
              AtualizadoPor: req.session.utilizador_nome,
              AtualizadoEm: new Date(),
            },
          }
        );
        return redirectMsg(res, 'notas', 'success', 'Nota atualizada com sucesso.');
      } else {
        // Se já existir uma nota para este (Aluno,Disciplina,Epoca,AnoLetivo), atualiza em vez de criar
        // Normalize types before searching to avoid false matches
        const query = {
          IdAluno: Number(idAluno),
          IdDisciplina: Number(idDisciplina),
          Epoca: String(epoca).trim(),
          AnoLetivo: String(anoLetivo).trim(),
        };
        console.log('[NOTAS] Procurando nota existente com query:', query);
        const existing = await NotaAvaliacao.findOne(query).lean();
        if (existing && existing.IdNota) {
          console.log('[NOTAS] Nota existente encontrada:', existing.IdNota);
          await NotaAvaliacao.updateOne(
            { IdNota: existing.IdNota },
            {
              $set: {
                Nota: nota,
                Observacoes: observacoes || null,
                AtualizadoPor: req.session.utilizador_nome,
                AtualizadoEm: new Date(),
              },
            }
          );
          return redirectMsg(res, 'notas', 'success', 'Já existia uma nota para este aluno/disciplina/época/ano — nota atualizada.');
        }

        await NotaAvaliacao.create({
          IdNota: await nextId(NotaAvaliacao, 'IdNota'),
          IdAluno: idAluno,
          IdDisciplina: idDisciplina,
          Epoca: epoca,
          AnoLetivo: anoLetivo,
          Nota: nota,
          Observacoes: observacoes || null,
          AtualizadoPor: req.session.utilizador_nome,
          AtualizadoEm: new Date(),
        });
        return redirectMsg(res, 'notas', 'success', 'Nota registada com sucesso.');
      }
    } catch (e) {
      if (e?.code === 11000) return redirectMsg(res, 'notas', 'error', 'Já existe uma nota para este aluno/disciplina/época/ano letivo.');
      return redirectMsg(res, 'notas', 'error', 'Erro ao guardar a nota.');
    }
  }

  // ── Eliminar nota ─────────────────────────────────────────────
  if (postAction === 'eliminar_nota') {
    const idNota = parseInt(req.body.IdNota, 10);
    await NotaAvaliacao.deleteOne({ IdNota: idNota });
    return redirectMsg(res, 'notas', 'success', 'Nota eliminada com sucesso.');
  }

  redirectMsg(res, 'pedidos', 'error', 'Ação inválida.');
});

module.exports = router;
