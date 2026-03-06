import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "./useAuth";

const loginSchema = z.object({
  email: z.string().email("Correo invalido"),
  password: z.string().min(8, "Minimo 8 caracteres")
});

type LoginFormValues = z.infer<typeof loginSchema>;

type LoginFormProps = {
  title?: string;
  subtitle?: string;
  onSuccess?: () => void;
};

export function LoginForm({
  title = "Acceso Operacional",
  subtitle = "Autenticacion Supabase (legacy sigue operando en paralelo).",
  onSuccess
}: LoginFormProps) {
  const { signInWithPassword, status, error } = useAuth();
  const defaultValues = useMemo<LoginFormValues>(
    () => ({
      email: "",
      password: ""
    }),
    []
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues
  });

  const onSubmit = async (values: LoginFormValues) => {
    const result = await signInWithPassword(values);
    if (result.ok) {
      onSuccess?.();
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-3 rounded-operation border border-panel-line bg-panel-bg/80 p-4"
    >
      <header className="grid gap-1">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-300">{title}</p>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </header>

      <label className="grid gap-2 text-sm">
        Correo
        <input
          type="email"
          autoComplete="username"
          className="rounded-md border border-slate-500 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-brand-ocean"
          {...register("email")}
        />
      </label>
      {errors.email ? <p className="text-xs text-rose-300">{errors.email.message}</p> : null}

      <label className="grid gap-2 text-sm">
        Contrasena
        <input
          type="password"
          autoComplete="current-password"
          className="rounded-md border border-slate-500 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-brand-ember"
          {...register("password")}
        />
      </label>
      {errors.password ? (
        <p className="text-xs text-rose-300">{errors.password.message}</p>
      ) : null}

      {status === "error" && error ? (
        <p className="rounded-md border border-rose-400/40 bg-rose-950/35 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting || status === "loading"}
        className="rounded-md bg-brand-ember px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
      >
        {isSubmitting || status === "loading" ? "Autenticando..." : "Iniciar sesion"}
      </button>
    </form>
  );
}
