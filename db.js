/**
 * db.js — Capa de base de datos SQLite para IdentiCASD-JPP
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'identicasd.db');
const db = new Database(DB_PATH);

// Activar WAL para mejor rendimiento con múltiples lecturas simultáneas
db.pragma('journal_mode = WAL');

// ── Crear tablas si no existen ───────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS fotos (
    id          TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    grado       TEXT NOT NULL,
    asignatura  TEXT NOT NULL,
    fecha       TEXT NOT NULL,
    categoria   TEXT NOT NULL,
    descripcion TEXT,
    filename    TEXT NOT NULL,
    drive_id    TEXT,
    drive_url   TEXT,
    status      TEXT NOT NULL DEFAULT 'Pendiente',
    comentarios TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// ── Operaciones ──────────────────────────────────────────────────

const fotos = {
  /** Insertar una foto nueva */
  insert(foto) {
    const stmt = db.prepare(`
      INSERT INTO fotos
        (id, nombre, grado, asignatura, fecha, categoria, descripcion,
         filename, drive_id, drive_url, status, comentarios)
      VALUES
        (@id, @nombre, @grado, @asignatura, @fecha, @categoria, @descripcion,
         @filename, @drive_id, @drive_url, @status, @comentarios)
    `);
    stmt.run(foto);
    return foto;
  },

  /** Obtener todas las fotos (panel docente) */
  getAll() {
    return db.prepare(`SELECT * FROM fotos ORDER BY created_at DESC`).all();
  },

  /** Obtener solo las aprobadas (galería pública) */
  getApproved() {
    return db.prepare(`
      SELECT * FROM fotos WHERE status = 'Aprobada' ORDER BY created_at DESC
    `).all();
  },

  /** Buscar por ID */
  getById(id) {
    return db.prepare(`SELECT * FROM fotos WHERE id = ?`).get(id);
  },

  /** Actualizar estado, comentarios y/o datos editados */
  update(id, fields) {
    const allowed = ['status', 'comentarios', 'nombre', 'grado', 'asignatura',
                     'fecha', 'categoria', 'descripcion', 'drive_id', 'drive_url'];
    const sets = Object.keys(fields)
      .filter(k => allowed.includes(k))
      .map(k => `${k} = @${k}`)
      .join(', ');
    if (!sets) return null;
    const stmt = db.prepare(`UPDATE fotos SET ${sets} WHERE id = @id`);
    stmt.run({ ...fields, id });
    return db.prepare(`SELECT * FROM fotos WHERE id = ?`).get(id);
  },

  /** Eliminar */
  delete(id) {
    return db.prepare(`DELETE FROM fotos WHERE id = ?`).run(id);
  },

  /** Contar fotos pendientes */
  countPending() {
    return db.prepare(`SELECT COUNT(*) as n FROM fotos WHERE status = 'Pendiente'`).get().n;
  },
};

module.exports = { db, fotos };
