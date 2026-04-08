const fs = require('fs');
const path = String.raw`c:\Users\dnefe\Documents\Antigravity proyectos\Autofichaje2026\apps\dashboard\src\app\fichas\[id]\page.tsx`;

let c = fs.readFileSync(path, 'utf8');

// Fix 1: readOnly key → editable
const idx = c.indexOf('readOnly className="w-2/5 p-1.5 text-xs bg-slate-100 border border-slate-200 rounded-lg text-slate-500"');
if (idx === -1) {
  console.log('NOT FOUND: readOnly input');
} else {
  // Find the full input tag start
  const tagStart = c.lastIndexOf('<input', idx);
  const tagEnd = c.indexOf('/>', idx) + 2;
  const oldTag = c.slice(tagStart, tagEnd);
  const newTag = `<input value={k.startsWith('__n_') ? '' : k} placeholder="Nombre del atributo" onChange={e => { const nk = e.target.value || k; const r = {}; for (const [ek,ev] of Object.entries(draft[campo] ?? {})) r[ek === k ? nk : ek] = ev; setDraft(d => ({...d, [campo]: r})); }} className="w-2/5 p-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-400 outline-none text-slate-700 placeholder-slate-300" />`;
  c = c.slice(0, tagStart) + newTag + c.slice(tagEnd);
  console.log('Fixed readOnly key input');
}

// Fix 2: generic key name → temp key
const btnIdx = c.indexOf('Atributo ${Object.keys(obj).length + 1}');
if (btnIdx === -1) {
  console.log('NOT FOUND: add button key');
} else {
  c = c.slice(0, btnIdx) + '__n_${Date.now()}' + c.slice(btnIdx + 'Atributo ${Object.keys(obj).length + 1}'.length);
  console.log('Fixed add button key');
}

fs.writeFileSync(path, c, 'utf8');
console.log('DONE');
