import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const schema = z.object({
  pin: z
    .string()
    .min(4, "PIN incompleto")
    .max(6, "PIN invalido")
    .regex(/^\d+$/, "Solo digitos"),
  role: z.enum(["ADMIN", "CUSTODIA"])
});

type FormValues = z.infer<typeof schema>;

type Props = {
  defaultRole: "ADMIN" | "CUSTODIA";
  onRoleChange: (role: "ADMIN" | "CUSTODIA") => void;
};

export function LoginForm({ defaultRole, onRoleChange }: Props) {
  const defaults = useMemo<FormValues>(
    () => ({ pin: "", role: defaultRole }),
    [defaultRole]
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults
  });

  const onSubmit = async (values: FormValues) => {
    onRoleChange(values.role);
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-3 rounded-operation border border-panel-line bg-panel-bg/80 p-4"
    >
      <p className="text-xs uppercase tracking-[0.25em] text-slate-300">
        Access Gate
      </p>
      <label className="grid gap-2 text-sm">
        PIN Operativo
        <input
          className="rounded-md border border-slate-500 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-brand-ember"
          type="password"
          maxLength={6}
          inputMode="numeric"
          {...register("pin")}
        />
      </label>
      {errors.pin ? (
        <p className="text-xs text-rose-300">{errors.pin.message}</p>
      ) : null}

      <label className="grid gap-2 text-sm">
        Rol
        <select
          className="rounded-md border border-slate-500 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-brand-ocean"
          {...register("role")}
        >
          <option value="ADMIN">ADMIN</option>
          <option value="CUSTODIA">CUSTODIA</option>
        </select>
      </label>

      <button
        disabled={isSubmitting}
        className="rounded-md bg-brand-ember px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
      >
        {isSubmitting ? "Validando..." : "Entrar"}
      </button>
    </form>
  );
}
