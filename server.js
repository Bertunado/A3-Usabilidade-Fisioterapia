const path = require('path');
const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./src/db');
const { requireAuth } = require('./src/middleware/auth');
const authRoutes = require('./src/routes/auth');
const patientRoutes = require('./src/routes/patients');
const appointmentRoutes = require('./src/routes/appointments');
const evolutionRoutes = require('./src/routes/evolutions');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

initDatabase();

// Frontend (mesmo arquivo publicado no GitHub Pages)
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api', (req, res) => {
  res.json({
    name: 'PhysioEdu API',
    status: 'online',
    endpoints: {
      auth: ['/api/auth/login', '/api/auth/register', '/api/auth/reset-password', '/api/auth/me', '/api/auth/logout'],
      patients: ['/api/patients', '/api/patients/:id'],
      appointments: ['/api/appointments?date=AAAA-MM-DD', '/api/appointments/:id', '/api/appointments/:id/status'],
      evolutions: ['/api/evolutions', '/api/evolutions/:id', '/api/evolutions/:id/review']
    }
  });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: 'server' }));

app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, patientRoutes, appointmentRoutes, evolutionRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Rota não encontrada.' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'JSON inválido na requisição.' });
  }
  console.error(err.stack);
  return res.status(500).json({ message: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`PhysioEdu rodando em http://localhost:${PORT}`);
});
