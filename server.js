import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const ADMIN_PASSWORD = 'Betty2026';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Asegurar directorios
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const dbPath = path.join(dataDir, 'orders.json');
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify([], null, 2));
}

// Multer para subidas locales
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Servir estáticos
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'dist')));

// Helper de base de datos JSON
function readOrders() {
  try {
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Error leyendo base de datos:', e);
    return [];
  }
}

function writeOrders(orders) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(orders, null, 2));
    return true;
  } catch (e) {
    console.error('Error escribiendo base de datos:', e);
    return false;
  }
}

// Middleware de autenticación simple
function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (auth === `Bearer ${ADMIN_PASSWORD}`) {
    next();
  } else {
    res.status(401).json({ error: 'No autorizado. Se requiere contraseña de administrador.' });
  }
}

// --- APIS PÚBLICAS (CLIENTES) ---

// Login del Administrador
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Contraseña incorrecta' });
  }
});

// Subida de archivos (Fotos y Comprobantes)
app.post('/api/upload', upload.fields([
  { name: 'foto', maxCount: 10 },
  { name: 'comprobante', maxCount: 1 }
]), (req, res) => {
  const response = {};
  if (req.files && req.files['foto']) {
    const paths = req.files['foto'].map(file => '/uploads/' + file.filename);
    response.foto = paths.join(', ');
  }
  if (req.files && req.files['comprobante']) {
    response.comprobante = '/uploads/' + req.files['comprobante'][0].filename;
  }
  res.json(response);
});

// Crear un pedido
app.post('/api/orders', (req, res) => {
  const orderData = req.body;
  const orders = readOrders();
  
  // Calcular siguiente número secuencial (_num)
  const maxNum = orders.reduce((max, o) => (o._num > max ? o._num : max), 0);
  const newOrder = {
    ...orderData,
    _num: maxNum + 1,
    fecha: orderData.fecha || new Date().toISOString(),
    seña: orderData.seña || 'No',
    pagoCompleto: orderData.pagoCompleto || 'No'
  };
  
  orders.push(newOrder);
  if (writeOrders(orders)) {
    res.status(201).json(newOrder);
  } else {
    res.status(500).json({ error: 'Error al guardar el pedido en la base de datos' });
  }
});

// --- APIS PROTEGIDAS (ADMINISTRADOR) ---

// Obtener todos los pedidos
app.get('/api/orders', requireAdmin, (req, res) => {
  res.json(readOrders());
});

// Actualizar un pedido individual por su _num
app.put('/api/orders/:num', requireAdmin, (req, res) => {
  const num = parseInt(req.params.num, 10);
  const updatedData = req.body;
  const orders = readOrders();
  
  const index = orders.findIndex(o => o._num === num);
  if (index !== -1) {
    orders[index] = { ...orders[index], ...updatedData };
    if (writeOrders(orders)) {
      res.json(orders[index]);
    } else {
      res.status(500).json({ error: 'Error al actualizar el pedido' });
    }
  } else {
    res.status(404).json({ error: 'Pedido no encontrado' });
  }
});

// Sincronizar todos los pedidos (Excel import / Google Sheets sync)
app.post('/api/orders/sync', requireAdmin, (req, res) => {
  const { orders } = req.body;
  if (!Array.isArray(orders)) {
    return res.status(400).json({ error: 'El cuerpo debe contener un array de pedidos' });
  }
  
  if (writeOrders(orders)) {
    res.json({ success: true, count: orders.length });
  } else {
    res.status(500).json({ error: 'Error al guardar sincronización de pedidos' });
  }
});

// Servir la app Vite por defecto para cualquier otra ruta (Soporte SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📂 Base de datos en: ${dbPath}`);
  console.log(`===================================================`);
});
