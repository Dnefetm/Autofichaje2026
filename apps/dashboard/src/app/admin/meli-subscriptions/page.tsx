'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

const ALL_KNOWN_TOPICS = [
    'items', 'orders_v2', 'orders', 'payments', 'questions', 'shipments',
    'messages', 'claims', 'vis_leads', 'flex-handshakes', 
    'catalog_item_competitions', 'catalog_suggestions', 'stock-locations'
];

export default function MeliSubscriptionsPage() {
    const [subscribedTopics, setSubscribedTopics] = useState<string[]>([]);
    const [stats, setStats] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetch('/api/admin/meli/subscriptions')
            .then(res => res.json())
            .then(data => {
                if (data.topics) setSubscribedTopics(data.topics);
                if (data.stats) setStats(data.stats);
            })
            .catch(() => toast.error('Error cargando suscripciones'))
            .finally(() => setLoading(false));
    }, []);

    const toggleTopic = (topic: string) => {
        setSubscribedTopics(prev => 
            prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
        );
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/admin/meli/subscriptions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topics: subscribedTopics })
            });
            const result = await res.json();
            if (res.ok) {
                toast.success('Suscripciones actualizadas', { description: result.message });
            } else {
                toast.error('Error', { description: result.error });
            }
        } catch (e: any) {
            toast.error('Error de red');
        }
        setSaving(false);
    };

    if (loading) return <div className="p-8">Cargando suscripciones...</div>;

    const totalEvents = Object.values(stats).reduce((a, b) => a + b, 0);

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold">Configuración de Suscripciones Webhook</h1>
            <p className="text-gray-500">
                Selecciona a qué eventos de Mercado Libre quieres suscribirte. 
                Deshabilitar topics que no usas ahorrará CPU en Vercel. Total eventos últimas 24h: {totalEvents}
            </p>

            <div className="bg-white shadow rounded-lg border">
                <div className="p-6 border-b">
                    <h2 className="text-xl font-semibold">Topics Disponibles</h2>
                    <p className="text-sm text-gray-500">
                        Recomendado mantener: items, orders_v2, payments, questions, shipments
                    </p>
                </div>
                <div className="p-6 space-y-4">
                    {ALL_KNOWN_TOPICS.map(topic => {
                        const count = stats[topic] || 0;
                        const isSubscribed = subscribedTopics.includes(topic);
                        return (
                            <div key={topic} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                                <div className="flex items-center space-x-3">
                                    <input 
                                        type="checkbox"
                                        id={topic} 
                                        checked={isSubscribed}
                                        onChange={() => toggleTopic(topic)}
                                        className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <label htmlFor={topic} className="font-medium cursor-pointer">
                                        {topic}
                                    </label>
                                </div>
                                <div className="text-sm text-gray-500">
                                    {count} eventos (24h)
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="flex justify-end">
                <button 
                    onClick={handleSave} 
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                    {saving ? 'Guardando...' : 'Guardar Suscripciones en ML'}
                </button>
            </div>
        </div>
    );
}
