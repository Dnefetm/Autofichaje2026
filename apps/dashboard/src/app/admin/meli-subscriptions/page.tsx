'use client';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

    // Calcular el total de eventos ruidosos
    const totalEvents = Object.values(stats).reduce((a, b) => a + b, 0);

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold">Configuración de Suscripciones Webhook</h1>
            <p className="text-gray-500">
                Selecciona a qué eventos de Mercado Libre quieres suscribirte. 
                Deshabilitar topics que no usas ahorrará CPU en Vercel. Total eventos últimas 24h: {totalEvents}
            </p>

            <Card>
                <CardHeader>
                    <CardTitle>Topics Disponibles</CardTitle>
                    <CardDescription>
                        Recomendado mantener: items, orders_v2, payments, questions, shipments
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {ALL_KNOWN_TOPICS.map(topic => {
                        const count = stats[topic] || 0;
                        const isSubscribed = subscribedTopics.includes(topic);
                        return (
                            <div key={topic} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                                <div className="flex items-center space-x-3">
                                    <Checkbox 
                                        id={topic} 
                                        checked={isSubscribed}
                                        onCheckedChange={() => toggleTopic(topic)}
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
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'Guardando...' : 'Guardar Suscripciones en ML'}
                </Button>
            </div>
        </div>
    );
}
