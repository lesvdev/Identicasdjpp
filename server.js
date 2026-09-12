/**
 * server.js — Backend de IdentiCASD-JPP
 * Node.js + Express · MongoDB Atlas · Cloudinary
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

function fotoPublic(f) {
  if (!f) return null;
  return {
    id:          f.id,
    name:        f.name || f.nombre,
    grade:       f.grade || f.grado,
    subject:     f.subject || f.asignatura,
    date:        f.date || f.fecha,
    category:    f.category || f.categoria,
    description: f.description || f.descripcion,
    comments:    f.comments || f.comentarios || '',
    status:      f.status,
    image:       f.driveUrl || f.image || `/api/fotos/${f.id}/imagen`,
    driveUrl:    f.driveUrl || f.drive_url || null,
    createdAt:   f.createdAt || f.created_at,
  };
}

const PORT         = process.env.PORT || 3000;
const DATA_DIR     = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.UPLOADS_DIR || './uploads';
const UPLOADS_DIR  = path.resolve(path.join(DATA_DIR, 'fotos'));
const MAX_FILE_MB  = parseInt(process.env.MAX_FILE_MB || '15', 10);
const TEACHER_PASS = process.env.TEACHER_PASSWORD || 'identic@sd2026';

[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com", "https://cdn.tailwindcss.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc:     ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors());
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

const uploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Demasiadas solicitudes. Intenta en una hora.' },
});

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

function teacherAuth(req, res, next) {
  const pwd = req.headers['x-teacher-password'] || req.body?.teacherPassword;
  if (pwd === TEACHER_PASS) return next();
  res.status(401).json({ error: 'Contraseña incorrecta' });
}

// POST /api/fotos
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

    const id = uuid();
    const ext = '.jpg';
    const finalName = `${id}${ext}`;
    const finalPath = path.join(UPLOADS_DIR, finalName);

    await sharp(req.file.path)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(finalPath);

    fs.unlinkSync(req.file.path);

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

    await fotos.insert(foto);

    uploadToDrive({
      filePath:  finalPath,
      nombre:    foto.nombre,
      grado:     foto.grado,
      categoria: foto.categoria,
      fecha:     foto.fecha,
      mimeType:  'image/jpeg',
    }).then(async (driveResult) => {
      if (driveResult) {
        await fotos.update(id, { drive_id: driveResult.driveId, drive_url: driveResult.driveUrl });
        console.log(`[Cloudinary] Vinculado a foto ${id}`);
      }
    });

    const guardada = await fotos.getById(id);
    res.status(201).json({
      ok:      true,
      message: 'Fotografía recibida. El docente la revisará pronto.',
      foto:    fotoPublic(guardada),
    });

  } catch (err) {
    console.error('[POST /api/fotos]', err);
    res.status(500).json({ error: 'Error interno al procesar la fotografía' });
  }
});

// GET /api/fotos (Galería pública)
app.get('/api/fotos', async (req, res) => {
  try {
    const { categoria, grado } = req.query;
    let lista = await fotos.getApproved();
    if (categoria) lista = lista.filter(f => (f.category || f.categoria) === categoria);
    if (grado)     lista = lista.filter(f => (f.grade || f.grado) === grado);
    res.json({ fotos: lista.map(fotoPublic), total: lista.length });
  } catch (err) {
    console.error('[GET /api/fotos]', err);
    res.status(500).json({ error: 'Error al consultar fotos' });
  }
});

// GET /api/fotos/:id/imagen (Redirige a Cloudinary o sirve local)
app.get('/api/fotos/:id/imagen', async (req, res) => {
  try {
    const foto = await fotos.getById(req.params.id);
    if (!foto) return res.status(404).json({ error: 'No encontrada' });
    
    const cloudUrl = foto.driveUrl || foto.drive_url;
    if (cloudUrl) {
      return res.redirect(cloudUrl);
    }

    const file = path.join(UPLOADS_DIR, foto.filename || '');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.sendFile(file);
  } catch (err) {
    console.error('[GET /api/fotos/:id/imagen]', err);
    res.status(500).json({ error: 'Error al obtener imagen' });
  }
});

// Rutas Docente
app.post('/api/docente/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (password === TEACHER_PASS) {
      const pendientes = await fotos.countPending();
      res.json({ ok: true, pendientes });
    } else {
      res.status(401).json({ error: 'Contraseña incorrecta' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Error en login' });
  }
});

app.get('/api/docente/fotos', teacherAuth, async (req, res) => {
  try {
    const [todas, pendientes] = await Promise.all([
      fotos.getAll(),
      fotos.countPending()
    ]);
    res.json({ fotos: todas.map(fotoPublic), pendientes });
  } catch (err) {
    console.error('[GET /api/docente/fotos]', err);
    res.status(500).json({ error: 'Error al consultar panel docente' });
  }
});

app.patch('/api/docente/fotos/:id', teacherAuth, async (req, res) => {
  try {
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
    const updated = await fotos.update(req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'Foto no encontrada' });
    res.json({ ok: true, foto: fotoPublic(updated) });
  } catch (err) {
    console.error('[PATCH /api/docente/fotos]', err);
    res.status(500).json({ error: 'Error al actualizar foto' });
  }
});

app.delete('/api/docente/fotos/:id', teacherAuth, async (req, res) => {
  try {
    const foto = await fotos.getById(req.params.id);
    if (!foto) return res.status(404).json({ error: 'No encontrada' });

    if (foto.filename) {
      const file = path.join(UPLOADS_DIR, foto.filename);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    await fotos.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/docente/fotos]', err);
    res.status(500).json({ error: 'Error al eliminar foto' });
  }
});

app.get('/api/docente/stats', teacherAuth, async (req, res) => {
  try {
    const all = await fotos.getAll();
    const pendientes = await fotos.countPending();
    const byStatus = {};
    const byCat    = {};
    for (const f of all) {
      const st = f.status || 'Pendiente';
      const cat = f.category || f.categoria || 'Sin Categoría';
      byStatus[st] = (byStatus[st] || 0) + 1;
      byCat[cat] = (byCat[cat]  || 0) + 1;
    }
    res.json({ total: all.length, byStatus, byCat, pendientes });
  } catch (err) {
    console.error('[GET /api/docente/stats]', err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

app.get('*', (req, res) => {
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.status(404).send('Frontend no desplegado aún.');
});

app.listen(PORT, () => {
  console.log(`✅ IdentiCASD-JPP corriendo en puerto ${PORT}`);
  console.log(`   Base de datos: MongoDB Atlas`);
  console.log(`   Uploads: ${UPLOADS_DIR}`);
});
