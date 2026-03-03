-- Migración a V13 (Arquitectura AppSheet Híbrida JSONB)

-- 1. Tablas Independientes Base
CREATE TABLE IF NOT EXISTS importadores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    rfc TEXT,
    direccion TEXT,
    contacto TEXT,
    creado_el TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operadores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    correo TEXT UNIQUE,         
    celular TEXT,
    fecha_ingreso DATE,         
    estatus TEXT DEFAULT 'activo',
    creado_el TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ubicaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT UNIQUE NOT NULL,  
    tipo TEXT,                    
    notas TEXT,
    activo BOOLEAN DEFAULT true
);

-- 2. Refactorización a "articulos"
-- Si existe la tabla anterior 'skus', la renombramos (esto asume que existía, si falla usamos DROP o algo).
-- Pero como es un entorno limpio / de desarrollo, vamos a crear 'articulos' desde cero, o si 'skus' existe lo mantenemos.
-- Para garantizar que no rompa las FK actuales, crearemos esto como tabla nueva, o si la renombramos alteramos.
-- REGLA: El usuario requiere el nombre `articulos` pero tenemos mucho código con `skus`.

-- Dado que estamos ejecutando la re-arquitectura profunda, crearemos la estructura EXACTAMENTE como fue diseñada en V13:

CREATE TABLE IF NOT EXISTS articulos (
    sku TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    marca TEXT,
    modelo TEXT,
    variante TEXT,
    categoria TEXT,
    descripcion TEXT,
    
    -- Códigos Base
    codigo_universal TEXT,
    codigo_sat TEXT,
    
    -- EL MOTOR MULTI-PUBLICACIÓN
    codigos_marketplace TEXT[], 
    
    -- Logística de Almacén
    caja_madre TEXT,
    peso_kg NUMERIC(10,3),
    largo_cm NUMERIC(10,2),    
    ancho_cm NUMERIC(10,2),
    alto_cm NUMERIC(10,2),
    materiales TEXT,           
    
    -- EL MODELO HÍBRIDO (JSONB)
    atributos_especificos JSONB DEFAULT '{}'::jsonb, 
    metadata_atributos JSONB DEFAULT '{}'::jsonb,    
    
    -- Regulaciones
    importador_id UUID REFERENCES importadores(id),
    pais_origen TEXT,
    requiere_etiqueta_nom BOOLEAN DEFAULT false,
    requiere_embalaje_esp BOOLEAN DEFAULT false,
    
    -- Status
    publicacion_ml TEXT,       
    url_producto TEXT,
    es_full BOOLEAN DEFAULT false,
    es_dropshipping BOOLEAN DEFAULT false,
    es_obsoleto BOOLEAN DEFAULT false,
    notas TEXT,
    
    imagenes TEXT[], 
    url_video TEXT,
    
    activo BOOLEAN DEFAULT true,
    creado_el TIMESTAMPTZ DEFAULT now(),
    actualizado_el TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS informacion_comercial (
    sku TEXT PRIMARY KEY REFERENCES articulos(sku) ON DELETE CASCADE,
    costo_compra NUMERIC(10,2) DEFAULT 0.00,
    precio_objetivo NUMERIC(10,2) DEFAULT 0.00,  
    precio_minimo NUMERIC(10,2) DEFAULT 0.00,
    actualizado_el TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_por_ubicacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_articulo TEXT REFERENCES articulos(sku) ON DELETE CASCADE,
    ubicacion_id UUID REFERENCES ubicaciones(id),
    cantidad INTEGER DEFAULT 0,
    UNIQUE(sku_articulo, ubicacion_id)
);

CREATE TABLE IF NOT EXISTS ingresos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_ingreso SERIAL,
    sku_articulo TEXT REFERENCES articulos(sku),
    ubicacion_id UUID REFERENCES ubicaciones(id),
    cantidad INTEGER NOT NULL,
    guia TEXT,                 
    transportista TEXT,        
    tipo_ingreso TEXT,         
    notas TEXT,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    operador_id UUID REFERENCES operadores(id),             
    imagenes TEXT[],            
    creado_el TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS importar_egresos_full (
    id_tarea UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_importacion TEXT NOT NULL,  
    guia TEXT,                     
    codigo_meli TEXT,              
    codigo_universal TEXT,         
    sku_ml TEXT,                   
    nombre_ml TEXT,                
    unidades_solicitadas INTEGER NOT NULL, 
    identificacion TEXT,           
    instrucciones TEXT,            
    estado_validacion TEXT DEFAULT 'pendiente', 
    creado_el TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tareas_recoleccion_full (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tarea_id UUID REFERENCES importar_egresos_full(id_tarea) ON DELETE CASCADE,
    sku_inventario TEXT REFERENCES articulos(sku), 
    ubicacion_origen_id UUID REFERENCES ubicaciones(id), 
    cantidad_recolectada INTEGER,  
    estado_recoleccion TEXT DEFAULT 'pendiente',
    fecha_pendiente TIMESTAMPTZ DEFAULT now(),
    operador_pendiente_id UUID REFERENCES operadores(id),
    fecha_reunido TIMESTAMPTZ,
    operador_reunio_id UUID REFERENCES operadores(id),
    fecha_preparado TIMESTAMPTZ,
    operador_preparo_id UUID REFERENCES operadores(id),
    fecha_no_encontrado TIMESTAMPTZ,
    operador_no_encontro_id UUID REFERENCES operadores(id),
    creado_el TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS egresos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_egreso SERIAL,
    sku_articulo TEXT REFERENCES articulos(sku) NOT NULL,
    ubicacion_id UUID REFERENCES ubicaciones(id) NOT NULL, 
    cantidad INTEGER NOT NULL,
    tipo_egreso TEXT NOT NULL,
    importacion_full_id TEXT,
    guia TEXT,                 
    transportista TEXT,        
    operador_id UUID REFERENCES operadores(id),             
    notas TEXT,
    creado_el TIMESTAMPTZ DEFAULT now()
);
