import { getDb } from '../db/database.js';

export function rowsToObjects(result) {
  if (result.length === 0) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

export function getOne(result) {
  const rows = rowsToObjects(result);
  return rows.length > 0 ? rows[0] : null;
}

export function checkProjectAccess(projectId, userId, role) {
  if (role === 'admin') return true;
  const db = getDb();
  const proj = db.exec('SELECT manager_id FROM projects WHERE id = ?', [projectId]);
  if (proj.length > 0 && proj[0].values.length > 0 && proj[0].values[0][0] === userId) return true;
  const result = db.exec('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  return result.length > 0 && result[0].values.length > 0;
}

export function getProjectRole(projectId, userId) {
  const db = getDb();
  const result = db.exec('SELECT role_in_project FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0];
}

export function resolveProjectId(identifier) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const db = getDb();
  if (/^\d+$/.test(String(identifier))) return Number(identifier);
  const result = db.exec('SELECT id FROM projects WHERE slug = ?', [identifier]);
  return result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : null;
}

// Multer/busboy отдаёт имя файла в latin1; перекодируем в UTF-8,
// чтобы русские названия не превращались в «кракозябры».
export function decodeFileName(name) {
  try {
    const decoded = Buffer.from(String(name), 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? String(name) : decoded;
  } catch (e) {
    return String(name);
  }
}
