-- 20261016: regla de pricing específica para DAI Autopartes
-- cost_basis = distribuidor (es el tipo_costo que trae la lista DAI)
-- margen_objetivo = 40 (configurable) para que haya precio de venta sugerido.

INSERT INTO pricing_rule_v3 (
  name, priority, is_active, proveedor, cost_basis, margen_objetivo, envio_fijo,
  aplicar_margen, aplicar_comision, aplicar_envio, aplicar_retenciones, aplicar_redondeo_magico,
  redondeo, redondeo_target_pct, redondeo_min_pct, redondeo_max_pct
) VALUES (
  'Precios DAI', 100, true, 'DAI Autopartes', 'distribuidor', 40, 0,
  true, true, true, false, true,
  '99', -10, 9, 14
)
ON CONFLICT DO NOTHING;
