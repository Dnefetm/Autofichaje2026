-- ============================================================
-- Migración: Interruptor general de sincronización de stock por mapeo.
--
-- Permite que una vidriera (publicación) mapeada a un artículo del catálogo
-- NO alimente ni reciba stock desde el motor de inventario. Es una herramienta
-- general: aplica a CUALQUIER mapeo existente o futuro.
--
-- Retrocompatible: DEFAULT true mantiene exactamente el comportamiento actual
-- (todo mapeo sincroniza stock como hasta hoy).
-- ============================================================

ALTER TABLE mapeo_publicacion_articulo
    ADD COLUMN IF NOT EXISTS sincronizar_stock BOOLEAN NOT NULL DEFAULT true;

-- Índice parcial para que el motor de stock filtre rápido los mapeos apagados.
CREATE INDEX IF NOT EXISTS idx_mapeo_sincronizar_stock
    ON mapeo_publicacion_articulo (sincronizar_stock)
    WHERE sincronizar_stock = false;
