import { PropsWithChildren } from "react";

type OpsPanelProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
}>;

export function OpsPanel({ title, subtitle, children }: OpsPanelProps) {
  return (
    <section className="rounded-operation border border-panel-line bg-panel-bg p-4 shadow-operation md:p-6">
      <header className="mb-4 border-b border-panel-line pb-3">
        <h2 className="text-lg font-semibold tracking-[0.08em] text-slate-100 md:text-xl">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-300">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

type OpsBadgeProps = {
  label: string;
  tone?: "info" | "warning" | "danger" | "ok";
};

export function OpsBadge({ label, tone = "info" }: OpsBadgeProps) {
  const classes = {
    info: "bg-brand-ocean/20 text-brand-ocean",
    warning: "bg-amber-400/20 text-amber-300",
    danger: "bg-rose-500/20 text-rose-300",
    ok: "bg-emerald-500/20 text-emerald-300"
  }[tone];

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${classes}`}>
      {label}
    </span>
  );
}
