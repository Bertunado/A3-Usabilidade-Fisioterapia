# PhysioEdu — Gestão de Estágio & Prontuário Eletrônico

Sistema para clínicas-escola de Fisioterapia: o **estudante** atende os pacientes da agenda e registra a evolução no formato SOAP; o **professor orientador** revisa, aprova ou pede correção.

## Como usar

### 1. Online (GitHub Pages) — modo demonstração

Acesse **https://soraln.github.io/A3-Usabilidade-Fisioterapia/**.

Sem servidor, o sistema roda inteiro no navegador e guarda os dados no `localStorage`. Tudo funciona (login, cadastros, evoluções, validação), mas os dados ficam **só naquele navegador**. O link "Restaurar dados iniciais", no rodapé, volta tudo ao estado original.

> Para ver aluno e professor ao mesmo tempo, abra duas abas do mesmo navegador. Entre como aluno **desmarcando** "Lembrar matrícula e manter conectado"; na outra aba, entre como professor. Uma aba atualiza sozinha quando a outra altera algo.

### 2. Com servidor (Node.js + SQLite) — dados compartilhados

Requer Node.js 20 ou mais novo.

```bash
npm install
npm start
```

Abra **http://localhost:3000**. A mesma página detecta o servidor e passa a usar a API com banco SQLite (`database/physioedu.db`). Outros dispositivos na mesma rede podem acessar por `http://IP-DO-COMPUTADOR:3000`, e todos veem os mesmos dados (as telas se atualizam a cada 30 s).

Para usar o site do GitHub Pages com um backend hospedado (Render, Railway, VPS...), defina a URL da API no `index.html`, antes dos scripts:

```html
<script>window.PHYSIOEDU_API_URL = 'https://minha-api.exemplo.com/';</script>
```

## Contas de demonstração

| Perfil     | Matrícula   | Senha  |
|------------|-------------|--------|
| Estudante  | `202301982` | 123456 |
| Estudante  | `202301455` | 123456 |
| Professor  | `DOC-88392` | 123456 |
| Professor  | `DOC-77120` | 123456 |

Também é possível criar uma conta pela tela de login ("Criar conta") e redefinir a senha em "Esqueceu a senha?" (matrícula + e-mail cadastrado).

## Funcionalidades

**Estudante**
- Agenda por dia (navegação entre datas), com contadores clicáveis que filtram a lista e busca por nome ou CPF.
- Cadastro de paciente com anamnese (validação de CPF, CPF único, máscaras de CPF e telefone), já agendando a primeira sessão.
- Atendimento SOAP: EVA, sinais vitais, condutas e plano. O rascunho é salvo automaticamente e, se a validação falhar, o sistema leva à aba com o campo que falta.
- Registro de falta com "Desfazer", sessões desmarcadas, retorno e reagendamento.
- Prontuário do paciente: dados, anamnese, próximas sessões e todas as evoluções.
- Aviso das evoluções com correção solicitada, com a edição e o reenvio para validação.

**Professor**
- Painel com evoluções pendentes, em correção e aprovadas, com filtros e busca.
- Visualização completa da evolução, aprovação (com comentário opcional) e pedido de correção (com comentário obrigatório).
- Consulta aos prontuários dos pacientes.

## Estrutura

```
index.html                 Interface (a mesma página no GitHub Pages e no servidor)
assets/js/shared.js        Regras compartilhadas: validações, CPF, datas, dados iniciais
assets/js/local-backend.js "Servidor" do navegador, usado quando não há backend (modo demonstração)
assets/js/api.js           Cliente da API: detecta o modo e envia as requisições
assets/js/app.js           Lógica das telas
server.js                  Servidor Express (API + arquivos da página)
src/db.js                  Esquema SQLite e dados iniciais
src/routes/*.js            Rotas: auth, patients, appointments, evolutions
```

## API

Todas as rotas, exceto as de autenticação, exigem o cabeçalho `Authorization: Bearer <token>`, devolvido no login.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login `{ matricula, password, role }` |
| POST | `/api/auth/register` | Criar conta |
| POST | `/api/auth/reset-password` | Redefinir senha `{ matricula, email, newPassword }` |
| GET | `/api/auth/me` | Usuário da sessão |
| POST | `/api/auth/logout` | Encerrar sessão |
| GET | `/api/patients?q=` | Listar/buscar pacientes |
| POST | `/api/patients` | Cadastrar paciente (+ 1ª sessão opcional em `appointment`) |
| GET / PUT | `/api/patients/:id` | Prontuário completo / editar cadastro |
| GET | `/api/appointments?date=AAAA-MM-DD` | Agenda do dia |
| POST | `/api/appointments` | Agendar sessão `{ patientId, date, time }` |
| GET / DELETE | `/api/appointments/:id` | Detalhe / desmarcar |
| PATCH | `/api/appointments/:id/status` | `pending`, `attending` ou `absent` |
| GET | `/api/evolutions?status=&mine=1` | Listar evoluções |
| POST | `/api/evolutions` | Registrar evolução (estudante) |
| GET / PUT | `/api/evolutions/:id` | Detalhe / reenviar após correção (autor) |
| PATCH | `/api/evolutions/:id/review` | `{ action: 'approve' \| 'correction', feedback }` (professor) |
