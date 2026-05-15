'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const perfilSchema = new Schema({
  IdPerfis: { type: Number, unique: true, sparse: true },
  perfil: { type: String, required: true, maxlength: 25 },
}, { collection: 'perfis' });

const userSchema = new Schema({
  IdUser: { type: Number, unique: true, sparse: true },
  login: { type: String, required: true, unique: true, maxlength: 40 },
  passwordHash: { type: String, required: true, maxlength: 255 },
  perfil: { type: Schema.Types.ObjectId, ref: 'Perfil', required: true },
}, { collection: 'users' });

const cursoSchema = new Schema({
  IdCurso: { type: Number, unique: true, sparse: true },
  Curso: { type: String, required: true, maxlength: 150 },
  Sigla: { type: String, required: true, maxlength: 10 },
}, { collection: 'cursos' });

const disciplinaSchema = new Schema({
  IdDisciplina: { type: Number, unique: true, sparse: true },
  Disciplina: { type: String, required: true, maxlength: 30 },
  Sigla: { type: String, required: true, maxlength: 10 },
}, { collection: 'disciplinas' });

const planoEstudoSchema = new Schema({
  IdDisciplina: { type: Number, required: true },
  IdCurso: { type: Number, required: true },
  Ano: { type: Number, default: 1, min: 1 },
  Semestre: { type: Number, default: 1, min: 1 },
}, { collection: 'plano_estudos' });

planoEstudoSchema.index({ IdDisciplina: 1, IdCurso: 1 }, { unique: true });

const matriculaSchema = new Schema({
  IdAluno: { type: Number, unique: true, sparse: true },
  IdUser: { type: Number, default: null },
  Nome: { type: String, required: true, maxlength: 25 },
  Foto: { type: Buffer, default: null },
  IdCurso: { type: Number, required: true },
  DataNascimento: { type: Date, default: null },
  Morada: { type: String, maxlength: 255, default: null },
  Email: { type: String, maxlength: 120, default: null },
  Telefone: { type: String, maxlength: 20, default: null },
  EstadoValidacao: { type: String, default: 'Pendente', maxlength: 20 },
  ObservacoesValidacao: { type: String, default: null },
  ValidadoPor: { type: String, maxlength: 80, default: null },
  DataValidacao: { type: Date, default: null },
}, { collection: 'matriculas' });

matriculaSchema.index({ IdUser: 1 });
matriculaSchema.index({ IdCurso: 1 });

const notaAvaliacaoSchema = new Schema({
  IdNota: { type: Number, unique: true, sparse: true },
  IdAluno: { type: Number, required: true },
  IdDisciplina: { type: Number, required: true },
  Epoca: { type: String, default: 'Normal', maxlength: 20 },
  AnoLetivo: { type: String, required: true, maxlength: 9 },
  Nota: { type: Number, required: true, min: 0, max: 20 },
  Observacoes: { type: String, maxlength: 255, default: null },
  AtualizadoPor: { type: String, maxlength: 80, default: null },
  AtualizadoEm: { type: Date, default: Date.now },
}, { collection: 'notas_avaliacao' });

notaAvaliacaoSchema.index({ IdAluno: 1, IdDisciplina: 1, Epoca: 1, AnoLetivo: 1 }, { unique: true });
notaAvaliacaoSchema.index({ IdDisciplina: 1 });
notaAvaliacaoSchema.index({ IdAluno: 1 });

notaAvaliacaoSchema.pre('save', function updateTimestamp(next) {
  this.AtualizadoEm = new Date();
  if (typeof next === 'function') return next();
});

const pedidoMatriculaSchema = new Schema({
  IdPedido: { type: Number, unique: true, sparse: true },
  IdAluno: { type: Number, default: null },
  NomeCandidato: { type: String, required: true, maxlength: 120 },
  Email: { type: String, maxlength: 150, default: null },
  IdCurso: { type: Number, default: null },
  Observacoes: { type: String, maxlength: 255, default: null },
  Estado: {
    type: String,
    enum: ['Pendente', 'Aprovado', 'Rejeitado'],
    default: 'Pendente',
  },
  ObservacaoDecisao: { type: String, maxlength: 255, default: null },
  DecididoPor: { type: String, maxlength: 80, default: null },
  DataPedido: { type: Date, default: Date.now },
  DataDecisao: { type: Date, default: null },
}, { collection: 'pedidos_matricula' });

pedidoMatriculaSchema.index({ Estado: 1 });
pedidoMatriculaSchema.index({ IdCurso: 1 });
pedidoMatriculaSchema.index({ IdAluno: 1 });

const passwordResetSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  selector: { type: String, required: true, unique: true, minlength: 16, maxlength: 16 },
  tokenHash: { type: String, required: true, minlength: 64, maxlength: 64 },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  requestedAt: { type: Date, default: Date.now },
  requestedIp: { type: String, maxlength: 45, default: null },
  userAgent: { type: String, maxlength: 255, default: null },
}, { collection: 'password_resets' });

passwordResetSchema.index({ userId: 1 });
passwordResetSchema.index({ expiresAt: 1 });

async function cascadeMatriculaDeleteById(matriculaId) {
  if (!matriculaId) {
    return;
  }

  const matricula = await mongoose.model('Matricula').findById(matriculaId).select('IdAluno').lean();
  if (!matricula?.IdAluno) return;

  await mongoose.model('NotaAvaliacao').deleteMany({ IdAluno: matricula.IdAluno });
  await mongoose.model('PedidoMatricula').updateMany({ IdAluno: matricula.IdAluno }, { $set: { IdAluno: null } });
}

async function cascadeUserDeleteById(userId) {
  if (!userId) {
    return;
  }

  await mongoose.model('PasswordReset').deleteMany({ userId });
}

matriculaSchema.pre('deleteOne', { document: true, query: false }, async function cascadeMatriculaDeleteDocument() {
  await cascadeMatriculaDeleteById(this._id);
});

matriculaSchema.pre('deleteOne', { document: false, query: true }, async function cascadeMatriculaDeleteQuery() {
  const matricula = await this.model.findOne(this.getFilter()).select('_id').lean();
  await cascadeMatriculaDeleteById(matricula && matricula._id);
});

matriculaSchema.pre('findOneAndDelete', async function cascadeMatriculaFindOneAndDelete() {
  const matricula = await this.model.findOne(this.getFilter()).select('_id').lean();
  await cascadeMatriculaDeleteById(matricula && matricula._id);
});

userSchema.pre('deleteOne', { document: true, query: false }, async function cascadeUserDeleteDocument() {
  await cascadeUserDeleteById(this._id);
});

userSchema.pre('deleteOne', { document: false, query: true }, async function cascadeUserDeleteQuery() {
  const user = await this.model.findOne(this.getFilter()).select('_id').lean();
  await cascadeUserDeleteById(user && user._id);
});

userSchema.pre('findOneAndDelete', async function cascadeUserFindOneAndDelete() {
  const user = await this.model.findOne(this.getFilter()).select('_id').lean();
  await cascadeUserDeleteById(user && user._id);
});
const Perfil = mongoose.models.Perfil || mongoose.model('Perfil', perfilSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Curso = mongoose.models.Curso || mongoose.model('Curso', cursoSchema);
const Disciplina = mongoose.models.Disciplina || mongoose.model('Disciplina', disciplinaSchema);
const PlanoEstudo = mongoose.models.PlanoEstudo || mongoose.model('PlanoEstudo', planoEstudoSchema);
const Matricula = mongoose.models.Matricula || mongoose.model('Matricula', matriculaSchema);
const NotaAvaliacao = mongoose.models.NotaAvaliacao || mongoose.model('NotaAvaliacao', notaAvaliacaoSchema);
const PedidoMatricula = mongoose.models.PedidoMatricula || mongoose.model('PedidoMatricula', pedidoMatriculaSchema);
const PasswordReset = mongoose.models.PasswordReset || mongoose.model('PasswordReset', passwordResetSchema);

module.exports = {
  Perfil,
  User,
  Curso,
  Disciplina,
  PlanoEstudo,
  Matricula,
  NotaAvaliacao,
  PedidoMatricula,
  PasswordReset,
};
