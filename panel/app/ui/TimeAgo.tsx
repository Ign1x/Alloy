"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { useAppI18n } from "../appCtx";

function normalizeLocaleTag(locale: any) {
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export default function TimeAgo({
  unix,
  fallback = "-",
  className,
}: {
  unix?: number | null;
  fallback?: ReactNode;
  className?: string;
}) {
  const { locale, fmtUnix } = useAppI18n();
  const localeTag = normalizeLocaleTag(locale);

  const relFmt = useMemo(() => {
    return new Intl.RelativeTimeFormat(localeTag, { numeric: "auto" });
  }, [localeTag]);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const ts = Number(unix || 0);
  if (!Number.isFinite(ts) || ts <= 0) return <>{fallback}</>;

  const absText = fmtUnix(ts);
  const deltaSec = Math.round((ts * 1000 - nowMs) / 1000);
  const absSec = Math.abs(deltaSec);

  let unit: Intl.RelativeTimeFormatUnit = "second";
  let value = deltaSec;
  if (absSec >= 60 && absSec < 3600) {
    unit = "minute";
    value = Math.round(deltaSec / 60);
  } else if (absSec >= 3600 && absSec < 86400) {
    unit = "hour";
    value = Math.round(deltaSec / 3600);
  } else if (absSec >= 86400 && absSec < 86400 * 30) {
    unit = "day";
    value = Math.round(deltaSec / 86400);
  } else if (absSec >= 86400 * 30 && absSec < 86400 * 365) {
    unit = "month";
    value = Math.round(deltaSec / (86400 * 30));
  } else if (absSec >= 86400 * 365) {
    unit = "year";
    value = Math.round(deltaSec / (86400 * 365));
  }

  const relText = relFmt.format(value, unit);
  return (
    <time className={className} dateTime={new Date(ts * 1000).toISOString()} title={absText}>
      {relText}
    </time>
  );
}
