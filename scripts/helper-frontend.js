/**
 * helper-frontend.js
 * Parchea el build_app.py existente para que el frontend
 * use la API REST del backend en vez de estado local.
 *
 * Este archivo documenta los cambios necesarios en el HTML.
 * Se aplican automáticamente al correr: node patch-frontend.js
 */

// Los cambios principales en el frontend son:
//
// 1. API_BASE apunta al servidor (vacío = mismo origen, funciona en producción)
//    const API_BASE = '';
//
// 2. handleSubmit en App ahora llama POST /api/fotos con FormData
//
// 3. GalleryPage carga desde GET /api/fotos
//
// 4. TeacherPage carga desde GET /api/docente/fotos (con password en header)
//
// 5. Las actualizaciones usan PATCH /api/docente/fotos/:id

console.log('Ver patch-frontend.js para detalles de integración API.');
