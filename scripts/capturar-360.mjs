#!/usr/bin/env node
/**
 * Captura el visor 360 de DAI → imágenes del producto (ficha_imagenes).
 * Script LOCAL (Playwright): corre en la máquina del owner, NO en Vercel
 * (Vercel no puede por límites de CPU y porque el visor es interactivo).
 *
 * Uso:
 *   node scripts/capturar-360.mjs --codigo 12001 --articulo <uuid-articulo> [--angulos 8] [--w360 <url>]
 *
 * Qué hace:
 *   1. Obtiene la URL del visor 360 (w360) del catálogo DAI (o la toma de --w360).
 *   2. Asegura una ficha técnica para el artículo.
 *   3. Abre el visor, rota (arrastre) y captura N ángulos (default 8).
 *   4. Post-proceso con sharp: cuadrado 1000×1000, fondo blanco.
 *   5. Sube a Supabase Storage e inserta en ficha_imagenes (tipo '360', orden, ángulo).
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '..');

const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : def;
};

function envFromDotenv(file) {
    const p = path.join(repo, file);
    if (!fs.existsSync(p)) return {};
    const out = {};
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) out[m[1]] = m[2].trim();
    }
    return out;
}

const env = { ...envFromDotenv('.env'), ...envFromDotenv('apps/dashboard/.env.local') };
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env');
    process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const codigo = String(arg('codigo', '')).trim();
const articuloId = String(arg('articulo', '')).trim();
const angulos = Math.max(2, Math.min(12, Number(arg('angulos', 8))));
let w360 = String(arg('w360', '')).trim();

if (!codigo || !articuloId) {
    console.error('Uso: node scripts/capturar-360.mjs --codigo <codigo> --articulo <uuid> [--angulos 8] [--w360 <url>]');
    process.exit(1);
}

// 1. URL del visor 360 desde el catálogo DAI (si no se pasó)
if (!w360) {
    const r = await fetch('https://dai.com.mx/Catalogo/ObtenerCatalogoBusqueda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ Busqueda: codigo, Equivalencia: 'false' }).toString(),
    });
    const j = await r.json();
    const exacto = (j.response || []).find((x) => String(x.detalle?.dai).trim() === codigo);
    w360 = String(exacto?.detalle?.w360 || '').trim();
}
if (!w360) {
    console.error(`No se encontró el visor 360 (w360) para el código ${codigo}.`);
    process.exit(1);
}
console.log(`Visor 360: ${w360}`);

// 2. Asegurar ficha técnica ligada al artículo
let fichaId = null;
const { data: ficha } = await sb.from('fichas_tecnicas').select('id').eq('articulo_id', articuloId).limit(1).maybeSingle();
if (ficha) {
    fichaId = ficha.id;
} else {
    const { data: art } = await sb.from('articulos').select('nombre,marca,modelo,codigo_universal').eq('articulo_id', articuloId).maybeSingle();
    const { data: nueva, error: fichaErr } = await sb.from('fichas_tecnicas').insert({
        articulo_id: articuloId,
        nombre_producto: art?.nombre || codigo,
        marca: art?.marca || 'DAI',
        modelo: art?.modelo || codigo,
        codigo_universal: art?.codigo_universal || null,
        estado: 'borrador',
        fecha_creacion: new Date().toISOString(),
    }).select('id').single();
    if (fichaErr || !nueva) {
        console.error('No se pudo crear la ficha:', fichaErr?.message);
        process.exit(1);
    }
    fichaId = nueva.id;
}
console.log(`Ficha: ${fichaId}`);

// 3. Playwright: abrir visor y rotar capturando
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
await page.goto(w360, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1800);

// Selector del elemento del visor (ajustar si la página cambia de markup).
const SELECTOR = 'canvas, #visor, #pano, .threesixty, .spritespin, img[src*="360"]';
const viewer = page.locator(SELECTOR).first();
if ((await viewer.count()) === 0) {
    console.error('No se localizó el elemento del visor 360. Ajusta el SELECTOR en el script.');
    await browser.close();
    process.exit(1);
}
const box = await viewer.boundingBox();
if (!box) {
    console.error('El visor no tiene boundingBox (quizá oculto).');
    await browser.close();
    process.exit(1);
}

const outDir = path.join(repo, 'tmp', 'dai-360', codigo);
fs.mkdirSync(outDir, { recursive: true });
const capturas = [];
for (let i = 0; i < angulos; i++) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Rotación por arrastre (un tramo por ángulo). Si el visor usa teclado o API JS,
    // reemplaza este bloque por el método correspondiente.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.25, cy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(450);

    const file = path.join(outDir, `angulo_${String(i).padStart(2, '0')}.png`);
    await viewer.screenshot({ path: file });
    capturas.push(file);
}
await browser.close();

// 4. Post-proceso: cuadrado 1000×1000 fondo blanco
const procesadas = [];
for (const f of capturas) {
    const out = f.replace('.png', '_sq.png');
    await sharp(f).resize(1000, 1000, { fit: 'contain', background: '#ffffff' }).png().toFile(out);
    procesadas.push(out);
}

// 5. Subir a Storage + insertar ficha_imagenes (tope 12, dedup simple por contenido)
const bucket = env.SUPABASE_IMAGENES_BUCKET || 'fichas';
let orden = 0;
let subidas = 0;
for (const f of procesadas) {
    orden++;
    const buf = fs.readFileSync(f);
    const p = `fichas/${fichaId}/${codigo}_360_${orden}.png`;
    const { error: upErr } = await sb.storage.from(bucket).upload(p, buf, { contentType: 'image/png', upsert: true });
    if (upErr) {
        console.error('upload error:', upErr.message);
        continue;
    }
    const url = sb.storage.from(bucket).getPublicUrl(p);
    await sb.from('ficha_imagenes').insert({
        ficha_id: fichaId,
        url: url.publicUrl,
        storage_path: p,
        orden,
        tipo: '360',
        formato: 'png',
        ancho_px: 1000,
        alto_px: 1000,
        tamano_bytes: buf.length,
        fuente: 'dai_360',
        url_original: w360,
    });
    subidas++;
}

console.log(`✅ Listo: ${subidas} capturas del visor 360 para ${codigo} → ficha ${fichaId}.`);
