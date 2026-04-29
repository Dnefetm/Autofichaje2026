const fs = require('fs');
let content = fs.readFileSync('supabase/migrations/fix_v102_final.sql', 'utf8');

// Strip the DROP statements at the top
content = content.replace(/-- 1\. DROP both overloads[\s\S]*?-- 3\. Run the correct definition of fn_match_precios_v2/m, '-- Fix for fn_match_precios_v2');

// Replace the end logic
const oldLogic = `    -- FASE 0 LOGIC: Actualizar precios de lista anterior (Header Vigencia)
    UPDATE public.listas_precios_proveedor
       SET vigente = false, fecha_vigor_hasta = CURRENT_DATE
     WHERE proveedor = v_proveedor
       AND vigente = true
       AND importacion_id <> p_importacion_id;

    UPDATE public.listas_precios_proveedor
       SET vigente = true
     WHERE importacion_id = p_importacion_id;`;

const newLogic = `    -- FASE 0 LOGIC: Actualizar precios de lista anterior (Header Vigencia)
    UPDATE public.listas_precios_proveedor
       SET vigente = false, fecha_vigor_hasta = now()
     WHERE proveedor = v_proveedor
       AND vigente = true
       AND importacion_id <> p_importacion_id;

    IF (SELECT count(*) FROM costos_articulo WHERE importacion_id=p_importacion_id AND articulo_id IS NOT NULL) > 0 THEN
        UPDATE public.listas_precios_proveedor
           SET vigente = true
         WHERE importacion_id = p_importacion_id;
    END IF;`;

content = content.replace(oldLogic, newLogic);

// Strip the COMET query at the end
content = content.replace(/-- 4\. VALIDATION QUERIES FOR COMET[\s\S]*/m, '');

fs.writeFileSync('supabase/migrations/20260429000002_v103_fix_backend_bugs_2.sql', content);
console.log('Done creating migration 2.');
