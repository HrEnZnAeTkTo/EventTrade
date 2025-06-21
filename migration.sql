-- migration.sql - Миграция для добавления поля is_active к товарам

-- Добавляем поле is_active, если его еще нет
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'products' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE products ADD COLUMN is_active BOOLEAN DEFAULT true;
        COMMENT ON COLUMN products.is_active IS 'Активность товара (видимость для клиентов)';
        
        -- Устанавливаем всем существующим товарам активный статус
        UPDATE products SET is_active = true WHERE is_active IS NULL;
        
        RAISE NOTICE 'Поле is_active добавлено к таблице products';
    ELSE
        RAISE NOTICE 'Поле is_active уже существует в таблице products';
    END IF;
END
$$;

-- Создаем индекс для быстрого поиска активных товаров
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = true;

-- Обновляем комментарий к таблице
COMMENT ON TABLE products IS 'Товары системы с поддержкой активности/видимости';

-- Проверяем результат
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'products' 
AND column_name = 'is_active';

SELECT 'Migration completed successfully!' as result;