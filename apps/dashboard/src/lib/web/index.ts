import { registrarWebAdapter } from './proveedor-web';
import { daiWebAdapter } from './dai';
import { tukWebAdapter } from './tuk';
import { urreaWebAdapter } from './urrea';

// Registro de adapters web por proveedor (doble horizonte: agregar proveedor = registrar aquí).
export function registrarWebAdapters(): void {
    registrarWebAdapter(daiWebAdapter);
    registrarWebAdapter(tukWebAdapter);
    registrarWebAdapter(urreaWebAdapter);
}
