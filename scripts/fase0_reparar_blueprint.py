# Fase 0 - Reparacion del blueprint (2026-08-23)
# 1) Rescata el contenido MANUAL de db_flow_blueprint.md -> docs/POLITICAS_FRONTEND.md (UTF-8 limpio)
# 2) Reconstruye db_flow_blueprint.md DESDE docs/db_flow_blueprint.json (fuente unica, 2026-08-15)
#    con encabezado GENERADO y codificacion UTF-8 pura.
import json, io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MD = os.path.join(ROOT, 'docs', 'db_flow_blueprint.md')
JS = os.path.join(ROOT, 'docs', 'db_flow_blueprint.json')
POL = os.path.join(ROOT, 'docs', 'POLITICAS_FRONTEND.md')

# ---------- 1) Leer el md corrupto (utf-8 + latin-1 mezclado) ----------
raw = open(MD, 'rb').read()
try:
    txt = raw.decode('utf-8')
except UnicodeDecodeError as e:
    txt = raw[:e.start].decode('utf-8') + raw[e.start:].decode('latin-1')
lines = txt.split('\n')

# Localizar fronteras: secciones manuales = 1-28 (UX/UI + Coherencia), 35-43 (Linaje), 928-fin (Politicas QA + Estrategia)
# Buscar indice de "## Maquinas de estado" (inicio del cuerpo generado) y "## Políticas de Seguridad Frontend"
i_gen = next(i for i, l in enumerate(lines) if l.startswith('## Maquinas de estado'))
i_tail = next(i for i, l in enumerate(lines) if l.startswith('## Pol') and 'Seguridad Frontend' in l)
manual_top = lines[0:28]          # titulo + secciones 1 y 2 (Nielsen + Coherencia)
manual_linaje = lines[34:43]      # Linaje de Datos
manual_tail = lines[i_tail:]      # Politicas QA + Estrategia DeepSeek

politicas = []
politicas.append('# Politicas Frontend, UX y Gobernanza del Proyecto')
politicas.append('')
politicas.append('> Documento CURADO (manual). Rescatado el 2026-08-23 desde db_flow_blueprint.md,')
politicas.append('> que a partir de hoy es un artefacto 100% generado. Editar SOLO este archivo.')
politicas.append('')
politicas.extend(manual_top)
politicas.append('')
politicas.append('---')
politicas.append('')
politicas.extend(manual_linaje)
politicas.append('')
politicas.append('---')
politicas.append('')
politicas.extend(manual_tail)
with io.open(POL, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(politicas).replace('\r', ''))
print('POLITICAS_FRONTEND.md escrito:', len(politicas), 'lineas')

# ---------- 2) Reconstruir el md desde el JSON ----------
d = json.load(open(JS, encoding='utf-8'))
md = []
md.append('<!-- GENERADO AUTOMATICAMENTE - NO EDITAR A MANO -->')
md.append('<!-- Fuente: docs/db_flow_blueprint.json | Regenerar: npx tsx scripts/generate_flow_blueprint.ts -->')
md.append('<!-- Contenido curado/politicas: docs/POLITICAS_FRONTEND.md -->')
md.append('')
md.append('# DB Flow Blueprint')
md.append('')
md.append(f"- **Generado:** `{d.get('generated_at')}` (snapshot; datos de runtime caducan en 26h)")
md.append(f"- **Schema hash:** `{d.get('schema_hash')}`")
md.append(f"- **Processes hash:** `{d.get('processes_hash')}`")
md.append(f"- **Tables:** {len(d['tables'])} | **Triggers:** {len(d['triggers'])} | **Cron jobs:** {len(d['cron_jobs'])} | **Edge fns:** {len(d['edge_functions'])} | **Queues:** {len(d['queues'])}")
md.append('')

sm = d.get('state_machines', {})
if sm:
    md.append('## Maquinas de estado'); md.append('')
    for name, s in sm.items():
        md.append(f"### {name} (enum `{s['enum_type']}`)")
        md.append(f"- **Estados:** {', '.join(s['states'])}")
        if s.get('recovery_from'):
            md.append(f"- **Recuperacion desde error ->** {', '.join(s['recovery_from'])}")
        md.append('- **Transiciones:**')
        for desde, hasta in s['transitions'].items():
            md.append(f" - `{desde}` -> {', '.join(hasta)}")
        md.append('')

qs = d.get('queues', {})
if qs:
    md.append('## Colas (jobs)'); md.append('')
    md.append(f"> Conteos del snapshot `{d.get('generated_at')}`. NO es estado en vivo. Verificar con `node scripts/live_audit.js`.")
    md.append('')
    for name, q in qs.items():
        counts = ', '.join(f"{k}={v}" for k, v in q['status_counts'].items())
        md.append(f"### {name}")
        md.append(f"- **Total:** {q['total']} ({counts})")
        if q.get('pending'): md.append(f"- **Pendientes:** {q['pending']}")
        if q.get('failed'): md.append(f"- **WARNING - Fallidos (acumulado historico):** {q['failed']}")
        if q.get('producers'): md.append(f"- **Productores:** {', '.join(q['producers'])}")
        md.append('')

diags = d.get('diagnostics', [])
if diags:
    md.append('## Diagnosticos'); md.append('')
    for sev in ['error', 'warn', 'info']:
        items = [x for x in diags if x['severity'] == sev]
        if not items: continue
        md.append(f"### {sev.upper()}"); md.append('')
        for x in items:
            line = f"- [{x['code']}] `{x['scope']}`: {x['message']}"
            if x.get('hint'): line += f" — {x['hint']}"
            md.append(line)
        md.append('')

procs = d.get('processes', {})
if procs:
    md.append('## Procesos declarados'); md.append('')
    for name, p in procs.items():
        md.append(f"### {name}"); md.append('')
        if p.get('trigger'): md.append(f"- Trigger: `{p['trigger']}`")
        steps = p.get('steps') or []
        if steps:
            md.append('- Steps:')
            for s in steps:
                bits = []
                if s.get('fn'): bits.append(f"fn=`{s['fn']}`")
                if s.get('estado'): bits.append(f"estado=`{s['estado']}`")
                if s.get('tabla_destino'): bits.append(f"tabla_destino=`{s['tabla_destino']}`")
                md.append('  - ' + ' | '.join(bits))
        ds = p.get('downstream') or []
        if ds:
            md.append('- Downstream:')
            for x in ds:
                if x.get('trigger'):
                    md.append(f"  - trigger=`{x['trigger']}`" + (f" | tabla=`{x['tabla']}`" if x.get('tabla') else ''))
                elif x.get('fn'):
                    md.append(f"  - fn=`{x['fn']}`" + (f" | destino=`{x['destino']}`" if x.get('destino') else ''))
                elif x.get('job'):
                    handlers = (d.get('job_handlers') or {}).get(x['job'], [])
                    h = ', '.join(f"`{v}`" for v in handlers) if handlers else '`no detectado`'
                    line = f"  - job=`{x['job']}` | handler={h} | expect_runtime=`{str(x.get('expect_runtime', True)).lower()}`"
                    if x.get('blocked_by'): line += f" | blocked_by=`{x['blocked_by']}`"
                    md.append(line)
        rec = p.get('recovery')
        if rec:
            line = f"- Recovery: desde `{rec.get('desde')}`"
            if rec.get('rutas'):
                line += ' -> [' + ', '.join(f"`{r}`" for r in rec['rutas']) + ']'
            md.append(line)
        md.append('')

md.append('## Salud del blueprint'); md.append('')
md.append(f"- Procesos declarados: {len(procs)}")
md.append(f"- Handlers de jobs detectados en worker: {len(d.get('job_handlers', {}))}")
md.append(f"- Diagnosticos error: {len([x for x in diags if x['severity']=='error'])}")
md.append(f"- Diagnosticos warn: {len([x for x in diags if x['severity']=='warn'])}")
md.append(f"- Diagnosticos info: {len([x for x in diags if x['severity']=='info'])}")
md.append('')

for fn, data in d['functions'].items():
    md.append(f"## {fn}")
    md.append(f"- **Security:** {data['security']}")
    md.append(f"- **Timeout Override:** {data.get('statement_timeout_override') or 'None'}")
    avg = data.get('avg_time_ms')
    src = data.get('timing_source', 'none')
    if avg:
        label = f"{avg:.2f} ms" if src in ('live_stats', 'pg_stat_statements', 'yaml_hint') else f"~{avg:.0f} ms (estimado)"
        md.append(f"- **Avg Time:** {label} (source: {src})")
    else:
        md.append(f"- **Avg Time:** Unknown (source: {src})")
    if data.get('dynamic_sql'): md.append('- WARNING: **Dynamic SQL Detected**')
    if data.get('calls_tables'): md.append(f"- **Touches Tables:** {', '.join(data['calls_tables'])}")
    if data.get('calls_functions'): md.append(f"- **Calls Functions:** {', '.join(data['calls_functions'])}")
    if data.get('triggers_cascade'):
        md.append('- **Cascading Triggers:**')
        for tc in data['triggers_cascade']:
            md.append(f" - `{tc['table']}` -> `{tc['target_function']}` (Trigger: {tc['trigger']})")
    md.append('')

with io.open(MD, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(md))
print('db_flow_blueprint.md reconstruido:', len(md), 'lineas desde JSON', d.get('generated_at'))

# ---------- 3) Verificacion ----------
raw2 = open(MD, 'rb').read()
raw2.decode('utf-8')  # falla si no es UTF-8 puro
print('VERIFICADO: db_flow_blueprint.md es UTF-8 valido,', len(raw2), 'bytes')
open(POL, 'rb').read().decode('utf-8')
print('VERIFICADO: POLITICAS_FRONTEND.md es UTF-8 valido')
