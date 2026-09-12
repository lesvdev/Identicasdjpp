/**
 * db.js — Capa de base de datos MongoDB Atlas para IdentiCASD-JPP
 */
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || "mongodb+srv://luissuarezv_db_user:4IIFJJAmQHAJHmhT@cluster0.kzxbqw0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

let client = null;
let db = null;

async function getCollection() {
  if (!db) {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db('identicasd');
    console.log('✅ Conectado exitosamente a MongoDB Atlas');
  }
  return db.collection('fotos');
}

const fotos = {
  /** Insertar una foto nueva */
  async insert(foto) {
    const col = await getCollection();
    const doc = {
      id: foto.id,
      name: foto.nombre,
      grade: foto.grado,
      subject: foto.asignatura,
      date: foto.fecha,
      category: foto.categoria,
      description: foto.descripcion || '',
      comments: foto.comentarios || '',
      status: foto.status || 'Pendiente',
      filename: foto.filename,
      driveUrl: foto.drive_url || null,
      image: foto.drive_url || `/api/fotos/${foto.id}/imagen`,
      createdAt: new Date().toISOString()
    };
    await col.insertOne(doc);
    return doc;
  },

  /** Obtener todas las fotos (panel docente) */
  async getAll() {
    const col = await getCollection();
    return await col.find({}).sort({ createdAt: -1 }).toArray();
  },

  /** Obtener solo las aprobadas (galería pública) */
  async getApproved() {
    const col = await getCollection();
    return await col.find({ status: 'Aprobada' }).sort({ createdAt: -1 }).toArray();
  },

  /** Buscar por ID */
  async getById(id) {
    const col = await getCollection();
    return await col.findOne({ id: String(id) });
  },

  /** Actualizar estado, comentarios y/o datos editados */
  async update(id, fields) {
    const col = await getCollection();
    const updateData = {};
    if (fields.status !== undefined) updateData.status = fields.status;
    if (fields.comentarios !== undefined) updateData.comments = fields.comentarios;
    if (fields.comments !== undefined) updateData.comments = fields.comments;
    if (fields.drive_url !== undefined) {
      updateData.driveUrl = fields.drive_url;
      updateData.image = fields.drive_url;
    }
    if (fields.nombre !== undefined) updateData.name = fields.nombre;
    if (fields.grado !== undefined) updateData.grade = fields.grado;
    if (fields.asignatura !== undefined) updateData.subject = fields.asignatura;
    if (fields.categoria !== undefined) updateData.category = fields.categoria;
    if (fields.descripcion !== undefined) updateData.description = fields.descripcion;

    await col.updateOne({ id: String(id) }, { $set: updateData });
    return await col.findOne({ id: String(id) });
  },

  /** Eliminar */
  async delete(id) {
    const col = await getCollection();
    return await col.deleteOne({ id: String(id) });
  },

  /** Contar fotos pendientes */
  async countPending() {
    const col = await getCollection();
    return await col.countDocuments({ status: 'Pendiente' });
  },
};

module.exports = { fotos };
