BEGIN;
CREATE TABLE backup_costos_articulo_104 AS SELECT * FROM costos_articulo;
CREATE TABLE backup_proveedor_articulos_alias_104 AS SELECT * FROM proveedor_articulos_alias;
CREATE TABLE backup_matching_decisiones_104 AS SELECT * FROM matching_decisiones;
CREATE TABLE backup_importaciones_excel_104 AS SELECT * FROM importaciones_excel;
-- reglas_precio might not exist yet, we can catch error or do IF EXISTS. Wait, IF EXISTS only works for DROP.
-- Let's do it individually without a transaction block so one failing doesn't stop the others.
COMMIT;
