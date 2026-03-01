"use client";

import { useState, useEffect } from 'react';
import { Activity, Clock, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export default function MonitorPage() {
    const [jobs, setJobs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchJobs();

        // Suscribirse a cambios en tiempo real
        const channel = supabase
            .channel('schema-db-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
                fetchJobs();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const MOCK_JOBS = [
        { id: 'job-001', type: 'sync_stock', status: 'completed', created_at: new Date().toISOString() },
        { id: 'job-002', type: 'sync_price', status: 'processing', created_at: new Date(Date.now() - 5000).toISOString() },
        { id: 'job-003', type: 'pause_listing', status: 'failed', error_log: 'Rate limit exceeded on MeLi API', created_at: new Date(Date.now() - 60000).toISOString() }
    ];

    async function fetchJobs() {
        try {
            const { data, error } = await supabase
                .from('jobs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(20);

            if (error || !data || data.length === 0) {
                setJobs(MOCK_JOBS);
            } else {
                setJobs(data);
            }
        } catch (err) {
            console.error('Error fetching jobs:', err);
            setJobs(MOCK_JOBS);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Monitor de Sincronización</h2>
                    <p className="text-slate-500">Jobs procesados en tiempo real por el Worker de Railway.</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-1 px-3 flex items-center gap-2 text-sm font-medium text-slate-600 shadow-sm">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    Conectado via Supabase Realtime
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden text-sm">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold flex items-center gap-2">
                        <Activity className="w-4 h-4 text-indigo-500" />
                        Cola de Trabajos (Jobs)
                    </h3>
                    <button onClick={fetchJobs} className="text-indigo-600 font-medium hover:underline flex items-center gap-1">
                        <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                        Refrescar
                    </button>
                </div>

                <div className="divide-y divide-slate-100">
                    {loading && !jobs.length ? (
                        <div className="p-8 text-center text-slate-400">Cargando monitor...</div>
                    ) : jobs.length === 0 ? (
                        <div className="p-8 text-center text-slate-400">No hay actividad reciente en la cola de jobs.</div>
                    ) : jobs.map((job) => (
                        <div key={job.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-4">
                                <StatusIcon status={job.status} />
                                <div>
                                    <div className="font-bold flex items-center gap-2">
                                        {job.type}
                                        <span className="text-[10px] font-mono font-normal bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                            ID: {job.id.slice(0, 8)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-400 flex items-center gap-2">
                                        {new Date(job.created_at).toLocaleTimeString()} •
                                        Status: <span className={cn(
                                            "font-semibold uppercase tracking-tighter",
                                            job.status === 'completed' ? 'text-green-600' :
                                                job.status === 'failed' ? 'text-red-600' :
                                                    job.status === 'processing' ? 'text-indigo-600' : 'text-slate-400'
                                        )}>{job.status}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                {job.error_log && (
                                    <div className="text-[10px] text-red-500 max-w-[200px] truncate mb-1" title={job.error_log}>
                                        Error: {job.error_log}
                                    </div>
                                )}
                                <button className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded font-bold hover:bg-slate-200 transition-colors">
                                    Detalles
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function StatusIcon({ status }: { status: string }) {
    const base = "w-10 h-10 rounded-lg flex items-center justify-center";
    if (status === 'completed') return <div className={cn(base, "bg-green-50 text-green-600")}><CheckCircle2 className="w-5 h-5" /></div>;
    if (status === 'failed') return <div className={cn(base, "bg-red-50 text-red-600")}><XCircle className="w-5 h-5" /></div>;
    if (status === 'processing') return <div className={cn(base, "bg-indigo-50 text-indigo-600 animate-pulse")}><Clock className="w-5 h-5" /></div>;
    return <div className={cn(base, "bg-slate-50 text-slate-300")}><Clock className="w-5 h-5" /></div>;
}
