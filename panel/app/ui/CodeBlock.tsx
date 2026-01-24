"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import CopyButton from "./CopyButton";

function normalizeNewlines(text: string) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function readBool(key: string, fallback: boolean) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeBool(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    // ignore
  }
}

export default function CodeBlock({
  text,
  maxHeight = 520,
  storageKey,
  initialWrap = false,
  initialLineNumbers = false,
  wrapLabel,
  lineNumbersLabel,
  title,
  hint,
  actions,
  showCopy = true,
  showWrapToggle = true,
  showLineNumbersToggle = true,
}: {
  text: string;
  maxHeight?: number;
  storageKey?: string;
  initialWrap?: boolean;
  initialLineNumbers?: boolean;
  wrapLabel?: string;
  lineNumbersLabel?: string;
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  showCopy?: boolean;
  showWrapToggle?: boolean;
  showLineNumbersToggle?: boolean;
}) {
  const storageWrapKey = storageKey ? `elegantmc_codeblock_wrap_v1:${storageKey}` : "";
  const storageLinesKey = storageKey ? `elegantmc_codeblock_lines_v1:${storageKey}` : "";

  const [wrap, setWrap] = useState<boolean>(() => (storageWrapKey ? readBool(storageWrapKey, initialWrap) : initialWrap));
  const [lineNumbers, setLineNumbers] = useState<boolean>(() =>
    storageLinesKey ? readBool(storageLinesKey, initialLineNumbers) : initialLineNumbers
  );

  useEffect(() => {
    if (!storageWrapKey) return;
    setWrap(readBool(storageWrapKey, initialWrap));
  }, [initialWrap, storageWrapKey]);

  useEffect(() => {
    if (!storageLinesKey) return;
    setLineNumbers(readBool(storageLinesKey, initialLineNumbers));
  }, [initialLineNumbers, storageLinesKey]);

  useEffect(() => {
    if (!storageWrapKey) return;
    writeBool(storageWrapKey, wrap);
  }, [storageWrapKey, wrap]);

  useEffect(() => {
    if (!storageLinesKey) return;
    writeBool(storageLinesKey, lineNumbers);
  }, [storageLinesKey, lineNumbers]);

  const normalized = useMemo(() => normalizeNewlines(text), [text]);
  const lines = useMemo(() => (lineNumbers ? normalized.split("\n") : []), [lineNumbers, normalized]);

  const preStyle = useMemo(() => {
    const style: any = {
      whiteSpace: wrap ? "pre-wrap" : "pre",
      wordBreak: wrap ? "break-word" : "normal",
      overflowWrap: wrap ? "anywhere" : "normal",
    };
    if (!lineNumbers) style.padding = "10px 12px";
    return style;
  }, [lineNumbers, wrap]);

  return (
    <div className="codeFrame" style={{ maxHeight }}>
      {title || hint || showWrapToggle || showLineNumbersToggle || showCopy || actions ? (
        <div className="codeToolbar">
          <div style={{ minWidth: 0 }}>
            {title ? <div className="codeToolbarTitle">{title}</div> : null}
            {hint ? <div className="hint codeToolbarHint">{hint}</div> : null}
          </div>
          <div className="row" style={{ justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {showLineNumbersToggle ? (
              <button type="button" className={`chip ${lineNumbers ? "active" : ""}`} onClick={() => setLineNumbers((v) => !v)}>
                {lineNumbersLabel || "Lines"}
              </button>
            ) : null}
            {showWrapToggle ? (
              <button type="button" className={`chip ${wrap ? "active" : ""}`} onClick={() => setWrap((v) => !v)}>
                {wrapLabel || "Wrap"}
              </button>
            ) : null}
            {showCopy ? <CopyButton text={normalized} iconOnly /> : null}
            {actions || null}
          </div>
        </div>
      ) : null}
      <pre className="codePre" style={preStyle}>
        {lineNumbers
          ? lines.map((l, i) => (
              <span key={i} className="codeLine">
                {l || "\u00A0"}
              </span>
            ))
          : normalized || ""}
      </pre>
    </div>
  );
}
