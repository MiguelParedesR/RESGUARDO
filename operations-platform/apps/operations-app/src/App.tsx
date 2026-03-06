import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import gsap from "gsap";
import { OpsPanel } from "@ops/ui";
import { useAppStore } from "./app/store/useAppStore";
import { LoginForm } from "./features/auth/LoginForm";
import { AdminDashboardModule } from "@ops/module-admin-dashboard";
import { CustodiaMobileModule } from "@ops/module-custodia-mobile";
import { TrackingModule } from "@ops/module-tracking";
import { AlarmSystemModule } from "@ops/module-alarm-system";

const tabs = [
  { id: "dashboard", label: "Operacion" },
  { id: "tracking", label: "Tracking" },
  { id: "alarm", label: "Alarmas" }
] as const;

export function App() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const role = useAppStore((s) => s.role);
  const activeModule = useAppStore((s) => s.activeModule);
  const setRole = useAppStore((s) => s.setRole);
  const setActiveModule = useAppStore((s) => s.setActiveModule);

  useEffect(() => {
    if (!frameRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".ops-enter",
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.45, stagger: 0.08, ease: "power2.out" }
      );
    }, frameRef);
    return () => ctx.revert();
  }, [activeModule, role]);

  const heartbeat = useQuery({
    queryKey: ["ops-heartbeat", role],
    queryFn: async () => ({
      ts: new Date().toISOString(),
      role,
      status: "ready"
    }),
    refetchInterval: 20_000
  });

  const body = useMemo(() => {
    if (activeModule === "tracking") return <TrackingModule role={role} />;
    if (activeModule === "alarm") return <AlarmSystemModule role={role} />;
    return role === "ADMIN" ? <AdminDashboardModule /> : <CustodiaMobileModule />;
  }, [activeModule, role]);

  return (
    <div className="min-h-screen px-4 py-5 md:px-8">
      <div ref={frameRef} className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[360px_1fr]">
        <motion.aside
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
          className="ops-enter"
        >
          <OpsPanel title="Centro Operacional" subtitle="Plataforma moderna en paralelo">
            <div className="grid gap-4">
              <LoginForm defaultRole={role} onRoleChange={setRole} />
              <div className="rounded-operation border border-panel-line bg-panel-bg/70 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
                  Estado Runtime
                </p>
                <p className="mt-2 text-sm text-slate-100">
                  Rol: <strong>{heartbeat.data?.role || role}</strong>
                </p>
                <p className="text-xs text-slate-300">
                  Heartbeat: {heartbeat.data?.ts || "sin sincronizar"}
                </p>
              </div>
            </div>
          </OpsPanel>
        </motion.aside>

        <motion.main
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="ops-enter"
        >
          <OpsPanel title="Nucleo de Operaciones">
            <div className="mb-4 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveModule(tab.id)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.18em] ${
                    activeModule === tab.id
                      ? "border-brand-ember bg-brand-ember text-slate-900"
                      : "border-panel-line bg-transparent text-slate-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {body}
          </OpsPanel>
        </motion.main>
      </div>
    </div>
  );
}
