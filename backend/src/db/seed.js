import { initDatabase, getDb, saveDatabase } from './database.js';
import bcrypt from 'bcryptjs';

async function seed() {
  await initDatabase();
  const db = getDb();

  const result = db.exec("SELECT id FROM users WHERE role = 'admin'");
  const hasAdmin = result.length > 0 && result[0].values.length > 0;

  if (!hasAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      ['Администратор', 'admin@example.com', hash, 'admin']
    );
    saveDatabase();
    console.log('Admin user created: admin@example.com / admin123');
  } else {
    console.log('Admin user already exists');
  }
}

seed().catch(console.error);
