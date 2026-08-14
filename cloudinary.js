/**
 * cloudinary.js — Integración con Cloudinary para almacenamiento de fotos
 */
const cloudinary = require('cloudinary').v2;

// Configurar con variables de entorno
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Sube un archivo a Cloudinary y devuelve { driveId, driveUrl }.
 * El archivo se nombra: NombreEstudiante_Grado_Categoria_Fecha
 *
 * @param {object} opts
 * @param {string} opts.filePath   - ruta local del archivo
 * @param {string} opts.nombre     - nombre del estudiante
 * @param {string} opts.grado      - grado del estudiante
 * @param {string} opts.categoria  - categoría de la foto
 * @param {string} opts.fecha      - fecha (YYYY-MM-DD)
 */
async function uploadToDrive({ filePath, nombre, grado, categoria, fecha }) {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.warn('[Cloudinary] Credenciales no configuradas — subida desactivada.');
    return null;
  }

  // Nombre limpio para public_id (sin caracteres problemáticos)
  const clean = str => (str || '').replace(/[^a-zA-Z0-9À-ɏ\-]/g, '_').replace(/_+/g, '_');
  const publicId = `identicasd/${clean(nombre)}_${clean(grado)}_${clean(categoria)}_${clean(fecha)}`;

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      public_id:      publicId,
      overwrite:      false,
      resource_type:  'image',
      folder:         'identicasd',
      // Transformación: máx 2000px, calidad auto
      transformation: [{ width: 2000, height: 2000, crop: 'limit', quality: 'auto' }],
    });

    console.log(`[Cloudinary] Subido: ${publicId}`);
    return {
      driveId:  result.public_id,
      driveUrl: result.secure_url,
    };
  } catch (err) {
    console.error('[Cloudinary] Error al subir:', err.message);
    return null;
  }
}

module.exports = { uploadToDrive };
