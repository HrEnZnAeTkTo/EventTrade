// server.js - Enhanced version with message replies, deletion and tents CRUD
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

// Database initialization with enhanced messages table
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
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Enhanced tents table with more fields
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tents (
        id SERIAL PRIMARY KEY,
        tent_number VARCHAR(20) UNIQUE NOT NULL,
        qr_code TEXT,
        location_description TEXT,
        zone VARCHAR(50),
        capacity INTEGER DEFAULT 4,
        contact_name VARCHAR(100),
        contact_phone VARCHAR(20),
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // Order items table
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

    // Enhanced messages table with reply support and deletion tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id),
        receiver_id INTEGER REFERENCES users(id),
        reply_to_id INTEGER REFERENCES messages(id),
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        is_deleted BOOLEAN DEFAULT FALSE,
        deleted_by INTEGER REFERENCES users(id),
        deleted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check and add new columns to existing messages table
    const checkReplyColumn = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'messages' AND column_name = 'reply_to_id'
    `);
    
    if (checkReplyColumn.rows.length === 0) {
      await pool.query('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)');
      await pool.query('ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE');
      await pool.query('ALTER TABLE messages ADD COLUMN deleted_by INTEGER REFERENCES users(id)');
      await pool.query('ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMP');
      console.log('Enhanced messages table with reply and deletion support');
    }

    // Check and add new columns to existing tents table
    const checkTentColumns = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'tents' AND column_name IN ('zone', 'capacity', 'contact_name', 'contact_phone', 'notes', 'is_active', 'updated_at')
    `);
    
    if (checkTentColumns.rows.length < 7) {
      await pool.query(`
        ALTER TABLE tents 
        ADD COLUMN IF NOT EXISTS zone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 4,
        ADD COLUMN IF NOT EXISTS contact_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20),
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      `);
      console.log('Enhanced tents table with additional fields');
    }

    // Inventory requests table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_requests (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER REFERENCES users(id),
        product_id INTEGER REFERENCES products(id),
        requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
        approved_quantity INTEGER,
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create trigger for updating updated_at in tents
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS update_tents_updated_at ON tents;
      CREATE TRIGGER update_tents_updated_at BEFORE UPDATE ON tents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    console.log('Database initialized successfully');
    
    // Insert default users
    const adminExists = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        ['admin', 'admin@festival.com', hashedPassword, 'admin']
      );
      console.log('Default admin user created (username: admin, password: admin123)');
      
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
        INSERT INTO products (name, description, price, stock_quantity, is_active) VALUES 
        ('Neko-Active', 'Активные салфетки-души для быстрого освежения', 500.00, 1000, true),
        ('Neko-Clinic', 'Клинические салфетки-души с антибактериальным эффектом', 2000.00, 500, true),
        ('Neko-Grill', 'Салфетки-души для очистки после приготовления на гриле', 600.00, 800, true)
      `);
      console.log('Sample products added');
    }

    // Insert sample tents
    const tentsExist = await pool.query('SELECT id FROM tents LIMIT 1');
    if (tentsExist.rows.length === 0) {
      await pool.query(`
        INSERT INTO tents (tent_number, location_description, zone, capacity) VALUES 
        ('A-01', 'Первый ряд, левая сторона', 'Зона A', 4),
        ('A-02', 'Первый ряд, центр', 'Зона A', 6),
        ('B-01', 'VIP зона, у главной сцены', 'VIP', 2),
        ('C-01', 'Семейная зона, рядом с детской площадкой', 'Семейная', 8)
      `);
      console.log('Sample tents added');
    }

  } catch (err) {
    console.error('Database initialization error:', err);
  }
};

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

// Products routes (unchanged from original)
app.get('/api/products', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    let showInactive = false;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        showInactive = decoded.role === 'admin' || decoded.role === 'operator';
      } catch (err) {
        // Invalid token, show only active
      }
    }
    
    let query = 'SELECT * FROM products';
    if (!showInactive) {
      query += ' WHERE is_active = true AND stock_quantity > 0';
    }
    query += ' ORDER BY name';
    
    const result = await pool.query(query);
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

app.patch('/api/products/:id/stock', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    const { operation, amount, newValue } = req.body;
    
    let query, params;
    
    if (operation === 'set') {
      query = 'UPDATE products SET stock_quantity = $1 WHERE id = $2 RETURNING *';
      params = [Math.max(0, newValue), id];
    } else if (operation === 'add') {
      query = 'UPDATE products SET stock_quantity = GREATEST(0, stock_quantity + $1) WHERE id = $2 RETURNING *';
      params = [amount, id];
    } else if (operation === 'subtract') {
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

app.patch('/api/products/:id/toggle', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    
    const result = await pool.query(
      'UPDATE products SET is_active = NOT is_active WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    const product = result.rows[0];
    const status = product.is_active ? 'активирован' : 'скрыт';
    
    res.json({ 
      message: `Товар ${status}`, 
      product: product 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

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

// Enhanced Tents routes with full CRUD
app.get('/api/tents', authenticateToken, async (req, res) => {
  try {
    let query = 'SELECT * FROM tents';
    
    // For non-admin users, show only active tents
    if (req.user.role === 'courier') {
      query += ' WHERE is_active = true';
    }
    
    query += ' ORDER BY tent_number';
    
    const result = await pool.query(query);
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

    const { 
      tent_number, 
      location_description, 
      zone, 
      capacity, 
      contact_name, 
      contact_phone, 
      notes 
    } = req.body;
    
    // Generate QR code
    const qr_code = await QRCode.toDataURL(tent_number);
    
    const result = await pool.query(
      `INSERT INTO tents (tent_number, qr_code, location_description, zone, capacity, contact_name, contact_phone, notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tent_number, qr_code, location_description, zone, capacity || 4, contact_name, contact_phone, notes]
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

app.put('/api/tents/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    const { 
      tent_number, 
      location_description, 
      zone, 
      capacity, 
      contact_name, 
      contact_phone, 
      notes 
    } = req.body;
    
    // Regenerate QR code if tent number changed
    let qr_code = null;
    if (tent_number) {
      qr_code = await QRCode.toDataURL(tent_number);
    }
    
    const result = await pool.query(
      `UPDATE tents SET 
       tent_number = COALESCE($1, tent_number),
       qr_code = COALESCE($2, qr_code),
       location_description = COALESCE($3, location_description),
       zone = COALESCE($4, zone),
       capacity = COALESCE($5, capacity),
       contact_name = COALESCE($6, contact_name),
       contact_phone = COALESCE($7, contact_phone),
       notes = COALESCE($8, notes)
       WHERE id = $9 RETURNING *`,
      [tent_number, qr_code, location_description, zone, capacity, contact_name, contact_phone, notes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Палатка не найдена' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Палатка с таким номером уже существует' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
});

app.patch('/api/tents/:id/toggle', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    
    const result = await pool.query(
      'UPDATE tents SET is_active = NOT is_active WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Палатка не найдена' });
    }

    const tent = result.rows[0];
    const status = tent.is_active ? 'активирована' : 'скрыта';
    
    res.json({ 
      message: `Палатка ${status}`, 
      tent: tent 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/tents/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    
    // Check if tent has orders
    const ordersCheck = await pool.query('SELECT COUNT(*) as count FROM orders WHERE tent_id = $1', [id]);
    
    if (parseInt(ordersCheck.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Невозможно удалить палатку с существующими заказами. Сначала скройте её.' 
      });
    }
    
    const result = await pool.query('DELETE FROM tents WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Палатка не найдена' });
    }

    res.json({ message: 'Палатка удалена', tent: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Orders routes (unchanged from original)
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
      query += ` WHERE o.courier_id IS NULL OR o.courier_id = $1`;
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
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { tent_number, items, payment_method } = req.body;
    
    const tentResult = await client.query('SELECT id FROM tents WHERE tent_number = $1 AND is_active = true', [tent_number]);
    
    if (tentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Палатка не найдена или неактивна' });
    }

    const tent_id = tentResult.rows[0].id;
    
    let total_amount = 0;
    const stockErrors = [];
    
    for (const item of items) {
      const productResult = await client.query(
        'SELECT id, name, price, stock_quantity FROM products WHERE id = $1 AND is_active = true', 
        [item.product_id]
      );
      
      if (productResult.rows.length === 0) {
        stockErrors.push(`Товар с ID ${item.product_id} не найден или неактивен`);
        continue;
      }
      
      const product = productResult.rows[0];
      
      if (product.stock_quantity < item.quantity) {
        stockErrors.push(`Недостаточно товара "${product.name}". В наличии: ${product.stock_quantity}, запрошено: ${item.quantity}`);
        continue;
      }
      
      total_amount += product.price * item.quantity;
    }
    
    if (stockErrors.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: stockErrors.join('\n') });
    }

    const orderResult = await client.query(
      'INSERT INTO orders (tent_id, total_amount, payment_method) VALUES ($1, $2, $3) RETURNING *',
      [tent_id, total_amount, payment_method]
    );

    const order = orderResult.rows[0];

    for (const item of items) {
      const productResult = await client.query('SELECT price FROM products WHERE id = $1', [item.product_id]);
      if (productResult.rows.length > 0) {
        await client.query(
          'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
          [order.id, item.product_id, item.quantity, productResult.rows[0].price]
        );
        
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    await client.query('COMMIT');

    res.status(201).json({ 
      ...order, 
      payment_url: '/api/payment/' + order.id 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Order creation error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
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

// Enhanced Messages routes with replies and deletion
app.get('/api/messages', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, 
             s.username as sender_name, 
             r.username as receiver_name,
             rm.message as reply_to_message,
             rs.username as reply_to_sender
      FROM messages m
      JOIN users s ON m.sender_id = s.id
      LEFT JOIN users r ON m.receiver_id = r.id
      LEFT JOIN messages rm ON m.reply_to_id = rm.id
      LEFT JOIN users rs ON rm.sender_id = rs.id
      WHERE (m.sender_id = $1 OR m.receiver_id = $1 OR m.receiver_id IS NULL)
        AND m.is_deleted = false
      ORDER BY m.created_at ASC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { message, receiver_id, reply_to_id } = req.body;
    
    let targetReceiverId = receiver_id;
    
    if ((req.user.role === 'admin' || req.user.role === 'operator') && !receiver_id) {
      targetReceiverId = null;
    }
    
    const result = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, reply_to_id, message) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, targetReceiverId, reply_to_id, message]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user can delete this message
    const messageResult = await pool.query('SELECT * FROM messages WHERE id = $1', [id]);
    
    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }
    
    const message = messageResult.rows[0];
    
    // Couriers can only delete their own messages
    // Admins/operators can delete any message
    const canDelete = (req.user.role === 'admin' || req.user.role === 'operator') || 
                     (message.sender_id === req.user.id);
    
    if (!canDelete) {
      return res.status(403).json({ error: 'Недостаточно прав для удаления этого сообщения' });
    }
    
    // Soft delete - mark as deleted instead of actually deleting
    const result = await pool.query(
      'UPDATE messages SET is_deleted = true, deleted_by = $1, deleted_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [req.user.id, id]
    );

    res.json({ message: 'Сообщение удалено', deleted_message: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Inventory requests routes (unchanged from original)
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

app.patch('/api/inventory-requests/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'operator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const { id } = req.params;
    const { approved_quantity } = req.body;

    const requestResult = await pool.query(
      'SELECT * FROM inventory_requests WHERE id = $1 AND status = $2',
      [id, 'pending']
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Запрос не найден или уже обработан' });
    }

    const request = requestResult.rows[0];
    const quantityToAdd = approved_quantity || request.requested_quantity;

    await pool.query(
      'UPDATE inventory_requests SET status = $1, approved_quantity = $2 WHERE id = $3',
      ['approved', quantityToAdd, id]
    );

    await pool.query(
      'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
      [quantityToAdd, request.product_id]
    );

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

// Payment simulation endpoints (unchanged)
app.get('/api/payment/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
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
    console.log(`✅ Enhanced server running on port ${PORT}`);
    console.log(`📋 New features: Message replies, deletion, and full tents CRUD`);
  });
});

module.exports = app;