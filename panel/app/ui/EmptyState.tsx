"use client";

import type { ReactNode } from "react";

export default function EmptyState({
  title,
  hint,
  actions,
  children,
  role,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  role?: string;
}) {
  return (
    <div className="emptyState" role={role || "note"}>
      <div className="emptyStateTitle">{title}</div>
      {hint ? <div className="emptyStateHint">{hint}</div> : null}
      {children}
      {actions ? <div className="emptyStateActions">{actions}</div> : null}
    </div>
  );
}

