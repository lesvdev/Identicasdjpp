/**
 * server.js — Backend de IdentiCASD-JPP
 * Node.js + Express · SQLite · Google Drive
 */
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const multer      = require('multer');
const sharp       = require('sharp');
const path        = require('path');
const fs          = require('fs');
const { v4: uuid } = require('uuid');

const { fotos }         = require('./db');
const { uploadToDrive } = require('./cloudinary');

/**
 * Convierte un registro de DB al formato que espera el frontend React.
 * DB usa: nombre, grado, asignatura, categoria, descripcion, comentarios
 * Frontend usa: name, grade, subject, category, description, comments, image
 */
function fotoPublic(f) {
  if (!f) return null;
  return {
    id:          f.id,
    name:        f.nombre,
    grade:       f.grado,
    subject:     f.asignatura,
    date:        f.fecha,
    category:    f.categoria,
    description: f.descripcion,
    comments:    f.comentarios,
    status:      f.status,
    image:       `/api/fotos/${f.id}/imagen`,
    driveUrl:    f.drive_url || null,
    createdAt:   f.created_at,
  };
}

// ── Config ────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3000;
// En Railway usamos /data (volumen persistente); localmente ./uploads
const DATA_DIR     = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.UPLOADS_DIR || './uploads';
const UPLOADS_DIR  = path.resolve(path.join(DATA_DIR, 'fotos'));
const DB_PATH_ENV  = path.resolve(path.join(DATA_DIR, 'identicasd.db'));
const MAX_FILE_MB  = parseInt(process.env.MAX_FILE_MB || '15', 10);
const TEACHER_PASS = process.env.TEACHER_PASSWORD || 'identic@sd2026';
const PUBLIC_DIR   = path.join(__dirname, 'public');

// Inyectar ruta de DB al módulo antes de requerir
process.env.DB_PATH = DB_PATH_ENV;

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR))  fs.mkdirSync(PUBLIC_DIR,  { recursive: true });

// ── Express ───────────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));   // sirve el frontend HTML
app.use('/fotos', express.static(UPLOADS_DIR)); // fotos accesibles

// Rate limiting: máx 30 subidas por IP por hora
const uploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Demasiadas solicitudes. Intenta en una hora.' },
});

// ── Multer: almacenamiento temporal de uploads ────────────────────
const tmpDir = path.join(UPLOADS_DIR, '_tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, tmpDir),
  filename:    (_, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se aceptan imágenes JPEG, PNG o WEBP'));
  },
});

// ── Middleware: verificar contraseña docente ──────────────────────
function teacherAuth(req, res, next) {
  const pwd = req.headers['x-teacher-password'] || req.body?.teacherPassword;
  if (pwd === TEACHER_PASS) return next();
  res.status(401).json({ error: 'Contraseña incorrecta' });
}

// ═════════════════════════════════════════════════════════════════
//  RUTAS PÚBLICAS
// ═════════════════════════════════════════════════════════════════

/**
 * POST /api/fotos
 * Recibe foto + metadatos, guarda en VPS y sube a Drive.
 */
app.post('/api/fotos', uploadLimit, upload.single('imagen'), async (req, res) => {
  try {
    const { nombre, grado, asignatura, fecha, categoria, descripcion } = req.body;

    if (!nombre || !grado || !categoria) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Faltan campos obligatorios: nombre, grado, categoría' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    }

    // Optimizar imagen con sharp (max 2000px, calidad 85%)
    const id       = uuid();
    const ext      = '.jpg';
    const finalName = `${id}${ext}`;
    const finalPath = path.join(UPLOADS_DIR, finalName);

    await sharp(req.file.path)
      .rotate()                          // respeta EXIF orientation
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(finalPath);

    fs.unlinkSync(req.file.path); // borrar tmp

    // Construir objeto foto
    const foto = {
      id,
      nombre:      nombre.trim(),
      grado:       grado.trim(),
      asignatura:  asignatura?.trim() || '',
      fecha:       fecha || new Date().toISOString().split('T')[0],
      categoria:   categoria.trim(),
      descripcion: descripcion?.trim() || '',
      filename:    finalName,
      drive_id:    null,
      drive_url:   null,
      status:      'Pendiente',
      comentarios: '',
    };

    // Guardar en DB
    fotos.insert(foto);

    // Subir a Drive en segundo plano (no bloquea la respuesta)
    uploadToDrive({
      filePath:  finalPath,
      nombre:    foto.nombre,
      grado:     foto.grado,
      categoria: foto.categoria,
      fecha:     foto.fecha,
      mimeType:  'image/jpeg',
    }).then(driveResult => {
      if (driveResult) {
        fotos.update(id, { drive_id: driveResult.driveId, drive_url: driveResult.driveUrl });
        console.log(`[Drive] Vinculado a foto ${id}`);
      }
    });

    res.status(201).json({
      ok:      true,
      message: 'Fotografía recibida. El docente la revisará pronto.',
      foto:    fotoPublic(fotos.getById(id)),
    });

  } catch (err) {
    console.error('[POST /api/fotos]', err);
    res.status(500).json({ error: 'Error interno al procesar la fotografía' });
  }
});

/**
 * GET /api/fotos
 * Galería pública: solo fotos aprobadas.
 */
app.get('/api/fotos', (req, res) => {
  const { categoria, grado } = req.query;
  let lista = fotos.getApproved();
  if (categoria) lista = lista.filter(f => f.categoria === categoria);
  if (grado)     lista = lista.filter(f => f.grado === grado);
  res.json({ fotos: lista.map(fotoPublic), total: lista.length });
});

/**
 * GET /api/fotos/:id/imagen
 * Servir imagen por ID (sin exponer el nombre de archivo interno).
 */
app.get('/api/fotos/:id/imagen', (req, res) => {
  const foto = fotos.getById(req.params.id);
  if (!foto) return res.status(404).json({ error: 'No encontrada' });
  const file = path.join(UPLOADS_DIR, foto.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(file);
});

// ═════════════════════════════════════════════════════════════════
//  RUTAS DEL PANEL DOCENTE (requieren contraseña)
// ═════════════════════════════════════════════════════════════════

/**
 * POST /api/docente/login
 * Verifica contraseña y devuelve OK.
 */
app.post('/api/docente/login', (req, res) => {
  const { password } = req.body;
  if (password === TEACHER_PASS) {
    res.json({ ok: true, pendientes: fotos.countPending() });
  } else {
    res.status(401).json({ error: 'Contraseña incorrecta' });
  }
});

/**
 * GET /api/docente/fotos
 * Todas las fotos (para el panel docente).
 */
app.get('/api/docente/fotos', teacherAuth, (req, res) => {
  res.json({ fotos: fotos.getAll().map(fotoPublic), pendientes: fotos.countPending() });
});

/**
 * PATCH /api/docente/fotos/:id
 * Actualizar estado, comentarios o datos de la foto.
 */
app.patch('/api/docente/fotos/:id', teacherAuth, (req, res) => {
  // Acepta nombres del frontend (English) y los mapea a nombres de DB (Spanish)
  const map = { name:'nombre', grade:'grado', subject:'asignatura',
                date:'fecha', category:'categoria', description:'descripcion',
                comments:'comentarios', status:'status', comentarios:'comentarios' };
  const fields = {};
  for (const [fk, dk] of Object.entries(map)) {
    if (req.body[fk] !== undefined) fields[dk] = req.body[fk];
  }
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'Sin campos para actualizar' });
  }
  const updated = fotos.update(req.params.id, fields);
  if (!updated) return res.status(404).json({ error: 'Foto no encontrada' });
  res.json({ ok: true, foto: fotoPublic(updated) });
});

/**
 * DELETE /api/docente/fotos/:id
 * Eliminar foto (borra archivo local también).
 */
app.delete('/api/docente/fotos/:id', teacherAuth, (req, res) => {
  const foto = fotos.getById(req.params.id);
  if (!foto) return res.status(404).json({ error: 'No encontrada' });

  // Borrar archivo local
  const file = path.join(UPLOADS_DIR, foto.filename);
  if (fs.existsSync(file)) fs.unlinkSync(file);

  fotos.delete(req.params.id);
  res.json({ ok: true });
});

/**
 * GET /api/docente/stats
 * Estadísticas rápidas para el panel.
 */
app.get('/api/docente/stats', teacherAuth, (req, res) => {
  const all = fotos.getAll();
  const byStatus = {};
  const byCat    = {};
  for (const f of all) {
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    byCat[f.categoria] = (byCat[f.categoria]  || 0) + 1;
  }
  res.json({ total: all.length, byStatus, byCat, pendientes: fotos.countPending() });
});

// ── Catch-all: devolver el frontend para rutas no-API ─────────────
app.get('*', (req, res) => {
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.status(404).send('Frontend no desplegado aún.');
});

// ── Iniciar servidor ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ IdentiCASD-JPP corriendo en puerto ${PORT}`);
  console.log(`   Uploads: ${UPLOADS_DIR}`);
  console.log(`   Drive:   ${process.env.DRIVE_FOLDER_ID ? 'configurado' : 'NO configurado'}`);
});
