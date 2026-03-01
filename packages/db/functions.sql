-- FUNCIONES Y TRIGGERS: GESTOR + AUTOFICHAS

-- 1. Trigger para actualizar la columna updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_skus_updated_at BEFORE UPDATE ON skus FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_inventory_snapshot_updated_at BEFORE UPDATE ON inventory_snapshot FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_marketplace_prices_updated_at BEFORE UPDATE ON marketplace_prices FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 2. Función para decremento de stock seguro (Atomisidad garantizada)
CREATE OR REPLACE FUNCTION decrement_stock_safe(
    p_sku TEXT,
    p_delta INTEGER, -- Positivo para restar stock
    p_source TEXT,
    p_reference_id TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_current_stock INTEGER;
    v_new_stock INTEGER;
BEGIN
    -- Bloqueo de fila para evitar condiciones de carrera
    SELECT physical_stock INTO v_current_stock
    FROM inventory_snapshot
    WHERE sku = p_sku
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SKU % no encontrado en inventario.', p_sku;
    END IF;

    -- Validar si hay stock suficiente
    IF v_current_stock < p_delta THEN
        RAISE EXCEPTION 'Stock insuficiente para SKU %: solicitado %, disponible %.', p_sku, p_delta, v_current_stock;
    END IF;

    -- Calcular nuevo stock
    v_new_stock := v_current_stock - p_delta;

    -- Actualizar inventario
    UPDATE inventory_snapshot
    SET physical_stock = v_new_stock,
        updated_at = now()
    WHERE sku = p_sku;

    -- Registrar transacción para auditoría
    INSERT INTO inventory_transactions (sku, delta, source, reference_id, resulting_stock)
    VALUES (p_sku, -p_delta, p_source, p_reference_id, v_new_stock);

    RETURN v_new_stock;
END;
$$ LANGUAGE plpgsql;

-- 3. Vista para stock disponible consolidado (Considerando reservas y buffers)
CREATE OR REPLACE VIEW view_available_stock AS
SELECT 
    s.sku,
    s.name,
    i.physical_stock,
    i.dropship_stock,
    i.reserved_stock,
    (i.physical_stock + i.dropship_stock) as total_stock,
    ((i.physical_stock + i.dropship_stock) - i.reserved_stock) as net_available_stock
FROM skus s
JOIN inventory_snapshot i ON s.sku = i.sku;
