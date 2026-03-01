import { Filter, Search } from 'lucide-react';

export function CatalogFilters({
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus
}: {
    searchQuery: string,
    setSearchQuery: (s: string) => void,
    filterStatus: string,
    setFilterStatus: (s: string) => void
}) {
    return (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por código SKU, nombre de producto o marca..."
                    className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                />
            </div>

            <div className="w-full md:w-auto flex items-center gap-3">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full md:w-48 px-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white cursor-pointer"
                >
                    <option value="all">Todos los productos</option>
                    <option value="mapped">Vinculados (MeLi)</option>
                    <option value="unmapped">Sin Vincular</option>
                    <option value="low_stock">Stock Bajo (≤ 2)</option>
                </select>
            </div>
        </div>
    );
}
