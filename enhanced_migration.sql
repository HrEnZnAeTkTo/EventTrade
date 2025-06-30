-- enhanced_migration.sql - Migration for chat replies, message deletion, and enhanced tents management

-- 1. Enhance messages table with reply support and soft deletion
DO $$
BEGIN
    -- Add reply support to messages
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'messages' 
        AND column_name = 'reply_to_id'
    ) THEN
        ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id);
        CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id);
        COMMENT ON COLUMN messages.reply_to_id IS 'Reference to the message being replied to';
    END IF;

    -- Add soft deletion support to messages
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'messages' 
        AND column_name = 'is_deleted'
    ) THEN
        ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
        ALTER TABLE messages ADD COLUMN deleted_by INTEGER REFERENCES users(id);
        ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMP;
        
        CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(is_deleted) WHERE is_deleted = false;
        
        COMMENT ON COLUMN messages.is_deleted IS 'Soft deletion flag for messages';
        COMMENT ON COLUMN messages.deleted_by IS 'User who deleted the message';
        COMMENT ON COLUMN messages.deleted_at IS 'Timestamp when message was deleted';
    END IF;
END
$$;

-- 2. Enhance tents table with additional fields
DO $$
BEGIN
    -- Add zone field
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tents' 
        AND column_name = 'zone'
    ) THEN
        ALTER TABLE tents ADD COLUMN zone VARCHAR(50);
        COMMENT ON COLUMN tents.zone IS 'Festival zone (e.g., Zone A, VIP, Family)';
    END IF;

    -- Add capacity field
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tents' 
        AND column_name = 'capacity'
    ) THEN
        ALTER TABLE tents ADD COLUMN capacity INTEGER DEFAULT 4;
        COMMENT ON COLUMN tents.capacity IS 'Number of people the tent can accommodate';
    END IF;

    -- Add contact fields
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tents' 
        AND column_name = 'contact_name'
    ) THEN
        ALTER TABLE tents ADD COLUMN contact_name VARCHAR(100);
        ALTER TABLE tents ADD COLUMN contact_phone VARCHAR(20);
        
        COMMENT ON COLUMN tents.contact_name IS 'Contact person name for the tent';
        COMMENT ON COLUMN tents.contact_phone IS 'Contact phone number';
    END IF;

    -- Add notes field
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tents' 
        AND column_name = 'notes'
    ) THEN
        ALTER TABLE tents ADD COLUMN notes TEXT;
        COMMENT ON COLUMN tents.notes IS 'Additional notes about the tent';
    END IF;

    -- Add is_active field for tents
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tents' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE tents ADD COLUMN is_active BOOLEAN DEFAULT true;
        CREATE INDEX IF NOT EXISTS idx_tents_active ON tents(is_active) WHERE is_active = true;
        COMMENT ON COLUMN tents.is_active IS 'Whether the tent is active and available for orders';
    END IF;

    -- Add updated_at field for tents
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tents' 
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE tents ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        COMMENT ON COLUMN tents.updated_at IS 'Timestamp when tent was last updated';
    END IF;
END
$$;

-- 3. Ensure products has is_active field (from previous migration)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'products' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE products ADD COLUMN is_active BOOLEAN DEFAULT true;
        CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = true;
        COMMENT ON COLUMN products.is_active IS 'Whether the product is active and visible to customers';
        
        -- Set all existing products as active
        UPDATE products SET is_active = true WHERE is_active IS NULL;
    END IF;
END
$$;

-- 4. Create or update triggers for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing triggers if they exist and recreate them
DROP TRIGGER IF EXISTS update_tents_updated_at ON tents;
CREATE TRIGGER update_tents_updated_at 
    BEFORE UPDATE ON tents
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at 
    BEFORE UPDATE ON orders
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Update existing data with default values
UPDATE tents SET 
    capacity = 4 
WHERE capacity IS NULL;

UPDATE tents SET 
    is_active = true 
WHERE is_active IS NULL;

UPDATE tents SET 
    zone = CASE 
        WHEN tent_number LIKE 'A-%' THEN 'Зона A'
        WHEN tent_number LIKE 'B-%' THEN 'Зона B'
        WHEN tent_number LIKE 'C-%' THEN 'Зона C'
        WHEN tent_number LIKE 'D-%' THEN 'Зона D'
        ELSE 'Основная зона'
    END
WHERE zone IS NULL;

-- 6. Create enhanced views for better data access
CREATE OR REPLACE VIEW v_active_tents AS
SELECT 
    t.*,
    COUNT(o.id) as total_orders,
    COUNT(CASE WHEN o.status = 'new' THEN 1 END) as pending_orders
FROM tents t
LEFT JOIN orders o ON t.id = o.tent_id
WHERE t.is_active = true
GROUP BY t.id
ORDER BY t.tent_number;

CREATE OR REPLACE VIEW v_message_threads AS
SELECT 
    m.*,
    s.username as sender_name,
    r.username as receiver_name,
    rm.message as reply_to_message,
    rs.username as reply_to_sender
FROM messages m
JOIN users s ON m.sender_id = s.id
LEFT JOIN users r ON m.receiver_id = r.id
LEFT JOIN messages rm ON m.reply_to_id = rm.id
LEFT JOIN users rs ON rm.sender_id = rs.id
WHERE m.is_deleted = false
ORDER BY m.created_at ASC;

-- 7. Add constraints for data integrity
ALTER TABLE tents ADD CONSTRAINT chk_tents_capacity 
    CHECK (capacity > 0 AND capacity <= 20);

ALTER TABLE messages ADD CONSTRAINT chk_messages_not_reply_to_self 
    CHECK (id != reply_to_id);

-- 8. Update table comments
COMMENT ON TABLE tents IS 'Festival tents with enhanced contact info and zone management';
COMMENT ON TABLE messages IS 'Messages with reply threading and soft deletion support';

-- 9. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tents_zone ON tents(zone);
CREATE INDEX IF NOT EXISTS idx_tents_capacity ON tents(capacity);
CREATE INDEX IF NOT EXISTS idx_messages_created_at_desc ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id);

-- 10. Grant necessary permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE ON tents TO festival_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO festival_app_user;

-- Verification queries
SELECT 'Enhanced migration completed successfully!' as status;

-- Show table structures
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name IN ('messages', 'tents', 'products')
    AND column_name IN ('reply_to_id', 'is_deleted', 'deleted_by', 'deleted_at', 'zone', 'capacity', 'contact_name', 'contact_phone', 'notes', 'is_active', 'updated_at')
ORDER BY table_name, ordinal_position;

-- Show updated row counts
SELECT 
    'tents' as table_name, 
    COUNT(*) as total_rows,
    COUNT(CASE WHEN is_active = true THEN 1 END) as active_rows
FROM tents
UNION ALL
SELECT 
    'products' as table_name, 
    COUNT(*) as total_rows,
    COUNT(CASE WHEN is_active = true THEN 1 END) as active_rows
FROM products
UNION ALL
SELECT 
    'messages' as table_name, 
    COUNT(*) as total_rows,
    COUNT(CASE WHEN is_deleted = false THEN 1 END) as active_rows
FROM messages;