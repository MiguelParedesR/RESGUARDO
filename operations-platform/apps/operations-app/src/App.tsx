import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import gsap from "gsap";
import { OpsPanel } from "@ops/ui";
import { LoginForm, useAuth } from "@ops/auth";
import { useAppStore } from "./app/store/useAppStore";
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
  const {
    initialized,
    status,
    role: authRole,
    profile,
    signOut
  } = useAuth();
  const role = useAppStore((s) => s.role);
  const activeModule = useAppStore((s) => s.activeModule);
  const setRole = useAppStore((s) => s.setRole);
  const setActiveModule = useAppStore((s) => s.setActiveModule);
  const isAuthenticated = status === "authenticated";

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

  useEffect(() => {
    if (status !== "authenticated") return;
    const targetRole = authRole === "CUSTODIA" ? "CUSTODIA" : "ADMIN";
    if (targetRole !== role) {
      setRole(targetRole);
    }
  }, [status, authRole, role, setRole]);

  const heartbeat = useQuery({
    queryKey: ["ops-heartbeat", role, status],
    queryFn: async () => ({
      ts: new Date().toISOString(),
      role,
      status
    }),
    refetchInterval: 20_000,
    enabled: initialized
  });

  const body = useMemo(() => {
    if (!isAuthenticated) {
      return (
        <div className="rounded-operation border border-panel-line bg-slate-950/30 p-4 text-sm text-slate-300">
          Inicia sesion para habilitar los modulos operacionales modernos.
        </div>
      );
    }
    if (activeModule === "tracking") return <TrackingModule role={role} />;
    if (activeModule === "alarm") return <AlarmSystemModule role={role} />;
    return role === "ADMIN" ? <AdminDashboardModule /> : <CustodiaMobileModule />;
  }, [activeModule, isAuthenticated, role]);

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
              {!initialized ? (
                <div className="rounded-operation border border-panel-line bg-panel-bg/70 p-4 text-sm text-slate-300">
                  Inicializando sesion...
                </div>
              ) : null}

              {!isAuthenticated ? (
                <LoginForm />
              ) : (
                <div className="rounded-operation border border-panel-line bg-panel-bg/70 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
                    Sesion Activa
                  </p>
                  <p className="mt-2 text-sm text-slate-100">
                    Usuario: <strong>{profile?.email || "sin correo"}</strong>
                  </p>
                  <p className="text-xs text-slate-300">
                    Rol Supabase: {authRole} | Rol App: {role}
                  </p>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="mt-3 rounded-md border border-panel-line px-3 py-2 text-xs font-semibold tracking-[0.15em] text-slate-100"
                  >
                    Cerrar sesion
                  </button>
                </div>
              )}

              <div className="rounded-operation border border-panel-line bg-panel-bg/70 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-300">
                  Estado Runtime
                </p>
                <p className="mt-2 text-sm text-slate-100">
                  Rol App: <strong>{heartbeat.data?.role || role}</strong>
                </p>
                <p className="text-xs text-slate-300">
                  Estado Auth: {status}
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
                  disabled={!isAuthenticated}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.18em] ${
                    activeModule === tab.id
                      ? "border-brand-ember bg-brand-ember text-slate-900"
                      : "border-panel-line bg-transparent text-slate-200"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
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
