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

  const table  = req.query.table || 'matriculas';
  const action = req.query.action || (alunoIdSessao ? 'ficha' : 'list');

  // Variáveis para render
  let matriculasLista = [];
  let fichaAluno = null;
  let fichaDisciplinas = [];
  let turmaColegas = [];

  // Último pedido de matrícula
  let ultimoPedido = null;
  if (alunoIdSessao) {
    const pedido = await PedidoMatricula.findOne({ IdAluno: alunoIdSessao })
      .sort({ IdPedido: -1, _id: -1 })
      .select('IdPedido Estado ObservacaoDecisao DecididoPor DataPedido DataDecisao IdCurso')
      .lean();
    if (pedido) {
      ultimoPedido = {
        ...pedido,
        DataPedidoFmt: formatDatePt(pedido.DataPedido),
        DataDecisaoFmt: formatDatePt(pedido.DataDecisao),
      };
    }
  }

  const estadoPedido         = ultimoPedido?.Estado || '';
  const alunoTemPedidoPendente = estadoPedido === 'Pendente';
  const alunoTemPedidoAprovado = estadoPedido === 'Aprovado';
  const alunoPodeCriarPedido   = estadoFicha === 'Aprovada' && !alunoTemPedidoPendente && !alunoTemPedidoAprovado;
  const alunoMatriculaEfetivada = estadoFicha === 'Aprovada' && alunoTemPedidoAprovado;

  // ── FOTO ──────────────────────────────────────────────────────
  if (table === 'matriculas' && action === 'foto') {
    const idAluno = parseInt(req.query.id_aluno, 10) || alunoIdSessao;
    const row = await Matricula.findOne({ IdAluno: idAluno }).select('Foto').lean();
    if (!row || !row.Foto) return res.sendStatus(404);
    res.set('Content-Type', 'image/jpeg');
    return res.send(row.Foto);
  }

  // ── IMPRIMIR FICHA ────────────────────────────────────────────
  if (table === 'matriculas' && action === 'ficha_print') {
    const idAluno = parseInt(req.query.id_aluno, 10) || alunoIdSessao;
    const ficha = await Matricula.findOne({ IdAluno: idAluno, EstadoValidacao: 'Aprovada' }).lean();
    
    if (!ficha) {
      return res.status(403).send('<h1>Acesso negado</h1><p>A tua ficha não está aprovada para impressão.</p>');
    }

    const curso = await Curso.findOne({ IdCurso: ficha.IdCurso }).select('Curso').lean();
    const plano = await PlanoEstudo.find({ IdCurso: ficha.IdCurso }).select('IdDisciplina').lean();
    const ids = plano.map((p) => p.IdDisciplina);
    const disciplinas = await Disciplina.find({ IdDisciplina: { $in: ids } })
      .sort({ Disciplina: 1 })
      .select('Disciplina -_id')
      .lean();

    const fotoBase64 = ficha.Foto ? `data:image/jpeg;base64,${ficha.Foto.toString('base64')}` : null;

    const html = `
<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ficha do Aluno - ${ficha.Nome}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #3B82F6; padding-bottom: 20px; }
    .header h1 { color: #3B82F6; font-size: 28px; margin-bottom: 5px; }
    .header p { color: #666; font-size: 14px; }
    .aluno-info { display: flex; gap: 30px; margin-bottom: 40px; }
    .foto { flex-shrink: 0; }
    .foto img { width: 140px; height: 160px; border: 2px solid #3B82F6; border-radius: 8px; object-fit: cover; }
    .dados { flex: 1; }
    .dados-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 15px; }
    .dados-item { }
    .dados-item strong { display: block; color: #3B82F6; font-weight: 600; margin-bottom: 4px; }
    .dados-item span { display: block; color: #666; }
    .section { margin-bottom: 30px; }
    .section h2 { font-size: 16px; color: #3B82F6; margin-bottom: 15px; border-bottom: 2px solid #E5E7EB; padding-bottom: 8px; }
    .disciplinas-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .disciplina-item { padding: 8px 12px; background: #F3F4F6; border-radius: 4px; border-left: 3px solid #3B82F6; }
    .disciplina-item span { display: block; color: #666; font-size: 13px; }
    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #E5E7EB; padding-top: 15px; }
    @media print {
      body { margin: 0; padding: 0; }
      .container { padding: 0; }
      .footer { page-break-before: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Ficha do Aluno</h1>
      <p>Instituto Politécnico da Cova da Beira</p>
    </div>

    <div class="aluno-info">
      <div class="foto">
        ${fotoBase64 ? `<img src="${fotoBase64}" alt="${ficha.Nome}">` : '<div style="width: 140px; height: 160px; background: #F3F4F6; border: 2px solid #3B82F6; border-radius: 8px; display: flex; align-items: center; justify-content: center;"><span style="color: #999;">Sem foto</span></div>'}
      </div>
      <div class="dados">
        <div class="dados-row">
          <div class="dados-item">
            <strong>ID do Aluno</strong>
            <span>${ficha.IdAluno}</span>
          </div>
          <div class="dados-item">
            <strong>Nome</strong>
            <span>${ficha.Nome}</span>
          </div>
        </div>
        <div class="dados-row">
          <div class="dados-item">
            <strong>Curso</strong>
            <span>${curso?.Curso || '-'}</span>
          </div>
          <div class="dados-item">
            <strong>Data de Nascimento</strong>
            <span>${formatDatePt(ficha.DataNascimento)}</span>
          </div>
        </div>
        <div class="dados-row">
          <div class="dados-item">
            <strong>Email</strong>
            <span>${ficha.Email || '-'}</span>
          </div>
          <div class="dados-item">
            <strong>Telefone</strong>
            <span>${ficha.Telefone || '-'}</span>
          </div>
        </div>
        <div class="dados-row">
          <div class="dados-item" style="grid-column: 1/-1;">
            <strong>Morada</strong>
            <span>${ficha.Morada || '-'}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Disciplinas do Curso</h2>
      <div class="disciplinas-list">
        ${disciplinas.map(d => `
          <div class="disciplina-item">
            <strong>${d.Disciplina}</strong>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="footer">
      <p>Documento gerado em ${formatDatePt(new Date())}</p>
    </div>
  </div>
</body>
</html>
    `;
    
    return res.send(html);
  }

  // ── IMPRIMIR CERTIFICADO ──────────────────────────────────────
  if (table === 'matriculas' && action === 'certificado_print') {
    const idAluno = parseInt(req.query.id_aluno, 10) || alunoIdSessao;
    const ficha = await Matricula.findOne({ IdAluno: idAluno, EstadoValidacao: 'Aprovada' }).lean();
    
    if (!ficha) {
      return res.status(403).send('<h1>Acesso negado</h1><p>O teu certificado não está disponível.</p>');
    }

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    const curso = await Curso.findOne({ IdCurso: ficha.IdCurso }).select('Curso').lean();

    const html = `
<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Certificado de Matrícula - ${ficha.Nome}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Georgia, serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5; }
    .certificate { width: 900px; height: 600px; background: white; border: 8px solid #3B82F6; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 60px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
    .certificate h1 { font-size: 36px; color: #3B82F6; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 2px; }
    .certificate p { font-size: 16px; color: #666; margin-bottom: 30px; line-height: 1.8; }
    .certificate .nome { font-size: 28px; color: #000; font-weight: bold; margin: 30px 0; }
    .certificate .curso { font-size: 18px; color: #3B82F6; font-style: italic; margin: 20px 0; }
    .certificate .data { font-size: 14px; color: #999; margin-top: 40px; }
    @media print {
      body { background: white; }
      .certificate { box-shadow: none; border-width: 1px; }
    }
  </style>
</head>
<body>
  <div class="certificate">
    <h1>Certificado de Matrícula</h1>
    <p>Certificamos que o aluno:</p>
    <div class="nome">${ficha.Nome}</div>
    <p>ingressou no curso de:</p>
    <div class="curso">${curso?.Curso || 'Curso'}</div>
    <p>encontra-se devidamente matriculado nesta instituição.</p>
    <div class="data">
      <p>Emitido em ${formatDatePt(new Date())}</p>
    </div>
  </div>
</body>
</html>
    `;
    
    return res.send(html);
  }

  // ── MATRÍCULAS LISTA ─────────────────────────────────────────
  if (action === 'matriculas_list' && alunoIdSessao) {
    matriculasLista = await Matricula.find(
      { IdAluno: alunoIdSessao, EstadoValidacao: 'Aprovada' }
    ).lean();
    for (let i = 0; i < matriculasLista.length; i++) {
      const curso = await Curso.findOne({ IdCurso: matriculasLista[i].IdCurso }).select('Curso').lean();
      matriculasLista[i].Curso = curso?.Curso || '';
    }
  }

  // ── FICHA ─────────────────────────────────────────────────────

  if (alunoIdSessao) {
    const fa = await Matricula.findOne({ IdAluno: alunoIdSessao }).lean();
    if (fa) {
      const fotoBuffer = fa.Foto ? Buffer.from(fa.Foto) : null;
      const curso = await Curso.findOne({ IdCurso: fa.IdCurso }).select('Curso').lean();
      fichaAluno = {
        ...fa,
        FotoBase64: fotoBuffer && fotoBuffer.length ? `data:image/jpeg;base64,${fotoBuffer.toString('base64')}` : null,
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
    alunoIdSessao, fichaAluno, fichaDisciplinas, turmaColegas, matriculasLista,
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

    const matricula = await Matricula.findOne({ IdAluno: alunoIdSessao }).select('Nome Email IdCurso').lean();
    if (!matricula) return redirectMsg(res, 'pedidos', 'error', 'Sem ficha associada.');

    await PedidoMatricula.create({
      IdPedido: await nextId(PedidoMatricula, 'IdPedido'),
      IdAluno: alunoIdSessao,
      NomeCandidato: matricula.Nome,
      Email: matricula.Email || null,
      IdCurso: matricula.IdCurso || null,
      Estado: 'Pendente',
      DataPedido: new Date(),
    });
    return redirectMsg(res, 'pedidos', 'success', 'Pedido de matrícula submetido com sucesso.');
  }

  redirectMsg(res, 'matriculas', 'error', 'Ação inválida.');
});

module.exports = router;
