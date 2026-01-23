"use client";

import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement, useId } from "react";

export default function Tooltip({ content, children, disabled }: { content: ReactNode; children: ReactElement; disabled?: boolean }) {
  const id = useId();

  if (disabled || !content) return children;
  if (!isValidElement(children)) return <>{children as any}</>;

  const prev = String((children.props as any)?.["aria-describedby"] || "").trim();
  const describedBy = prev ? `${prev} ${id}` : id;

  return (
    <span className="uiTooltipWrap">
      {cloneElement(children, { "aria-describedby": describedBy } as any)}
      <span role="tooltip" id={id} className="uiTooltip">
        {content}
      </span>
    </span>
  );
}

