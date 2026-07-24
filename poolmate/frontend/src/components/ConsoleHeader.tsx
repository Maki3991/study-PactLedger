import {
  ClipboardList,
  LayoutDashboard,
  ShieldCheck
} from "lucide-react";
import type { ReactNode } from "react";

export type ConsoleView = "runtime" | "orders";

interface ConsoleHeaderProps {
  activeView: ConsoleView;
  onNavigate(view: ConsoleView): void;
  actions?: ReactNode;
}

export function ConsoleHeader({
  activeView,
  onNavigate,
  actions
}: ConsoleHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">
          <ShieldCheck size={21} strokeWidth={1.8} />
        </span>
        <div>
          <h1>PoolMate</h1>
          <p>Operations console</p>
        </div>
      </div>
      <nav className="console-nav" aria-label="Console views">
        <button
          type="button"
          className={activeView === "runtime" ? "is-active" : undefined}
          aria-current={activeView === "runtime" ? "page" : undefined}
          onClick={() => onNavigate("runtime")}
        >
          <LayoutDashboard size={15} aria-hidden="true" />
          Runtime
        </button>
        <button
          type="button"
          className={activeView === "orders" ? "is-active" : undefined}
          aria-current={activeView === "orders" ? "page" : undefined}
          onClick={() => onNavigate("orders")}
        >
          <ClipboardList size={15} aria-hidden="true" />
          Orders
        </button>
      </nav>
      <div className="topbar__actions">{actions}</div>
    </header>
  );
}
