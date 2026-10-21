# PhysioEdu — Gestão de Estágio & Prontuário Eletrônico

Sistema para clínicas-escola de Fisioterapia: o **estudante** atende os pacientes da agenda e registra a evolução no formato SOAP; o **professor orientador** revisa, aprova ou pede correção; o **administrador** cadastra estudantes e professores e controla o acesso.

## Como usar

### 1. Online (GitHub Pages)

Acesse **https://soraln.github.io/A3-Usabilidade-Fisioterapia/**.

Sem servidor, o sistema roda inteiro no navegador e guarda os dados no `localStorage`. Tudo funciona (login, cadastros, evoluções, validação), mas os dados ficam **só naquele navegador**. Para voltar aos dados iniciais, limpe os dados do site no navegador.

> Para ver aluno e professor ao mesmo tempo, abra duas abas do mesmo navegador. Entre como aluno **desmarcando** "Lembrar matrícula e manter conectado"; na outra aba, entre como professor. Uma aba atualiza sozinha quando a outra altera algo.

### 2. Com servidor (Node.js + SQLite) — dados compartilhados

Requer Node.js 20 ou mais novo.

```bash
npm install
npm start
```

Abra **http://localhost:3000**. A mesma página detecta o servidor e passa a usar a API com banco SQLite local (`database/physioedu.db`). Outros dispositivos na mesma rede podem acessar por `http://IP-DO-COMPUTADOR:3000`, e todos veem os mesmos dados (as telas se atualizam a cada 30 s).

Para usar o site do GitHub Pages com um backend hospedado (Render, Railway, VPS...), defina a URL da API no `index.html`, antes dos scripts:

```html
<script>window.PHYSIOEDU_API_URL = 'https://minha-api.exemplo.com/';</script>
```

### 3. Em produção (Render + Turso)

O servidor roda no [Render](https://render.com) e o banco fica no [Turso](https://turso.tech), que é SQLite hospedado. Os dois têm plano gratuito.

1. **Turso:** crie uma conta, crie um banco (por exemplo `physioedu`) na região AWS US East (Virginia) e gere um token de acesso. Anote a URL do banco (`libsql://...`) e o token.
2. **Render:** crie uma conta com o GitHub, clique em **New > Blueprint** e selecione este repositório. O arquivo `render.yaml` já configura tudo; preencha:
   - `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` com os dados do Turso;
   - `ADMIN_PASSWORD` com a senha que o administrador vai usar.
3. Aguarde o deploy e acesse o endereço `https://....onrender.com`. O banco começa vazio, apenas com o usuário `admin`.

A cada `git push` na branch principal o Render publica a nova versão. No plano gratuito o servidor "dorme" após 15 minutos sem acesso; o primeiro acesso depois disso demora cerca de 1 minuto.

## Configuração do servidor

Variáveis de ambiente opcionais do `npm start`:

| Variável | Para que serve |
|---|---|
| `PORT` | Porta do servidor (padrão `3000`) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Banco Turso (produção). Sem elas, usa o arquivo SQLite local |
| `DB_PATH` | Caminho do arquivo SQLite local (padrão `database/physioedu.db`) |
| `DEMO_DATA=false` | Não cria pacientes e contas de exemplo; o banco começa só com o administrador |
| `ADMIN_PASSWORD` | Senha do administrador, usada apenas quando a conta admin é criada pela primeira vez |
| `TRUST_PROXY=1` | Use quando o servidor estiver atrás de um proxy reverso (Nginx, Caddy), para o bloqueio de tentativas de login usar o IP real |

O login bloqueia por 15 minutos a combinação IP + matrícula após 8 senhas erradas seguidas.

## Contas cadastradas

| Perfil     | Matrícula   | Senha  |
|------------|-------------|--------|
| Estudante  | `202301982` | 123456 |
| Estudante  | `202301455` | 123456 |
| Professor  | `DOC-88392` | 123456 |
| Professor  | `DOC-77120` | 123456 |

O **administrador** entra com o login `admin` (por qualquer aba da tela de login). A senha padrão é repassada pelo responsável do projeto e não fica registrada no código: o sistema guarda apenas o hash dela.

Não há cadastro público. Novos estudantes e professores são criados no painel administrativo com uma **senha provisória**, que o usuário troca obrigatoriamente no primeiro acesso. Em caso de esquecimento, o administrador define uma nova senha provisória.

## Funcionalidades

**Estudante**
- Agenda por dia (navegação entre datas), com contadores clicáveis que filtram a lista e busca por nome ou CPF.
- Cadastro de paciente com anamnese (validação de CPF, CPF único, máscaras de CPF e telefone), já agendando a primeira sessão.
- Atendimento SOAP: EVA, sinais vitais, condutas e plano. O rascunho é salvo automaticamente e, se a validação falhar, o sistema leva à aba com o campo que falta.
- Registro de falta com "Desfazer", sessões desmarcadas, retorno e reagendamento.
- Prontuário do paciente: dados, anamnese, próximas sessões e todas as evoluções.
- Aviso das evoluções com correção solicitada, com a edição e o reenvio para validação.

**Administrador**
- Cadastro de estudantes e professores com senha provisória (gerada automaticamente ou digitada).
- Edição de dados, redefinição de senha e desativação/reativação do acesso, sem apagar o histórico de atendimentos.
- Lista com busca, filtros por perfil e indicação de último acesso e de senha provisória pendente.
- Por segurança, a sessão do administrador não fica salva: recarregar, fechar a aba ou sair do site exige novo login (e ela expira sozinha em 8 horas).

**Todos os perfis**
- Troca da própria senha pelo ícone de chave no cabeçalho.

**Professor**
- Painel com evoluções pendentes, em correção e aprovadas, com filtros e busca.
- Visualização completa da evolução, aprovação (com comentário opcional) e pedido de correção (com comentário obrigatório).
- Consulta aos prontuários dos pacientes.

## Estrutura

```
index.html                 Interface (a mesma página no GitHub Pages e no servidor)
assets/js/shared.js        Regras compartilhadas: validações, CPF, datas, dados iniciais
assets/js/local-backend.js "Servidor" do navegador, usado quando não há backend (GitHub Pages)
assets/js/api.js           Cliente da API: detecta o modo e envia as requisições
assets/js/app.js           Lógica das telas
server.js                  Servidor Express (API + arquivos da página)
src/db.js                  Conexão (Turso ou arquivo local), esquema, migrações e dados iniciais
render.yaml                Configuração de deploy no Render
src/routes/*.js            Rotas: auth, admin, patients, appointments, evolutions
```

## API

Todas as rotas, exceto o login, exigem o cabeçalho `Authorization: Bearer <token>`, devolvido no login. As rotas clínicas (pacientes, agenda e evoluções) são exclusivas de estudantes e professores; as de `/api/admin` são exclusivas do administrador.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login `{ matricula, password, role }` |
| GET | `/api/auth/me` | Usuário da sessão |
| POST | `/api/auth/change-password` | Trocar a própria senha `{ currentPassword, newPassword }` |
| POST | `/api/auth/logout` | Encerrar sessão |
| GET / POST | `/api/admin/users` | Listar / cadastrar estudante ou professor (admin) |
| PUT | `/api/admin/users/:id` | Editar cadastro (admin) |
| POST | `/api/admin/users/:id/password` | Definir senha provisória (admin) |
| PATCH | `/api/admin/users/:id/status` | Ativar/desativar acesso `{ active }` (admin) |
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
