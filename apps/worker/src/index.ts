import { startProcessor } from './processor';
import { runReconciliation } from '@gestor/sync/reconciliation';
import logger from '@gestor/shared/lib/logger';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';

// Cargar variables de entorno (Solo local)
if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
}

const RECONCILIATION_INTERVAL = 30 * 60 * 1000; // 30 minutos

async function main() {
    logger.info('--- GESTOR WORKER ENGINE START ---');

    // **RENDER HEALTH CHECK WORKAROUND**
    // Render free tier requiere que sea un servicio 'web' y escuche un puerto.
    const port = process.env.PORT || 8080;
    http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Autofichaje Worker is alive and running 24/7');
    }).listen(port, () => {
        logger.info(`Health check web server is listening on port ${port} to satisfy Render Free Tier requirements.`);
    });

    // Manejo de señales para apagado graceful
    process.on('SIGTERM', () => {
        logger.info('Recibida señal SIGTERM, apagando...');
        process.exit(0);
    });

    process.on('SIGINT', () => {
        logger.info('Recibida señal SIGINT, apagando...');
        process.exit(0);
    });

    // Tarea programada: Reconciliación
    setInterval(async () => {
        await runReconciliation();
    }, RECONCILIATION_INTERVAL);

    // Iniciar reconciliación inmediata al arrancar (opcional, pero recomendado para validar)
    runReconciliation().catch(err => logger.error({ err }, 'Error en reconciliación inicial'));

    await startProcessor();
}

main().catch((err) => {
    logger.fatal({ err }, 'Fallo crítico en el hilo principal');
    process.exit(1);
});
