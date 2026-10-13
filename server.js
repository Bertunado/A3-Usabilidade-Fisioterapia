const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./src/db');
const authRoutes = require('./src/routes/auth');
const patientRoutes = require('./src/routes/patients');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

initDatabase();

app.get('/', (req, res) => {
  res.json({
    name: 'PhysioEdu API',
    status: 'online',
    endpoints: {
      auth: ['/api/auth/login', '/api/auth/register'],
      patients: ['/api/patients', '/api/patients/:id'],
      evolutions: ['/api/patients/:id/evolutions', '/api/evolutions/pending']
    }
  });
});

app.use('/api/auth', authRoutes);
app.use('/api', patientRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
