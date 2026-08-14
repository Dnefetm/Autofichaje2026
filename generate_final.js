const fs = require('fs');

let v119 = fs.readFileSync('supabase/migrations/20260809122800_v119_fix_import_timeout.sql', 'utf8');
let v118 = fs.readFileSync('supabase/migrations/20260805221000_v118_optimizar_costos_resolver.sql', 'utf8');

// Fix v119
v119 = v119.replace(
  /DELETE FROM listas_precios_raw_staging\s+WHERE importacion_id = p_importacion_id;/g,
  "-- FIX: Canibalizacion de Staging eliminada\n    -- DELETE FROM listas_precios_raw_staging\n    -- WHERE importacion_id = p_importacion_id;"
);

// Fix v118
let v118_fn = v118.substring(v118.indexOf('CREATE OR REPLACE FUNCTION public.fn_resolver_y_poblar_costos'));

v118_fn = v118_fn.replace(
  'lower(public.f_unaccent_immutable(trim(payload->>v_col_modelo))) AS modelo_norm',
  'lower(public.f_unaccent_immutable(trim(payload->>v_col_modelo))) AS modelo_norm,\n         lower(public.f_unaccent_immutable(trim(payload->>v_col_codigo))) AS codigo_norm'
);

v118_fn = v118_fn.replace(
  'AND lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.modelo_norm',
  "AND lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.codigo_norm\n       AND f.codigo_norm <> ''"
);

v118_fn = v118_fn.replace(
  'AND lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.modelo_norm',
  "AND lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.codigo_norm\n                AND f.codigo_norm <> ''"
);

fs.writeFileSync('apply_fix_final.sql', v119 + '\n\n' + v118_fn);
console.log('apply_fix_final.sql generated!');
