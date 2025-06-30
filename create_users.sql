-- create_users.sql
DELETE FROM users WHERE username IN ('admin', 'courier1', 'operator1');

INSERT INTO users (username, email, password_hash, role, full_name) VALUES 
('admin', 'admin@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'admin', 'Администратор системы'),
('courier1', 'courier1@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'courier', 'Курьер 1'),
('operator1', 'operator1@festival.com', '$2a$10$YQdDBOhh2tFjC5TwkT/cAO8NeGkgNSH7eqGJq5PO.P5tKkYHD4k.q', 'operator', 'Оператор 1');

SELECT 'Users created successfully!' as result;
SELECT username, role FROM users;