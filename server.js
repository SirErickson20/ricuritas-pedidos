import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Betty2026';

// ── Middleware ─────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Cloudinary ─────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const cloudStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'ricuritas',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
  },
});
const upload = multer({ storage: cloudStorage });

// ── MongoDB (singleton lazy) ───────────────────────────────
let mongoClient = null;

async function getCollection() {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await mongoClient.connect();
  }
  return mongoClient.db('ricuritas').collection('orders');
}

// ── Auth middleware ────────────────────────────────────────
function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (auth === `Bearer ${ADMIN_PASSWORD}`) return next();
  res.status(401).json({ error: 'No autorizado. Se requiere contraseña de administrador.' });
}

// ── Archivos estáticos ─────────────────────────────────────
app.use(express.static(path.join(__dirname, 'dist')));

// ══════════════════════════════════════════════════════════
//  APIs PÚBLICAS (clientes)
// ══════════════════════════════════════════════════════════

// Login administrador
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Contraseña incorrecta' });
  }
});

// Subida de fotos/comprobantes → Cloudinary
app.post('/api/upload', upload.fields([
  { name: 'foto', maxCount: 10 },
  { name: 'comprobante', maxCount: 1 },
]), (req, res) => {
  try {
    const response = {};
    if (req.files?.['foto']) {
      const urls = req.files['foto'].map(f => f.path);
      response.foto = urls.join(', ');
    }
    if (req.files?.['comprobante']) {
      response.comprobante = req.files['comprobante'][0].path;
    }
    res.json(response);
  } catch (e) {
    console.error('Error upload:', e);
    res.status(500).json({ error: 'Error al subir archivos: ' + e.message });
  }
});

// Crear pedido
app.post('/api/orders', async (req, res) => {
  try {
    const orderData = req.body;
    const col = await getCollection();

    const last = await col.find({}, { projection: { _num: 1 } })
      .sort({ _num: -1 }).limit(1).toArray();
    const maxNum = last.length > 0 ? (last[0]._num || 0) : 0;

    const newOrder = {
      ...orderData,
      _num: maxNum + 1,
      fecha: orderData.fecha || new Date().toISOString(),
      seña: orderData.seña || 'No',
      pagoCompleto: orderData.pagoCompleto || 'No',
    };

    await col.insertOne(newOrder);
    res.status(201).json(newOrder);
  } catch (e) {
    console.error('Error crear pedido:', e);
    res.status(500).json({ error: 'Error al guardar el pedido: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════
//  APIs PROTEGIDAS (administrador)
// ══════════════════════════════════════════════════════════

// Obtener todos los pedidos
app.get('/api/orders', requireAdmin, async (req, res) => {
  try {
    const col = await getCollection();
    const orders = await col.find({}).sort({ _num: 1 }).toArray();
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: 'Error al leer pedidos: ' + e.message });
  }
});

// Actualizar pedido por _num
app.put('/api/orders/:num', requireAdmin, async (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    const updatedData = { ...req.body };
    delete updatedData._id;

    const col = await getCollection();
    const result = await col.findOneAndUpdate(
      { _num: num },
      { $set: updatedData },
      { returnDocument: 'after' }
    );

    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'Pedido no encontrado' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar: ' + e.message });
  }
});

// Eliminar pedido por _num
app.delete('/api/orders/:num', requireAdmin, async (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    const col = await getCollection();
    const result = await col.deleteOne({ _num: num });

    if (result.deletedCount > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Pedido no encontrado' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar: ' + e.message });
  }
});

// Sync manual (por si se necesita)
app.post('/api/orders/sync', requireAdmin, async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'El cuerpo debe contener un array de pedidos' });
    }
    const col = await getCollection();
    await col.deleteMany({});
    if (orders.length > 0) await col.insertMany(orders);
    res.json({ success: true, count: orders.length });
  } catch (e) {
    res.status(500).json({ error: 'Error en sync: ' + e.message });
  }
});

// ── SPA fallback ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ── Iniciar servidor (solo local, no en Vercel) ────────────
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`📦 MongoDB Atlas conectado`);
    console.log(`🖼️  Cloudinary configurado`);
    console.log(`===================================================`);
  });
}

export default app;
