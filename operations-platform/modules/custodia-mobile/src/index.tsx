import { motion } from "framer-motion";
import { OpsMap } from "@ops/maps";

export function CustodiaMobileModule() {
  return (
    <div className="grid gap-4">
      <div className="rounded-operation border border-panel-line bg-slate-950/25 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
          Sesion Custodia
        </p>
        <h3 className="mt-1 text-xl font-semibold">Servicio ACTIVO</h3>
        <p className="text-sm text-slate-300">Placa ABC-123 | Cliente ACME</p>
      </div>

      <OpsMap
        current={[-12.0458, -77.0413]}
        destination={[-12.0632, -77.035]}
        route={[
          [-12.0458, -77.0413],
          [-12.0512, -77.0396],
          [-12.0566, -77.0382],
          [-12.0632, -77.035]
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <motion.button
          whileTap={{ scale: 0.97 }}
          className="rounded-operation bg-brand-ember px-4 py-3 text-sm font-bold text-slate-900"
        >
          Confirmar Check-In
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          className="rounded-operation bg-rose-600 px-4 py-3 text-sm font-bold text-white"
        >
          Panico
        </motion.button>
      </div>
    </div>
  );
}
