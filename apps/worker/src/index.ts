import { startProcessor } from './processor';
import { runReconciliation } from '@gestor/sync/reconciliation';
import logger from '@gestor/shared/lib/logger';
import dotenv from 'dotenv';
import path from 'path';

// Cargar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const RECONCILIATION_INTERVAL = 30 * 60 * 1000; // 30 minutos

async function main() {
    logger.info('--- GESTOR WORKER ENGINE START ---');

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
