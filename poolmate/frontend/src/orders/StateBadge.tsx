import type { Severity } from "../components/StatusCard";

interface StateBadgeProps {
  label: string;
  severity: Severity;
}

export function StateBadge({ label, severity }: StateBadgeProps) {
  return <span className={`state-badge state-badge--${severity}`}>{label}</span>;
}
