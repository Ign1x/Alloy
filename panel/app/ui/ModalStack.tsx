"use client";

import type { CSSProperties, ReactNode, RefObject } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type OverlayKind = "modal" | "drawer" | "menu" | "lightbox";

type StackItem = {
  id: string;
  kind: OverlayKind;
  lockScroll: boolean;
};

type ModalStackCtxValue = {
  stackVersion: number;
  register: (item: StackItem) => void;
  unregister: (id: string) => void;
  isTop: (id: string) => boolean;
  zIndexOf: (id: string) => number;
};

const ModalStackCtx = createContext<ModalStackCtxValue | null>(null);

const BASE_Z = 100;
const STEP_Z = 2;

function shouldLockScroll(kind: OverlayKind) {
  return kind === "modal" || kind === "drawer" || kind === "lightbox";
}

function isFocusable(el: HTMLElement) {
  const disabled = (el as any).disabled === true || el.getAttribute("aria-disabled") === "true";
  if (disabled) return false;
  const tabIndexAttr = el.getAttribute("tabindex");
  if (tabIndexAttr === "-1") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

function focusFirstIn(root: HTMLElement | null) {
  if (!root) return;
  const candidates = listFocusableIn(root);
  for (const el of candidates) {
    if (!isFocusable(el)) continue;
    try {
      el.focus();
      return;
    } catch {
      // ignore
    }
  }
  try {
    root.focus();
  } catch {
    // ignore
  }
}

function listFocusableIn(root: HTMLElement) {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  );
  return candidates.filter((el) => isFocusable(el));
}

function focusLastIn(root: HTMLElement | null) {
  if (!root) return;
  const candidates = listFocusableIn(root);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      candidates[i]!.focus();
      return;
    } catch {
      // ignore
    }
  }
  try {
    root.focus();
  } catch {
    // ignore
  }
}

function trapTabKey(e: any, root: HTMLElement | null) {
  if (!root) return;
  if (e.key !== "Tab") return;

  const focusables = listFocusableIn(root);
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (!focusables.length) {
    e.preventDefault();
    try {
      root.focus();
    } catch {
      // ignore
    }
    return;
  }

  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const idx = active ? focusables.indexOf(active) : -1;
  const shift = !!e.shiftKey;

  if (shift) {
    if (idx <= 0) {
      e.preventDefault();
      focusLastIn(root);
    }
    return;
  }
  if (idx < 0 || idx === focusables.length - 1) {
    e.preventDefault();
    focusFirstIn(root);
  }
}

export function ModalStackProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<StackItem[]>([]);
  const stackRef = useRef<StackItem[]>([]);
  stackRef.current = stack;

  const stackVersion = stack.length;

  const register = useCallback((item: StackItem) => {
    const id = String(item?.id || "").trim();
    if (!id) return;
    const kind: OverlayKind = item.kind === "drawer" || item.kind === "menu" || item.kind === "lightbox" ? item.kind : "modal";
    const lockScroll = item.lockScroll ?? shouldLockScroll(kind);
    setStack((prev) => {
      const next = prev.filter((x) => x.id !== id);
      next.push({ id, kind, lockScroll });
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    const key = String(id || "").trim();
    if (!key) return;
    setStack((prev) => prev.filter((x) => x.id !== key));
  }, []);

  const isTop = useCallback((id: string) => {
    const key = String(id || "").trim();
    const cur = stackRef.current;
    if (!key || !cur.length) return false;
    return cur[cur.length - 1]?.id === key;
  }, []);

  const zIndexOf = useCallback((id: string) => {
    const key = String(id || "").trim();
    const cur = stackRef.current;
    const idx = cur.findIndex((x) => x.id === key);
    if (idx < 0) return BASE_Z;
    return BASE_Z + idx * STEP_Z;
  }, []);

  const lock = useMemo(() => stack.some((x) => x.lockScroll), [stack]);
  useEffect(() => {
    if (!lock) return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarW = Math.max(0, (window.innerWidth || 0) - (document.documentElement?.clientWidth || 0));
    document.body.style.overflow = "hidden";
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [lock]);

  const value = useMemo<ModalStackCtxValue>(
    () => ({ stackVersion, register, unregister, isTop, zIndexOf }),
    [stackVersion, register, unregister, isTop, zIndexOf]
  );

  return <ModalStackCtx.Provider value={value}>{children}</ModalStackCtx.Provider>;
}

function useModalStack() {
  const ctx = useContext(ModalStackCtx);
  if (!ctx) throw new Error("ModalStackProvider missing");
  return ctx;
}

function useRegisterOverlay({
  id,
  open,
  kind,
  dialogRef,
  lockScroll,
}: {
  id: string;
  open: boolean;
  kind: OverlayKind;
  dialogRef: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
}) {
  const { stackVersion, register, unregister, isTop, zIndexOf } = useModalStack();
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    register({ id, kind, lockScroll: lockScroll ?? shouldLockScroll(kind) });
    const t = window.setTimeout(() => {
      const root = dialogRef.current;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (root && active && root.contains(active)) return;
      focusFirstIn(root);
    }, 0);
    return () => {
      window.clearTimeout(t);
      const wasTop = isTop(id);
      unregister(id);
      if (wasTop && restoreFocusRef.current && document.contains(restoreFocusRef.current)) {
        try {
          restoreFocusRef.current.focus();
        } catch {
          // ignore
        }
      }
    };
  }, [dialogRef, id, isTop, kind, lockScroll, open, register, unregister]);

  return { zIndex: zIndexOf(id), stackVersion };
}

export function ManagedModal({
  id,
  open,
  overlayClassName = "modalOverlay",
  overlayStyle,
  onOverlayClick,
  modalClassName = "modal",
  modalStyle,
  ariaLabel,
  lockScroll,
  children,
}: {
  id: string;
  open: boolean;
  overlayClassName?: string;
  overlayStyle?: CSSProperties;
  onOverlayClick?: (e: any) => void;
  modalClassName?: string;
  modalStyle?: CSSProperties;
  ariaLabel?: string;
  lockScroll?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { isTop } = useModalStack();
  const { zIndex } = useRegisterOverlay({ id, open, kind: "modal", dialogRef, lockScroll });
  if (!open) return null;
  return (
    <div className={overlayClassName} style={{ ...(overlayStyle || {}), zIndex }} onClick={onOverlayClick}>
      <div
        ref={dialogRef}
        className={modalClassName}
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e: any) => {
          if (!isTop(id)) return;
          if (e.key === "Escape") {
            if (!onOverlayClick) return;
            e.preventDefault();
            e.stopPropagation();
            onOverlayClick(e);
            return;
          }
          trapTabKey(e, dialogRef.current);
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ManagedDrawer({
  id,
  open,
  overlayClassName = "drawerOverlay",
  overlayStyle,
  onOverlayClick,
  drawerClassName = "drawer",
  drawerStyle,
  ariaLabel,
  lockScroll,
  children,
}: {
  id: string;
  open: boolean;
  overlayClassName?: string;
  overlayStyle?: CSSProperties;
  onOverlayClick?: (e: any) => void;
  drawerClassName?: string;
  drawerStyle?: CSSProperties;
  ariaLabel?: string;
  lockScroll?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { isTop } = useModalStack();
  const { zIndex } = useRegisterOverlay({ id, open, kind: "drawer", dialogRef, lockScroll });
  if (!open) return null;
  return (
    <div className={overlayClassName} style={{ ...(overlayStyle || {}), zIndex }} onClick={onOverlayClick}>
      <div
        ref={dialogRef}
        className={drawerClassName}
        style={drawerStyle}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e: any) => {
          if (!isTop(id)) return;
          if (e.key === "Escape") {
            if (!onOverlayClick) return;
            e.preventDefault();
            e.stopPropagation();
            onOverlayClick(e);
            return;
          }
          trapTabKey(e, dialogRef.current);
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ManagedLightbox({
  id,
  open,
  overlayClassName = "lightboxOverlay",
  overlayStyle,
  onOverlayClick,
  lightboxClassName = "lightbox",
  lightboxStyle,
  ariaLabel,
  lockScroll,
  children,
}: {
  id: string;
  open: boolean;
  overlayClassName?: string;
  overlayStyle?: CSSProperties;
  onOverlayClick?: (e: any) => void;
  lightboxClassName?: string;
  lightboxStyle?: CSSProperties;
  ariaLabel?: string;
  lockScroll?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { isTop } = useModalStack();
  const { zIndex } = useRegisterOverlay({ id, open, kind: "lightbox", dialogRef, lockScroll });
  if (!open) return null;
  return (
    <div className={overlayClassName} style={{ ...(overlayStyle || {}), zIndex }} onClick={onOverlayClick}>
      <div
        ref={dialogRef}
        className={lightboxClassName}
        style={lightboxStyle}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e: any) => {
          if (!isTop(id)) return;
          if (e.key === "Escape") {
            if (!onOverlayClick) return;
            e.preventDefault();
            e.stopPropagation();
            onOverlayClick(e);
            return;
          }
          trapTabKey(e, dialogRef.current);
        }}
      >
        {children}
      </div>
    </div>
  );
}
