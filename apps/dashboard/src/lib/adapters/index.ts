import { registrarAdapter } from '@/lib/proveedor-adapter';
import { urreaAdapter } from './urrea';
import { wurthAdapter } from './wurth';
import { tukAdapter } from './tuk';

// Registro de adapters de proveedores (doble horizonte: agregar uno = registrar aquí).
export function registrarAdaptadoresProveedores(): void {
    registrarAdapter(urreaAdapter);
    registrarAdapter(wurthAdapter);
    registrarAdapter(tukAdapter);
}
