-- init.sql
-- Инициализация базы данных для Festival Delivery System

-- Создание расширений
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Создание enum типов для лучшей типизации
CREATE TYPE user_role AS ENUM ('admin', 'operator', 'courier');
CREATE TYPE order_status AS ENUM ('new', 'in_delivery', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE payment_method AS ENUM ('sbp', 'card', 'cash');
CREATE TYPE message_type AS ENUM ('text', 'system', 'notification');
CREATE TYPE inventory_request_status AS ENUM ('pending', 'approved', 'rejected', 'fulfilled');

-- Таблица пользователей
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'courier',
    full_name VARCHAR(100),
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для пользователей
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active);

-- Таблица категорий товаров
CREATE TABLE product_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица товаров
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES product_categories(id),
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    cost_price DECIMAL(10,2) CHECK (cost_price >= 0),
    stock_quantity INTEGER DEFAULT 0 CHECK (stock_quantity >= 0),
    min_stock_level INTEGER DEFAULT 10,
    max_stock_level INTEGER DEFAULT 1000,
    unit VARCHAR(20) DEFAULT 'шт',
    weight DECIMAL(8,2),
    sku VARCHAR(50) UNIQUE,
    barcode VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для товаров
CREATE INDEX idx_products_name ON products USING gin(name gin_trgm_ops);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_products_stock ON products(stock_quantity);
CREATE INDEX idx_products_sku ON products(sku);

-- Таблица зон фестиваля
CREATE TABLE festival_zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    coordinates POINT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица палаток
CREATE TABLE tents (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    tent_number VARCHAR(20) UNIQUE NOT NULL,
    zone_id INTEGER REFERENCES festival_zones(id),
    qr_code TEXT,
    location_description TEXT,
    coordinates POINT,
    capacity INTEGER,
    contact_phone VARCHAR(20),
    contact_name VARCHAR(100),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для палаток
CREATE INDEX idx_tents_number ON tents(tent_number);
CREATE INDEX idx_tents_zone ON tents(zone_id);
CREATE INDEX idx_tents_active ON tents(is_active);

-- Таблица заказов
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    order_number VARCHAR(20) UNIQUE,
    tent_id INTEGER REFERENCES tents(id),
    customer_name VARCHAR(100),
    customer_phone VARCHAR(20),
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
    delivery_fee DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    status order_status DEFAULT 'new',
    payment_status payment_status DEFAULT 'pending',
    payment_method payment_method,
    payment_transaction_id VARCHAR(100),
    courier_id INTEGER REFERENCES users(id),
    operator_id INTEGER REFERENCES users(id),
    priority INTEGER DEFAULT 0,
    estimated_delivery_time TIMESTAMP,
    actual_delivery_time TIMESTAMP,
    delivery_notes TEXT,
    customer_rating INTEGER CHECK (customer_rating >= 1 AND customer_rating <= 5),
    customer_feedback TEXT,
    internal_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для заказов
CREATE INDEX idx_orders_number ON orders(order_number);
CREATE INDEX idx_orders_tent ON orders(tent_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_courier ON orders(courier_id);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_priority ON orders(priority DESC);

-- Таблица позиций заказа
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для позиций заказа
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- Таблица истории статусов заказов
CREATE TABLE order_status_history (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    previous_status order_status,
    new_status order_status NOT NULL,
    changed_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индекс для истории статусов
CREATE INDEX idx_order_status_history_order ON order_status_history(order_id);
CREATE INDEX idx_order_status_history_created ON order_status_history(created_at);

-- Таблица сообщений
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    sender_id INTEGER REFERENCES users(id),
    receiver_id INTEGER REFERENCES users(id),
    order_id INTEGER REFERENCES orders(id),
    message_type message_type DEFAULT 'text',
    subject VARCHAR(200),
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    is_important BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для сообщений
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_receiver ON messages(receiver_id);
CREATE INDEX idx_messages_order ON messages(order_id);
CREATE INDEX idx_messages_read ON messages(is_read);
CREATE INDEX idx_messages_created ON messages(created_at);

-- Таблица запросов пополнения
CREATE TABLE inventory_requests (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    courier_id INTEGER REFERENCES users(id),
    product_id INTEGER REFERENCES products(id),
    requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
    approved_quantity INTEGER CHECK (approved_quantity >= 0),
    status inventory_request_status DEFAULT 'pending',
    reason TEXT,
    approved_by INTEGER REFERENCES users(id),
    fulfilled_by INTEGER REFERENCES users(id),
    notes TEXT,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP,
    fulfilled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для запросов пополнения
CREATE INDEX idx_inventory_requests_courier ON inventory_requests(courier_id);
CREATE INDEX idx_inventory_requests_product ON inventory_requests(product_id);
CREATE INDEX idx_inventory_requests_status ON inventory_requests(status);
CREATE INDEX idx_inventory_requests_created ON inventory_requests(created_at);

-- Таблица движения товаров
CREATE TABLE stock_movements (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    movement_type VARCHAR(20) NOT NULL, -- 'in', 'out', 'adjustment'
    quantity INTEGER NOT NULL,
    old_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    reason VARCHAR(100),
    reference_type VARCHAR(50), -- 'order', 'inventory_request', 'adjustment'
    reference_id INTEGER,
    user_id INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для движения товаров
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX idx_stock_movements_created ON stock_movements(created_at);

-- Таблица сессий пользователей
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    device_info TEXT,
    ip_address INET,
    is_active BOOLEAN DEFAULT TRUE,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для сессий
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_active ON user_sessions(is_active);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

-- Таблица логов действий
CREATE TABLE activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для логов
CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at);

-- Функции и триггеры

-- Функция обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггеры для автоматического обновления updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tents_updated_at BEFORE UPDATE ON tents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Функция автоматической генерации номера заказа
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL THEN
        NEW.order_number := 'FD' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || 
                           LPAD(NEW.id::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER generate_order_number_trigger BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION generate_order_number();

-- Функция логирования изменений статуса заказа
CREATE OR REPLACE FUNCTION log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_history (order_id, previous_status, new_status, notes)
        VALUES (NEW.id, OLD.status, NEW.status, 'Автоматическое изменение статуса');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER log_order_status_change_trigger AFTER UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION log_order_status_change();

-- Функция обновления остатков товаров
CREATE OR REPLACE FUNCTION update_product_stock()
RETURNS TRIGGER AS $$
DECLARE
    old_stock INTEGER;
    new_stock INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Уменьшаем остаток при создании заказа
        SELECT stock_quantity INTO old_stock FROM products WHERE id = NEW.product_id;
        new_stock := old_stock - NEW.quantity;
        
        UPDATE products SET stock_quantity = new_stock WHERE id = NEW.product_id;
        
        INSERT INTO stock_movements (product_id, movement_type, quantity, old_quantity, new_quantity, 
                                   reason, reference_type, reference_id)
        VALUES (NEW.product_id, 'out', NEW.quantity, old_stock, new_stock, 
                'Заказ создан', 'order', NEW.order_id);
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

CREATE TRIGGER update_product_stock_trigger AFTER INSERT ON order_items
    FOR EACH ROW EXECUTE FUNCTION update_product_stock();

-- Вставка начальных данных

-- Категории товаров
INSERT INTO product_categories (name, description) VALUES 
('Салфетки-души', 'Влажные салфетки для гигиены'),
('Гигиенические принадлежности', 'Дополнительные товары для гигиены'),
('Аксессуары', 'Дополнительные аксессуары для фестиваля');

-- Зоны фестиваля
INSERT INTO festival_zones (name, description) VALUES 
('Зона A', 'Зона 1'),
('Зона B', 'Зона 2'),
('Зона C', 'Зона 3'),
('Зона D', 'Зона 4');

-- Администратор по умолчанию (пароль admin123)
INSERT INTO users (username, email, password_hash, role, full_name) VALUES 
('admin', 'admin@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'admin', 'Администратор системы'),
('operator1', 'operator1@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'operator', 'Оператор 1'),
('courier1', 'courier1@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'courier', 'Курьер 1'),
('courier2', 'courier2@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'courier', 'Курьер 2');

-- Товары
INSERT INTO products (name, description, category_id, price, cost_price, stock_quantity, sku) VALUES 
('Neko-Active', 'Описание', 1, 500.00, 300.00, 1000, 'NEKO-ACTIVE'),
('Neko-Clinic', 'Описание', 1, 1350.00, 1200.00, 500, 'NEKO-CLINIC'),
('Neko-Grill', 'Описание', 1, 850.00, 360.00, 800, 'NEKO-GRILL');

-- Тестовые палатки
INSERT INTO tents (tent_number, zone_id, location_description) VALUES 
('A-01', 1, 'A-01'),
('A-02', 1, 'A-02'),
('A-03', 1, 'A-03'),
('B-01', 2, 'B-01'),
('B-02', 2, 'B-02'),
('C-01', 3, 'C-01'),
('C-02', 3, 'C-02'),
('D-01', 4, 'D-01'),
('D-02', 4, 'D-02'),
('D-03', 4, 'D-03');

-- Функция для создания представлений и отчетов
CREATE VIEW v_order_summary AS
SELECT 
    o.id,
    o.order_number,
    o.created_at,
    t.tent_number,
    fz.name as zone_name,
    o.total_amount,
    o.status,
    o.payment_status,
    u.username as courier_name,
    COUNT(oi.id) as items_count,
    SUM(oi.quantity) as total_quantity
FROM orders o
LEFT JOIN tents t ON o.tent_id = t.id
LEFT JOIN festival_zones fz ON t.zone_id = fz.id
LEFT JOIN users u ON o.courier_id = u.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id, t.tent_number, fz.name, u.username;

CREATE VIEW v_product_stock_status AS
SELECT 
    p.id,
    p.name,
    p.stock_quantity,
    p.min_stock_level,
    p.max_stock_level,
    pc.name as category_name,
    CASE 
        WHEN p.stock_quantity <= p.min_stock_level THEN 'low'
        WHEN p.stock_quantity >= p.max_stock_level THEN 'overstocked'
        ELSE 'normal'
    END as stock_status
FROM products p
LEFT JOIN product_categories pc ON p.category_id = pc.id
WHERE p.is_active = true;

-- Создание индексов для производительности
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at_desc ON orders (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_created_at_desc ON messages (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_created_at_desc ON activity_logs (created_at DESC);

-- Настройки для автоочистки старых данных
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
    -- Удаляем старые сессии (старше 30 дней)
    DELETE FROM user_sessions 
    WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
    
    -- Удаляем старые логи активности (старше 90 дней)
    DELETE FROM activity_logs 
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
    
    -- Архивируем старые заказы (старше 1 года)
    -- В продакшене лучше перенести в архивную таблицу
    
END;
$$ LANGUAGE plpgsql;

-- Можно настроить cron job для периодической очистки
-- SELECT cron.schedule('cleanup-old-data', '0 2 * * *', 'SELECT cleanup_old_data();');

COMMIT;