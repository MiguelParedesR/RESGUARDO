import { create } from "zustand";

export type UserRole = "ADMIN" | "CUSTODIA";
type ActiveModule = "dashboard" | "tracking" | "alarm";

type AppState = {
  role: UserRole;
  activeModule: ActiveModule;
  selectedServicioId: string | null;
  setRole: (role: UserRole) => void;
  setActiveModule: (module: ActiveModule) => void;
  setSelectedServicioId: (servicioId: string | null) => void;
};

export const useAppStore = create<AppState>((set) => ({
  role: "ADMIN",
  activeModule: "dashboard",
  selectedServicioId: null,
  setRole: (role) =>
    set(() => ({
      role,
      activeModule: "dashboard"
    })),
  setActiveModule: (activeModule) => set(() => ({ activeModule })),
  setSelectedServicioId: (selectedServicioId) => set(() => ({ selectedServicioId }))
}));
