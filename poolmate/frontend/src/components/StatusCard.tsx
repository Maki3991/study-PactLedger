import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  LoaderCircle,
  XCircle,
  type LucideIcon
} from "lucide-react";

export type Severity = "healthy" | "warning" | "error" | "neutral";

interface StatusCardProps {
  title: string;
  label: string;
  detail: string;
  rawStatus?: string;
  severity: Severity;
  loading?: boolean;
  icon: LucideIcon;
}

const severityIcons: Record<Severity, LucideIcon> = {
  healthy: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  neutral: CircleOff
};

export function StatusCard({
  title,
  label,
  detail,
  rawStatus,
  severity,
  loading = false,
  icon: Icon
}: StatusCardProps) {
  const StateIcon = loading ? LoaderCircle : severityIcons[severity];

  return (
    <article className={`status-card status-card--${severity}`}>
      <div className="status-card__heading">
        <span className="status-card__system-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <h2>{title}</h2>
      </div>
      <div
        className="status-card__state"
        aria-live="polite"
        aria-label={`${title}: ${label}`}
      >
        <StateIcon
          className={loading ? "spin" : undefined}
          size={17}
          strokeWidth={2}
          aria-hidden="true"
        />
        <strong>{label}</strong>
      </div>
      <p>{detail}</p>
      {rawStatus ? <code>{rawStatus}</code> : null}
    </article>
  );
}
