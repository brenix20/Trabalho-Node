# IPCAVNF — Node.js / Express

Conversão do projeto PHP para Node.js com Express, EJS e MySQL2.
Inclui preparação para integração faseada com MongoDB.

## Estrutura do projeto

```
ipcavnf-node/
├── public/
│   └── styles.css              ← CSS global
├── src/
│   ├── app.js                  ← Entrada principal (equivalente a index.php + bootstrap.php)
│   ├── db.js                   ← Pool de ligações MySQL
│   ├── mongodb.js              ← Ligação MongoDB (driver oficial)
│   ├── helpers/
│   │   └── utils.js            ← Funções auxiliares (equivalente a common.php)
│   ├── middleware/
│   │   ├── auth.js             ← requireAuth, requirePerfil
│   │   └── upload.js           ← Multer para upload de fotos
│   ├── routes/
│   │   ├── login.js            ← /login  (equivalente a login.php)
│   │   ├── gestor.js           ← /gestor (equivalente a gestor.php)
│   │   ├── aluno.js            ← /aluno  (equivalente a aluno.php)
│   │   └── funcionario.js      ← /funcionario (equivalente a funcionario.php)
│   └── views/
│       ├── login.ejs
│       ├── partials/
│       │   └── navbar.ejs
│       ├── gestor/
│       │   └── index.ejs
│       ├── aluno/
│       │   └── index.ejs
│       └── funcionario/
│           └── index.ejs
├── .env.example
└── package.json
```

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edita o .env com as tuas credenciais de base de dados

# 3. Iniciar o servidor
npm start

# Ou em modo desenvolvimento (com hot-reload)
npm run dev
```

## Variáveis de ambiente (.env)

| Variável              | Descrição                        | Default       |
|-----------------------|----------------------------------|---------------|
| `IPCAVNF_DB_HOST`     | Host da base de dados            | `localhost`   |
| `IPCAVNF_DB_PORT`     | Porta MySQL                      | `3306`        |
| `IPCAVNF_DB_NAME`     | Nome da base de dados            | `ipcavnf`     |
| `IPCAVNF_DB_USER`     | Utilizador MySQL                 | —             |
| `IPCAVNF_DB_PASS`     | Password MySQL                   | —             |
| `SESSION_SECRET`      | Segredo para sessão Express      | (obrigatório em produção) |
| `PORT`                | Porta do servidor HTTP           | `3000`        |

## Rotas

| Rota            | Perfil requerido  | Equivalente PHP     |
|-----------------|-------------------|---------------------|
| `GET/POST /login`      | —          | `login.php`         |
| `GET /logout`          | —          | `logout.php`        |
| `GET /`                | qualquer   | `index.php`         |
| `GET/POST /gestor`     | gestor     | `gestor.php`        |
| `GET/POST /aluno`      | aluno      | `aluno.php`         |
| `GET/POST /funcionario`| funcionario| `funcionario.php`   |

## Diferenças face ao PHP original

| PHP                            | Node.js                                      |
|-------------------------------|----------------------------------------------|
| `session_start()` / `$_SESSION` | `express-session`                          |
| `password_hash()` / `password_verify()` | `bcryptjs`                        |
| CSRF com `$_SESSION['csrf_token']` | Tokens de sessão (campo `_csrf` pode ser adicionado com `csurf`) |
| `$_FILES` + `LONGBLOB`        | `multer` (memoryStorage) → Buffer no MySQL   |
| `mysqli` com prepared statements | `mysql2/promise` com prepared statements  |
| Redirect com `header('Location:…')` | `res.redirect()`                    |
| Views inline (PHP + HTML)     | Templates EJS separados                      |
| `password_argon2id` preferido | `bcrypt` (custo 12) — argon2 disponível via `argon2` npm se necessário |

## Base de dados

Usa o mesmo schema MySQL (`ipcavnf.sql`) — não é necessário alterar nada na BD.
O Node.js conecta-se à mesma base de dados MariaDB/MySQL que o projeto PHP usava.

## Integração com MongoDB (faseada)

Neste momento, as rotas em `src/routes` usam SQL direto (MySQL). Por isso, a migração para MongoDB deve ser feita por etapas.

### 1) Dependências e variáveis de ambiente

- Dependência já adicionada: `mongodb`.
- Configura no `.env` as variáveis Mongo (ver `.env.example`):
	- `MONGODB_URI`
	- `MONGODB_DB`
	- parâmetros de pool/timeout opcionais

### 2) Conexão Mongo no arranque

- O arranque em `src/app.js` já tenta ligar MongoDB quando `MONGODB_URI` existe.
- Se não existir, a app continua em modo MySQL legado.

### 3) Estratégia de migração recomendada

1. Migrar primeiro `src/routes/login.js` para coleção `users` e `perfis`.
2. Migrar depois `src/routes/aluno.js` (`matriculas`, `pedidos_matricula`).
3. Migrar `src/routes/funcionario.js` e `src/routes/gestor.js`.
4. Remover `src/db.js` (MySQL) apenas no fim, quando todas as rotas estiverem em MongoDB.

### 4) Mapeamento inicial de tabelas para coleções

- `Users` -> `users`
- `Perfis` -> `perfis`
- `matriculas` -> `matriculas`
- `pedidos_matricula` -> `pedidos_matricula`
- `disciplina` -> `disciplinas`
- `cursos` -> `cursos`
- `plano_estudos` -> `plano_estudos`
- `notas_avaliacao` -> `notas_avaliacao`

### 5) Nota importante

Enquanto uma rota continuar a usar MySQL, essa rota ainda depende de MariaDB/MySQL ativo.
