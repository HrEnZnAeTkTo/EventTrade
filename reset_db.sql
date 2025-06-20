-- reset_db.sql - Ручной сброс базы данных

-- Удаляем старые данные
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM products;
DELETE FROM users;

-- Сбрасываем счетчики
ALTER SEQUENCE users_id_seq RESTART WITH 1;
ALTER SEQUENCE products_id_seq RESTART WITH 1;
ALTER SEQUENCE orders_id_seq RESTART WITH 1;

-- Создаем правильных пользователей
INSERT INTO users (username, email, password_hash, role, full_name) VALUES 
('admin', 'admin@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'admin', 'Администратор системы'),
('operator1', 'operator1@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'operator', 'Оператор 1'),
('courier1', 'courier1@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'courier', 'Курьер 1'),
('courier2', 'courier2@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'courier', 'Курьер 2');

-- Создаем правильные товары
INSERT INTO products (name, description, price, stock_quantity) VALUES 
('Neko-Active', 'Активные салфетки-души для быстрого освежения', 500.00, 1000),
('Neko-Clinic', 'Клинические салфетки-души с антибактериальным эффектом', 2000.00, 500),
('Neko-Grill', 'Салфетки-души для очистки после приготовления на гриле', 600.00, 800);

-- Создаем тестовые палатки
INSERT INTO tents (tent_number, location_description) VALUES 
('A-01', 'Первый ряд, левая сторона'),
('A-02', 'Первый ряд, центр'),
('B-01', 'VIP зона, у главной сцены'),
('C-01', 'Семейная зона, рядом с детской площадкой');

SELECT 'Database reset completed!' as result;