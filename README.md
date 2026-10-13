## Endpoints principais

### Autenticação
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/users`

### Pacientes
- `GET /api/patients`
- `POST /api/patients`
- `GET /api/patients/:id`
- `PATCH /api/patients/:id/status`
- `POST /api/patients/:id/evolutions`

### Evoluções
- `GET /api/evolutions/pending`
- `PATCH /api/evolutions/:id/approve`

## Usuários padrão criados

- Estudante: matrícula `202301982`, senha `123456`
- Professor: matrícula `DOC-88392`, senha `123456`
