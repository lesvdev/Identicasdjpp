/**
 * drive.js — Integración con Google Drive vía cuenta de servicio
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const FOLDER_ID   = process.env.DRIVE_FOLDER_ID;
const SA_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

let auth = null;

function getAuth() {
  if (auth) return auth;
  if (!SA_KEY_PATH || !fs.existsSync(SA_KEY_PATH)) {
    console.warn('[Drive] Cuenta de servicio no configurada — subidas a Drive desactivadas.');
    return null;
  }
  const key = JSON.parse(fs.readFileSync(SA_KEY_PATH, 'utf8'));
  auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return auth;
}

/**
 * Sube un archivo al Drive y devuelve { driveId, driveUrl }.
 * El archivo se nombra: NombreEstudiante_Grado_Categoria_Fecha.ext
 *
 * @param {object} opts
 * @param {string} opts.filePath   - ruta local del archivo
 * @param {string} opts.nombre     - nombre del estudiante
 * @param {string} opts.grado      - grado del estudiante
 * @param {string} opts.categoria  - categoría de la foto
 * @param {string} opts.fecha      - fecha (YYYY-MM-DD)
 * @param {string} opts.mimeType   - p.ej. 'image/jpeg'
 */
async function uploadToDrive({ filePath, nombre, grado, categoria, fecha, mimeType }) {
  const authClient = getAuth();
  if (!authClient || !FOLDER_ID) return null;

  const drive = google.drive({ version: 'v3', auth: authClient });

  // Nombre limpio: sin caracteres problemáticos, espacios → guión bajo
  const clean = str => (str || '').replace(/[^a-zA-Z0-9À-ɏ\-]/g, '_').replace(/_+/g, '_');
  const ext   = path.extname(filePath) || '.jpg';
  const driveName = `${clean(nombre)}_${clean(grado)}_${clean(categoria)}_${clean(fecha)}${ext}`;

  try {
    const res = await drive.files.create({
      requestBody: {
        name:    driveName,
        parents: [FOLDER_ID],
      },
      media: {
        mimeType,
        body: fs.createReadStream(filePath),
      },
      fields: 'id, webViewLink',
    });

    console.log(`[Drive] Subido: ${driveName} (id: ${res.data.id})`);
    return {
      driveId:  res.data.id,
      driveUrl: res.data.webViewLink,
    };
  } catch (err) {
    console.error('[Drive] Error al subir:', err.message);
    return null;
  }
}

module.exports = { uploadToDrive };
