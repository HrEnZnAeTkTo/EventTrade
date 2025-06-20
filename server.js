// server.js
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'festival_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'festival_delivery',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Database initialization
const initDatabase = async () => {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'courier',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        stock_quantity INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tents (
        id SERIAL PRIMARY KEY,
        tent_number VARCHAR(20) UNIQUE NOT NULL,
        qr_code TEXT,
        location_description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        tent_id INTEGER REFERENCES tents(id),
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'new',
        payment_status VARCHAR(20) DEFAULT 'pending',
        payment_method VARCHAR(20),
        courier_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Order items table - ИСПРАВЛЕНО!
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id),
        receiver_id INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Inventory requests table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_requests (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER REFERENCES users(id),
        product_id INTEGER REFERENCES products(id),
        requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database initialized successfully');
    
    // Insert default admin user
    const adminExists = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        ['admin', 'admin@festival.com', hashedPassword, 'admin']
      );
      console.log('Default admin user created (username: admin, password: admin123)');
      
      // Create courier user
      await pool.query(
        'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        ['courier1', 'courier1@festival.com', hashedPassword, 'courier']
      );
      console.log('Default courier user created (username: courier1, password: admin123)');
    }

    // Insert sample products
    const productsExist = await pool.query('SELECT id FROM products LIMIT 1');
    if (productsExist.rows.length === 0) {
      await pool.query(`
        INSERT INTO products (name, description, price, stock_quantity) VALUES 
        ('Neko-Active', 'Активные салфетки-души для быстрого освежения', 500.00, 1000),
        ('Neko-Clinic', 'Клинические салфетки-души с антибактериальным эффектом', 2000.00, 500),
        ('Neko-Grill', 'Салфетки-души для очистки после приготовления на гриле', 600.00, 800)
      `);
      console.log('Sample products added');
    }

    // Insert sample tents
    const tentsExist = await pool.query('SELECT id FROM tents LIMIT 1');
    if (tentsExist.rows.length === 0) {
      await pool.query(`
        INSERT INTO tents (tent_number, location_description) VALUES 
        ('A-01', 'Первый ряд, левая сторона'),
        ('A-02', 'Первый ряд, центр'),
        ('B-01', 'VIP зона, у главной сцены'),
        ('C-01', 'Семейная зона, рядом с детской площадкой')
      `);
      console.log('Sample tents added');
    }

  } catch (err) {
    console.error('Database initialization error:', err);
  }
};

// Routes

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Неверные учетные данные' });
    }

    const user = userResult.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверные учетные данные' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, role = 'courier' } = req.body;
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const userResult = await pool.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
      [username, email, hashedPassword, role]
    );

    const user = userResult.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user
    });
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Пользователь уже существует' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
});

// Products routes
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { name, description, price, stock_quantity } = req.body;
    
    const result = await pool.query(
      'INSERT INTO products (name, description, price, stock_quantity) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, price, stock_quantity]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    const { name, description, price, stock_quantity } = req.body;
    
    const result = await pool.query(
      'UPDATE products SET name = $1, description = $2, price = $3, stock_quantity = $4 WHERE id = $5 RETURNING *',
      [name, description, price, Math.max(0, stock_quantity), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Новый endpoint для обновления только количества товара
app.patch('/api/products/:id/stock', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    const { operation, amount, newValue } = req.body;
    
    let query, params;
    
    if (operation === 'set') {
      // Установить конкретное значение
      query = 'UPDATE products SET stock_quantity = $1 WHERE id = $2 RETURNING *';
      params = [Math.max(0, newValue), id];
    } else if (operation === 'add') {
      // Прибавить к текущему значению
      query = 'UPDATE products SET stock_quantity = GREATEST(0, stock_quantity + $1) WHERE id = $2 RETURNING *';
      params = [amount, id];
    } else if (operation === 'subtract') {
      // Вычесть из текущего значения (не меньше 0)
      query = 'UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - $1) WHERE id = $2 RETURNING *';
      params = [amount, id];
    } else {
      return res.status(400).json({ error: 'Неверная операция. Используйте: set, add, subtract' });
    }
    
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удаление товара
app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    res.json({ message: 'Товар удален', product: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Tents routes
app.get('/api/tents', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tents ORDER BY tent_number');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/tents', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { tent_number, location_description } = req.body;
    
    // Generate QR code
    const qr_code = await QRCode.toDataURL(tent_number);
    
    const result = await pool.query(
      'INSERT INTO tents (tent_number, qr_code, location_description) VALUES ($1, $2, $3) RETURNING *',
      [tent_number, qr_code, location_description]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Палатка с таким номером уже существует' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
});

// Orders routes - ИСПРАВЛЕНО!
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT o.*, t.tent_number, u.username as courier_name,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', oi.id, 
                   'product_id', oi.product_id,
                   'product_name', p.name,
                   'quantity', oi.quantity,
                   'price', oi.unit_price
                 )
               ) FILTER (WHERE oi.id IS NOT NULL), 
               '[]'::json
             ) as items
      FROM orders o
      LEFT JOIN tents t ON o.tent_id = t.id
      LEFT JOIN users u ON o.courier_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.id
    `;

    if (req.user.role === 'courier') {
      query += ' WHERE o.courier_id = $1';
    }

    query += ' GROUP BY o.id, t.tent_number, u.username ORDER BY o.created_at DESC';

    const result = req.user.role === 'courier' 
      ? await pool.query(query, [req.user.id])
      : await pool.query(query);

    res.json(result.rows);
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { tent_number, items, payment_method } = req.body;
    
    // Find tent
    const tentResult = await pool.query('SELECT id FROM tents WHERE tent_number = $1', [tent_number]);
    
    if (tentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Палатка не найдена' });
    }

    const tent_id = tentResult.rows[0].id;
    
    // Calculate total
    let total_amount = 0;
    for (const item of items) {
      const productResult = await pool.query('SELECT price FROM products WHERE id = $1', [item.product_id]);
      if (productResult.rows.length > 0) {
        total_amount += productResult.rows[0].price * item.quantity;
      }
    }

    // Create order
    const orderResult = await pool.query(
      'INSERT INTO orders (tent_id, total_amount, payment_method) VALUES ($1, $2, $3) RETURNING *',
      [tent_id, total_amount, payment_method]
    );

    const order = orderResult.rows[0];

    // Add order items - ИСПРАВЛЕНО!
    for (const item of items) {
      const productResult = await pool.query('SELECT price FROM products WHERE id = $1', [item.product_id]);
      if (productResult.rows.length > 0) {
        await pool.query(
          'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
          [order.id, item.product_id, item.quantity, productResult.rows[0].price]
        );
        
        // Update stock
        await pool.query(
          'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    res.status(201).json({ ...order, payment_url: '/api/payment/' + order.id });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    let query = 'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
    let params = [status, id];

    if (req.user.role === 'courier' && status === 'in_delivery') {
      query = 'UPDATE orders SET status = $1, courier_id = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
      params = [status, id, req.user.id];
    }

    const result = await pool.query(query + ' RETURNING *', params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Messages routes
app.get('/api/messages', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, 
             s.username as sender_name, 
             r.username as receiver_name
      FROM messages m
      JOIN users s ON m.sender_id = s.id
      LEFT JOIN users r ON m.receiver_id = r.id
      WHERE m.sender_id = $1 OR m.receiver_id = $1 OR m.receiver_id IS NULL
      ORDER BY m.created_at DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { message, receiver_id } = req.body;
    
    const result = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, receiver_id, message]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Inventory requests routes
app.post('/api/inventory-requests', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'courier' && req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав для запроса пополнения' });
    }

    const { product_id, requested_quantity } = req.body;
    
    const result = await pool.query(
      'INSERT INTO inventory_requests (courier_id, product_id, requested_quantity) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, product_id, requested_quantity]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/inventory-requests', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'courier') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const result = await pool.query(`
      SELECT ir.*, u.username as courier_name, p.name as product_name
      FROM inventory_requests ir
      JOIN users u ON ir.courier_id = u.id
      JOIN products p ON ir.product_id = p.id
      ORDER BY ir.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Новый endpoint для одобрения запроса пополнения
app.patch('/api/inventory-requests/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    const { approved_quantity } = req.body;

    // Получаем информацию о запросе
    const requestResult = await pool.query(
      'SELECT * FROM inventory_requests WHERE id = $1 AND status = $2',
      [id, 'pending']
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Запрос не найден или уже обработан' });
    }

    const request = requestResult.rows[0];
    const quantityToAdd = approved_quantity || request.requested_quantity;

    // Обновляем статус запроса
    await pool.query(
      'UPDATE inventory_requests SET status = $1, approved_quantity = $2 WHERE id = $3',
      ['approved', quantityToAdd, id]
    );

    // Добавляем товар на склад
    await pool.query(
      'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
      [quantityToAdd, request.product_id]
    );

    // Получаем обновленную информацию
    const updatedRequest = await pool.query(`
      SELECT ir.*, u.username as courier_name, p.name as product_name
      FROM inventory_requests ir
      JOIN users u ON ir.courier_id = u.id
      JOIN products p ON ir.product_id = p.id
      WHERE ir.id = $1
    `, [id]);

    res.json({ 
      message: 'Запрос одобрен и товар добавлен на склад',
      request: updatedRequest.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Отклонение запроса пополнения
app.patch('/api/inventory-requests/:id/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    const { reason } = req.body;

    const result = await pool.query(
      'UPDATE inventory_requests SET status = $1, notes = $2 WHERE id = $3 AND status = $4 RETURNING *',
      ['rejected', reason || 'Запрос отклонен', id, 'pending']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Запрос не найден или уже обработан' });
    }

    res.json({ 
      message: 'Запрос отклонен',
      request: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Payment simulation endpoint
app.get('/api/payment/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
  // Simulate payment page
  res.send(`
    <html>
      <head><title>Оплата заказа #${orderId}</title></head>
      <body>
        <h1>Оплата заказа #${orderId}</h1>
        <p>Симуляция оплаты через СБП</p>
        <button onclick="window.location.href='/api/payment/${orderId}/success'">
          Оплатить
        </button>
      </body>
    </html>
  `);
});

app.get('/api/payment/:orderId/success', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    await pool.query(
      'UPDATE orders SET payment_status = $1 WHERE id = $2',
      ['paid', orderId]
    );

    res.send(`
      <html>
        <head><title>Оплата успешна</title></head>
        <body>
          <h1>Оплата успешна!</h1>
          <p>Заказ #${orderId} оплачен. Ожидайте доставку.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при обработке платежа');
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

module.exports = app;