"use client";

import type { CSSProperties, ReactNode } from "react";

import { useAppActions, useAppI18n } from "../appCtx";
import Icon from "./Icon";
import Tooltip from "./Tooltip";

function docLabel(doc: string, t: any) {
  const key = String(doc || "").trim().toLowerCase();
  if (key === "security") return t.tr("Security", "安全");
  if (key === "panel_readme") return "Panel";
  if (key === "changelog") return t.tr("Changelog", "更新日志");
  return "README";
}

export default function EnvHelpButton({
  env,
  doc = "readme",
  find,
  tooltip,
  ariaLabel,
  iconOnly = true,
  className,
  style,
  disabled,
}: {
  env: string | string[];
  doc?: "readme" | "security" | "panel_readme" | "changelog" | string;
  find?: string;
  tooltip?: ReactNode;
  ariaLabel?: string;
  iconOnly?: boolean;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
}) {
  const { t } = useAppI18n();
  const { openHelpDoc } = useAppActions();

  const envs = (Array.isArray(env) ? env : [env]).map((e) => String(e || "").trim()).filter(Boolean);
  const primary = String(find || envs[0] || "").trim();
  const docKey = String(doc || "").trim().toLowerCase();

  const envLabel = envs.length
    ? envs.length <= 3
      ? envs.join(", ")
      : `${envs.slice(0, 2).join(", ")} +${envs.length - 2}`
    : "";

  const content =
    tooltip ??
    (primary && envLabel
      ? t.tr(
          `Docs: ${docLabel(docKey, t)} · env: ${envLabel} · search: ${primary}`,
          `文档：${docLabel(docKey, t)} · 变量：${envLabel} · 搜索：${primary}`
        )
      : envLabel
        ? t.tr(`Docs: ${docLabel(docKey, t)} · env: ${envLabel}`, `文档：${docLabel(docKey, t)} · 变量：${envLabel}`)
        : primary
          ? t.tr(`Docs: ${docLabel(docKey, t)} · search: ${primary}`, `文档：${docLabel(docKey, t)} · 搜索：${primary}`)
          : t.tr(`Docs: ${docLabel(docKey, t)}`, `文档：${docLabel(docKey, t)}`));

  const aria = ariaLabel || t.tr("Open docs", "打开文档");
  const canOpen = !disabled && !!docKey;

  return (
    <Tooltip content={content} instant>
      <button
        type="button"
        className={["iconBtn", iconOnly ? "iconOnly" : "", className || ""].filter(Boolean).join(" ")}
        style={style}
        aria-label={aria}
        title={typeof content === "string" ? content : undefined}
        disabled={!canOpen}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!canOpen) return;
          openHelpDoc(docKey, { find: primary || "" });
        }}
      >
        <Icon name="help" />
        {iconOnly ? null : t.tr("Docs", "文档")}
      </button>
    </Tooltip>
  );
}
