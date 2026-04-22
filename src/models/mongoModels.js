'use strict';

const mongoose = require('mongoose');
const { Schema, Decimal128 } = mongoose;

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

const planoEstudosSchema = new Schema({
  disciplinaId: { type: Schema.Types.ObjectId, ref: 'Disciplina', required: true },
  ano: { type: Number, default: 1, min: 1 },
  semestre: { type: Number, default: 1, min: 1 },
}, { _id: false });

const cursoSchema = new Schema({
  IdCurso: { type: Number, unique: true, sparse: true },
  curso: { type: String, required: true, maxlength: 150 },
  sigla: { type: String, required: true, maxlength: 10 },
  planoEstudos: { type: [planoEstudosSchema], default: [] },
}, { collection: 'cursos' });

const disciplinaSchema = new Schema({
  IdDisciplina: { type: Number, unique: true, sparse: true },
  disciplina: { type: String, required: true, maxlength: 30 },
  sigla: { type: String, required: true, maxlength: 10 },
}, { collection: 'disciplinas' });

const matriculaSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  nome: { type: String, required: true, maxlength: 25 },
  foto: { type: Buffer, default: null },
  cursoId: { type: Schema.Types.ObjectId, ref: 'Curso', required: true },
  dataNascimento: { type: Date, default: null },
  morada: { type: String, maxlength: 255, default: null },
  email: { type: String, maxlength: 120, default: null },
  telefone: { type: String, maxlength: 20, default: null },
  estadoValidacao: { type: String, default: 'Pendente', maxlength: 20 },
  observacoesValidacao: { type: String, default: null },
  validadoPor: { type: String, maxlength: 80, default: null },
  dataValidacao: { type: Date, default: null },
}, { collection: 'matriculas' });

matriculaSchema.index({ userId: 1 });
matriculaSchema.index({ cursoId: 1 });

const notaAvaliacaoSchema = new Schema({
  alunoId: { type: Schema.Types.ObjectId, ref: 'Matricula', required: true },
  disciplinaId: { type: Schema.Types.ObjectId, ref: 'Disciplina', required: true },
  epoca: { type: String, default: 'Normal', maxlength: 20 },
  anoLetivo: { type: String, required: true, maxlength: 9 },
  nota: { type: Decimal128, required: true },
  observacoes: { type: String, maxlength: 255, default: null },
  atualizadoPor: { type: String, maxlength: 80, default: null },
  atualizadoEm: { type: Date, default: Date.now },
}, { collection: 'notas_avaliacao' });

notaAvaliacaoSchema.index({ alunoId: 1, disciplinaId: 1, epoca: 1, anoLetivo: 1 }, { unique: true });
notaAvaliacaoSchema.index({ disciplinaId: 1 });
notaAvaliacaoSchema.index({ alunoId: 1 });

notaAvaliacaoSchema.pre('save', function updateTimestamp(next) {
  this.atualizadoEm = new Date();
  next();
});

const pedidoMatriculaSchema = new Schema({
  alunoId: { type: Schema.Types.ObjectId, ref: 'Matricula', default: null },
  nomeCandidato: { type: String, required: true, maxlength: 120 },
  email: { type: String, maxlength: 150, default: null },
  cursoId: { type: Schema.Types.ObjectId, ref: 'Curso', default: null },
  observacoes: { type: String, maxlength: 255, default: null },
  estado: {
    type: String,
    enum: ['Pendente', 'Aprovado', 'Rejeitado'],
    default: 'Pendente',
  },
  observacaoDecisao: { type: String, maxlength: 255, default: null },
  decididoPor: { type: String, maxlength: 80, default: null },
  dataPedido: { type: Date, default: Date.now },
  dataDecisao: { type: Date, default: null },
}, { collection: 'pedidos_matricula' });

pedidoMatriculaSchema.index({ estado: 1 });
pedidoMatriculaSchema.index({ cursoId: 1 });
pedidoMatriculaSchema.index({ alunoId: 1 });

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

matriculaSchema.pre('deleteOne', { document: true, query: false }, async function cascadeMatriculaDelete() {
  await mongoose.model('NotaAvaliacao').deleteMany({ alunoId: this._id });
  await mongoose.model('PedidoMatricula').updateMany({ alunoId: this._id }, { $set: { alunoId: null } });
});

userSchema.pre('deleteOne', { document: true, query: false }, async function cascadeUserDelete() {
  await mongoose.model('PasswordReset').deleteMany({ userId: this._id });
});

const Perfil = mongoose.models.Perfil || mongoose.model('Perfil', perfilSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Curso = mongoose.models.Curso || mongoose.model('Curso', cursoSchema);
const Disciplina = mongoose.models.Disciplina || mongoose.model('Disciplina', disciplinaSchema);
const Matricula = mongoose.models.Matricula || mongoose.model('Matricula', matriculaSchema);
const NotaAvaliacao = mongoose.models.NotaAvaliacao || mongoose.model('NotaAvaliacao', notaAvaliacaoSchema);
const PedidoMatricula = mongoose.models.PedidoMatricula || mongoose.model('PedidoMatricula', pedidoMatriculaSchema);
const PasswordReset = mongoose.models.PasswordReset || mongoose.model('PasswordReset', passwordResetSchema);

module.exports = {
  Perfil,
  User,
  Curso,
  Disciplina,
  Matricula,
  NotaAvaliacao,
  PedidoMatricula,
  PasswordReset,
};
