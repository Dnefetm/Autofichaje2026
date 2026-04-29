import fetch from 'node-fetch';

async function testWebhookSpeed() {
    console.log("Simulando una ráfaga de 3 webhooks de Mercado Libre a localhost...");
    
    for (let i = 1; i <= 3; i++) {
        const start = Date.now();
        try {
            const res = await fetch('http://localhost:3000/api/webhooks/meli', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: 'items',
                    resource: '/items/MLM123456789',
                    user_id: 12345,
                    _id: `test_notif_${Date.now()}_${i}`
                })
            });
            const text = await res.text();
            const duration = Date.now() - start;
            console.log(`Petición ${i}: Status ${res.status} completada en ${duration}ms. Respuesta: ${text}`);
            
            if (duration < 200) {
                console.log(`✅ ¡Éxito! El webhook retornó en menos de 200ms (${duration}ms). Esto garantiza que ML no hará reintentos de castigo (Escudo 1 validado).`);
            } else {
                console.log(`❌ Demasiado lento: ${duration}ms. ML hará reintentos.`);
            }
        } catch (err: any) {
            console.error(`Error en petición ${i}:`, err.message);
        }
        // Pequeña pausa entre ráfagas
        await new Promise(r => setTimeout(r, 100));
    }
}

testWebhookSpeed();
