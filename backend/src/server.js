import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { initDatabase } from './db/database.js';
import authRoutes from './routes/auth.js';
import internalRoutes from './routes/internal.js';
import usersRoutes from './routes/users.js';
import projectsRoutes from './routes/projects.js';
import issuesRoutes from './routes/issues.js';
import { authMiddleware } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.PORTAL_URLS,
]
  .filter(Boolean)
  .flatMap(value => value.split(',').map(item => item.trim()).filter(Boolean));

if (allowedOrigins.length === 0) {
  allowedOrigins.push('http://localhost:5173');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/internal', internalRoutes);

app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/projects', authMiddleware, projectsRoutes);
app.use('/api/issues', authMiddleware, issuesRoutes);

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

async function start() {
  await initDatabase();
  console.log('Database initialized');

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch(console.error);
