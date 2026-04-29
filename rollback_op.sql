BEGIN;
UPDATE listas_precios_proveedor SET vigente=false, fecha_vigor_hasta=now()
 WHERE importacion_id='5f077660-83ac-4268-96e4-633c97a51cb0';
UPDATE listas_precios_proveedor SET vigente=true,  fecha_vigor_hasta=NULL
 WHERE importacion_id='fb8a73c8-f1fd-4bd9-9cc5-b8654e4f9d9b';
DELETE FROM costos_articulo     WHERE importacion_id='5f077660-83ac-4268-96e4-633c97a51cb0';
DELETE FROM matching_decisiones WHERE importacion_id='5f077660-83ac-4268-96e4-633c97a51cb0';
DELETE FROM listas_precios_raw  WHERE importacion_id='5f077660-83ac-4268-96e4-633c97a51cb0';
UPDATE importaciones_excel SET estado='cancelado' WHERE id='5f077660-83ac-4268-96e4-633c97a51cb0';
COMMIT;
