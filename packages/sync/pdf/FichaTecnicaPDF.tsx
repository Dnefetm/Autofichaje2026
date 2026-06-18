import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet, Font } from '@react-pdf/renderer';

Font.registerHyphenationCallback((word) => [word]);

export interface FichaPDFData {
id: string;
nombre_producto: string | null;
marca: string | null;
marca_nombre?: string | null;
modelo: string | null;
variante: string | null;
codigo_universal: string | null;
categoria: string | null;
fabricante: string | null;
descripcion: string | null;
descripcion_larga: string | null;
bullet_points: string[] | null;
palabras_clave: string[] | null;
especificaciones: string | null;
materiales: string | null;
atributos_dinamicos: Record<string, any> | null;
peso_kg: number | null;
largo_cm: number | null;
ancho_cm: number | null;
alto_cm: number | null;
uso_recomendado: string | null;
precauciones: string | null;
ingredientes: string | null;
informacion_normativa: string | null;
instrucciones_uso: string | null;
leyendas_precautorias: string | null;
indicaciones_almacenamiento: string | null;
imagen_urls?: string[] | null;
}

export interface FichaPDFMeta {
version: number;
generadoEn: string;
urlPublica?: string;
qrDataUrl?: string;
logoDataUrl?: string;
brandColor?: string;
imagenesDataUrl?: string[];
}

const baseColors = { text: '#1A1A1A', muted: '#666666', line: '#E2E2E2', bgSoft: '#F7F7F7' };

const buildStyles = (brand: string) => StyleSheet.create({
page: { fontFamily: 'Helvetica', fontSize: 9, color: baseColors.text, paddingTop: 36, paddingBottom: 44, paddingHorizontal: 40, lineHeight: 1.4 },
header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 2, borderBottomColor: brand, paddingBottom: 8, marginBottom: 14 },
headerLeft: { flexShrink: 1, paddingRight: 12 },
brandName: { fontSize: 8, color: brand, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
title: { fontSize: 16, fontWeight: 'bold', marginTop: 2 },
subtitle: { fontSize: 9, color: baseColors.muted, marginTop: 2 },
logo: { width: 70, height: 40, objectFit: 'contain' },
idRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
chip: { backgroundColor: baseColors.bgSoft, borderRadius: 3, paddingVertical: 3, paddingHorizontal: 6 },
chipLabel: { fontSize: 6.5, color: baseColors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
chipValue: { fontSize: 9, fontWeight: 'medium' },
section: { marginBottom: 12 },
sectionTitle: { fontSize: 10, fontWeight: 'bold', color: brand, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, borderBottomWidth: 0.5, borderBottomColor: baseColors.line, paddingBottom: 2 },
body: { fontSize: 9, color: baseColors.text },
bullet: { flexDirection: 'row', marginBottom: 2 },
bulletDot: { width: 8, color: brand },
bulletText: { flex: 1 },
table: { borderWidth: 0.5, borderColor: baseColors.line, borderRadius: 2 },
tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: baseColors.line },
trLast: { flexDirection: 'row' },
tdKey: { width: '40%', padding: 4, backgroundColor: baseColors.bgSoft, fontWeight: 'medium', fontSize: 8.5 },
tdVal: { width: '60%', padding: 4, fontSize: 8.5 },
warnBox: { borderWidth: 0.5, borderColor: brand, borderRadius: 2, padding: 6, backgroundColor: '#FFF7F8' },
gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
galleryImg: { width: 150, height: 110, objectFit: 'contain', borderWidth: 0.5, borderColor: baseColors.line, borderRadius: 2, padding: 2 },
heroWrap: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 14, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: baseColors.line },
heroImg: { width: 150, height: 150, objectFit: 'contain', borderWidth: 0.5, borderColor: baseColors.line, borderRadius: 3, padding: 4, backgroundColor: baseColors.bgSoft },
heroInfo: { flex: 1 },
thumbImg: { width: 70, height: 70, objectFit: 'contain', borderWidth: 0.5, borderColor: baseColors.line, borderRadius: 2, padding: 2 },
footer: { position: 'absolute', bottom: 18, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 0.5, borderTopColor: baseColors.line, paddingTop: 6 },
footerText: { fontSize: 6.5, color: baseColors.muted },
qr: { width: 40, height: 40 },
});

const has = (v: any) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
const norm = (v: any) => String(v ?? '').trim().toLowerCase();

export function FichaTecnicaPDF({ ficha, meta }: { ficha: FichaPDFData; meta: FichaPDFMeta }) {
const brand = meta.brandColor || '#C8102E';
const s = buildStyles(brand);
const marca = ficha.marca_nombre || ficha.marca || '';

const Chip = ({ label, value }: { label: string; value: any }) => has(value) ? (
<View style={s.chip}>
<Text style={s.chipLabel}>{label}</Text>
<Text style={s.chipValue}>{String(value)}</Text>
</View>
) : null;

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
<View style={s.section} wrap={false}>
<Text style={s.sectionTitle}>{title}</Text>
{children}
</View>
);

const TextSection = ({ title, value }: { title: string; value: any }) => has(value) ? (
<Section title={title}>
<Text style={s.body}>{String(value)}</Text>
</Section>
) : null;

const BulletList = ({ items }: { items: string[] }) => (
<View>
{items.map((it, i) => (
<View key={i} style={s.bullet}>
<Text style={s.bulletDot}>{'\u2022'}</Text>
<Text style={s.bulletText}>{it}</Text>
</View>
))}
</View>
);

const KeyValTable = ({ rows }: { rows: Array<[string, any]> }) => {
const valid = rows.filter(([, v]) => has(v));
if (valid.length === 0) return null;
return (
<View style={s.table}>
{valid.map(([k, v], i) => (
<View key={i} style={i === valid.length - 1 ? s.trLast : s.tr}>
<Text style={s.tdKey}>{k}</Text>
<Text style={s.tdVal}>{String(v)}</Text>
</View>
))}
</View>
);
};

const dims: Array<[string, any]> = [
['Peso (kg)', ficha.peso_kg],
['Largo (cm)', ficha.largo_cm],
['Ancho (cm)', ficha.ancho_cm],
['Alto (cm)', ficha.alto_cm],
];

const atributosRows: Array<[string, any]> = ficha.atributos_dinamicos
? Object.entries(ficha.atributos_dinamicos).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])
: [];

const mostrarInstrucciones = has(ficha.instrucciones_uso) && norm(ficha.instrucciones_uso) !== norm(ficha.uso_recomendado);
const mostrarPrecauciones = has(ficha.precauciones) && norm(ficha.precauciones) !== norm(ficha.leyendas_precautorias);

const imagenes = (meta.imagenesDataUrl && meta.imagenesDataUrl.length > 0)
? meta.imagenesDataUrl
: (ficha.imagen_urls || []).filter(Boolean);
  const imagenPrincipal = imagenes[0];
  const imagenesSecundarias = imagenes.slice(1);

const tieneCumplimiento = has(ficha.informacion_normativa) || has(ficha.leyendas_precautorias) || mostrarPrecauciones || has(ficha.indicaciones_almacenamiento);

const fechaGen = new Date(meta.generadoEn).toLocaleDateString('es-MX');
const footerInfo = `${marca ? marca + ' \u00b7 ' : ''}Ficha tecnica v${meta.version} \u00b7 Generada ${fechaGen}`;

return (
<Document>
<Page size="A4" style={s.page}>
<View style={s.header} fixed>
<View style={s.headerLeft}>
{marca ? <Text style={s.brandName}>{marca}</Text> : null}
<Text style={s.title}>{ficha.nombre_producto || 'Producto'}</Text>
{has(ficha.descripcion) ? <Text style={s.subtitle}>{ficha.descripcion}</Text> : null}
</View>
{meta.logoDataUrl ? <Image style={s.logo} src={meta.logoDataUrl} /> : null}
</View>
        {imagenPrincipal ? (
          <View style={s.heroWrap}>
            <Image style={s.heroImg} src={imagenPrincipal} />
            <View style={s.heroInfo}>
              {marca ? <Text style={s.brandName}>{marca}</Text> : null}
              <Text style={s.title}>{ficha.nombre_producto || 'Producto'}</Text>
              {has(ficha.modelo) ? <Text style={s.subtitle}>Modelo: {ficha.modelo}</Text> : null}
              {has(ficha.codigo_universal) ? <Text style={s.subtitle}>SKU: {ficha.codigo_universal}</Text> : null}
              {has(ficha.descripcion) ? <Text style={s.body}>{ficha.descripcion}</Text> : null}
            </View>
          </View>
        ) : null}

<View style={s.idRow}>
<Chip label="Modelo" value={ficha.modelo} />
<Chip label="EAN/UPC" value={ficha.codigo_universal} />
<Chip label="Materiales" value={ficha.materiales} />
<Chip label="Variante" value={ficha.variante} />
<Chip label="Categoria" value={ficha.categoria} />
</View>

<TextSection title="Descripcion" value={ficha.descripcion_larga || ficha.descripcion} />

{has(ficha.bullet_points) ? (
<Section title="Puntos clave">
<BulletList items={ficha.bullet_points as string[]} />
</Section>
) : null}

<TextSection title="Especificaciones" value={ficha.especificaciones} />

{atributosRows.length > 0 ? (
<Section title="Atributos tecnicos">
<KeyValTable rows={atributosRows} />
</Section>
) : null}

{dims.some(([, v]) => has(v)) ? (
<Section title="Dimensiones y peso">
<KeyValTable rows={dims} />
</Section>
) : null}

<TextSection title="Uso recomendado" value={ficha.uso_recomendado} />
{mostrarInstrucciones ? <TextSection title="Instrucciones de uso" value={ficha.instrucciones_uso} /> : null}
<TextSection title="Ingredientes" value={ficha.ingredientes} />

{tieneCumplimiento ? (
<Section title="Cumplimiento y seguridad">
<View style={s.warnBox}>
{has(ficha.informacion_normativa) ? <Text style={s.body}>Normativa: {ficha.informacion_normativa}</Text> : null}
{has(ficha.leyendas_precautorias) ? <Text style={s.body}>Leyendas precautorias: {ficha.leyendas_precautorias}</Text> : null}
{mostrarPrecauciones ? <Text style={s.body}>Precauciones: {ficha.precauciones}</Text> : null}
{has(ficha.indicaciones_almacenamiento) ? <Text style={s.body}>Almacenamiento: {ficha.indicaciones_almacenamiento}</Text> : null}
</View>
</Section>
) : null}

          {imagenesSecundarias.length > 0 ? (
          <Section title="Mas imagenes">
            <View style={s.gallery}>
              {imagenesSecundarias.slice(0, 6).map((src, i) => (
                <Image key={i} style={s.thumbImg} src={src} />
              ))}
            </View>
          </Section>
        ) : null}

<View style={s.footer} fixed>
<View style={s.headerLeft}>
<Text style={s.footerText}>{footerInfo}</Text>
{meta.urlPublica ? <Text style={s.footerText}>{meta.urlPublica}</Text> : null}
<Text style={s.footerText} render={({ pageNumber, totalPages }) => `Pagina ${pageNumber} de ${totalPages}`} />
</View>
{meta.qrDataUrl ? <Image style={s.qr} src={meta.qrDataUrl} /> : null}
</View>
</Page>
</Document>
);
}
