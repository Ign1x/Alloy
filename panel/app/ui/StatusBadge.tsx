"use client";

import type { ReactNode } from "react";

export default function StatusBadge({
  tone,
  children,
  className,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger";
  children: ReactNode;
  className?: string;
}) {
  const t = tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "danger" ? "danger" : "";
  return (
    <span className={["badge", "statusBadge", t, className].filter(Boolean).join(" ")}>
      <span className="statusBadgeDot" aria-hidden="true" />
      {children}
    </span>
  );
}

