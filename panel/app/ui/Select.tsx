"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

function findFirstEnabled(options: SelectOption[]) {
  for (let i = 0; i < options.length; i++) {
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

function findNextEnabled(options: SelectOption[], from: number, dir: 1 | -1) {
  if (!options.length) return -1;
  let i = from;
  for (let step = 0; step < options.length; step++) {
    i = (i + dir + options.length) % options.length;
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

export default function Select({
  value,
  onChange,
  options,
  disabled,
  placeholder = "Select…",
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  style?: any;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const selected = useMemo(() => options.find((o) => String(o.value) === String(value)) || null, [options, value]);
  const selectedLabel = selected ? selected.label : placeholder;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (el.contains(e.target as any)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => String(o.value) === String(value) && !o.disabled);
    setActiveIdx(idx >= 0 ? idx : findFirstEnabled(options));
  }, [open, options, value]);

  function commit(idx: number) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(String(opt.value));
    setOpen(false);
    btnRef.current?.focus();
  }

  function onButtonKeyDown(e: any) {
    if (disabled) return;
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const next = findNextEnabled(options, activeIdx >= 0 ? activeIdx : findFirstEnabled(options), 1);
      if (next >= 0) setActiveIdx(next);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const next = findNextEnabled(options, activeIdx >= 0 ? activeIdx : findFirstEnabled(options), -1);
      if (next >= 0) setActiveIdx(next);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (activeIdx >= 0) commit(activeIdx);
    }
  }

  return (
    <div ref={rootRef} className={`uiSelect ${open ? "open" : ""} ${disabled ? "disabled" : ""}`} style={style}>
      <button
        ref={btnRef}
        type="button"
        className="uiSelectButton"
        onClick={() => (!disabled ? setOpen((v) => !v) : null)}
        onKeyDown={onButtonKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!!disabled}
      >
        <span className="uiSelectValue">{selectedLabel}</span>
        <span className="uiSelectChevron" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="uiSelectMenu" role="listbox">
          {options.map((o, idx) => {
            const selected = String(o.value) === String(value);
            const active = idx === activeIdx;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`uiSelectOption ${selected ? "selected" : ""} ${active ? "active" : ""}`}
                disabled={!!o.disabled}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => commit(idx)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

