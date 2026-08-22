
function ProveedorConfigPanel() {
    const [configs, setConfigs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        setLoading(true);
        try {
            const res = await fetch("/api/settings/proveedores");
            if (res.ok) {
                const data = await res.json();
                setConfigs(data);
            }
        } catch(e) { console.error("Error", e); }
        setLoading(false);
    }

    async function handleSave(prov: string, currentConfig: any) {
        setSaving(prov);
        try {
            await fetch("/api/settings/proveedores", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(currentConfig)
            });
        } catch(e) { console.error("Error", e); }
        setSaving(null);
    }

    if (loading) return null;
    if (configs.length === 0) return null; // no proveedores

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden mb-8">
            <div className="bg-[var(--surface-2)] px-6 py-4 border-b border-[var(--border)]">
                <h3 className="font-bold text-[var(--text)] flex items-center gap-2">
                    <Database className="w-5 h-5 text-indigo-500" />
                    Configuración de Costos por Proveedor
                </h3>
                <p className="text-xs text-[var(--text-faint)] mt-1">
                    Selecciona qué tipo de costo se usará por defecto para cada proveedor al calcular precios y si se debe sumar el Margen adicional.
                </p>
            </div>
            <div className="p-0">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs uppercase bg-[var(--surface-2)] text-[var(--text-faint)] border-b border-[var(--border)]">
                        <tr>
                            <th className="px-6 py-3 font-bold">Proveedor</th>
                            <th className="px-6 py-3 font-bold">Tipo Costo Preferido</th>
                            <th className="px-6 py-3 font-bold text-center">Aplicar Margen (%)</th>
                            <th className="px-6 py-3 font-bold"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                        {configs.map(c => {
                            const isSaving = saving === c.proveedor;
                            return (
                                <tr key={c.proveedor} className="hover:bg-[var(--surface-2)] transition-colors">
                                    <td className="px-6 py-4 font-bold text-[var(--text)]">{c.proveedor}</td>
                                    <td className="px-6 py-4">
                                        <select 
                                            value={c.tipo_costo_preferido || ""} 
                                            onChange={(e) => setConfigs(prev => prev.map(p => p.proveedor === c.proveedor ? {...p, tipo_costo_preferido: e.target.value} : p))}
                                            className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                                        >
                                            <option value="">-- Automático (Mayor Costo) --</option>
                                            <option value="distribuidor">Distribuidor</option>
                                            <option value="mayoreo">Mayoreo</option>
                                            <option value="menudeo">Menudeo</option>
                                            <option value="subdistribuidor">Subdistribuidor</option>
                                        </select>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button 
                                            onClick={() => setConfigs(prev => prev.map(p => p.proveedor === c.proveedor ? {...p, aplica_regla_margen: !p.aplica_regla_margen} : p))}
                                            className="inline-flex items-center"
                                        >
                                            {c.aplica_regla_margen ? <ToggleRight className="w-8 h-8 text-[var(--ok)]" /> : <ToggleLeft className="w-8 h-8 text-slate-300" />}
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button 
                                            onClick={() => handleSave(c.proveedor, c)}
                                            disabled={isSaving}
                                            className="bg-[var(--surface-2)] hover:bg-[var(--accent)] hover:text-white border border-[var(--border)] text-[var(--text)] px-3 py-1.5 rounded-md flex items-center gap-2 transition-colors disabled:opacity-50 ml-auto"
                                        >
                                            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                            {isSaving ? "Guardando..." : "Guardar"}
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

