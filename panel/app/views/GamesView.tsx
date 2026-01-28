"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppActions, useAppCore, useAppFiles, useAppGames, useAppI18n } from "../appCtx";
import CopyButton from "../ui/CopyButton";
import EmptyState from "../ui/EmptyState";
import Icon from "../ui/Icon";
import { ManagedModal } from "../ui/ModalStack";
import Select from "../ui/Select";
import DangerZone from "../ui/DangerZone";
import Sparkline from "../ui/Sparkline";
import TimeAgo from "../ui/TimeAgo";
import StatusBadge from "../ui/StatusBadge";

type RenderLogLine = {
  text: string;
  textLower: string;
  level: "" | "warn" | "error";
  issueClass: "" | "issueWarn" | "issueDanger";
};

type CommonLogIssueID = "eula" | "port" | "oom" | "java" | "jar" | "frp_auth";

function getPropValue(text: string, key: string) {
  const k = `${key}=`;
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith(k)) return t.slice(k.length).trim();
  }
  return null;
}

function upsertProp(text: string, key: string, value: string) {
  const k = `${key}=`;
  const lines = String(text || "").split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    if (t.startsWith(k)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  return out.join("\n").replace(/\n+$/, "\n");
}

function detectCommonLogIssueId({ upper, source }: { upper: string; source: string }): CommonLogIssueID | null {
  // EULA
  if (upper.includes("YOU NEED TO AGREE TO THE EULA") || upper.includes("SET EULA=TRUE") || upper.includes("EULA.TXT")) return "eula";

  // Port binding
  if (upper.includes("FAILED TO BIND TO PORT") || upper.includes("BINDEXCEPTION") || upper.includes("ADDRESS ALREADY IN USE")) return "port";

  // Out of memory
  if (upper.includes("OUTOFMEMORYERROR") || upper.includes("JAVA HEAP SPACE") || upper.includes("GC OVERHEAD LIMIT EXCEEDED")) return "oom";

  // Java version mismatch
  if (upper.includes("UNSUPPORTEDCLASSVERSIONERROR") || upper.includes("CLASS FILE VERSION")) return "java";

  // Jar/runtime bootstrap failures
  if (
    upper.includes("UNABLE TO ACCESS JARFILE") ||
    upper.includes("NO MAIN MANIFEST ATTRIBUTE") ||
    upper.includes("COULD NOT FIND OR LOAD MAIN CLASS")
  ) {
    return "jar";
  }

  // FRP auth failures (from frpc)
  if (source === "frp" && (upper.includes("AUTHENTICATION FAILED") || upper.includes("INVALID TOKEN") || upper.includes("TOKEN IS NOT CORRECT"))) {
    return "frp_auth";
  }

  return null;
}

function highlightText(text: string, qLower: string) {
  const q = String(qLower || "").trim().toLowerCase();
  if (!q) return text;
  const t = String(text || "");
  if (t.length > 12_000) return text;
  const lower = t.toLowerCase();
  const parts: any[] = [];
  let i = 0;
  let hits = 0;
  const maxHits = 32;
  while (i < t.length && hits < maxHits) {
    const at = lower.indexOf(q, i);
    if (at < 0) break;
    if (at > i) parts.push(t.slice(i, at));
    parts.push(
      <mark key={`m-${hits}`} className="logMark">
        {t.slice(at, at + q.length)}
      </mark>
    );
    hits += 1;
    i = at + q.length;
  }
  if (!parts.length) return text;
  if (i < t.length) parts.push(t.slice(i));
  return parts;
}

function highlightRegex(text: string, re: RegExp) {
  if (!re) return text;
  const t = String(text || "");
  if (!t) return text;
  if (t.length > 12_000) return text;

  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  let rgx: RegExp;
  try {
    rgx = new RegExp(re.source, flags);
  } catch {
    return text;
  }

  const parts: any[] = [];
  let last = 0;
  let hits = 0;
  const maxHits = 32;
  while (hits < maxHits) {
    const m = rgx.exec(t);
    if (!m) break;
    const at = typeof m.index === "number" ? m.index : -1;
    const match = String(m[0] || "");
    if (at < 0) break;
    const end = at + match.length;
    if (end <= at) {
      rgx.lastIndex = at + 1;
      continue;
    }
    if (at > last) parts.push(t.slice(last, at));
    parts.push(
      <mark key={`m-${hits}`} className="logMark">
        {t.slice(at, end)}
      </mark>
    );
    hits += 1;
    last = end;
  }
  if (!parts.length) return text;
  if (last < t.length) parts.push(t.slice(last));
  return parts;
}

function parseTpsFromLines(lines: string[]) {
  let tps: [number, number, number] | null = null;
  let mspt: number | null = null;
  const toNum = (s: string) => {
    const n = Number.parseFloat(String(s || "").trim());
    return Number.isFinite(n) ? n : null;
  };

  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = String(raw || "");
    const m =
      line.match(/TPS\s+from\s+last[^:]*:\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i) ||
      line.match(/\bTPS\b[^0-9]*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
    if (m) {
      const a = toNum(m[1] || "");
      const b = toNum(m[2] || "");
      const c = toNum(m[3] || "");
      if (a != null && b != null && c != null) tps = [a, b, c];
    }
    const mm = line.match(/\b(?:Tick Time|MSPT)\b[^0-9]*([0-9.]+)\s*ms/i);
    if (mm) {
      const n = toNum(mm[1] || "");
      if (n != null) mspt = n;
    }
  }

  if (!tps) return null;
  return { tps1: tps[0], tps5: tps[1], tps15: tps[2], mspt };
}

const USERCACHE_EXPIRY_WINDOW_SEC = 86400 * 30;

function parseUsercacheExpiresOnUnix(expiresOnRaw: string): number | null {
  const raw = String(expiresOnRaw || "").trim();
  if (!raw) return null;

  const m = raw.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/
  );
  if (m) {
    const date = m[1] || "";
    const time = m[2] || "";
    let tz = m[3] || "Z";
    if (tz !== "Z") {
      const tzm = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
      if (tzm) tz = `${tzm[1]}${tzm[2]}:${tzm[3]}`;
      else tz = "Z";
    }
    const ms = Date.parse(`${date}T${time}${tz}`);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function estimateUsercacheLastSeenUnix(expiresUnix: number | null): number | null {
  const ts = Number(expiresUnix || 0);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const last = ts - USERCACHE_EXPIRY_WINDOW_SEC;
  return last > 0 ? last : null;
}

function GamesView() {
  const { t, fmtUnix, fmtTime, fmtBytes } = useAppI18n();
  const { copyText, pushToast, confirmDialog, openHelpModal, joinRelPath, openShareView } = useAppActions();
  const { selectedDaemon, setTab, shareMode } = useAppCore();
  const {
    serverDirs,
    serverDirsStatus,
    refreshServerDirs,
    instanceId,
    setInstanceId,
    instanceTagsById,
    updateInstanceTags,
    favoriteInstanceIds,
    toggleFavoriteInstance,
    instanceNotesById,
    updateInstanceNote,
    instanceMetaById,
    openSettingsModal,
    openJarUpdateModal,
    openInstallModal,
    startServer,
    startServerFromSavedConfig,
    stopServer,
    restartServer,
    deleteServer,
    backupServer,
    openTrashModal,
    openDatapackModal,
    openResourcePackModal,
    exportInstanceZip,
    downloadWorldZip,
    openServerPropertiesEditor,
    renameInstance,
    cloneInstance,
    backupZips,
    backupZipsStatus,
    refreshBackupZips,
    backupRetentionKeepLast,
    saveBackupRetentionKeepLast,
    pruneBackups,
    restoreBackupNow,
    frpOpStatus,
    serverOpStatus,
    gameActionBusy,
    instanceStatus,
    frpStatus,
    localHost,
    gamePort,
    enableFrp,
    selectedProfile,
    frpRemotePort,
    logView,
    setLogView,
    logs,
    logsLoadedOnce,
    consoleLine,
    setConsoleLine,
    sendConsoleLine,
    downloadLatestLog,
    mcLogSearch,
    instanceUsageBytes,
    instanceUsageStatus,
    instanceUsageBusy,
    computeInstanceUsage,
    instanceMetricsHistory,
    instanceMetricsStatus,
    crashArtifacts,
    crashArtifactsStatus,
    crashArtifactsBusy,
    refreshCrashArtifacts,
    downloadCrashArtifact,
    startFrpProxyNow,
    restartFrpProxyNow,
    stopFrpProxyNow,
    readFrpProxyIniNow,
    probeTcpFromDaemonNow,
    repairInstance,
    updateModrinthPack,
  } = useAppGames();
  const { setFsPath, openFileByPath, fsReadText, fsWriteText } = useAppFiles();

  const running = !!instanceStatus?.running;
  const canControl = !!selectedDaemon?.connected && !!instanceId.trim() && !gameActionBusy;
  const gamesLoading = serverDirsStatus === t.tr("Loading...", "加载中...") && !serverDirs.length;
  const logsLoading = !logsLoadedOnce && !!selectedDaemon?.connected;

  async function acceptEulaNowLocal(instanceOverride?: string) {
    const inst = String(instanceOverride ?? instanceId).trim();
    if (!inst) return;
    if (!selectedDaemon?.connected) {
      pushToast({ kind: "error", message: t.tr("daemon offline", "daemon 离线") });
      return;
    }

    const eulaPath = joinRelPath(inst, "eula.txt");
    let baseText = "";
    try {
      baseText = await fsReadText(eulaPath, 10_000);
      const v = String(getPropValue(baseText, "eula") || "").trim().toLowerCase();
      if (v === "true") {
        pushToast({ kind: "ok", message: t.tr("EULA already accepted", "EULA 已接受") });
        return;
      }
    } catch {
      baseText = "";
    }

    const ok = await confirmDialog(
      t.tr(
        `Minecraft requires accepting the Mojang EULA.\nEULA: https://www.minecraft.net/en-us/eula\n\nWrite servers/${inst}/eula.txt with eula=true?`,
        `Minecraft 需要接受 Mojang EULA。\nEULA: https://www.minecraft.net/en-us/eula\n\n是否写入 servers/${inst}/eula.txt 为 eula=true？`
      ),
      { title: t.tr("Accept EULA", "接受 EULA"), confirmLabel: t.tr("Accept", "接受"), cancelLabel: t.tr("Cancel", "取消") }
    );
    if (!ok) return;

    const nextText = baseText
      ? upsertProp(baseText, "eula", "true")
      : "# Generated by ElegantMC\n# By changing the setting below to TRUE you are indicating your agreement to the EULA (https://www.minecraft.net/en-us/eula).\n\n" +
        "eula=true\n";
    try {
      await fsWriteText(eulaPath, nextText, 10_000);
      pushToast({ kind: "ok", message: t.tr("EULA accepted", "EULA 已接受") });
    } catch (e: any) {
      pushToast({ kind: "error", message: t.tr("Failed to write eula.txt", "写入 eula.txt 失败"), detail: String(e?.message || e) });
    }
  }

  const [logQueryRaw, setLogQueryRaw] = useState<string>("");
  const [logQuery, setLogQuery] = useState<string>("");
  const [logRegex, setLogRegex] = useState<boolean>(false);
  const [logMatchOnly, setLogMatchOnly] = useState<boolean>(false);
  const [logLevelFilter, setLogLevelFilter] = useState<"all" | "warn" | "error">("all");
  const [logTimeMode, setLogTimeMode] = useState<"local" | "relative">("local");
  const [logPreset, setLogPreset] = useState<string>("");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [wrapLogs, setWrapLogs] = useState<boolean>(true);
  const [highlightLogs, setHighlightLogs] = useState<boolean>(true);
  const [historySearchOpen, setHistorySearchOpen] = useState<boolean>(false);
  const [historySearchBusy, setHistorySearchBusy] = useState<boolean>(false);
  const [historySearchStatus, setHistorySearchStatus] = useState<string>("");
  const [historySearchQuery, setHistorySearchQuery] = useState<string>("");
  const [historySearchRegex, setHistorySearchRegex] = useState<boolean>(false);
  const [historySearchMaxFiles, setHistorySearchMaxFiles] = useState<number>(12);
  const [historySearchMaxMatches, setHistorySearchMaxMatches] = useState<number>(200);
  const [historySearchBefore, setHistorySearchBefore] = useState<number>(0);
  const [historySearchAfter, setHistorySearchAfter] = useState<number>(0);
  const [historySearchResult, setHistorySearchResult] = useState<any | null>(null);
  const [logSelectStart, setLogSelectStart] = useState<number | null>(null);
  const [logSelectEnd, setLogSelectEnd] = useState<number | null>(null);
  const [logBookmarksOpen, setLogBookmarksOpen] = useState<boolean>(false);
  const [logBookmarks, setLogBookmarks] = useState<
    { id: string; inst: string; view: string; label: string; text: string; createdAtUnix: number; lineIdxHint: number }[]
  >([]);
  const [logBookmarksQueryRaw, setLogBookmarksQueryRaw] = useState<string>("");
  const [logBookmarksQuery, setLogBookmarksQuery] = useState<string>("");
  const [frpDiagOpen, setFrpDiagOpen] = useState<boolean>(false);
  const [frpDiagProxyName, setFrpDiagProxyName] = useState<string>("");
  const [frpDiagRevealToken, setFrpDiagRevealToken] = useState<boolean>(false);
  const [frpDiagIni, setFrpDiagIni] = useState<string>("");
  const [frpDiagIniStatus, setFrpDiagIniStatus] = useState<string>("");
  const [frpDiagIniBusy, setFrpDiagIniBusy] = useState<boolean>(false);
  const [frpDiagProbeStatus, setFrpDiagProbeStatus] = useState<string>("");
  const [frpDiagProbeBusy, setFrpDiagProbeBusy] = useState<boolean>(false);
  const [frpDiagProbeResult, setFrpDiagProbeResult] = useState<any | null>(null);
  const [logFindIdx, setLogFindIdx] = useState<number>(0);
  const [logPaused, setLogPaused] = useState<boolean>(false);
  const [logClearAtUnix, setLogClearAtUnix] = useState<number>(0);
  const [pausedLogs, setPausedLogs] = useState<any[] | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const consoleInputRef = useRef<HTMLInputElement | null>(null);
  const [logScrollTop, setLogScrollTop] = useState<number>(0);
  const [logViewportHeight, setLogViewportHeight] = useState<number>(640);
  const [logNearBottom, setLogNearBottom] = useState<boolean>(true);
  const [newLogsCount, setNewLogsCount] = useState<number>(0);
  const prevLogLinesLenRef = useRef<number>(0);

  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState<number>(0);
  const [gameQueryRaw, setGameQueryRaw] = useState<string>("");
  const [gameQuery, setGameQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped">("all");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [tagsDraft, setTagsDraft] = useState<string>("");
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [compactActions, setCompactActions] = useState<boolean>(false);

  const [cmdOutputs, setCmdOutputs] = useState<
    { id: string; cmd: string; startedUnix: number; lines: string[] }[]
  >([]);
  const [cmdCapture, setCmdCapture] = useState<{
    id: string;
    inst: string;
    cmd: string;
    startedUnix: number;
    nextLogIdx: number;
  } | null>(null);
  const cmdCaptureLinesRef = useRef<string[]>([]);
  const [cmdCaptureLines, setCmdCaptureLines] = useState<string[]>([]);

  const [accessTab, setAccessTab] = useState<"players" | "whitelist" | "ops">("players");

  const [playersStatus, setPlayersStatus] = useState<string>("");
  const [playersBusy, setPlayersBusy] = useState<boolean>(false);
  const [players, setPlayers] = useState<{ name: string; uuid: string; expiresOn: string }[]>([]);
  const [playersQueryRaw, setPlayersQueryRaw] = useState<string>("");
  const [playersQuery, setPlayersQuery] = useState<string>("");
  const [playersSort, setPlayersSort] = useState<"name" | "lastSeen">("lastSeen");

  const [whitelistStatus, setWhitelistStatus] = useState<string>("");
  const [whitelistBusy, setWhitelistBusy] = useState<boolean>(false);
  const [whitelistDirty, setWhitelistDirty] = useState<boolean>(false);
  const [whitelistEntries, setWhitelistEntries] = useState<{ name: string; uuid: string }[]>([]);
  const [wlAddName, setWlAddName] = useState<string>("");
  const [wlAddUuid, setWlAddUuid] = useState<string>("");
  const [wlErr, setWlErr] = useState<string>("");

  const [opsStatus, setOpsStatus] = useState<string>("");
  const [opsBusy, setOpsBusy] = useState<boolean>(false);
  const [opsDirty, setOpsDirty] = useState<boolean>(false);
  const [opsEntries, setOpsEntries] = useState<{ name: string; uuid: string; level: number; bypassesPlayerLimit: boolean }[]>([]);
  const [opAddName, setOpAddName] = useState<string>("");
  const [opAddUuid, setOpAddUuid] = useState<string>("");
  const [opAddLevel, setOpAddLevel] = useState<number>(4);
  const [opAddBypass, setOpAddBypass] = useState<boolean>(true);
  const [opErr, setOpErr] = useState<string>("");

  const [packManifest, setPackManifest] = useState<any | null>(null);
  const [packManifestStatus, setPackManifestStatus] = useState<string>("");

  const [backupMetaByPath, setBackupMetaByPath] = useState<Record<string, any>>({});
  const [dangerRestorePath, setDangerRestorePath] = useState<string>("");
  const [backupNewOpen, setBackupNewOpen] = useState<boolean>(false);
  const [backupNewFormat, setBackupNewFormat] = useState<"zip" | "tar.gz">("tar.gz");
  const [backupNewStop, setBackupNewStop] = useState<boolean>(true);
  const [backupNewKeepLast, setBackupNewKeepLast] = useState<number>(0);
  const [backupNewComment, setBackupNewComment] = useState<string>("");

  const [backupRetentionOpen, setBackupRetentionOpen] = useState<boolean>(false);
  const [backupRetentionDraft, setBackupRetentionDraft] = useState<number>(0);

  const [tpsInfo, setTpsInfo] = useState<{
    atUnix: number;
    tps1: number | null;
    tps5: number | null;
    tps15: number | null;
    mspt: number | null;
  } | null>(null);
  const [tpsStatus, setTpsStatus] = useState<string>("");
  const lastTpsParsedIdRef = useRef<string>("");

  const socketText = useMemo(() => {
    if (frpStatus?.running && frpStatus.remote_port) {
      return `${frpStatus.remote_addr}:${frpStatus.remote_port}`;
    }
    const ip = localHost || "127.0.0.1";
    return `${ip}:${Math.round(Number(gamePort || 25565))}`;
  }, [frpStatus, localHost, gamePort]);

  useEffect(() => {
    const t = window.setTimeout(() => setGameQuery(gameQueryRaw), 150);
    return () => window.clearTimeout(t);
  }, [gameQueryRaw]);

  useEffect(() => {
    const t = window.setTimeout(() => setPlayersQuery(playersQueryRaw), 150);
    return () => window.clearTimeout(t);
  }, [playersQueryRaw]);

  useEffect(() => {
    const t = window.setTimeout(() => setLogBookmarksQuery(logBookmarksQueryRaw), 150);
    return () => window.clearTimeout(t);
  }, [logBookmarksQueryRaw]);

  const playersView = useMemo(() => {
    const q = String(playersQuery || "").trim().toLowerCase();
    const list = (Array.isArray(players) ? players : []).filter((p) => {
      if (!q) return true;
      return `${p.name} ${p.uuid} ${p.expiresOn}`.toLowerCase().includes(q);
    });

    const withTs = list.map((p) => {
      const expiresUnix = parseUsercacheExpiresOnUnix(p.expiresOn);
      const lastSeenUnix = estimateUsercacheLastSeenUnix(expiresUnix);
      return { ...p, expiresUnix, lastSeenUnix };
    });

    withTs.sort((a: any, b: any) => {
      if (playersSort === "lastSeen") {
        const ax = Number(a?.lastSeenUnix || 0);
        const bx = Number(b?.lastSeenUnix || 0);
        if (ax !== bx) return bx - ax;
        const an = String(a?.name || "");
        const bn = String(b?.name || "");
        return an.localeCompare(bn);
      }
      const an = String(a?.name || "");
      const bn = String(b?.name || "");
      const c = an.localeCompare(bn);
      if (c) return c;
      return String(a?.uuid || "").localeCompare(String(b?.uuid || ""));
    });

    return withTs as Array<{ name: string; uuid: string; expiresOn: string; expiresUnix: number | null; lastSeenUnix: number | null }>;
  }, [players, playersQuery, playersSort]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 520px)");
    const onChange = () => setCompactActions(!!mq.matches);
    onChange();
    if (typeof (mq as any).addEventListener === "function") (mq as any).addEventListener("change", onChange);
    else (mq as any).addListener(onChange);
    return () => {
      if (typeof (mq as any).removeEventListener === "function") (mq as any).removeEventListener("change", onChange);
      else (mq as any).removeListener(onChange);
    };
  }, []);

  const runningById = useMemo(() => {
    const list = Array.isArray((selectedDaemon as any)?.heartbeat?.instances) ? (selectedDaemon as any).heartbeat.instances : [];
    const out: Record<string, boolean> = {};
    for (const it of list) {
      const id = String((it as any)?.id || "").trim();
      if (!id) continue;
      out[id] = !!(it as any)?.running;
    }
    return out;
  }, [selectedDaemon]);

  const favoriteSet = useMemo(() => {
    const set = new Set<string>();
    const list = Array.isArray(favoriteInstanceIds) ? favoriteInstanceIds : [];
    for (const id of list) {
      const s = String(id || "").trim();
      if (s) set.add(s);
    }
    return set;
  }, [favoriteInstanceIds]);

  const currentTags = useMemo(() => {
    const inst = String(instanceId || "").trim();
    if (!inst) return [] as string[];
    const list = (instanceTagsById && (instanceTagsById as any)[inst]) || [];
    return Array.isArray(list) ? list.map((s: any) => String(s || "").trim()).filter(Boolean) : [];
  }, [instanceId, instanceTagsById]);

  const currentNote = useMemo(() => {
    const inst = String(instanceId || "").trim();
    if (!inst) return "";
    return String((instanceNotesById && (instanceNotesById as any)[inst]) || "");
  }, [instanceId, instanceNotesById]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const id of serverDirs || []) {
      const list = (instanceTagsById && (instanceTagsById as any)[id]) || [];
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        const s = String(t || "").trim();
        if (s) set.add(s);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [serverDirs, instanceTagsById]);

  const filteredServerDirs = useMemo(() => {
    const tag = String(tagFilter || "").trim().toLowerCase();
    const q = String(gameQuery || "").trim().toLowerCase();
    const sf = statusFilter;
    return (serverDirs || []).filter((id: string) => {
      const tags = (instanceTagsById && (instanceTagsById as any)[id]) || [];
      const tagList = Array.isArray(tags) ? tags.map((s: any) => String(s || "").trim()).filter(Boolean) : [];

      if (tag) {
        if (!tagList.some((t: string) => t.toLowerCase() === tag)) return false;
      }

      if (sf !== "all") {
        const running = !!runningById[id];
        if (sf === "running" && !running) return false;
        if (sf === "stopped" && running) return false;
      }

      if (q) {
        const hay = [id, ...tagList].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [serverDirs, instanceTagsById, tagFilter, gameQuery, statusFilter, runningById]);

  useEffect(() => {
    setTagsDraft(currentTags.join(", "));
  }, [instanceId, currentTags.join("|")]);

  useEffect(() => {
    setNoteDraft(currentNote);
  }, [instanceId, currentNote]);

  function saveTags() {
    const inst = instanceId.trim();
    if (!inst) return;
    const tags = String(tagsDraft || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    updateInstanceTags(inst, tags);
  }

  function saveNote() {
    const inst = instanceId.trim();
    if (!inst) return;
    updateInstanceNote(inst, noteDraft);
  }

  const sortedServerDirs = useMemo(() => {
    const list = (filteredServerDirs || []).slice();
    list.sort((a: string, b: string) => {
      const af = favoriteSet.has(a) ? 1 : 0;
      const bf = favoriteSet.has(b) ? 1 : 0;
      if (af !== bf) return bf - af;
      return a.localeCompare(b);
    });
    return list;
  }, [filteredServerDirs, favoriteSet]);

  const instVirtualEnabled = sortedServerDirs.length > 220;
  const instRowH = 86;
  const instListScrollRef = useRef<HTMLDivElement | null>(null);
  const [instListScrollTop, setInstListScrollTop] = useState<number>(0);
  const [instListViewportH, setInstListViewportH] = useState<number>(520);
  const [instListPendingFocusIdx, setInstListPendingFocusIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!instVirtualEnabled) return;
    const el = instListScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setInstListViewportH(Math.max(120, el.clientHeight || 520));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [instVirtualEnabled]);

  const instListVirtual = useMemo(() => {
    const list = Array.isArray(sortedServerDirs) ? sortedServerDirs : [];
    const total = list.length;
    const enabled = instVirtualEnabled;
    if (!enabled) return { enabled: false, visible: list, start: 0, topPad: 0, bottomPad: 0 };

    const overscan = 8;
    const start = Math.max(0, Math.floor(instListScrollTop / instRowH) - overscan);
    const visibleCount = Math.ceil(instListViewportH / instRowH) + overscan * 2;
    const end = Math.min(total, start + visibleCount);
    const topPad = start * instRowH;
    const bottomPad = Math.max(0, (total - end) * instRowH);
    return { enabled: true, visible: list.slice(start, end), start, topPad, bottomPad };
  }, [sortedServerDirs, instVirtualEnabled, instListScrollTop, instListViewportH]);

  function focusInstRow(idx: number) {
    if (!instListVirtual.enabled) return;
    const total = sortedServerDirs.length;
    const next = Math.max(0, Math.min(total - 1, Math.round(Number(idx || 0))));
    const el = instListScrollRef.current;
    if (el) {
      const top = next * instRowH;
      const bottom = top + instRowH;
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;
      if (top < viewTop) el.scrollTop = top;
      else if (bottom > viewBottom) el.scrollTop = Math.max(0, bottom - el.clientHeight);
    }
    setInstListPendingFocusIdx(next);
  }

  useEffect(() => {
    if (!instListVirtual.enabled) return;
    if (instListPendingFocusIdx == null) return;
    const start = instListVirtual.start;
    const end = start + instListVirtual.visible.length;
    if (instListPendingFocusIdx < start || instListPendingFocusIdx >= end) return;
    const root = instListScrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-virt-idx="${instListPendingFocusIdx}"]`);
    if (!el) return;
    try {
      el.focus();
      setInstListPendingFocusIdx(null);
    } catch {
      // ignore
    }
  }, [instListPendingFocusIdx, instListVirtual.enabled, instListVirtual.start, instListVirtual.visible.length]);

  const instanceProxies = useMemo(() => {
    const inst = String(instanceId || "").trim();
    const list = Array.isArray(selectedDaemon?.heartbeat?.frp_proxies) ? selectedDaemon.heartbeat.frp_proxies : [];
    if (!inst || !list.length) return [];
    const prefix = `${inst}-`;
    return list.filter((p: any) => {
      const name = String(p?.proxy_name || "").trim();
      return name === inst || name.startsWith(prefix);
    });
  }, [selectedDaemon, instanceId]);

  const frpProxyLastErrByName = useMemo(() => {
    const out: Record<string, string> = {};
    const list = Array.isArray(logs) ? logs : [];
    const maxScan = 5000;
    let scanned = 0;
    for (let i = list.length - 1; i >= 0 && scanned < maxScan; i--, scanned++) {
      const l: any = list[i];
      if (l?.source !== "frp") continue;
      if (String(l?.stream || "") !== "stderr") continue;
      const name = String(l?.instance || "").trim();
      if (!name || out[name]) continue;
      const line = String(l?.line || "").trim();
      if (!line) continue;
      out[name] = line.slice(0, 2000);
    }
    return out;
  }, [logs]);

  const frpDiagProxyOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const inst = instanceId.trim();
    if (inst && !seen.has(inst)) {
      seen.add(inst);
      out.push({ value: inst, label: inst });
    }
    for (const p of Array.isArray(instanceProxies) ? instanceProxies : []) {
      const name = String((p as any)?.proxy_name || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ value: name, label: name });
    }
    return out;
  }, [instanceId, instanceProxies]);

  const frpDiagLogTailText = useMemo(() => {
    const name = frpDiagProxyName.trim();
    if (!name) return "";
    const list = Array.isArray(logs) ? logs : [];
    const out: string[] = [];
    for (let i = list.length - 1; i >= 0 && out.length < 200; i--) {
      const l: any = list[i];
      if (l?.source !== "frp") continue;
      if (String(l?.instance || "").trim() !== name) continue;
      const tsUnix = Number(l?.ts_unix || 0);
      const ts = Number.isFinite(tsUnix) && tsUnix > 0 ? fmtTime(tsUnix) : "--:--:--";
      const stream = String(l?.stream || "");
      const line = String(l?.line || "");
      out.push(`[${ts}] ${stream}: ${line}`);
    }
    out.reverse();
    return out.join("\n");
  }, [logs, frpDiagProxyName, fmtTime]);

  const perf = useMemo(() => {
    const hist = Array.isArray(instanceMetricsHistory) ? instanceMetricsHistory : [];
    const memTotalBytes = Math.floor(Number(selectedDaemon?.heartbeat?.mem?.total_bytes || 0));
    const cpuValues = hist.map((p: any) => (typeof p?.cpu_percent === "number" ? p.cpu_percent : null));
    const memPctValues = hist.map((p: any) => {
      if (memTotalBytes <= 0) return null;
      const rss = typeof p?.mem_rss_bytes === "number" ? p.mem_rss_bytes : null;
      if (rss == null) return null;
      const pct = (Number(rss) * 100) / memTotalBytes;
      return Number.isFinite(pct) ? pct : null;
    });
    const last = hist.length ? hist[hist.length - 1] : null;
    const cpuLatest = typeof (last as any)?.cpu_percent === "number" ? (last as any).cpu_percent : null;
    const memLatestBytes = typeof (last as any)?.mem_rss_bytes === "number" ? (last as any).mem_rss_bytes : null;
    const memLatestPct =
      memTotalBytes > 0 && typeof memLatestBytes === "number" ? (Number(memLatestBytes) * 100) / memTotalBytes : null;
    return { hist, memTotalBytes, cpuValues, memPctValues, cpuLatest, memLatestBytes, memLatestPct };
  }, [instanceMetricsHistory, selectedDaemon]);

  const lastBackup = useMemo(() => {
    const list = Array.isArray(backupZips) ? backupZips : [];
    if (!list.length) return { unix: null as number | null, file: "" };
    const p = String(list[0] || "");
    const file = p.split("/").pop() || p;
    const meta = backupMetaByPath[p];
    const metaUnix = Math.floor(Number(meta?.created_at_unix || 0));
    if (Number.isFinite(metaUnix) && metaUnix > 0) return { unix: metaUnix, file };
    const m = file.match(/-(\d{9,12})\.(?:zip|tar\.gz|tgz)$/i);
    const unix = m ? Number(m[1]) : null;
    return { unix: Number.isFinite(Number(unix)) ? Number(unix) : null, file };
  }, [backupZips, backupMetaByPath]);

  const backupRetentionPreview = useMemo(() => {
    const all = Array.isArray(backupZips) ? backupZips : [];
    const keepLast = Math.max(0, Math.min(1000, Math.round(Number(backupRetentionDraft || 0) || 0)));
    if (keepLast <= 0) return { keepLast, keep: all, del: [] as string[] };
    return { keepLast, keep: all.slice(0, keepLast), del: all.slice(keepLast) };
  }, [backupZips, backupRetentionDraft]);

  useEffect(() => {
    if (!logPaused) {
      setPausedLogs(null);
      return;
    }
    setPausedLogs(Array.isArray(logs) ? logs.slice() : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logPaused]);

  useEffect(() => {
    const t = window.setTimeout(() => setLogQuery(logQueryRaw), 180);
    return () => window.clearTimeout(t);
  }, [logQueryRaw]);

  const logFilter = useMemo(() => {
    const q = String(logQuery || "").trim();
    if (!q) return { mode: "none" as const, q: "", re: null as RegExp | null, error: "" };
    if (!logRegex) return { mode: "text" as const, q: q.toLowerCase(), re: null as RegExp | null, error: "" };

    const limit = 160;
    if (q.length > limit) return { mode: "regex" as const, q, re: null as RegExp | null, error: `Pattern too long (>${limit})` };
    try {
      return { mode: "regex" as const, q, re: new RegExp(q, "i"), error: "" };
    } catch (e: any) {
      return { mode: "regex" as const, q, re: null as RegExp | null, error: String(e?.message || e) };
    }
  }, [logQuery, logRegex]);

  const logPresetDefs = useMemo(() => {
    return [
      {
        id: "exceptions",
        label: t.tr("Exceptions / stacktrace", "异常 / 堆栈"),
        regex: true,
        query: "(Exception|Error|Stacktrace|Caused by)",
        matchOnly: true,
        level: "error" as const,
      },
      {
        id: "cant_keep_up",
        label: t.tr("Can't keep up", "Can't keep up（卡顿）"),
        regex: false,
        query: "Can't keep up",
        matchOnly: true,
        level: "warn" as const,
      },
      {
        id: "timed_out",
        label: t.tr("Timed out", "Timed out（超时）"),
        regex: true,
        query: "Timed out|timed out|timeout|Read timed out",
        matchOnly: true,
        level: "warn" as const,
      },
      {
        id: "oom",
        label: t.tr("Out of memory", "内存溢出"),
        regex: true,
        query: "OutOfMemoryError|GC overhead limit exceeded",
        matchOnly: true,
        level: "error" as const,
      },
      {
        id: "watchdog",
        label: t.tr("Server watchdog", "服务端 Watchdog"),
        regex: true,
        query: "watchdog|Server Hang Watchdog|A single server tick took",
        matchOnly: true,
        level: "error" as const,
      },
      {
        id: "login_errors",
        label: t.tr("Login / auth errors", "登录/认证错误"),
        regex: true,
        query: "Failed to verify username|Not authenticated|Disconnecting",
        matchOnly: true,
        level: "warn" as const,
      },
    ] as Array<{
      id: string;
      label: string;
      regex: boolean;
      query: string;
      matchOnly: boolean;
      level: "all" | "warn" | "error";
    }>;
  }, [t]);

  const logPresetOptions = useMemo(() => {
    return logPresetDefs.map((p) => ({ value: p.id, label: p.label }));
  }, [logPresetDefs]);

  const historyFilter = useMemo(() => {
    const q = String(historySearchQuery || "").trim();
    if (!q) return { mode: "none" as const, q: "", qLower: "", re: null as RegExp | null, error: "" };
    if (!historySearchRegex) return { mode: "text" as const, q, qLower: q.toLowerCase(), re: null as RegExp | null, error: "" };
    const limit = 200;
    if (q.length > limit) return { mode: "regex" as const, q, qLower: "", re: null as RegExp | null, error: `Pattern too long (>${limit})` };
    try {
      return { mode: "regex" as const, q, qLower: "", re: new RegExp(q, "i"), error: "" };
    } catch (e: any) {
      return { mode: "regex" as const, q, qLower: "", re: null as RegExp | null, error: String(e?.message || e) };
    }
  }, [historySearchQuery, historySearchRegex]);

  useEffect(() => {
    setLogClearAtUnix(0);
    setLogSelectStart(null);
    setLogSelectEnd(null);
  }, [instanceId, logView]);

  const filteredLogs = useMemo(() => {
    const inst = instanceId.trim();
    const q = logFilter.q;
    const source = logPaused && pausedLogs ? pausedLogs : logs;
    const list = (source || []).filter((l: any) => {
      if (logView === "frp") {
        if (l.source !== "frp") return false;
        const name = String(l.instance || "").trim();
        if (!inst) return true;
        if (!name) return true;
        return name === inst || name.startsWith(`${inst}-`);
      }
      if (logView === "mc") return l.source === "mc" && l.instance === inst;
      if (logView === "install") return l.source === "install" && l.instance === inst;
      // all
      return (l.instance && l.instance === inst) || (l.source === "frp" && !l.instance);
    });
    const since = Math.max(0, Math.floor(Number(logClearAtUnix || 0)));
    const next = since ? list.filter((l: any) => Math.floor(Number(l?.ts_unix || 0)) >= since) : list;
    if (!logMatchOnly || logFilter.mode === "none") return next;
    if (logFilter.mode === "text") return next.filter((l: any) => String(l?.line || "").toLowerCase().includes(q));

    // Regex: if invalid, keep logs visible and surface error in UI.
    const re = logFilter.re;
    if (!re) return next;
    return next.filter((l: any) => re.test(String(l?.line || "")));
  }, [logs, logView, instanceId, logPaused, pausedLogs, logClearAtUnix, logFilter, logMatchOnly]);

  const logLines = useMemo<RenderLogLine[]>(() => {
    const list = filteredLogs.length ? filteredLogs.slice(-2000) : [];
    if (!list.length) return [{ text: "<no logs>", textLower: "<no logs>", level: "", issueClass: "" }];
    const baseTs =
      logTimeMode === "relative"
        ? (() => {
            for (const l of list) {
              const ts = Number((l as any)?.ts_unix || 0);
              if (Number.isFinite(ts) && ts > 0) return ts;
            }
            return 0;
          })()
        : 0;
    const mapped: RenderLogLine[] = list.map((l: any) => {
      const tsUnix = Number(l.ts_unix || 0);
      let ts = "--:--:--";
      if (Number.isFinite(tsUnix) && tsUnix > 0) {
        if (logTimeMode === "relative" && baseTs > 0) ts = `+${Math.max(0, Math.floor(tsUnix - baseTs))}s`;
        else ts = fmtTime(tsUnix);
      }
      const src = l.source || "daemon";
      const stream = l.stream || "";
      const inst = l.instance ? `(${l.instance})` : "";
      const text = `[${ts}] ${src}${inst} ${stream}: ${l.line || ""}`;
      const upper = String(text || "").toUpperCase();
      const isErr = /\b(ERROR|FATAL)\b/.test(upper) || upper.includes("EXCEPTION") || upper.includes("STACKTRACE");
      const isWarn = /\bWARN(ING)?\b/.test(upper);
      const level: RenderLogLine["level"] = isErr ? "error" : isWarn ? "warn" : "";
      const issueId = detectCommonLogIssueId({ upper, source: String(src || "") });
      const issueClass: RenderLogLine["issueClass"] = issueId ? (issueId === "frp_auth" ? "issueWarn" : "issueDanger") : "";
      return { text, textLower: text.toLowerCase(), level, issueClass };
    });
    if (logLevelFilter === "warn") {
      const out = mapped.filter((l) => l.level === "warn");
      return out.length ? out : [{ text: "<no logs>", textLower: "<no logs>", level: "", issueClass: "" }];
    }
    if (logLevelFilter === "error") {
      const out = mapped.filter((l) => l.level === "error");
      return out.length ? out : [{ text: "<no logs>", textLower: "<no logs>", level: "", issueClass: "" }];
    }
    return mapped;
  }, [filteredLogs, logLevelFilter, logTimeMode]);

  const commonLogIssues = useMemo(() => {
    const list = filteredLogs.length ? filteredLogs.slice(-2000) : [];
    const byId = new Map<CommonLogIssueID, { id: CommonLogIssueID; severity: "warn" | "danger"; lastSeenUnix: number; sample: string; source: string }>();
    for (const l of list) {
      const source = String((l as any)?.source || "").trim() || "daemon";
      const line = String((l as any)?.line || "");
      if (!line) continue;
      const upper = line.toUpperCase();
      const id = detectCommonLogIssueId({ upper, source });
      if (!id) continue;
      const severity: "warn" | "danger" = id === "frp_auth" ? "warn" : "danger";
      const tsUnix = Math.floor(Number((l as any)?.ts_unix || 0));
      const sample = line.length > 280 ? `${line.slice(0, 280)}…` : line;

      const prev = byId.get(id);
      if (!prev || (Number.isFinite(tsUnix) && tsUnix > (prev.lastSeenUnix || 0))) {
        byId.set(id, { id, severity, lastSeenUnix: Number.isFinite(tsUnix) ? tsUnix : 0, sample, source });
      }
    }

    const rank = (s: "warn" | "danger") => (s === "danger" ? 2 : 1);
    const out = Array.from(byId.values());
    out.sort((a, b) => rank(b.severity) - rank(a.severity) || (b.lastSeenUnix || 0) - (a.lastSeenUnix || 0));
    return out;
  }, [filteredLogs]);

  const logMatchLineIdxs = useMemo(() => {
    if (logFilter.mode === "none") return [] as number[];
    if (logFilter.mode === "text") {
      const q = logFilter.q;
      if (!q) return [] as number[];
      const out: number[] = [];
      for (let i = 0; i < logLines.length; i++) {
        if (String(logLines[i]?.textLower || "").includes(q)) out.push(i);
      }
      return out;
    }
    const re = logFilter.re;
    if (!re) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < logLines.length; i++) {
      if (re.test(String(logLines[i]?.text || ""))) out.push(i);
    }
    return out;
  }, [logLines, logFilter]);

  useEffect(() => {
    setLogFindIdx(0);
  }, [logFilter.mode, logFilter.q, logMatchOnly, logView, instanceId]);

  useEffect(() => {
    const n = logMatchLineIdxs.length;
    if (!n) {
      if (logFindIdx) setLogFindIdx(0);
      return;
    }
    if (logFindIdx < 0) setLogFindIdx(0);
    else if (logFindIdx >= n) setLogFindIdx(n - 1);
  }, [logMatchLineIdxs.length, logFindIdx]);

  const activeLogMatchLineIdx = useMemo(() => {
    const n = logMatchLineIdxs.length;
    if (!n) return -1;
    const idx = Math.min(n - 1, Math.max(0, Math.round(Number(logFindIdx || 0))));
    return logMatchLineIdxs[idx] ?? -1;
  }, [logMatchLineIdxs, logFindIdx]);

  function scrollToLogLine(lineIdx: number) {
    const el = logScrollRef.current;
    if (!el) return;
    setAutoScroll(false);
    if (!wrapLogs) {
      const lineHeight = 18;
      el.scrollTop = Math.max(0, lineIdx * lineHeight - Math.floor(el.clientHeight / 2));
      return;
    }
    const hit = el.querySelector(`[data-log-idx="${lineIdx}"]`) as HTMLElement | null;
    if (hit) hit.scrollIntoView({ block: "center" });
  }

  function jumpLogMatch(dir: -1 | 1) {
    const n = logMatchLineIdxs.length;
    if (!n) return;
    setLogFindIdx((cur) => {
      const next = (cur + dir + n) % n;
      window.setTimeout(() => scrollToLogLine(logMatchLineIdxs[next] ?? 0), 0);
      return next;
    });
  }

  async function runHistorySearchNow() {
    const inst = instanceId.trim();
    if (!inst) {
      setHistorySearchStatus(t.tr("Select a game first", "请先选择游戏"));
      return;
    }
    if (!selectedDaemon?.connected) {
      setHistorySearchStatus(t.tr("daemon offline", "daemon 离线"));
      return;
    }
    const q = String(historySearchQuery || "").trim();
    if (!q) {
      setHistorySearchStatus(t.tr("query required", "query 不能为空"));
      return;
    }
    if (historyFilter.mode === "regex" && historyFilter.error) {
      setHistorySearchStatus(`${t.tr("regex error", "正则错误")}: ${historyFilter.error}`);
      return;
    }

    setHistorySearchBusy(true);
    setHistorySearchStatus(t.tr("Searching...", "搜索中..."));
    try {
      const out = await mcLogSearch(inst, {
        query: q,
        regex: !!historySearchRegex,
        max_files: Math.max(1, Math.min(60, Math.round(Number(historySearchMaxFiles || 0) || 12))),
        max_matches: Math.max(1, Math.min(2000, Math.round(Number(historySearchMaxMatches || 0) || 200))),
        context_before: Math.max(0, Math.min(20, Math.round(Number(historySearchBefore || 0) || 0))),
        context_after: Math.max(0, Math.min(20, Math.round(Number(historySearchAfter || 0) || 0))),
      });
      setHistorySearchResult(out);
      const hits = Array.isArray((out as any)?.matches) ? (out as any).matches.length : 0;
      setHistorySearchStatus(hits ? "" : t.tr("No matches", "没有匹配"));
    } catch (e: any) {
      setHistorySearchResult(null);
      setHistorySearchStatus(String(e?.message || e));
    } finally {
      setHistorySearchBusy(false);
    }
  }

  function buildLogExportText(lines: string[], meta: { inst: string; view: string; start: number; end: number; total: number }) {
    const nowUnix = Math.floor(Date.now() / 1000);
    const header = [
      "# ElegantMC log export",
      `# instance: ${meta.inst || "-"}`,
      `# view: ${meta.view || "-"}`,
      `# range: ${meta.start + 1}-${meta.end + 1} / ${meta.total} (count=${meta.end - meta.start + 1})`,
      `# exported_at: ${fmtUnix(nowUnix)}`,
      "",
    ].join("\n");
    return header + (lines.join("\n") || "<empty>") + "\n";
  }

  async function exportLogSelection(mode: "copy" | "download") {
    const inst = instanceId.trim();
    if (!inst) return;
    if (!logSelection) return;

    const start = logSelection.start;
    const end = logSelection.end;
    const total = logLines.length;
    const lines = logLines.slice(start, end + 1).map((l) => String(l?.text || ""));
    const view = String(logView || "");
    const text = buildLogExportText(lines, { inst, view, start, end, total });

    if (mode === "copy") {
      await copyText(text);
      return;
    }

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const viewTag = (view || "all").replace(/[^A-Za-z0-9._-]+/g, "_");
    const exportedAtUnix = Math.floor(Date.now() / 1000);
    a.download = `elegantmc-${inst}-${viewTag}-logs-${start + 1}-${end + 1}-${exportedAtUnix}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function deriveBookmarkLabel(text: string) {
    const s = String(text || "").trim();
    if (!s) return "";
    const idx = s.lastIndexOf(": ");
    const body = idx >= 0 ? s.slice(idx + 2) : s;
    const oneLine = body.replace(/\s+/g, " ").trim();
    if (oneLine.length <= 80) return oneLine;
    return oneLine.slice(0, 80) + "…";
  }

  function toggleLogBookmark(lineIdx: number, text: string) {
    const inst = instanceId.trim();
    if (!inst) return;
    const line = String(text || "");
    if (!line) return;

    const list = Array.isArray(logBookmarks) ? logBookmarks : [];
    const candidates = list
      .map((b, i) => ({ b, i }))
      .filter((x) => String(x.b?.text || "") === line);

    if (candidates.length) {
      let best = candidates[0];
      let bestDist = Math.abs(Math.round(Number(best.b.lineIdxHint || 0)) - lineIdx);
      for (const c of candidates) {
        const dist = Math.abs(Math.round(Number(c.b.lineIdxHint || 0)) - lineIdx);
        if (dist < bestDist) {
          best = c;
          bestDist = dist;
        }
      }
      setLogBookmarks(list.filter((_, i) => i !== best.i));
      pushToast(t.tr("Bookmark removed", "书签已移除"), "ok");
      return;
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const label = deriveBookmarkLabel(line);
    const next = [{ id, inst, view: String(logView || "all"), label, text: line.slice(0, 50_000), createdAtUnix: nowUnix, lineIdxHint: lineIdx }, ...list].slice(0, 200);
    setLogBookmarks(next);
    pushToast(t.tr("Bookmarked", "已添加书签"), "ok");
  }

  function findLogLineIndexByText(text: string, hintIdx: number) {
    const target = String(text || "");
    if (!target) return -1;
    const hits: number[] = [];
    for (let i = 0; i < logLines.length; i++) {
      if (String(logLines[i]?.text || "") === target) hits.push(i);
    }
    if (!hits.length) return -1;
    if (hits.length === 1) return hits[0];
    let best = hits[0];
    let bestDist = Math.abs(best - hintIdx);
    for (const i of hits) {
      const dist = Math.abs(i - hintIdx);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    return best;
  }

  function jumpToBookmark(b: { text: string; lineIdxHint: number }) {
    const idx = findLogLineIndexByText(String(b?.text || ""), Math.max(0, Math.round(Number(b?.lineIdxHint || 0) || 0)));
    if (idx < 0) {
      pushToast(t.tr("Bookmark not found in current buffer (try History search).", "当前缓冲区未找到该书签（可尝试“历史搜索”）。"), "error");
      return;
    }
    setLogSelectStart(idx);
    setLogSelectEnd(idx);
    scrollToLogLine(idx);
  }

  async function loadFrpDiagIni(nameRaw: string, revealToken: boolean) {
    const name = String(nameRaw || "").trim();
    if (!name) {
      setFrpDiagIni("");
      setFrpDiagIniStatus(t.tr("name is required", "name 不能为空"));
      return;
    }
    setFrpDiagIniBusy(true);
    setFrpDiagIniStatus(t.tr("Loading...", "加载中..."));
    try {
      const out = await readFrpProxyIniNow(name, revealToken);
      const ini = String((out as any)?.ini || "");
      const truncated = !!(out as any)?.truncated;
      setFrpDiagIni(ini);
      setFrpDiagIniStatus(truncated ? t.tr("Truncated", "已截断") : "");
    } catch (e: any) {
      setFrpDiagIni("");
      setFrpDiagIniStatus(String(e?.message || e));
    } finally {
      setFrpDiagIniBusy(false);
    }
  }

  async function runFrpDiagProbeNow() {
    const profile = selectedProfile;
    if (!profile) {
      setFrpDiagProbeStatus(t.tr("Select an FRP profile first", "请先选择 FRP 配置"));
      setFrpDiagProbeResult(null);
      return;
    }
    const host = String(profile?.server_addr || "").trim();
    const port = Math.round(Number(profile?.server_port || 0));
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
      setFrpDiagProbeStatus(t.tr("Invalid FRP profile host/port", "FRP 配置的 host/port 无效"));
      setFrpDiagProbeResult(null);
      return;
    }
    setFrpDiagProbeBusy(true);
    setFrpDiagProbeStatus(t.tr("Probing from daemon...", "从 daemon 探测中..."));
    setFrpDiagProbeResult(null);
    try {
      const out = await probeTcpFromDaemonNow(host, port, 1800);
      setFrpDiagProbeResult(out);
      setFrpDiagProbeStatus("");
    } catch (e: any) {
      setFrpDiagProbeResult(null);
      setFrpDiagProbeStatus(String(e?.message || e));
    } finally {
      setFrpDiagProbeBusy(false);
    }
  }

  useEffect(() => {
    if (!autoScroll) return;
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [autoScroll]);

  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    const update = () => setLogViewportHeight(Math.max(160, Math.round(el.clientHeight || 640)));
    update();
    const onWin = () => update();
    window.addEventListener("resize", onWin);
    let ro: any = null;
    try {
      if (typeof (window as any).ResizeObserver === "function") {
        ro = new (window as any).ResizeObserver(() => update());
        ro.observe(el);
      }
    } catch {
      ro = null;
    }
    return () => {
      window.removeEventListener("resize", onWin);
      try {
        if (ro && typeof ro.disconnect === "function") ro.disconnect();
      } catch {
        // ignore
      }
    };
  }, [wrapLogs]);

  useEffect(() => {
    if (!autoScroll || !logNearBottom) return;
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines.length, autoScroll, logNearBottom]);

  useEffect(() => {
    if (logPaused) {
      prevLogLinesLenRef.current = logLines.length;
      setNewLogsCount(0);
      return;
    }
    const prev = prevLogLinesLenRef.current;
    const cur = logLines.length;
    prevLogLinesLenRef.current = cur;

    if (logNearBottom) {
      setNewLogsCount(0);
      return;
    }
    if (cur > prev) {
      setNewLogsCount((n) => n + (cur - prev));
      return;
    }
    if (cur < prev) setNewLogsCount(0);
  }, [logLines.length, logNearBottom, logPaused]);

  const logVirtual = useMemo<{
    start: number;
    end: number;
    topPad: number;
    bottomPad: number;
    visible: RenderLogLine[];
  }>(() => {
    const total = logLines.length;
    if (wrapLogs) {
      return { start: 0, end: total, topPad: 0, bottomPad: 0, visible: logLines };
    }
    const lineHeight = 18;
    const viewHeight = logViewportHeight;
    const overscan = 12;
    const start = Math.max(0, Math.floor(logScrollTop / lineHeight) - overscan);
    const visibleCount = Math.ceil(viewHeight / lineHeight) + overscan * 2;
    const end = Math.min(total, start + visibleCount);
    return {
      start,
      end,
      topPad: start * lineHeight,
      bottomPad: (total - end) * lineHeight,
      visible: logLines.slice(start, end),
    };
  }, [logLines, logScrollTop, wrapLogs, logViewportHeight]);

  const logRangeLabel = useMemo(() => {
    const total = logLines.length;
    if (!total) return "";
    const start = Math.max(0, logVirtual.start);
    const end = Math.max(start, Math.min(total, logVirtual.end));
    return `${Math.min(total, start + 1)}-${end} / ${total}`;
  }, [logLines.length, logVirtual.end, logVirtual.start]);

  const logSelection = useMemo(() => {
    const total = logLines.length;
    const a = typeof logSelectStart === "number" ? Math.round(Number(logSelectStart)) : NaN;
    const b = typeof logSelectEnd === "number" ? Math.round(Number(logSelectEnd)) : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b) || total <= 0) return null;
    const start = Math.max(0, Math.min(total - 1, Math.min(a, b)));
    const end = Math.max(0, Math.min(total - 1, Math.max(a, b)));
    return { start, end, count: end - start + 1 };
  }, [logLines.length, logSelectStart, logSelectEnd]);

  const logBookmarkTextSet = useMemo(() => {
    const set = new Set<string>();
    for (const b of Array.isArray(logBookmarks) ? logBookmarks : []) {
      const txt = String((b as any)?.text || "");
      if (txt) set.add(txt);
    }
    return set;
  }, [logBookmarks]);

  const filteredLogBookmarks = useMemo(() => {
    const q = String(logBookmarksQuery || "").trim().toLowerCase();
    const list = Array.isArray(logBookmarks) ? logBookmarks : [];
    if (!q) return list;
    return list.filter((b) => `${b.label} ${b.text}`.toLowerCase().includes(q));
  }, [logBookmarks, logBookmarksQuery]);

  useEffect(() => {
    if (!selectedDaemon?.connected) return;
    const inst = instanceId.trim();
    if (!inst) return;
    refreshBackupZips(inst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, selectedDaemon?.connected]);

  useEffect(() => {
    if (!selectedDaemon?.connected) return;
    const inst = instanceId.trim();
    if (!inst) return;
    refreshCrashArtifacts(inst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, selectedDaemon?.connected]);

  useEffect(() => {
    setDangerRestorePath("");
  }, [instanceId]);

  useEffect(() => {
    const inst = instanceId.trim();
    if (!inst || !selectedDaemon?.connected) {
      setDangerRestorePath("");
      return;
    }
    if (dangerRestorePath) return;
    const first = Array.isArray(backupZips) && backupZips.length ? String(backupZips[0] || "") : "";
    if (first) setDangerRestorePath(first);
  }, [instanceId, selectedDaemon?.connected, backupZips, dangerRestorePath]);

  useEffect(() => {
    const inst = instanceId.trim();
    if (!inst || !selectedDaemon?.connected) {
      setBackupMetaByPath({});
      return;
    }
    const list = (Array.isArray(backupZips) ? backupZips : []).slice(0, 25);
    let cancelled = false;
    async function load() {
      const next: Record<string, any> = {};
      for (const p of list) {
        const path = String(p || "").trim();
        if (!path) continue;
        try {
          const raw = await fsReadText(`${path}.meta.json`, 8_000);
          const parsed = raw && raw.trim() ? JSON.parse(raw) : null;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) next[path] = parsed;
        } catch {
          // ignore missing meta
        }
      }
      if (!cancelled) setBackupMetaByPath(next);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupZips, instanceId, selectedDaemon?.connected]);

  useEffect(() => {
    const inst = instanceId.trim();
    if (!inst) {
      setCmdHistory([]);
      setCmdHistoryIdx(0);
      return;
    }
    try {
      const raw = localStorage.getItem("elegantmc_console_history_v1");
      const all = raw ? JSON.parse(raw) : {};
      const list = Array.isArray(all?.[inst]) ? all[inst] : [];
      const cleaned = list.map((s: any) => String(s || "").trim()).filter(Boolean).slice(-50);
      setCmdHistory(cleaned);
      setCmdHistoryIdx(cleaned.length);
    } catch {
      setCmdHistory([]);
      setCmdHistoryIdx(0);
    }
  }, [instanceId]);

  useEffect(() => {
    const inst = instanceId.trim();
    if (!inst) {
      setLogBookmarks([]);
      setLogBookmarksQueryRaw("");
      setLogBookmarksQuery("");
      return;
    }
    try {
      const raw = localStorage.getItem(`elegantmc_log_bookmarks_v1:${inst}`);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const cleaned = list
        .map((b: any) => ({
          id: String(b?.id || "").trim(),
          inst,
          view: String(b?.view || "").trim() || "all",
          label: String(b?.label || "").trim().slice(0, 120),
          text: String(b?.text || "").slice(0, 50_000),
          createdAtUnix: Math.floor(Number(b?.createdAtUnix || b?.created_at_unix || 0)),
          lineIdxHint: Math.max(0, Math.round(Number(b?.lineIdxHint ?? b?.line_idx_hint ?? 0) || 0)),
        }))
        .filter((b: any) => b.id && b.text)
        .slice(0, 200);
      setLogBookmarks(cleaned);
    } catch {
      setLogBookmarks([]);
    }
  }, [instanceId]);

  useEffect(() => {
    const inst = instanceId.trim();
    if (!inst) return;
    try {
      localStorage.setItem(`elegantmc_log_bookmarks_v1:${inst}`, JSON.stringify((logBookmarks || []).slice(0, 200)));
    } catch {
      // ignore
    }
  }, [instanceId, logBookmarks]);

  function persistCmdHistory(inst: string, list: string[]) {
    try {
      const raw = localStorage.getItem("elegantmc_console_history_v1");
      const all = raw ? JSON.parse(raw) : {};
      all[inst] = list.slice(-50);
      localStorage.setItem("elegantmc_console_history_v1", JSON.stringify(all));
    } catch {
      // ignore
    }
  }

  async function sendConsoleWithHistory() {
    const inst = instanceId.trim();
    const cmd = consoleLine.trim();
    if (!inst || !cmd) return;
    const next = [...cmdHistory.filter((c) => c !== cmd), cmd].slice(-50);
    setCmdHistory(next);
    setCmdHistoryIdx(next.length);
    persistCmdHistory(inst, next);
    beginCmdCapture(cmd);
    await sendConsoleLine();
  }

  async function sendQuickCommand(cmd: string) {
    const inst = instanceId.trim();
    const line = String(cmd || "").trim();
    if (!inst || !line) return;
    const next = [...cmdHistory.filter((c) => c !== line), line].slice(-50);
    setCmdHistory(next);
    setCmdHistoryIdx(next.length);
    persistCmdHistory(inst, next);
    beginCmdCapture(line);
    await sendConsoleLine(line);
  }

  function normalizeUuid(raw: string) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const hex = s.replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) return "";
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function isValidMcName(raw: string) {
    const name = String(raw || "").trim();
    return /^[A-Za-z0-9_]{1,16}$/.test(name);
  }

  function beginCmdCapture(cmd: string) {
    const inst = instanceId.trim();
    if (!inst) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    cmdCaptureLinesRef.current = [];
    setCmdCaptureLines([]);
    setCmdCapture({
      id,
      inst,
      cmd,
      startedUnix: Math.floor(Date.now() / 1000),
      nextLogIdx: Array.isArray(logs) ? logs.length : 0,
    });
  }

  useEffect(() => {
    if (!cmdCapture) return;
    const all = Array.isArray(logs) ? logs : [];
    let idx = Math.max(0, Math.min(all.length, Math.floor(Number(cmdCapture.nextLogIdx || 0))));
    if (idx >= all.length) return;
    const slice = all.slice(idx);
    const nextIdx = idx + slice.length;

    const lines: string[] = [];
    for (const l of slice) {
      if (l?.source !== "mc") continue;
      if (String(l?.instance || "").trim() !== cmdCapture.inst) continue;
      const tsUnix = Math.floor(Number(l?.ts_unix || 0));
      const ts = tsUnix > 0 ? fmtTime(tsUnix) : "-";
      const stream = String(l?.stream || "").trim();
      const body = String(l?.line || "");
      lines.push(`[${ts}]${stream ? ` ${stream}:` : ""} ${body}`);
    }
    if (lines.length) {
      cmdCaptureLinesRef.current = [...cmdCaptureLinesRef.current, ...lines].slice(-120);
      setCmdCaptureLines(cmdCaptureLinesRef.current);
    }

    setCmdCapture((prev) => (prev && prev.id === cmdCapture.id ? { ...prev, nextLogIdx: nextIdx } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs.length, cmdCapture?.id]);

  useEffect(() => {
    if (!cmdCapture) return;
    const id = cmdCapture.id;
    const cmd = cmdCapture.cmd;
    const startedUnix = cmdCapture.startedUnix;
    const tmr = window.setTimeout(() => {
      const lines = cmdCaptureLinesRef.current.slice();
      setCmdOutputs((prev) => [{ id, cmd, startedUnix, lines }, ...prev].slice(0, 12));
      setCmdCapture(null);
      setCmdCaptureLines([]);
      cmdCaptureLinesRef.current = [];
    }, 2800);
    return () => window.clearTimeout(tmr);
  }, [cmdCapture?.id]);

  useEffect(() => {
    const latest = cmdOutputs[0];
    if (!latest) return;
    if (latest.id === lastTpsParsedIdRef.current) return;
    const cmd = String(latest.cmd || "").trim().toLowerCase();
    if (cmd !== "tps" && cmd !== "minecraft:tps") return;
    lastTpsParsedIdRef.current = latest.id;

    const parsed = parseTpsFromLines(latest.lines || []);
    if (!parsed) {
      setTpsInfo(null);
      setTpsStatus(t.tr("No TPS output captured (is this a Paper/Spigot server?)", "未捕获到 TPS 输出（是否为 Paper/Spigot 服务端？）"));
      return;
    }
    setTpsInfo({ atUnix: latest.startedUnix, ...parsed });
    setTpsStatus("");
  }, [cmdOutputs, t]);

  function isNotFoundErr(e: any) {
    const m = String(e?.message || e || "");
    return /not found|no such file|enoent/i.test(m);
  }

  useEffect(() => {
    const inst = instanceId.trim();
    if (!inst || !selectedDaemon?.connected) {
      setPackManifest(null);
      setPackManifestStatus("");
      return;
    }
    let cancelled = false;
    async function load() {
      setPackManifestStatus(t.tr("Loading...", "加载中..."));
      try {
        const raw = await fsReadText(joinRelPath(inst, ".elegantmc_pack.json"), 10_000);
        const parsed = raw && raw.trim() ? JSON.parse(raw) : null;
        if (cancelled) return;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setPackManifest(null);
          setPackManifestStatus("");
          return;
        }
        setPackManifest(parsed);
        setPackManifestStatus("");
      } catch (e: any) {
        if (cancelled) return;
        if (isNotFoundErr(e)) {
          setPackManifest(null);
          setPackManifestStatus("");
        } else {
          setPackManifest(null);
          setPackManifestStatus(String(e?.message || e));
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, selectedDaemon?.connected]);

  async function refreshPlayers() {
    const inst = instanceId.trim();
    if (!inst || !selectedDaemon?.connected) return;
    setPlayersBusy(true);
    setPlayersStatus(t.tr("Loading...", "加载中..."));
    try {
      const raw = await fsReadText(joinRelPath(inst, "usercache.json"), 10_000);
      const parsed = raw && raw.trim() ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const cleaned = list
        .map((it: any) => ({
          name: String(it?.name || "").trim(),
          uuid: normalizeUuid(String(it?.uuid || "")),
          expiresOn: String(it?.expiresOn || "").trim(),
        }))
        .filter((p: any) => p.name || p.uuid);
      cleaned.sort((a: any, b: any) => a.name.localeCompare(b.name));
      setPlayers(cleaned);
      setPlayersStatus(cleaned.length ? "" : t.tr("No players in usercache.json yet", "usercache.json 暂无玩家"));
    } catch (e: any) {
      setPlayers([]);
      if (isNotFoundErr(e)) setPlayersStatus(t.tr("usercache.json not found (server may not have started yet)", "未找到 usercache.json（可能尚未启动过）"));
      else setPlayersStatus(String(e?.message || e));
    } finally {
      setPlayersBusy(false);
    }
  }

  async function quickWhitelistPlayer(p: { name: string; uuid: string }) {
    const inst = instanceId.trim();
    const name = String(p?.name || "").trim();
    const uuid = normalizeUuid(String(p?.uuid || ""));
    if (!inst || !selectedDaemon?.connected) return;
    if (!name) {
      pushToast(t.tr("Player name required", "需要玩家名称"), "error");
      return;
    }
    if (!isValidMcName(name)) {
      pushToast(t.tr("Invalid player name", "玩家名称无效"), "error");
      return;
    }
    const ok = await confirmDialog(t.tr(`Add ${name} to whitelist?`, `将 ${name} 加入白名单？`), {
      title: t.tr("Whitelist", "白名单"),
      confirmLabel: t.tr("Add", "添加"),
      cancelLabel: t.tr("Cancel", "取消"),
    });
    if (!ok) return;

    if (running && canControl) {
      await sendQuickCommand(`whitelist add ${name}`);
      window.setTimeout(() => refreshWhitelist(), 600);
      return;
    }

    try {
      let existing: { name: string; uuid: string }[] = [];
      try {
        const raw = await fsReadText(joinRelPath(inst, "whitelist.json"), 20_000);
        const parsed = raw && raw.trim() ? JSON.parse(raw) : [];
        const list = Array.isArray(parsed) ? parsed : [];
        existing = list
          .map((it: any) => ({ name: String(it?.name || "").trim(), uuid: normalizeUuid(String(it?.uuid || "")) }))
          .filter((x: any) => x.name || x.uuid);
      } catch (e: any) {
        if (!isNotFoundErr(e)) throw e;
      }

      const nameKey = name.toLowerCase();
      const uuidKey = uuid.toLowerCase();
      const dup = existing.some(
        (e) =>
          (uuidKey && String(e.uuid || "").toLowerCase() === uuidKey) ||
          (nameKey && String(e.name || "").toLowerCase() === nameKey)
      );
      if (dup) {
        pushToast(t.tr(`${name} is already in whitelist`, `${name} 已在白名单中`), "info");
        return;
      }

      const next = [...existing, { name, uuid }].sort((a, b) => a.name.localeCompare(b.name));
      await fsWriteText(joinRelPath(inst, "whitelist.json"), JSON.stringify(next, null, 2) + "\n", 20_000);
      pushToast(t.tr(`Whitelisted: ${name}`, `已加入白名单：${name}`), "ok");
      refreshWhitelist();
    } catch (e: any) {
      pushToast(String(e?.message || e), "error");
    }
  }

  async function quickBanPlayer(nameRaw: string) {
    const name = String(nameRaw || "").trim();
    if (!name) return;
    if (!running || !canControl) {
      pushToast(t.tr("Server must be running to ban players", "封禁需要服务端在运行"), "error");
      return;
    }
    if (!isValidMcName(name)) {
      pushToast(t.tr("Invalid player name", "玩家名称无效"), "error");
      return;
    }
    const ok = await confirmDialog(t.tr(`Ban ${name}?`, `封禁 ${name}？`), {
      title: t.tr("Ban player", "封禁玩家"),
      confirmLabel: t.tr("Ban", "封禁"),
      cancelLabel: t.tr("Cancel", "取消"),
      danger: true,
    });
    if (!ok) return;
    await sendQuickCommand(`ban ${name}`);
  }

  async function refreshWhitelist() {
    const inst = instanceId.trim();
    if (!inst || !selectedDaemon?.connected) return;
    setWhitelistBusy(true);
    setWlErr("");
    setWhitelistStatus(t.tr("Loading...", "加载中..."));
    try {
      const raw = await fsReadText(joinRelPath(inst, "whitelist.json"), 10_000);
      const parsed = raw && raw.trim() ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const cleaned = list
        .map((it: any) => ({
          name: String(it?.name || "").trim(),
          uuid: normalizeUuid(String(it?.uuid || "")),
        }))
        .filter((p: any) => p.name || p.uuid);
      cleaned.sort((a: any, b: any) => a.name.localeCompare(b.name));
      setWhitelistEntries(cleaned);
      setWhitelistDirty(false);
      setWhitelistStatus("");
    } catch (e: any) {
      setWhitelistEntries([]);
      setWhitelistDirty(false);
      if (isNotFoundErr(e)) setWhitelistStatus(t.tr("whitelist.json not found (will create on save)", "未找到 whitelist.json（保存时将创建）"));
      else setWhitelistStatus(String(e?.message || e));
    } finally {
      setWhitelistBusy(false);
    }
  }

  async function saveWhitelist() {
    const inst = instanceId.trim();
    if (!inst || !selectedDaemon?.connected || whitelistBusy) return;
    setWhitelistBusy(true);
    setWlErr("");
    setWhitelistStatus(t.tr("Saving...", "保存中..."));
    try {
      const payload = (whitelistEntries || [])
        .map((it) => ({ name: String(it?.name || "").trim(), uuid: normalizeUuid(String(it?.uuid || "")) }))
        .filter((p) => p.name || p.uuid);
      await fsWriteText(joinRelPath(inst, "whitelist.json"), JSON.stringify(payload, null, 2) + "\n", 10_000);
      setWhitelistDirty(false);
      setWhitelistStatus(t.tr("Saved", "已保存"));
      setTimeout(() => setWhitelistStatus(""), 900);
    } catch (e: any) {
      setWhitelistStatus(String(e?.message || e));
    } finally {
      setWhitelistBusy(false);
    }
  }

  function addWhitelistEntry() {
    setWlErr("");
    const name = String(wlAddName || "").trim();
    const uuid = normalizeUuid(wlAddUuid);
    if (!name && !uuid) {
      setWlErr(t.tr("name or uuid required", "name 或 uuid 必填"));
      return;
    }
    if (name && !isValidMcName(name)) {
      setWlErr(t.tr("invalid name (1-16, A-Z a-z 0-9 _)", "name 无效（1-16 位，仅 A-Z a-z 0-9 _）"));
      return;
    }
    if (wlAddUuid.trim() && !uuid) {
      setWlErr(t.tr("invalid uuid", "uuid 无效"));
      return;
    }
    const nameKey = name.toLowerCase();
    const uuidKey = uuid.toLowerCase();
    const dup = (whitelistEntries || []).some((e) => (uuidKey && String(e.uuid || "").toLowerCase() === uuidKey) || (nameKey && String(e.name || "").toLowerCase() === nameKey));
    if (dup) {
      setWlErr(t.tr("duplicate entry", "重复条目"));
      return;
    }
    setWhitelistEntries((prev) => [...(prev || []), { name, uuid }].sort((a, b) => a.name.localeCompare(b.name)));
    setWhitelistDirty(true);
    setWlAddName("");
    setWlAddUuid("");
  }

  async function refreshOps() {
    const inst = instanceId.trim();
    if (!inst || !selectedDaemon?.connected) return;
    setOpsBusy(true);
    setOpErr("");
    setOpsStatus(t.tr("Loading...", "加载中..."));
    try {
      const raw = await fsReadText(joinRelPath(inst, "ops.json"), 10_000);
      const parsed = raw && raw.trim() ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const cleaned = list
        .map((it: any) => {
          const name = String(it?.name || "").trim();
          const uuid = normalizeUuid(String(it?.uuid || ""));
          const levelRaw = Math.round(Number(it?.level ?? 0));
          const level = Number.isFinite(levelRaw) ? Math.max(1, Math.min(4, levelRaw)) : 4;
          const bypass = typeof it?.bypassesPlayerLimit === "boolean" ? !!it.bypassesPlayerLimit : true;
          return { name, uuid, level, bypassesPlayerLimit: bypass };
        })
        .filter((p: any) => p.name || p.uuid);
      cleaned.sort((a: any, b: any) => a.name.localeCompare(b.name));
      setOpsEntries(cleaned);
      setOpsDirty(false);
      setOpsStatus("");
    } catch (e: any) {
      setOpsEntries([]);
      setOpsDirty(false);
      if (isNotFoundErr(e)) setOpsStatus(t.tr("ops.json not found (will create on save)", "未找到 ops.json（保存时将创建）"));
      else setOpsStatus(String(e?.message || e));
    } finally {
      setOpsBusy(false);
    }
  }

  async function saveOps() {
    const inst = instanceId.trim();
    if (!inst || !selectedDaemon?.connected || opsBusy) return;
    setOpsBusy(true);
    setOpErr("");
    setOpsStatus(t.tr("Saving...", "保存中..."));
    try {
      const payload = (opsEntries || [])
        .map((it) => {
          const name = String(it?.name || "").trim();
          const uuid = normalizeUuid(String(it?.uuid || ""));
          const levelRaw = Math.round(Number(it?.level ?? 4));
          const level = Number.isFinite(levelRaw) ? Math.max(1, Math.min(4, levelRaw)) : 4;
          const bypass = typeof it?.bypassesPlayerLimit === "boolean" ? !!it.bypassesPlayerLimit : true;
          return { name, uuid, level, bypassesPlayerLimit: bypass };
        })
        .filter((p) => p.name || p.uuid);
      await fsWriteText(joinRelPath(inst, "ops.json"), JSON.stringify(payload, null, 2) + "\n", 10_000);
      setOpsDirty(false);
      setOpsStatus(t.tr("Saved", "已保存"));
      setTimeout(() => setOpsStatus(""), 900);
    } catch (e: any) {
      setOpsStatus(String(e?.message || e));
    } finally {
      setOpsBusy(false);
    }
  }

  function addOpEntry() {
    setOpErr("");
    const name = String(opAddName || "").trim();
    const uuid = normalizeUuid(opAddUuid);
    const level = Math.max(1, Math.min(4, Math.round(Number(opAddLevel) || 4)));
    const bypass = !!opAddBypass;
    if (!name && !uuid) {
      setOpErr(t.tr("name or uuid required", "name 或 uuid 必填"));
      return;
    }
    if (name && !isValidMcName(name)) {
      setOpErr(t.tr("invalid name (1-16, A-Z a-z 0-9 _)", "name 无效（1-16 位，仅 A-Z a-z 0-9 _）"));
      return;
    }
    if (opAddUuid.trim() && !uuid) {
      setOpErr(t.tr("invalid uuid", "uuid 无效"));
      return;
    }
    const nameKey = name.toLowerCase();
    const uuidKey = uuid.toLowerCase();
    const dup = (opsEntries || []).some((e) => (uuidKey && String(e.uuid || "").toLowerCase() === uuidKey) || (nameKey && String(e.name || "").toLowerCase() === nameKey));
    if (dup) {
      setOpErr(t.tr("duplicate entry", "重复条目"));
      return;
    }
    setOpsEntries((prev) => [...(prev || []), { name, uuid, level, bypassesPlayerLimit: bypass }].sort((a, b) => a.name.localeCompare(b.name)));
    setOpsDirty(true);
    setOpAddName("");
    setOpAddUuid("");
  }

  useEffect(() => {
    const inst = instanceId.trim();
    if (!inst) {
      setPlayers([]);
      setPlayersStatus("");
      setPlayersQueryRaw("");
      setWhitelistEntries([]);
      setWhitelistStatus("");
      setWhitelistDirty(false);
      setOpsEntries([]);
      setOpsStatus("");
      setOpsDirty(false);
      return;
    }
    if (!selectedDaemon?.connected) return;
    if (accessTab === "players") refreshPlayers();
    if (accessTab === "whitelist") refreshWhitelist();
    if (accessTab === "ops") refreshOps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessTab, instanceId, selectedDaemon?.connected]);

  if (shareMode) {
    const inst = instanceId.trim();
    const daemonId = String(selectedDaemon?.id || "").trim();
    const localSocket = `${localHost || "127.0.0.1"}:${Math.round(Number(gamePort || 25565))}`;

    return (
      <div className="stack shareStack">
        <div className="card">
          <h2>{t.tr("Game Snapshot", "游戏快照")}</h2>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge">
              {t.tr("daemon", "daemon")}: <code>{daemonId || "-"}</code>
            </span>
            <span className="badge">
              {t.tr("game", "游戏")}: <code>{inst || "-"}</code>
            </span>
            {running ? <StatusBadge tone="ok">{t.tr("running", "运行中")}</StatusBadge> : <StatusBadge tone="neutral">{t.tr("stopped", "已停止")}</StatusBadge>}
            {typeof selectedDaemon?.heartbeat?.server_time_unix === "number" ? (
              <span className="badge">
                {t.tr("updated", "更新时间")}: <TimeAgo unix={selectedDaemon.heartbeat.server_time_unix} />
              </span>
            ) : null}
          </div>

          <div className="grid2 mt-3 items-start">
            <div className="cardSub">
              <h3>{t.tr("Connect", "连接")}</h3>
              <code className="shareSocket">{inst ? socketText : "-"}</code>
              <div className="hint mt-2">
                {frpStatus?.running && frpStatus.remote_port ? (
                  <>
                    FRP: <code>{frpStatus.remote_addr}:{frpStatus.remote_port}</code>
                  </>
                ) : enableFrp ? (
                  <span className="badge warn">{t.tr("FRP enabled (not running)", "FRP 已开启（未运行）")}</span>
                ) : (
                  <span className="muted">FRP: -</span>
                )}
              </div>
              {enableFrp ? (
                <div className="hint mt-2">
                  {t.tr("desired", "期望")}:{" "}
                  {selectedProfile ? (
                    <>
                      {t.tr("on", "开启")} (<code>{selectedProfile.name}</code>)
                    </>
                  ) : (
                    <span className="badge warn">{t.tr("on (no profile)", "开启（无配置）")}</span>
                  )}
                  {" · "}
                  {t.tr("remote port", "remote port")}: <code>{Math.round(Number(frpRemotePort || 0))}</code>
                </div>
              ) : null}
            </div>

            <div className="cardSub">
              <h3>{t.tr("Details", "详情")}</h3>

              <div className="kv">
                <div className="k">{t.tr("Network", "网络")}</div>
                <div className="v">{inst ? <span className="badge">{localSocket}</span> : <span className="muted">-</span>}</div>
              </div>

              <div className="kv">
                <div className="k">{t.tr("Java", "Java")}</div>
                <div className="v">{instanceStatus?.java ? <code>{String(instanceStatus.java)}</code> : <span className="muted">-</span>}</div>
                <div className="hint">
                  {t.tr("major", "major")}: <code>{Number(instanceStatus?.java_major || 0) || "-"}</code>
                  {" · "}
                  {t.tr("required", "required")}: <code>{Number(instanceStatus?.required_java_major || 0) ? `>=${Number(instanceStatus.required_java_major)}` : "-"}</code>
                </div>
              </div>

              <div className="kv">
                <div className="k">{t.tr("Last exit", "最后退出")}</div>
                <div className="v">
                  {typeof instanceStatus?.last_exit_unix === "number" && instanceStatus.last_exit_unix > 0 ? (
                    <TimeAgo unix={instanceStatus.last_exit_unix} />
                  ) : (
                    <span className="muted">-</span>
                  )}
                </div>
                <div className="hint">
                  {instanceStatus?.last_exit_signal ? (
                    <>
                      {t.tr("signal", "信号")}: <code>{String(instanceStatus.last_exit_signal)}</code>
                    </>
                  ) : typeof instanceStatus?.last_exit_code === "number" ? (
                    <>
                      {t.tr("exit code", "退出码")}: <code>{String(instanceStatus.last_exit_code)}</code>
                    </>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedDaemon && !selectedDaemon.connected) {
    return (
      <div className="card">
        <div className="toolbar">
          <div className="toolbarLeft items-center">
            <div>
              <h2>{t.tr("Game", "游戏")}</h2>
              <div className="hint">
                {t.tr("daemon", "daemon")}: <code>{String(selectedDaemon?.id || "-")}</code> · {t.tr("status", "状态")}:{" "}
                <span className="badge">{t.tr("offline", "离线")}</span>
              </div>
            </div>
          </div>
	        </div>
	        <EmptyState
	          title={t.tr("Daemon offline", "Daemon 离线")}
	          hint={
	            <>
	              {t.tr("This page needs an online daemon to manage game instances.", "本页需要 Daemon 在线才能管理游戏实例。")} {t.tr("last seen", "最后在线")}:{" "}
	              <code>{selectedDaemon?.lastSeenUnix ? <TimeAgo unix={selectedDaemon.lastSeenUnix} /> : "-"}</code>
	            </>
	          }
	          actions={
	            <>
	              <button type="button" className="primary" onClick={() => setTab("nodes")}>
	                {t.tr("Go to Nodes", "前往 Nodes")}
	              </button>
	              <button type="button" className="iconBtn" onClick={openHelpModal}>
	                {t.tr("Troubleshoot", "排查")}
	              </button>
	            </>
	          }
	        >
	          <div className="emptyStateHint" style={{ whiteSpace: "pre-wrap" }}>
	            {t.tr(
	              "Recommended checks:\n1) Is the daemon process/container running?\n2) Verify ELEGANTMC_PANEL_WS_URL / DNS / firewall.\n3) Verify daemon token matches the node in Panel.",
	              "建议排查：\n1) Daemon 进程/容器是否在运行？\n2) 检查 ELEGANTMC_PANEL_WS_URL / DNS / 防火墙。\n3) 检查 daemon token 是否与 Panel 中节点一致。"
	            )}
	          </div>
	        </EmptyState>
	      </div>
	    );
	  }

  return (
    <div className="stack">
      <div className="card">
        <h2>{t.tr("Game", "游戏")}</h2>

        <div className="toolbar">
          <div className="toolbarLeft">
            <div className="field" style={{ flex: 1, minWidth: 260 }}>
              <label>{t.tr("Game", "游戏")}</label>
	              {gamesLoading ? (
	                <div className="stack" style={{ gap: 10 }}>
	                  <div className="skeleton" style={{ minHeight: 44 }} />
	                  <div className="skeleton" style={{ minHeight: 36 }} />
	                  <div className="skeleton" style={{ minHeight: 36 }} />
	                </div>
	              ) : (
                <>
                  <Select
                    value={instanceId}
                    onChange={(v) => setInstanceId(v)}
                    disabled={!serverDirs.length}
                    placeholder={t.tr("No games installed", "暂无游戏实例")}
                    options={sortedServerDirs.map((id: string) => {
                      const tags = (instanceTagsById && (instanceTagsById as any)[id]) || [];
                      const list = Array.isArray(tags) ? tags.map((s: any) => String(s || "").trim()).filter(Boolean) : [];
                      const running = !!runningById[id];
                      const runLabel = running ? t.tr(" (running)", " (运行中)") : "";
                      const fav = favoriteSet.has(id) ? "★ " : "";
                      const label = list.length ? `${fav}${id}${runLabel} · ${list.join(", ")}` : `${fav}${id}${runLabel}`;
                      return { value: id, label };
                    })}
                  />
                  <div className="row" style={{ marginTop: 8, gap: 10, alignItems: "center" }}>
                    <input
                      value={gameQueryRaw}
                      onChange={(e: any) => setGameQueryRaw(e.target.value)}
                      placeholder={t.tr("Search games…", "搜索游戏…")}
                      style={{ flex: 1, minWidth: 140 }}
                    />
                    <div style={{ width: 170 }}>
                      <Select
                        value={statusFilter}
                        onChange={(v) => setStatusFilter(v as any)}
                        options={[
                          { value: "all", label: t.tr("All statuses", "全部状态") },
                          { value: "running", label: t.tr("Running", "运行中") },
                          { value: "stopped", label: t.tr("Stopped", "已停止") },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 8, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span className="hint">{t.tr("Tag filter", "标签筛选")}</span>
                    <div style={{ width: 220 }}>
                      <Select
                        value={tagFilter}
                        onChange={(v) => setTagFilter(v)}
                        placeholder={t.tr("All tags", "全部标签")}
                        options={[
                          { value: "", label: t.tr("All tags", "全部标签") },
                          ...availableTags.map((tag) => ({ value: tag, label: tag })),
                        ]}
                      />
                    </div>
                  </div>
                </>
              )}
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="hint">
                  {t.tr("installed", "已安装")}: {serverDirs.length} · {t.tr("shown", "显示")}: {filteredServerDirs.length}
                  {serverDirsStatus ? ` · ${serverDirsStatus}` : ""}
                </div>
                <button
                  type="button"
                  className="iconBtn iconOnly"
                  title={t.tr("Refresh games list", "刷新游戏列表")}
                  aria-label={t.tr("Refresh games list", "刷新游戏列表")}
                  onClick={refreshServerDirs}
                  disabled={!selectedDaemon?.connected}
                >
                  <Icon name="refresh" />
                </button>
              </div>
            </div>
          </div>

          <div className={`toolbarRight gamesToolbarRight ${compactActions ? "compact" : ""}`}>
            {!compactActions ? (
              <div className="btnGroup">
                <button type="button" className="iconBtn" onClick={openInstallModal} disabled={!selectedDaemon?.connected || gameActionBusy}>
                  <Icon name="plus" />
                  {t.tr("Install", "安装")}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className={`gamesStickyBar ${compactActions ? "compact" : ""}`}>
          <div className="gamesStickyLeft">
            <span className="muted">{t.tr("Instance", "实例")}</span>
            <span className="gamesStickyTitle">{instanceId.trim() || "-"}</span>
            <StatusBadge tone={running ? "ok" : "neutral"}>{running ? t.tr("running", "运行中") : t.tr("stopped", "已停止")}</StatusBadge>
          </div>

	          <div className="gamesStickyMetrics">
	            <span className="metricChip">
	              <span className="metricChipLabel">{t.tr("port", "端口")}</span>
	              <span className="metricChipValue">{Math.round(Number(gamePort || 25565))}</span>
	            </span>
	            <CopyButton
	              iconOnly
	              text={`${localHost || "127.0.0.1"}:${Math.round(Number(gamePort || 25565))}`}
	              tooltip={t.tr("Copy address", "复制地址")}
	              ariaLabel={t.tr("Copy address", "复制地址")}
	            />
	            <span className="metricChip">
	              <span className="metricChipLabel">{t.tr("players", "玩家")}</span>
	              <span className="metricChipValue">{playersBusy ? "…" : players.length || "-"}</span>
	            </span>
	            <span className="metricChip">
	              <span className="metricChipLabel">TPS</span>
	              <span className="metricChipValue">{tpsInfo?.tps1 == null ? "-" : tpsInfo.tps1.toFixed(2)}</span>
	            </span>
	            <span
	              className="metricChip"
	              title={
	                perf.memLatestBytes == null
	                  ? "-"
	                  : `${fmtBytes(perf.memLatestBytes)}${perf.memTotalBytes > 0 ? ` / ${fmtBytes(perf.memTotalBytes)}` : ""}`
	              }
	            >
	              <span className="metricChipLabel">RAM</span>
	              <span className="metricChipValue" style={{ maxWidth: 180 }}>
	                {perf.memLatestBytes == null ? "-" : fmtBytes(perf.memLatestBytes)}
	                {perf.memTotalBytes > 0 ? ` / ${fmtBytes(perf.memTotalBytes)}` : ""}
	              </span>
	            </span>
	          </div>

          <div className="btnGroup gamesActionGroup">
            <button className={running ? "" : "primary"} onClick={() => (running ? stopServer() : startServer())} disabled={!canControl}>
              {gameActionBusy ? t.tr("Working...", "处理中...") : running ? t.tr("Stop", "停止") : t.tr("Start", "启动")}
            </button>
            <button
              type="button"
              className="iconBtn iconOnly"
              title={
                instanceId.trim()
                  ? favoriteSet.has(instanceId.trim())
                    ? t.tr(`Unfavorite instance ${instanceId.trim()}`, `取消收藏实例 ${instanceId.trim()}`)
                    : t.tr(`Favorite instance ${instanceId.trim()}`, `收藏实例 ${instanceId.trim()}`)
                  : t.tr("Favorite", "收藏")
              }
              aria-label={
                instanceId.trim()
                  ? favoriteSet.has(instanceId.trim())
                    ? t.tr(`Unfavorite instance ${instanceId.trim()}`, `取消收藏实例 ${instanceId.trim()}`)
                    : t.tr(`Favorite instance ${instanceId.trim()}`, `收藏实例 ${instanceId.trim()}`)
                  : t.tr("Favorite", "收藏")
              }
              onClick={() => toggleFavoriteInstance(instanceId.trim())}
              disabled={!instanceId.trim()}
            >
              {favoriteSet.has(instanceId.trim()) ? "★" : "☆"}
            </button>
            <Select
              value=""
              onChange={(v) => {
                if (v === "install") openInstallModal();
                else if (v === "restart") restartServer();
                else if (v === "backup") backupServer();
                else if (v === "datapack") openDatapackModal();
                else if (v === "resourcepack") openResourcePackModal();
                else if (v === "trash") openTrashModal();
                else if (v === "export") exportInstanceZip();
                else if (v === "downloadWorld") downloadWorldZip();
                else if (v === "properties") openServerPropertiesEditor();
                else if (v === "rename") renameInstance();
                else if (v === "clone") cloneInstance();
                else if (v === "repair") repairInstance();
                else if (v === "acceptEula") acceptEulaNowLocal();
                else if (v === "settings") openSettingsModal();
                else if (v === "files") {
                  setFsPath(instanceId.trim());
                  setTab("files");
                }
              }}
              placeholder={t.tr("More", "更多")}
              options={[
                ...(compactActions ? [{ value: "install", label: t.tr("Install…", "安装…"), disabled: !selectedDaemon?.connected || gameActionBusy }] : []),
                { value: "restart", label: t.tr("Restart", "重启"), disabled: !canControl },
                { value: "backup", label: t.tr("Backup", "备份"), disabled: !canControl },
                { value: "datapack", label: t.tr("Datapack…", "Datapack…"), disabled: !canControl },
                { value: "resourcepack", label: t.tr("Resource pack…", "资源包…"), disabled: !canControl },
                { value: "acceptEula", label: t.tr("Accept EULA", "接受 EULA"), disabled: !canControl },
                { value: "repair", label: t.tr("Repair…", "修复…"), disabled: !canControl },
                { value: "trash", label: t.tr("Trash…", "回收站…"), disabled: !selectedDaemon?.connected },
                { value: "export", label: t.tr("Export zip", "导出 zip"), disabled: !selectedDaemon?.connected || !instanceId.trim() },
                { value: "downloadWorld", label: t.tr("Download world", "下载世界"), disabled: !selectedDaemon?.connected || !instanceId.trim() },
                { value: "properties", label: "server.properties…", disabled: !canControl },
                { value: "rename", label: t.tr("Rename…", "重命名…"), disabled: !canControl },
                { value: "clone", label: t.tr("Clone…", "克隆…"), disabled: !canControl },
                { value: "settings", label: t.tr("Settings", "设置"), disabled: !canControl },
                { value: "files", label: t.tr("Files", "文件"), disabled: !canControl },
              ]}
              style={compactActions ? { width: "100%" } : { width: 150 }}
              disabled={!selectedDaemon?.connected || gameActionBusy}
            />
            {gameActionBusy ? <span className="badge">{t.tr("busy", "忙碌")}</span> : null}
          </div>
        </div>

        {!gamesLoading && !serverDirs.length ? (
          <div className="emptyState mt-3">
            <div style={{ fontWeight: 800 }}>{t.tr("No games installed yet.", "暂无已安装游戏。")}</div>
            <div className="hint" style={{ marginTop: 6 }}>
              {t.tr("Install a Vanilla/Paper server or a modpack to get started.", "安装 Vanilla/Paper 或整合包以开始使用。")}
            </div>
            <div className="btnGroup" style={{ marginTop: 10, justifyContent: "center" }}>
              <button type="button" className="primary iconBtn" onClick={openInstallModal} disabled={!selectedDaemon?.connected || gameActionBusy}>
                <Icon name="plus" />
                {t.tr("Install", "安装")}
              </button>
            </div>
          </div>
        ) : null}

        {!gamesLoading && serverDirs.length ? (
          <div className="mt-3">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <h3 className="m-0">{t.tr("Instances", "实例")}</h3>
              <span className="muted">
                {t.tr("shown", "显示")}: {sortedServerDirs.length}
              </span>
            </div>
            {instListVirtual.enabled ? (
              <div
                ref={instListScrollRef}
                className="virtList"
                style={{ maxHeight: 720 }}
                onScroll={(e) => setInstListScrollTop(e.currentTarget.scrollTop)}
                role="list"
                aria-label={t.tr("Instances", "实例")}
              >
                {instListVirtual.topPad > 0 ? <div style={{ height: instListVirtual.topPad }} /> : null}
                {instListVirtual.visible.map((id: string, localIdx: number) => {
                  const absIdx = instListVirtual.start + localIdx;
                  const tags = (instanceTagsById && (instanceTagsById as any)[id]) || [];
                  const tagList = Array.isArray(tags) ? tags.map((s: any) => String(s || "").trim()).filter(Boolean) : [];
                  const note = String((instanceNotesById && (instanceNotesById as any)[id]) || "").trim();
                  const noteOneLine = note ? note.split(/\r?\n/)[0].slice(0, 120) : "";
                  const meta = (instanceMetaById && (instanceMetaById as any)[id]) || null;
                  const kindKey = String(meta?.server_kind || "").trim().toLowerCase();
                  const kind = kindKey ? `${kindKey.slice(0, 1).toUpperCase()}${kindKey.slice(1)}` : "";
                  const ver = String(meta?.server_version || "").trim();
                  const kindVer = [kind, ver].filter(Boolean).join(" ");
                  const portRaw = meta?.game_port != null ? Math.round(Number(meta.game_port)) : 0;
                  const port = Number.isFinite(portRaw) && portRaw >= 1 && portRaw <= 65535 ? portRaw : 0;
                  const running = !!runningById[id];
                  const isActive = id === instanceId;
                  const line = [
                    kindVer ? kindVer : "",
                    port ? `:${port}` : "",
                    tagList.length ? `${t.tr("tags", "标签")}: ${tagList.join(", ")}` : t.tr("no tags", "无标签"),
                    noteOneLine ? `· ${noteOneLine}` : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div
                      key={id}
                      data-virt-idx={absIdx}
                      className={`virtRow ${isActive ? "active" : ""}`.trim()}
                      style={{ height: instRowH }}
                      role="listitem"
                      tabIndex={0}
                      onClick={() => setInstanceId(id)}
                      onKeyDown={(e) => {
                        const target = e.target as any;
                        if (target && typeof target.closest === "function" && target.closest("button") && target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setInstanceId(id);
                          return;
                        }
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          focusInstRow(absIdx + 1);
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          focusInstRow(absIdx - 1);
                        }
                      }}
                    >
                      <div className="virtRowMain">
                        <div className="virtRowTitle">
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{id}</span>
                          {favoriteSet.has(id) ? <span className="badge">★</span> : null}
                          <StatusBadge tone={running ? "ok" : "neutral"}>{running ? t.tr("running", "运行中") : t.tr("stopped", "已停止")}</StatusBadge>
                        </div>
                        <div className="virtRowSub" title={line}>
                          <span className="virtRowMetaText">{line || "—"}</span>
                        </div>
                      </div>
                      <div className="virtRowActions">
                        <button
                          type="button"
                          className={running ? "" : "primary"}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (running) stopServer(id);
                            else startServerFromSavedConfig(id);
                          }}
                          disabled={!selectedDaemon?.connected || gameActionBusy}
                        >
                          {running ? t.tr("Stop", "停止") : t.tr("Start", "启动")}
                        </button>
                        <button
                          type="button"
                          className="iconBtn iconOnly"
                          title={favoriteSet.has(id) ? t.tr("Unfavorite", "取消收藏") : t.tr("Favorite", "收藏")}
                          aria-label={favoriteSet.has(id) ? t.tr("Unfavorite", "取消收藏") : t.tr("Favorite", "收藏")}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavoriteInstance(id);
                          }}
                          disabled={!id.trim()}
                        >
                          {favoriteSet.has(id) ? "★" : "☆"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFsPath(id);
                            setTab("files");
                          }}
                          disabled={!selectedDaemon?.connected}
                        >
                          {t.tr("Files", "文件")}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {instListVirtual.bottomPad > 0 ? <div style={{ height: instListVirtual.bottomPad }} /> : null}
              </div>
            ) : (
              <div className="cardGrid">
                {sortedServerDirs.map((id: string) => {
                  const tags = (instanceTagsById && (instanceTagsById as any)[id]) || [];
                  const tagList = Array.isArray(tags) ? tags.map((s: any) => String(s || "").trim()).filter(Boolean) : [];
                  const note = String((instanceNotesById && (instanceNotesById as any)[id]) || "").trim();
                  const noteOneLine = note ? note.split(/\r?\n/)[0].slice(0, 120) : "";
                  const meta = (instanceMetaById && (instanceMetaById as any)[id]) || null;
                  const kindKey = String(meta?.server_kind || "").trim().toLowerCase();
                  const kind = kindKey ? `${kindKey.slice(0, 1).toUpperCase()}${kindKey.slice(1)}` : "";
                  const ver = String(meta?.server_version || "").trim();
                  const kindVer = [kind, ver].filter(Boolean).join(" ");
                  const portRaw = meta?.game_port != null ? Math.round(Number(meta.game_port)) : 0;
                  const port = Number.isFinite(portRaw) && portRaw >= 1 && portRaw <= 65535 ? portRaw : 0;
                  const running = !!runningById[id];
                  const isActive = id === instanceId;
                  return (
	                    <div
	                      key={id}
	                      className={["itemCard", isActive ? "active" : ""].filter(Boolean).join(" ")}
	                      style={{ opacity: running ? 1 : 0.9 }}
	                      role="button"
	                      tabIndex={0}
	                      onClick={() => setInstanceId(id)}
	                      onKeyDown={(e) => {
	                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setInstanceId(id);
                        }
                      }}
                    >
                      <div className="itemCardHeader">
                        <div className="min-w-0">
                          <div className="itemTitle" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{id}</span>
                            {favoriteSet.has(id) ? <span className="badge">★</span> : null}
                          </div>
                          {kindVer || port ? (
                            <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: "wrap" }}>
                              {kindVer ? <span className="badge">{kindVer}</span> : null}
                              {port ? <span className="badge">:{port}</span> : null}
                            </div>
                          ) : null}
                          <div className="itemMeta">
                            {tagList.length ? (
                              <span>
                                {t.tr("tags", "标签")}: {tagList.join(", ")}
                              </span>
                            ) : (
                              <span className="muted">{t.tr("no tags", "无标签")}</span>
                            )}
                            {noteOneLine ? <span> · {noteOneLine}</span> : null}
                          </div>
                        </div>
                        <StatusBadge tone={running ? "ok" : "neutral"}>{running ? t.tr("running", "运行中") : t.tr("stopped", "已停止")}</StatusBadge>
                      </div>

                      <div className="itemFooter">
                        <div className="btnGroup" style={{ justifyContent: "flex-start" }}>
                          <button
                            type="button"
                            className={running ? "" : "primary"}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (running) stopServer(id);
                              else startServerFromSavedConfig(id);
                            }}
                            disabled={!selectedDaemon?.connected || gameActionBusy}
                          >
                            {running ? t.tr("Stop", "停止") : t.tr("Start", "启动")}
                          </button>
                          <button
                            type="button"
                            className="iconBtn iconOnly"
                            title={favoriteSet.has(id) ? t.tr("Unfavorite", "取消收藏") : t.tr("Favorite", "收藏")}
                            aria-label={favoriteSet.has(id) ? t.tr("Unfavorite", "取消收藏") : t.tr("Favorite", "收藏")}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavoriteInstance(id);
                            }}
                            disabled={!id.trim()}
                          >
                            {favoriteSet.has(id) ? "★" : "☆"}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFsPath(id);
                              setTab("files");
                            }}
                            disabled={!selectedDaemon?.connected}
                          >
                            {t.tr("Files", "文件")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {frpOpStatus || serverOpStatus ? (
          <div className="hint mt-2">
            {frpOpStatus ? <span style={{ marginRight: 10 }}>FRP: {frpOpStatus}</span> : null}
            {serverOpStatus ? <span>MC: {serverOpStatus}</span> : null}
          </div>
        ) : null}

        <div className="grid2">
          <div className="kv">
            <div className="k">{t.tr("Status", "状态")}</div>
            <div className="v">
              {instanceStatus?.running ? (
                <span className="badge ok">
                  {t.tr("running", "运行中")} (pid {instanceStatus.pid || "-"})
                </span>
              ) : (
                <span className="badge">{t.tr("stopped", "已停止")}</span>
              )}
            </div>
            <div className="hint">
              {t.tr("node", "节点")}: {selectedDaemon?.id || "-"}
            </div>
          </div>

          <div className="kv">
            <div className="k">{t.tr("Last exit", "最后退出")}</div>
            <div className="v">
              {typeof instanceStatus?.last_exit_unix === "number" && instanceStatus.last_exit_unix > 0 ? (
                <span className={instanceStatus?.last_exit_signal || (typeof instanceStatus?.last_exit_code === "number" && instanceStatus.last_exit_code !== 0) ? "badge warn" : "badge"}>
                  <TimeAgo unix={instanceStatus.last_exit_unix} />
                </span>
              ) : (
                <span className="muted">-</span>
              )}
            </div>
            <div className="hint">
              {instanceStatus?.last_exit_signal ? (
                <>
                  {t.tr("signal", "信号")}: <code>{String(instanceStatus.last_exit_signal)}</code>
                </>
              ) : typeof instanceStatus?.last_exit_code === "number" ? (
                <>
                  {t.tr("exit code", "退出码")}: <code>{String(instanceStatus.last_exit_code)}</code>
                </>
              ) : (
                <span className="muted">-</span>
              )}
            </div>
          </div>

          <div className="kv">
            <div className="k">{t.tr("FRP process", "FRP 进程")}</div>
            <div className="v">
              {frpStatus?.running ? <StatusBadge tone="ok">{t.tr("running", "运行中")}</StatusBadge> : <StatusBadge tone="neutral">{t.tr("stopped", "已停止")}</StatusBadge>}
              {frpStatus?.running && frpStatus.remote_port ? (
                <span className="badge">
                  {frpStatus.remote_addr}:{frpStatus.remote_port}
                </span>
              ) : null}
            </div>
            <div className="hint">
              {t.tr("desired", "期望")}:{" "}
              {enableFrp ? (
                selectedProfile ? (
                  <>
                    {t.tr("on", "开启")} (<code>{selectedProfile.name}</code>)
                  </>
                ) : (
                  <span style={{ color: "var(--danger)" }}>{t.tr("on (no profile)", "开启（无配置）")}</span>
                )
              ) : (
                t.tr("off", "关闭")
              )}
              {" · "}
              {t.tr("remote port", "remote port")}: <code>{Math.round(Number(frpRemotePort || 0))}</code>
            </div>
          </div>

          <div className="kv">
            <div className="k">{t.tr("Java", "Java")}</div>
            <div className="v">{instanceStatus?.java ? <code>{String(instanceStatus.java)}</code> : <span className="muted">-</span>}</div>
            <div className="hint">
              {t.tr("major", "major")}: <code>{Number(instanceStatus?.java_major || 0) || "-"}</code>
              {" · "}
              {t.tr("required", "required")}: <code>{Number(instanceStatus?.required_java_major || 0) ? `>=${Number(instanceStatus.required_java_major)}` : "-"}</code>
            </div>
          </div>

          <div className="kv">
            <div className="k">{t.tr("Pack", "整合包")}</div>
            <div className="v">
              {packManifest ? (
                <code style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {String(packManifest?.source?.title || packManifest?.mrpack?.name || packManifest?.provider || "").trim() || "-"}
                </code>
              ) : (
                <span className="muted">-</span>
              )}
            </div>
            <div className="hint">
              {packManifest ? (
                <>
                  <span className="muted">{t.tr("provider", "来源")}: </span>
                  <code>{String(packManifest?.provider || "-")}</code>
                  {packManifest?.source?.version_number || packManifest?.source?.version_name ? (
                    <>
                      {" · "}
                      <span className="muted">{t.tr("version", "版本")}: </span>
                      <code>{String(packManifest?.source?.version_number || packManifest?.source?.version_name || "").trim() || "-"}</code>
                    </>
                  ) : null}
                  {packManifest?.loader?.kind ? (
                    <>
                      {" · "}
                      <span className="muted">{t.tr("loader", "加载器")}: </span>
                      <code>
                        {String(packManifest?.loader?.kind || "").trim()}
                        {packManifest?.loader?.version ? ` ${String(packManifest.loader.version)}` : ""}
                      </code>
                    </>
                  ) : null}
                  {" · "}
                  <button
                    type="button"
                    className="linkBtn"
                    onClick={async () => {
                      const inst = instanceId.trim();
                      if (!inst) return;
                      setTab("files");
                      await openFileByPath(joinRelPath(inst, ".elegantmc_pack.json"));
                    }}
                    disabled={!selectedDaemon?.connected || !instanceId.trim()}
                  >
                    {t.tr("manifest", "manifest")}
                  </button>
                  {String(packManifest?.provider || "") === "modrinth" &&
                  String(packManifest?.source?.project_id || packManifest?.mrpack?.project_id || "")
                    .trim()
                    .length ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="linkBtn"
                        onClick={async () => {
                          const ok = await confirmDialog(
                            t.tr(
                              "Update this Modrinth pack to the latest version?\n\nThis updates pack files (mods/config/etc). Existing config files under config/ are preserved when they already exist.",
                              "将此 Modrinth 整合包更新到最新版本？\n\n这会更新整合包文件（mods/config 等）。对于 config/ 下已存在的配置文件，会尽量保留不覆盖。"
                            ),
                            {
                              title: t.tr("Update Pack", "更新整合包"),
                              confirmLabel: t.tr("Update", "更新"),
                              cancelLabel: t.tr("Cancel", "取消"),
                            }
                          );
                          if (!ok) return;
                          await updateModrinthPack();
                        }}
                        disabled={!selectedDaemon?.connected || !instanceId.trim() || gameActionBusy}
                      >
                        {t.tr("Update pack", "更新整合包")}
                      </button>
                    </>
                  ) : null}
                </>
              ) : packManifestStatus ? (
                <span style={{ color: "var(--danger)" }}>{packManifestStatus}</span>
              ) : (
                <span className="muted">{t.tr("not a modpack install", "非整合包安装")}</span>
              )}
            </div>
          </div>

          <div className="kv">
            <div className="k">{t.tr("Tags", "标签")}</div>
            <div className="v">
              {currentTags.length ? currentTags.map((tag) => <span key={tag} className="badge">{tag}</span>) : <span className="muted">-</span>}
            </div>
            <div className="hint">
              <div className="row" style={{ gap: 8 }}>
                <input
                  value={tagsDraft}
                  onChange={(e: any) => setTagsDraft(e.target.value)}
                  placeholder={t.tr("e.g. survival, modpack", "例如 survival, modpack")}
                  style={{ flex: 1, minWidth: 180 }}
                  disabled={!instanceId.trim()}
                />
                <button type="button" onClick={saveTags} disabled={!selectedDaemon?.connected || !instanceId.trim()}>
                  {t.tr("Save", "保存")}
                </button>
              </div>
            </div>
          </div>

          <div className="kv">
            <div className="k">{t.tr("Notes", "备注")}</div>
            <div className="v w-full">
              <textarea
                value={noteDraft}
                onChange={(e: any) => setNoteDraft(e.target.value)}
                placeholder={t.tr("Local notes (not synced)", "本地备注（不同步）")}
                rows={3}
                style={{ width: "100%", resize: "vertical" }}
                disabled={!instanceId.trim()}
              />
            </div>
            <div className="hint">
              <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                <span className="muted">
                  {t.tr("saved locally", "仅本地保存")} · {Math.min(4000, Math.max(0, noteDraft.length))}/4000
                </span>
                <button type="button" onClick={saveNote} disabled={!instanceId.trim()}>
                  {t.tr("Save", "保存")}
                </button>
              </div>
            </div>
          </div>

          <div className="kv">
            <div className="k">{t.tr("Network", "网络")}</div>
            <div className="v">
              {instanceId.trim() ? (
                <span className="badge">{`${localHost || "127.0.0.1"}:${Math.round(Number(gamePort || 25565))}`}</span>
              ) : (
                <span className="muted">-</span>
              )}
            </div>
            <div className="hint">
              {t.tr(
                "Hints: leave server-ip empty · Docker default published range 25565-25600",
                "提示：server-ip 建议留空 · Docker 默认映射端口段 25565-25600"
              )}
            </div>
          </div>

          <div className="kv">
            <div className="k">{t.tr("Last heartbeat", "最后心跳")}</div>
            <div className="v"><TimeAgo unix={selectedDaemon?.heartbeat?.server_time_unix} /></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h2 className="m-0">{t.tr("Connect", "连接")}</h2>
          <button
            type="button"
            className="iconBtn"
            onClick={() => openShareView({ kind: "game", daemonId: selectedDaemon?.id, instanceId })}
            disabled={!instanceId.trim()}
          >
            <Icon name="link" /> {t.tr("Share view", "分享视图")}
          </button>
        </div>
        <div className="row socketRow">
          <code
            className="clickCopy socketCode"
            role="button"
            tabIndex={0}
            title={
              instanceId.trim()
                ? `${socketText} · ${t.tr("Click to copy", "点击复制")}`
                : "-"
            }
            onClick={() => (instanceId.trim() ? copyText(socketText) : null)}
            onKeyDown={(e) => {
              if (!instanceId.trim()) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                copyText(socketText);
              }
            }}
          >
            {instanceId.trim() ? socketText : "-"}
          </code>
          <CopyButton text={socketText} className="socketCopyBtn" disabled={!instanceId.trim()} />
        </div>
        <div className="hint mt-2">
          <span>
            {t.tr("desired", "期望")}:{" "}
            {enableFrp ? (
              selectedProfile ? (
                <>
                  FRP {t.tr("on", "开启")} (<code>{selectedProfile.name}</code>)
                </>
              ) : (
                <span style={{ color: "var(--danger)" }}>FRP {t.tr("on (no profile)", "开启（无配置）")}</span>
              )
            ) : (
              `FRP ${t.tr("off", "关闭")}`
            )}
            {" · "}
            {t.tr("actual", "实际")}: {frpStatus?.running ? t.tr("running", "运行中") : t.tr("stopped", "已停止")}
          </span>
        </div>
        <div className="hint">
          {frpStatus?.running && frpStatus.remote_port ? (
            <span>{t.tr("FRP: public address (copy to friends).", "FRP：公网连接地址（可直接复制给朋友）。")}</span>
          ) : enableFrp ? (
            !selectedProfile ? (
              <span>
                {t.tr("FRP is enabled but no server is selected (go to", "FRP 已开启但未选择服务器（去")}{" "}
                <button className="linkBtn" onClick={() => setTab("frp")}>
                  FRP
                </button>{" "}
                {t.tr("to save a profile).", "保存一个 profile）。")}
              </span>
            ) : selectedProfile.status?.online === false ? (
              <span style={{ color: "var(--danger)" }}>
                {t.tr("FRP server unreachable", "FRP 服务器不可达")}: {selectedProfile.status.error || t.tr("offline", "离线")}（{t.tr("go to FRP tab and click Test/Probe", "去 FRP 页点击 Test/Probe")}）
              </span>
            ) : frpRemotePort <= 0 ? (
              <span>{t.tr("FRP is enabled but Remote Port=0 (server-assigned; consider a fixed port).", "FRP 已开启但 Remote Port=0（由服务端分配端口；建议手动指定一个固定端口）。")}</span>
            ) : frpStatus && frpStatus.running === false ? (
              <span style={{ color: "var(--danger)" }}>
                {t.tr(
                  "FRP desired on, but not running on daemon (see Logs → FRP / check token, server_addr, server_port).",
                  "FRP 期望开启，但 daemon 上未运行（看 Logs → FRP / 检查 token、server_addr、server_port）"
                )}
              </span>
            ) : (
              <span>{t.tr("FRP: after start, a public address will appear.", "FRP：启动后会显示公网地址。")}</span>
            )
          ) : (
            <span>{t.tr("FRP is off: showing local/LAN address (Docker defaults to 25565-25600).", "未开启 FRP：显示本机/LAN 连接地址（Docker 默认映射 25565-25600）。")}</span>
          )}
        </div>
        <div className="hint">
          {t.tr("Minecraft: Multiplayer → Add Server → Address", "Minecraft：多人游戏 → 添加服务器 → 地址填")} <code>{instanceId.trim() ? socketText : "IP:Port"}</code>
        </div>
        {instanceStatus?.running && instanceId.trim() ? (
          <div className="row" style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div className="hint" style={{ minWidth: 0 }}>
              {t.tr(
                "From a running instance, you can start an FRP proxy without restarting MC.",
                "实例运行中时，可无需重启 MC 直接启动 FRP proxy。"
              )}
            </div>
            <div className="btnGroup">
              <button
                type="button"
                className="iconBtn"
                onClick={() => startFrpProxyNow()}
                disabled={!selectedDaemon?.connected || !selectedProfile || gameActionBusy}
                title={!selectedProfile ? t.tr("Select an FRP profile first", "请先选择 FRP 配置") : undefined}
              >
                <Icon name="plus" />
                {t.tr("Start FRP proxy", "启动 FRP proxy")}
              </button>
              <button
                type="button"
                className="iconBtn"
                onClick={() => {
                  const name = instanceId.trim();
                  setFrpDiagProxyName(name);
                  setFrpDiagRevealToken(false);
                  setFrpDiagIni("");
                  setFrpDiagIniStatus("");
                  setFrpDiagProbeStatus("");
                  setFrpDiagProbeResult(null);
                  setFrpDiagOpen(true);
                  loadFrpDiagIni(name, false);
                }}
                disabled={!instanceId.trim()}
                title={t.tr("Show FRP config, logs, and connectivity checks.", "查看 FRP 配置、日志与连通性检测。")}
              >
                <Icon name="search" />
                {t.tr("Diagnostics", "诊断")}
              </button>
            </div>
          </div>
        ) : null}
        {instanceId.trim() && (enableFrp || frpStatus?.running) ? (
          instanceProxies.length ? (
            <div style={{ marginTop: 10 }}>
              <div className="hint">{t.tr("FRP proxies for this instance:", "该实例的 FRP proxies：")}</div>
              <div className="stack" style={{ gap: 8, marginTop: 6 }}>
                {instanceProxies.map((p: any) => {
                  const name = String(p?.proxy_name || "").trim() || "-";
                  const addr = String(p?.remote_addr || "").trim() || "-";
                  const remotePort = Math.round(Number(p?.remote_port || 0));
                  const running = !!p?.running;
                  const lastErr = name !== "-" ? String(frpProxyLastErrByName?.[name] || "").trim() : "";
                  return (
                    <div key={`${name}-${addr}-${remotePort}`} className="itemCard">
                      <div className="itemCardHeader">
                        <div className="min-w-0">
                          <div className="itemTitle">{name}</div>
                          <div className="itemMeta">
                            <code>
                              {addr}:{remotePort > 0 ? remotePort : "-"}
                            </code>
                            {" · "}
                            <span className="hint">
                              {t.tr("started", "启动")}: <TimeAgo unix={p.started_unix} />
                            </span>
                          </div>
                        </div>
                        <div className="btnGroup justify-end">
                          {running ? <StatusBadge tone="ok">{t.tr("running", "运行中")}</StatusBadge> : <StatusBadge tone="neutral">{t.tr("stopped", "已停止")}</StatusBadge>}
                        </div>
                      </div>

                      {lastErr ? (
                        <div className="hint" style={{ color: "var(--danger)" }}>
                          {t.tr("last error", "最近错误")}: {lastErr}
                        </div>
                      ) : null}

                      <div className="itemFooter">
                        <div className="btnGroup justify-end">
                          <button
                            type="button"
                            className="iconBtn"
                            onClick={() => restartFrpProxyNow(name, { remotePort: remotePort > 0 ? remotePort : undefined })}
                            disabled={!selectedDaemon?.connected || !instanceId.trim() || !selectedProfile || gameActionBusy}
                            title={!selectedProfile ? t.tr("Select an FRP profile first", "请先选择 FRP 配置") : undefined}
                          >
                            <Icon name="refresh" />
                            {t.tr("Restart", "重启")}
                          </button>
                          <button
                            type="button"
                            className="dangerBtn"
                            onClick={async () => {
                              const ok = await confirmDialog(
                                t.tr(`Stop FRP proxy "${name}"? Players will be disconnected.`, `停止 FRP proxy「${name}」？玩家将断开连接。`),
                                { title: t.tr("Stop FRP", "停止 FRP"), confirmLabel: t.tr("Stop", "停止"), cancelLabel: t.tr("Cancel", "取消"), danger: true }
                              );
                              if (!ok) return;
                              stopFrpProxyNow(name);
                            }}
                            disabled={!selectedDaemon?.connected || !name || gameActionBusy}
                          >
                            {t.tr("Stop", "停止")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="hint mt-2">
              {t.tr("FRP proxies", "FRP proxies")}: -
            </div>
          )
        ) : null}
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbarLeft items-center">
            <div>
              <h2>{t.tr("Performance", "性能")}</h2>
              <div className="hint">
                {instanceId.trim() ? (
                  <>
                    {t.tr("game", "游戏")}: <code>{instanceId.trim()}</code>
                    {instanceMetricsStatus ? ` · ${instanceMetricsStatus}` : ""}
                    {tpsStatus ? ` · ${tpsStatus}` : ""}
                  </>
                ) : (
                  t.tr("Select a game to see performance metrics", "选择游戏以查看性能指标")
                )}
              </div>
              {instanceId.trim() ? (
                <div className="hint" style={{ marginTop: 6 }}>
                  CPU: <code>{perf.cpuLatest == null ? "-" : `${perf.cpuLatest.toFixed(1)}%`}</code> · RSS:{" "}
                  <code>{perf.memLatestBytes == null ? "-" : fmtBytes(perf.memLatestBytes)}</code>
                  {perf.memTotalBytes > 0 && typeof perf.memLatestPct === "number" ? (
                    <>
                      {" "}
                      (<code>{perf.memLatestPct.toFixed(1)}%</code>)
                    </>
                  ) : null}
                  {" · "}
                  TPS: <code>{tpsInfo?.tps1 == null ? "-" : tpsInfo.tps1.toFixed(2)}</code>
                  {tpsInfo?.mspt != null ? (
                    <>
                      {" "}
                      / MSPT: <code>{tpsInfo.mspt.toFixed(2)}ms</code>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="toolbarRight">
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                setTpsStatus(t.tr("Querying...", "查询中..."));
                sendQuickCommand("tps");
              }}
              disabled={!selectedDaemon?.connected || !instanceId.trim() || !running || gameActionBusy}
              title={!running ? t.tr("Start the server to query TPS", "请先启动服务器以查询 TPS") : undefined}
            >
              <Icon name="refresh" />
              {t.tr("Query TPS", "查询 TPS")}
            </button>
          </div>
        </div>

        {instanceId.trim() ? (
          <div className="row" style={{ marginTop: 10, gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 220 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">CPU%</span>
                <code>{perf.cpuLatest == null ? "-" : `${perf.cpuLatest.toFixed(1)}%`}</code>
              </div>
              <Sparkline values={perf.cpuValues} width={220} height={36} />
            </div>
            <div style={{ minWidth: 220 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">{t.tr("Memory (RSS %)", "内存（RSS %）")}</span>
                <code>
                  {perf.memLatestBytes == null ? "-" : fmtBytes(perf.memLatestBytes)}
                  {perf.memTotalBytes > 0 && typeof perf.memLatestPct === "number" ? ` (${perf.memLatestPct.toFixed(1)}%)` : ""}
                </code>
              </div>
              <Sparkline
                values={perf.memPctValues}
                width={220}
                height={36}
                stroke="var(--ok)"
                fill="var(--ok-soft-bg)"
              />
            </div>
            <div style={{ minWidth: 220 }}>
              <div className="muted">TPS (1m / 5m / 15m)</div>
              <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: "wrap" }}>
                <span className={`badge ${tpsInfo?.tps1 != null && tpsInfo.tps1 >= 19.5 ? "ok" : ""}`}>
                  {tpsInfo?.tps1 != null ? tpsInfo.tps1.toFixed(2) : "-"}
                </span>
                <span className="badge">{tpsInfo?.tps5 != null ? tpsInfo.tps5.toFixed(2) : "-"}</span>
                <span className="badge">{tpsInfo?.tps15 != null ? tpsInfo.tps15.toFixed(2) : "-"}</span>
                {tpsInfo?.mspt != null ? <span className="badge">MSPT {tpsInfo.mspt.toFixed(2)}</span> : null}
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {t.tr("last query", "最后查询")}: <code>{tpsInfo ? <TimeAgo unix={tpsInfo.atUnix} /> : "-"}</code>
              </div>
            </div>
          </div>
        ) : (
          <div className="hint" style={{ marginTop: 10 }}>
            {t.tr("Select a game to see metrics.", "选择游戏以查看指标。")}
          </div>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbarLeft items-center">
            <div>
              <h2>{t.tr("Backups", "备份")}</h2>
              <div className="hint">
                {instanceId.trim() ? (
                  <>
                    {t.tr("folder", "目录")}: <code>servers/_backups/{instanceId.trim()}/</code>
                    {typeof backupZipsStatus === "string" && backupZipsStatus ? ` · ${backupZipsStatus}` : ""}
                  </>
                ) : (
                  t.tr("Select a game to view backups", "选择游戏以查看备份")
                )}
              </div>
              {instanceId.trim() ? (
                <div className="hint" style={{ marginTop: 6 }}>
                  {t.tr("size", "大小")}: <code>{instanceUsageBytes == null ? "-" : fmtBytes(instanceUsageBytes)}</code>
                  {instanceUsageStatus ? ` · ${instanceUsageStatus}` : ""}
                  {" · "}
                  {t.tr("last backup", "最近备份")}:{" "}
                  {lastBackup.unix ? <TimeAgo unix={lastBackup.unix} /> : Array.isArray(backupZips) && backupZips.length ? lastBackup.file : "-"}
                  {" · "}
                  {t.tr("keep last", "保留最近")}:{" "}
                  <code>{backupRetentionKeepLast > 0 ? backupRetentionKeepLast : t.tr("all", "全部")}</code>
                </div>
              ) : null}
            </div>
          </div>
          <div className="toolbarRight">
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                setBackupNewStop(true);
                setBackupNewFormat("tar.gz");
                setBackupNewKeepLast(Math.max(0, Math.min(1000, Math.round(Number(backupRetentionKeepLast || 0) || 0))));
                setBackupNewComment("");
                setBackupNewOpen(true);
              }}
              disabled={!canControl}
              title={!instanceId.trim() ? t.tr("Select a game first", "请先选择游戏") : undefined}
            >
              <Icon name="plus" />
              {t.tr("New backup", "新建备份")}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                setBackupRetentionDraft(Math.max(0, Math.min(1000, Math.round(Number(backupRetentionKeepLast || 0) || 0))));
                setBackupRetentionOpen(true);
              }}
              disabled={!selectedDaemon?.connected || !instanceId.trim() || gameActionBusy}
            >
              {t.tr("Retention…", "保留策略…")}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => refreshBackupZips(instanceId.trim())}
              disabled={!selectedDaemon?.connected || !instanceId.trim()}
            >
              <Icon name="refresh" />
              {t.tr("Refresh", "刷新")}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => computeInstanceUsage()}
              disabled={!selectedDaemon?.connected || !instanceId.trim() || instanceUsageBusy}
              title={t.tr("Compute instance folder size (may take a while)", "计算实例目录大小（可能需要一段时间）")}
            >
              {instanceUsageBusy ? t.tr("Scanning…", "扫描中…") : t.tr("Compute size", "计算大小")}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                const inst = instanceId.trim();
                if (!inst) return;
                setFsPath(`_backups/${inst}`);
                setTab("files");
              }}
              disabled={!selectedDaemon?.connected || !instanceId.trim()}
            >
              {t.tr("Open folder", "打开目录")}
            </button>
          </div>
        </div>

        {instanceId.trim() ? (
          Array.isArray(backupZips) && backupZips.length ? (
            <>
              <div className="hint">
                {t.tr("showing", "显示")} {Math.min(15, backupZips.length)} / {backupZips.length}
              </div>
	              <table className="striped" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>{t.tr("Time", "时间")}</th>
                    <th>{t.tr("Backup", "备份")}</th>
                    <th style={{ width: 110 }}>{t.tr("Size", "大小")}</th>
                    <th>{t.tr("Comment", "备注")}</th>
                    <th style={{ width: 210 }} />
                  </tr>
                </thead>
                <tbody>
                  {backupZips.slice(0, 15).map((p: string) => {
                    const path = String(p || "");
                    const file = path.split("/").pop() || path;
                    const meta = backupMetaByPath[path] || null;
                    const unixMeta = Math.floor(Number(meta?.created_at_unix || 0));
                    const m = file.match(/-(\d{9,12})\.(?:zip|tar\.gz|tgz)$/i);
                    const unixName = m ? Math.floor(Number(m[1])) : 0;
                    const unix =
                      (Number.isFinite(unixMeta) && unixMeta > 0 ? unixMeta : 0) ||
                      (Number.isFinite(unixName) && unixName > 0 ? unixName : 0) ||
                      0;
                    const bytes = meta && Number.isFinite(Number(meta?.bytes)) ? Number(meta.bytes) : null;
                    const comment = meta ? String(meta?.comment || "").trim() : "";
                    const format =
                      meta && String(meta?.format || "").trim()
                        ? String(meta.format).trim()
                        : file.toLowerCase().endsWith(".zip")
                          ? "zip"
                          : "tar.gz";
                    return (
                      <tr key={path}>
                        <td className="muted">{unix ? <TimeAgo unix={unix} /> : "-"}</td>
                        <td style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span className="badge">{format}</span>
                            <code style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{file}</code>
                          </div>
                        </td>
                        <td>{bytes == null ? "-" : fmtBytes(bytes)}</td>
                        <td className="muted" style={{ minWidth: 0 }}>
                          {comment || <span className="muted">-</span>}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div className="btnGroup justify-end">
                            <CopyButton iconOnly text={path} tooltip={t.tr("Copy path", "复制路径")} ariaLabel={t.tr("Copy path", "复制路径")} />
                            <button
                              type="button"
                              onClick={() => {
                                const inst = instanceId.trim();
                                if (!inst) return;
                                setFsPath(`_backups/${inst}`);
                                setTab("files");
                              }}
                            >
                              {t.tr("Open", "打开")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <div className="hint">
              {t.tr("No backups yet. Use New backup to create one.", "暂无备份。使用「新建备份」创建一个备份。")}
            </div>
          )
        ) : (
          <div className="hint">{t.tr("Select a game to see backups.", "选择游戏以查看备份。")}</div>
        )}
      </div>

      <div className="card">
        <h2>{t.tr("Danger Zone", "危险区")}</h2>
        <div className="hint">
          {instanceId.trim()
            ? t.tr("High-risk actions require extra confirmation.", "高风险操作会要求额外确认。")
            : t.tr("Select a game to manage dangerous actions.", "选择游戏以管理危险操作。")}
        </div>

        <DangerZone title={t.tr("Danger Zone", "危险区")}>
          <div className="grid2" style={{ alignItems: "end" }}>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>{t.tr("Restore from backup", "从备份恢复")}</label>
              <Select
                value={dangerRestorePath}
                onChange={(v) => setDangerRestorePath(v)}
                disabled={!Array.isArray(backupZips) || !backupZips.length || !canControl}
                placeholder={
                  Array.isArray(backupZips) && backupZips.length ? t.tr("Select backup…", "选择备份…") : t.tr("No backups found", "未找到备份")
                }
                options={(Array.isArray(backupZips) ? backupZips : []).slice(0, 25).map((p: any) => {
                  const path = String(p || "").trim();
                  const meta = path ? (backupMetaByPath as any)?.[path] : null;
                  const file = path ? path.split("/").pop() || path : "-";
                  const unix = meta && typeof meta.created_at_unix === "number" ? meta.created_at_unix : 0;
                  const label = unix ? `${fmtUnix(unix)} · ${file}` : file;
                  return { value: path, label };
                })}
              />
              <div className="hint">
                {t.tr("This will overwrite servers/<instance>/.", "这将覆盖 servers/<instance>/。")}{" "}
                <code>{instanceId.trim() ? `servers/${instanceId.trim()}/` : "servers/<instance>/"}</code>
              </div>
              <div className="btnGroup" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  type="button"
                  className="dangerBtn"
                  onClick={() => restoreBackupNow(dangerRestorePath)}
                  disabled={!canControl || !dangerRestorePath.trim()}
                >
                  {t.tr("Restore", "恢复")}
                </button>
              </div>
            </div>

            <div className="field">
              <label>{t.tr("Server jar", "服务端 Jar")}</label>
              <div className="btnGroup" style={{ justifyContent: "flex-start" }}>
                <button type="button" className="iconBtn" onClick={openJarUpdateModal} disabled={!canControl}>
                  {t.tr("Update jar…", "更新 Jar…")}
                </button>
              </div>
              <div className="hint">{t.tr("Stops the server and replaces the jar file.", "会停止服务器并替换 Jar 文件。")}</div>
            </div>

            <div className="field">
              <label>{t.tr("Instance", "实例")}</label>
              <div className="btnGroup" style={{ justifyContent: "flex-start" }}>
                <button type="button" className="dangerBtn" onClick={() => deleteServer()} disabled={!canControl}>
                  {t.tr("Move to trash…", "移入回收站…")}
                </button>
              </div>
              <div className="hint">{t.tr("Moves servers/<instance>/ to trash.", "将 servers/<instance>/ 移入回收站。")}</div>
            </div>
          </div>
        </DangerZone>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbarLeft items-center">
            <div>
              <h2>{t.tr("Players", "玩家")}</h2>
              <div className="hint">
                {instanceId.trim() ? (
                  <>
                    {t.tr("game", "游戏")}: <code>{instanceId.trim()}</code>
                  </>
                ) : (
                  t.tr("Select a game to manage players", "选择游戏以管理玩家")
                )}
              </div>
            </div>
          </div>
          <div className="toolbarRight items-center">
            <div className="btnGroup" style={{ justifyContent: "flex-start" }}>
              <button type="button" className={accessTab === "players" ? "primary" : ""} onClick={() => setAccessTab("players")} disabled={!instanceId.trim()}>
                {t.tr("Players", "玩家")}
              </button>
              <button type="button" className={accessTab === "whitelist" ? "primary" : ""} onClick={() => setAccessTab("whitelist")} disabled={!instanceId.trim()}>
                {t.tr("Whitelist", "白名单")}
              </button>
              <button type="button" className={accessTab === "ops" ? "primary" : ""} onClick={() => setAccessTab("ops")} disabled={!instanceId.trim()}>
                Ops
              </button>
            </div>

            {accessTab === "players" ? (
              <>
                <button type="button" className="iconBtn" onClick={refreshPlayers} disabled={!selectedDaemon?.connected || !instanceId.trim() || playersBusy}>
                  <Icon name="refresh" />
                  {t.tr("Refresh", "刷新")}
                </button>
                <button
                  type="button"
                  className="iconBtn"
                  onClick={async () => {
                    const inst = instanceId.trim();
                    if (!inst) return;
                    setTab("files");
                    await openFileByPath(joinRelPath(inst, "usercache.json"));
                  }}
                  disabled={!selectedDaemon?.connected || !instanceId.trim()}
                >
                  {t.tr("Open file", "打开文件")}
                </button>
              </>
            ) : accessTab === "whitelist" ? (
              <>
                <button type="button" className="iconBtn" onClick={refreshWhitelist} disabled={!selectedDaemon?.connected || !instanceId.trim() || whitelistBusy}>
                  <Icon name="refresh" />
                  {t.tr("Refresh", "刷新")}
                </button>
                <button type="button" className="iconBtn" onClick={saveWhitelist} disabled={!selectedDaemon?.connected || !instanceId.trim() || whitelistBusy || !whitelistDirty}>
                  {t.tr("Save", "保存")}
                </button>
                <button
                  type="button"
                  className="iconBtn"
                  onClick={async () => {
                    const inst = instanceId.trim();
                    if (!inst) return;
                    setTab("files");
                    await openFileByPath(joinRelPath(inst, "whitelist.json"));
                  }}
                  disabled={!selectedDaemon?.connected || !instanceId.trim()}
                >
                  {t.tr("Open file", "打开文件")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="iconBtn" onClick={refreshOps} disabled={!selectedDaemon?.connected || !instanceId.trim() || opsBusy}>
                  <Icon name="refresh" />
                  {t.tr("Refresh", "刷新")}
                </button>
                <button type="button" className="iconBtn" onClick={saveOps} disabled={!selectedDaemon?.connected || !instanceId.trim() || opsBusy || !opsDirty}>
                  {t.tr("Save", "保存")}
                </button>
                <button
                  type="button"
                  className="iconBtn"
                  onClick={async () => {
                    const inst = instanceId.trim();
                    if (!inst) return;
                    setTab("files");
                    await openFileByPath(joinRelPath(inst, "ops.json"));
                  }}
                  disabled={!selectedDaemon?.connected || !instanceId.trim()}
                >
                  {t.tr("Open file", "打开文件")}
                </button>
              </>
            )}
          </div>
        </div>

        {accessTab === "players" ? (
          <>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="hint">
                <code>servers/&lt;instance&gt;/usercache.json</code>
                {playersStatus ? ` · ${playersStatus}` : ""}
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <Select
                  value={playersSort}
                  onChange={(v) => setPlayersSort(v === "name" ? "name" : "lastSeen")}
                  options={[
                    { value: "lastSeen", label: t.tr("Sort: last seen", "排序：最近登录") },
                    { value: "name", label: t.tr("Sort: name", "排序：名称") },
                  ]}
                  style={{ width: 180 }}
                  disabled={!instanceId.trim()}
                />
                <input
                  value={playersQueryRaw}
                  onChange={(e: any) => setPlayersQueryRaw(e.target.value)}
                  placeholder={t.tr("Search players…", "搜索玩家…")}
                  style={{ width: 260 }}
                  disabled={!instanceId.trim()}
                />
              </div>
            </div>
            {playersView.length ? (
	              <table className="striped" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>{t.tr("Name", "名称")}</th>
                    <th>UUID</th>
                    <th>{t.tr("Last seen", "最近登录")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {playersView.map((p) => (
                    <tr key={`${p.uuid}-${p.name}`}>
                      <td>
                        <code>{p.name || "-"}</code>
                      </td>
                      <td>
                        <code>{p.uuid || "-"}</code>
                      </td>
                      <td className="muted" title={p.expiresOn || undefined}>
                        {p.lastSeenUnix ? <TimeAgo unix={p.lastSeenUnix} /> : p.expiresOn || "-"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div className="btnGroup" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                          <CopyButton
                            iconOnly
                            text={String(p.uuid || "")}
                            tooltip="Copy UUID"
                            ariaLabel="Copy UUID"
                            disabled={!p.uuid}
                          />
                          <CopyButton
                            iconOnly
                            text={String(p.name || "")}
                            tooltip={t.tr("Copy name", "复制名称")}
                            ariaLabel={t.tr("Copy name", "复制名称")}
                            disabled={!p.name}
                          />
                          <button
                            type="button"
                            className="iconBtn"
                            onClick={() => quickWhitelistPlayer({ name: p.name, uuid: p.uuid })}
                            disabled={!selectedDaemon?.connected || !instanceId.trim() || whitelistBusy || !p.name}
                            title={t.tr("Add to whitelist", "加入白名单")}
                          >
                            {t.tr("Whitelist", "白名单")}
                          </button>
                          <button
                            type="button"
                            className="dangerBtn"
                            onClick={() => quickBanPlayer(p.name)}
                            disabled={!running || !canControl || !p.name}
                            title={running ? t.tr("Ban player", "封禁玩家") : t.tr("Server is not running", "服务端未运行")}
                          >
                            {t.tr("Ban", "封禁")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="hint" style={{ marginTop: 10 }}>
                {playersStatus || t.tr("No players yet.", "暂无玩家。")}
              </div>
            )}
          </>
        ) : accessTab === "whitelist" ? (
          <>
            <div className="hint">
              <code>servers/&lt;instance&gt;/whitelist.json</code>
              {whitelistStatus ? ` · ${whitelistStatus}` : ""}
              {whitelistDirty ? ` · ${t.tr("unsaved", "未保存")}` : ""}
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8, alignItems: "center" }}>
              <input
                value={wlAddName}
                onChange={(e: any) => setWlAddName(e.target.value)}
                placeholder={t.tr("Name (optional)", "Name（可选）")}
                style={{ flex: 1, minWidth: 180 }}
                disabled={!instanceId.trim()}
              />
              <input
                value={wlAddUuid}
                onChange={(e: any) => setWlAddUuid(e.target.value)}
                placeholder={t.tr("UUID (optional)", "UUID（可选）")}
                style={{ flex: 1, minWidth: 260 }}
                disabled={!instanceId.trim()}
              />
              <button type="button" onClick={addWhitelistEntry} disabled={!instanceId.trim()}>
                <Icon name="plus" /> {t.tr("Add", "添加")}
              </button>
            </div>
            {wlErr ? (
              <div className="fieldError" style={{ marginTop: 6 }}>
                {wlErr}
              </div>
            ) : null}
            {whitelistEntries.length ? (
	              <table className="striped" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>{t.tr("Name", "名称")}</th>
                    <th>UUID</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {whitelistEntries.map((p) => {
                    const entryLabel = p.name && p.uuid ? `${p.name} (${p.uuid})` : p.name || p.uuid || "-";
                    const copyLabel = t.tr(`Copy whitelist entry ${entryLabel}`, `复制白名单条目 ${entryLabel}`);
                    const removeLabel = t.tr(`Remove whitelist entry ${entryLabel}`, `移除白名单条目 ${entryLabel}`);
                    return (
                      <tr key={`${p.uuid}-${p.name}`}>
                      <td>
                        <code>{p.name || "-"}</code>
                      </td>
                      <td>
                        <code>{p.uuid || "-"}</code>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div className="btnGroup">
                          <CopyButton iconOnly text={String(p.uuid || p.name || "")} tooltip={copyLabel} ariaLabel={copyLabel} />
                          <button
                            type="button"
                            className="dangerBtn iconBtn iconOnly"
                            title={removeLabel}
                            aria-label={removeLabel}
                            onClick={() => {
                              setWhitelistEntries((prev) => (prev || []).filter((x) => !(x.uuid === p.uuid && x.name === p.name)));
                              setWhitelistDirty(true);
                            }}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="hint" style={{ marginTop: 10 }}>
                {t.tr("No whitelist entries yet.", "暂无白名单。")}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="hint">
              <code>servers/&lt;instance&gt;/ops.json</code>
              {opsStatus ? ` · ${opsStatus}` : ""}
              {opsDirty ? ` · ${t.tr("unsaved", "未保存")}` : ""}
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8, alignItems: "center" }}>
              <input
                value={opAddName}
                onChange={(e: any) => setOpAddName(e.target.value)}
                placeholder={t.tr("Name (optional)", "Name（可选）")}
                style={{ flex: 1, minWidth: 180 }}
                disabled={!instanceId.trim()}
              />
              <input
                value={opAddUuid}
                onChange={(e: any) => setOpAddUuid(e.target.value)}
                placeholder={t.tr("UUID (optional)", "UUID（可选）")}
                style={{ flex: 1, minWidth: 260 }}
                disabled={!instanceId.trim()}
              />
              <input
                type="number"
                value={opAddLevel}
                onChange={(e: any) => setOpAddLevel(Math.round(Number(e.target.value || 0)) || 4)}
                min={1}
                max={4}
                title={t.tr("level 1-4", "level 1-4")}
                style={{ width: 86 }}
                disabled={!instanceId.trim()}
              />
              <label className="checkRow" style={{ userSelect: "none" }}>
                <input type="checkbox" checked={opAddBypass} onChange={(e: any) => setOpAddBypass(!!e.target.checked)} />{" "}
                {t.tr("Bypass limit", "绕过人数限制")}
              </label>
              <button type="button" onClick={addOpEntry} disabled={!instanceId.trim()}>
                <Icon name="plus" /> {t.tr("Add", "添加")}
              </button>
            </div>
            {opErr ? (
              <div className="fieldError" style={{ marginTop: 6 }}>
                {opErr}
              </div>
            ) : null}
            {opsEntries.length ? (
	              <table className="striped" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>{t.tr("Name", "名称")}</th>
                    <th>UUID</th>
                    <th>{t.tr("Level", "等级")}</th>
                    <th>{t.tr("Bypass", "绕过")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {opsEntries.map((p) => {
                    const entryLabel = p.name && p.uuid ? `${p.name} (${p.uuid})` : p.name || p.uuid || "-";
                    const copyLabel = t.tr(`Copy op entry ${entryLabel}`, `复制 OP 条目 ${entryLabel}`);
                    const removeLabel = t.tr(`Remove op entry ${entryLabel}`, `移除 OP 条目 ${entryLabel}`);
                    return (
                      <tr key={`${p.uuid}-${p.name}`}>
                      <td>
                        <code>{p.name || "-"}</code>
                      </td>
                      <td>
                        <code>{p.uuid || "-"}</code>
                      </td>
                      <td>
                        <code>{p.level}</code>
                      </td>
                      <td className="muted">{p.bypassesPlayerLimit ? t.tr("yes", "是") : t.tr("no", "否")}</td>
                      <td style={{ textAlign: "right" }}>
                        <div className="btnGroup">
                          <CopyButton iconOnly text={String(p.uuid || p.name || "")} tooltip={copyLabel} ariaLabel={copyLabel} />
                          <button
                            type="button"
                            className="dangerBtn iconBtn iconOnly"
                            title={removeLabel}
                            aria-label={removeLabel}
                            onClick={() => {
                              setOpsEntries((prev) => (prev || []).filter((x) => !(x.uuid === p.uuid && x.name === p.name)));
                              setOpsDirty(true);
                            }}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="hint" style={{ marginTop: 10 }}>
                {t.tr("No ops yet.", "暂无 OP。")}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbarLeft items-center">
            <div>
              <h2>{t.tr("Crash artifacts", "崩溃产物")}</h2>
              <div className="hint">
                {instanceId.trim() ? (
                  <>
                    <code>servers/{instanceId.trim()}/crash-reports/</code> · <code>servers/{instanceId.trim()}/hs_err_pid*.log</code>
                    {typeof crashArtifactsStatus === "string" && crashArtifactsStatus ? ` · ${crashArtifactsStatus}` : ""}
                  </>
                ) : (
                  t.tr("Select a game to view crash artifacts", "选择游戏以查看崩溃产物")
                )}
              </div>
            </div>
          </div>
          <div className="toolbarRight">
            <button
              type="button"
              className="iconBtn"
              onClick={() => refreshCrashArtifacts(instanceId.trim())}
              disabled={!selectedDaemon?.connected || !instanceId.trim() || crashArtifactsBusy}
              title={!instanceId.trim() ? t.tr("Select a game first", "请先选择游戏") : undefined}
            >
              <Icon name="refresh" />
              {crashArtifactsBusy ? t.tr("Refreshing…", "刷新中…") : t.tr("Refresh", "刷新")}
            </button>
          </div>
        </div>

        {instanceId.trim() ? (
          Array.isArray(crashArtifacts) && crashArtifacts.length ? (
            <>
              <div className="hint">
                {t.tr("showing", "显示")} {crashArtifacts.length}
              </div>
              <table className="striped" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>{t.tr("Time", "时间")}</th>
                    <th style={{ width: 120 }}>{t.tr("Kind", "类型")}</th>
                    <th>{t.tr("File", "文件")}</th>
                    <th style={{ width: 110 }}>{t.tr("Size", "大小")}</th>
                    <th style={{ width: 210 }} />
                  </tr>
                </thead>
                <tbody>
                  {crashArtifacts.map((it: any) => {
                    const path = String(it?.path || "").trim();
                    const name = String(it?.name || path.split("/").pop() || "").trim();
                    const kind = String(it?.kind || "").trim();
                    const unix = Math.max(0, Math.floor(Number(it?.mtimeUnix ?? it?.mtime_unix ?? 0)));
                    const bytes = Math.max(0, Number(it?.size ?? it?.bytes ?? 0));
                    const kindLabel = kind === "hs_err" ? "hs_err" : "crash_report";
                    const copyLabel = t.tr(`Copy path: ${name}`, `复制路径：${name}`);
                    const dlLabel = t.tr(`Download: ${name}`, `下载：${name}`);
                    return (
                      <tr key={path || name}>
                        <td className="muted">{unix ? <TimeAgo unix={unix} /> : "-"}</td>
                        <td>
                          <span className="badge">{kindLabel}</span>
                        </td>
                        <td style={{ minWidth: 0 }}>
                          <code style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name || "-"}</code>
                        </td>
                        <td>{fmtBytes(bytes)}</td>
                        <td style={{ textAlign: "right" }}>
                          <div className="btnGroup justify-end">
                            <CopyButton iconOnly text={path} tooltip={copyLabel} ariaLabel={copyLabel} disabled={!path} />
                            <button
                              type="button"
                              className="iconBtn"
                              onClick={() => downloadCrashArtifact(path, name)}
                              disabled={!selectedDaemon?.connected || !path}
                              title={dlLabel}
                              aria-label={dlLabel}
                            >
                              <Icon name="download" />
                              {t.tr("Download", "下载")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <div className="hint">{t.tr("No crash artifacts found yet.", "暂无崩溃产物。")}</div>
          )
        ) : (
          <div className="hint">{t.tr("Select a game to see crash artifacts.", "选择游戏以查看崩溃产物。")}</div>
        )}
      </div>

      <div className="card">
        <h2>{t.tr("Logs", "日志")}</h2>
        <div className="toolbar">
          <div className="toolbarLeft">
            <div className="field" style={{ minWidth: 180 }}>
              <label>{t.tr("View", "视图")}</label>
              <Select
                value={logView}
                onChange={(v) => setLogView(v as any)}
                options={[
                  { value: "all", label: t.tr("All", "全部") },
                  { value: "mc", label: "MC" },
                  { value: "install", label: t.tr("Install", "安装") },
                  { value: "frp", label: "FRP" },
                ]}
              />
            </div>
	            <div className="field" style={{ minWidth: 160 }}>
	              <label>{t.tr("Level", "级别")}</label>
	              <div className="chipRow logFilterChips">
	                <button type="button" className={`chip ${logLevelFilter === "all" ? "active" : ""}`} onClick={() => setLogLevelFilter("all")}>
	                  {t.tr("All", "全部")}
	                </button>
                <button
                  type="button"
                  className={`chip warn ${logLevelFilter === "warn" ? "active" : ""}`}
                  onClick={() => setLogLevelFilter("warn")}
                >
                  {t.tr("Warn", "警告")}
                </button>
                <button
                  type="button"
                  className={`chip danger ${logLevelFilter === "error" ? "active" : ""}`}
                  onClick={() => setLogLevelFilter("error")}
                >
                  {t.tr("Error", "错误")}
                </button>
              </div>
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label>{t.tr("Time", "时间")}</label>
              <Select
                value={logTimeMode}
                onChange={(v) => setLogTimeMode(v as any)}
                options={[
                  { value: "local", label: t.tr("Local", "本地") },
                  { value: "relative", label: t.tr("Relative", "相对") },
                ]}
              />
            </div>
          </div>
          <div className="toolbarRight">
            <div className="logSearchBar">
              <Icon name="search" />
              <input
                value={logQueryRaw}
                onChange={(e: any) => setLogQueryRaw(e.target.value)}
                placeholder={t.tr("Search logs…", "搜索日志…")}
                style={{ width: 220 }}
                onKeyDown={(e: any) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    jumpLogMatch(e.shiftKey ? -1 : 1);
                  }
                }}
              />
              {logQueryRaw.trim() ? (
	                <button type="button" className="iconBtn iconOnly ghost" title={t.tr("Clear", "清空")} aria-label={t.tr("Clear", "清空")} onClick={() => setLogQueryRaw("")}>
	                  ×
	                </button>
              ) : null}
              {logFilter.mode !== "none" && logFilter.q ? (
                <>
                  <button
                    type="button"
                    className="iconBtn iconOnly"
                    title={t.tr("Previous match", "上一个匹配")}
                    aria-label={t.tr("Previous match", "上一个匹配")}
                    onClick={() => jumpLogMatch(-1)}
                    disabled={!logMatchLineIdxs.length}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="iconBtn iconOnly"
                    title={t.tr("Next match", "下一个匹配")}
                    aria-label={t.tr("Next match", "下一个匹配")}
                    onClick={() => jumpLogMatch(1)}
                    disabled={!logMatchLineIdxs.length}
                  >
                    ↓
                  </button>
                  <span className="badge">
                    {logMatchLineIdxs.length ? `${Math.min(logMatchLineIdxs.length, logFindIdx + 1)}/${logMatchLineIdxs.length}` : t.tr("0 match", "0 匹配")}
                  </span>
                </>
              ) : null}
            </div>
            <Select
              value={logPreset}
              onChange={(v) => {
                const id = String(v || "");
                setLogPreset("");
                const preset = logPresetDefs.find((p) => p.id === id);
                if (!preset) return;
                setLogRegex(preset.regex);
                setLogMatchOnly(preset.matchOnly);
                setLogLevelFilter(preset.level);
                setLogQueryRaw(preset.query);
              }}
              placeholder={t.tr("Presets…", "预设…")}
              options={logPresetOptions}
              style={{ width: 200 }}
              disabled={!instanceId.trim()}
            />
            <label className="checkRow" style={{ userSelect: "none" }}>
              <input type="checkbox" checked={logMatchOnly} onChange={(e) => setLogMatchOnly(e.target.checked)} />{" "}
              {t.tr("Only matches", "仅匹配")}
            </label>
            <label className="checkRow" style={{ userSelect: "none" }}>
              <input type="checkbox" checked={logRegex} onChange={(e) => setLogRegex(e.target.checked)} /> {t.tr("Regex", "正则")}
            </label>
            {logFilter.mode === "regex" && logFilter.error ? (
              <span className="badge" title={logFilter.error}>
                {t.tr("regex error", "正则错误")}
              </span>
            ) : null}
            <label className="checkRow" style={{ userSelect: "none" }}>
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> {t.tr("Auto-scroll", "自动滚动")}
            </label>
            <label className="checkRow" style={{ userSelect: "none" }}>
              <input type="checkbox" checked={wrapLogs} onChange={(e) => setWrapLogs(e.target.checked)} /> {t.tr("Wrap", "换行")}
            </label>
            <label className="checkRow" style={{ userSelect: "none" }}>
              <input type="checkbox" checked={highlightLogs} onChange={(e) => setHighlightLogs(e.target.checked)} /> {t.tr("Highlight", "高亮")}
            </label>
            <button type="button" className="iconBtn" onClick={() => setLogPaused((v) => !v)}>
              {logPaused ? t.tr("Resume", "继续") : t.tr("Pause", "暂停")}
            </button>
            {logPaused ? <span className="badge">{t.tr("paused", "已暂停")}</span> : null}
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                setLogClearAtUnix(Math.floor(Date.now() / 1000));
              }}
            >
              {t.tr("Clear view", "清空视图")}
            </button>
            {logSelection ? (
              <>
                <span className="badge" title={t.tr("Click a line to select; Shift+Click to range.", "点击某行以选择；Shift+点击以选择范围。")}>
                  {t.tr("Selected", "已选")}: {logSelection.count}
                </span>
                <button type="button" className="iconBtn" onClick={() => exportLogSelection("copy")}>
                  <Icon name="copy" />
                  {t.tr("Copy selection", "复制选中")}
                </button>
                <button type="button" className="iconBtn" onClick={() => exportLogSelection("download")}>
                  <Icon name="download" />
                  {t.tr("Download selection", "下载选中")}
                </button>
                <button
                  type="button"
                  className="iconBtn iconOnly"
                  title={t.tr("Clear selection", "清空选择")}
                  aria-label={t.tr("Clear selection", "清空选择")}
                  onClick={() => {
                    setLogSelectStart(null);
                    setLogSelectEnd(null);
                  }}
                >
                  ×
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                const text =
                  logLines
                    .slice(-300)
                    .map((l: any) => l.text)
                    .join("\n") || "";
                copyText(text || "<empty>");
              }}
            >
              <Icon name="copy" />
              {t.tr("Copy", "复制")}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                const text =
                  logLines
                    .slice(-2000)
                    .map((l: any) => l.text)
                    .join("\n") || "";
                const blob = new Blob([text || "<empty>"], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                const name = instanceId.trim() ? `elegantmc-${instanceId.trim()}-logs.txt` : `elegantmc-logs.txt`;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
            >
              <Icon name="download" />
              {t.tr("Download view", "下载视图")}
            </button>
            <button type="button" className="iconBtn" onClick={downloadLatestLog} disabled={!selectedDaemon?.connected || !instanceId.trim()}>
              <Icon name="download" />
              latest.log
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                setHistorySearchResult(null);
                setHistorySearchStatus("");
                setHistorySearchQuery(String(logQueryRaw || "").trim());
                setHistorySearchRegex(!!logRegex);
                setHistorySearchMaxFiles(12);
                setHistorySearchMaxMatches(200);
                setHistorySearchBefore(0);
                setHistorySearchAfter(0);
                setHistorySearchOpen(true);
              }}
              disabled={!selectedDaemon?.connected || !instanceId.trim()}
              title={t.tr("Search server log files on disk (latest + rotated).", "在磁盘日志文件中搜索（latest + 历史轮转）。")}
            >
              <Icon name="search" />
              {t.tr("History search…", "历史搜索…")}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                setLogBookmarksQueryRaw("");
                setLogBookmarksOpen(true);
              }}
              disabled={!instanceId.trim()}
              title={t.tr("Local bookmarks for this instance (stored in browser).", "该实例的本地书签（保存在浏览器）。")}
            >
              <Icon name="pin" />
              {t.tr("Bookmarks", "书签")}
              {logBookmarks.length ? <span className="badge">{logBookmarks.length}</span> : null}
            </button>
          </div>
        </div>

        {commonLogIssues.length ? (
          <details className="uiDetails" open style={{ marginTop: 4 }}>
            <summary>
              <span>{t.tr("Likely causes", "可能原因")}</span>
              <span className={`badge ${commonLogIssues.some((x) => x.severity === "danger") ? "danger" : "warn"}`}>
                <span className="statusBadgeDot" />
                {commonLogIssues.length}
              </span>
            </summary>
            <div className="stack" style={{ gap: 10 }}>
              {commonLogIssues.map((it) => {
                const inst = instanceId.trim();
                const view = String(logView || "all");
                const title =
                  it.id === "eula"
                    ? t.tr("EULA not accepted", "未接受 EULA")
                    : it.id === "port"
                      ? t.tr("Port already in use", "端口被占用")
                      : it.id === "oom"
                        ? t.tr("Out of memory", "内存不足")
                        : it.id === "java"
                          ? t.tr("Java version mismatch", "Java 版本不匹配")
                          : it.id === "jar"
                            ? t.tr("Jar startup failed", "Jar 启动失败")
                            : t.tr("FRP auth failure", "FRP 认证失败");

                const detail =
                  it.id === "eula"
                    ? t.tr("Server refused to start until eula.txt has eula=true.", "服务端拒绝启动，需在 eula.txt 写入 eula=true。")
                    : it.id === "port"
                      ? t.tr("Another process is already listening on this port.", "该端口已被其他进程占用。")
                      : it.id === "oom"
                        ? t.tr("JVM ran out of heap memory. Increase Xmx or reduce load.", "JVM 堆内存不足：提高 Xmx 或减少负载/插件。")
                        : it.id === "java"
                          ? t.tr(
                              "The selected Java is too old/new for this jar (e.g. class file 65 requires Java 21).",
                              "当前 Java 版本与 jar 不匹配（例如 class file 65 需要 Java 21）。"
                            )
                          : it.id === "jar"
                            ? t.tr("Jar path or jar contents are invalid (missing file/manifest/main class).", "jar 路径或内容无效（缺失文件/manifest/main class）。")
                            : t.tr("frpc cannot authenticate to frps. Check token/profile on both sides.", "frpc 无法通过 frps 认证；请检查两端的 token/配置。 ");

                const applyFilter = () => {
                  // Apply a focused filter so the user can see the evidence quickly.
                  setLogMatchOnly(true);
                  setLogLevelFilter(it.severity === "danger" ? "error" : "warn");
                  if (it.id === "oom") {
                    setLogRegex(true);
                    setLogQueryRaw("OutOfMemoryError|GC overhead limit exceeded|Java heap space");
                  } else if (it.id === "port") {
                    setLogRegex(true);
                    setLogQueryRaw("BindException|Address already in use|Failed to bind to port");
                  } else if (it.id === "eula") {
                    setLogRegex(true);
                    setLogQueryRaw("EULA|eula\\.txt|eula=true");
                  } else if (it.id === "java") {
                    setLogRegex(true);
                    setLogQueryRaw("UnsupportedClassVersionError|class file version");
                  } else if (it.id === "jar") {
                    setLogRegex(true);
                    setLogQueryRaw("Unable to access jarfile|No main manifest attribute|Could not find or load main class");
                  } else {
                    setLogRegex(true);
                    setLogQueryRaw("authentication failed|invalid token|token is not correct");
                  }
                };

                const openEula = () => {
                  if (!inst) return;
                  setTab("files");
                  setFsPath(inst);
                  openFileByPath(joinRelPath(inst, "eula.txt"));
                };

                const openSettings = () => {
                  if (!inst) return;
                  openSettingsModal();
                };

                return (
                  <div key={it.id} className="cardSub" style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 800, letterSpacing: "-0.01em" }}>{title}</div>
                        <span className={`badge ${it.severity === "danger" ? "danger" : "warn"}`.trim()}>
                          <span className="statusBadgeDot" />
                          <TimeAgo unix={it.lastSeenUnix} fallback={t.tr("recent", "最近")} />
                        </span>
                      </div>
                      <div className="hint" style={{ marginTop: 4 }}>
                        {detail}
                      </div>
                      {it.sample ? (
                        <div className="hint" style={{ marginTop: 6 }}>
                          <code style={{ whiteSpace: "pre-wrap" }}>{it.sample}</code>
                        </div>
                      ) : null}
                    </div>
                    <div className="btnGroup" style={{ flex: "0 0 auto" }}>
                      <button type="button" className="iconBtn" onClick={applyFilter} title={t.tr("Filter logs to evidence", "筛选日志证据")}
                      >
                        <Icon name="search" />
                        {t.tr("Filter", "筛选")}
                      </button>
                      {it.id === "eula" ? (
                        <button type="button" className="iconBtn" onClick={() => acceptEulaNowLocal(inst)} disabled={!canControl}>
                          <Icon name="check" />
                          {t.tr("Accept EULA", "接受 EULA")}
                        </button>
                      ) : null}
                      {it.id === "eula" ? (
                        <button type="button" className="iconBtn" onClick={openEula} disabled={!inst}>
                          <Icon name="file" />
                          eula.txt
                        </button>
                      ) : null}
                      {it.id !== "frp_auth" ? (
                        <button type="button" className="iconBtn" onClick={openSettings} disabled={!inst}>
                          <Icon name="settings" />
                          {t.tr("Settings", "设置")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="iconBtn"
                          onClick={() => {
                            setLogView("frp" as any);
                            applyFilter();
                          }}
                        >
                          <Icon name="link" />
                          FRP
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {instanceId.trim() ? (
                <div className="hint">
                  {t.tr(
                    "These hints are best-effort. Use Presets/History search for deeper investigation.",
                    "这些提示是尽力推断；需要更深入排查可用“预设/历史搜索”。"
                  )}
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

        <div className="logScrollWrap">
          <div
            ref={logScrollRef}
            style={{ maxHeight: 640, overflow: "auto" }}
            onScroll={(e) => {
              const el = e.currentTarget;
              setLogScrollTop(el.scrollTop);
              const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
              setLogNearBottom(remaining <= 64);
            }}
          >
	            {logsLoading ? (
	              <div className="stack" style={{ padding: 12, gap: 10 }}>
	                {Array.from({ length: 14 }).map((_, i) => (
	                  <div key={i} className="skeleton" style={{ minHeight: 18 }} />
	                ))}
	              </div>
	            ) : (
              <>
                <div style={{ height: logVirtual.topPad }} />
                <pre style={{ margin: 0 }}>
                  {logVirtual.visible.map((l, idx) => {
                    const lineIdx = logVirtual.start + idx;
                    const lineNo = lineIdx + 1;
                    const inst = instanceId.trim();
                    const instSuffixEn = inst ? ` (${inst})` : "";
                    const instSuffixZh = inst ? `（实例 ${inst}）` : "";
                    const isActive = lineIdx === activeLogMatchLineIdx;
                    const isSelected = !!logSelection && lineIdx >= logSelection.start && lineIdx <= logSelection.end;
                    const cls = `logLine ${highlightLogs ? l.level : ""} ${highlightLogs ? l.issueClass : ""} ${isSelected ? "selected" : ""} ${isActive ? "activeMatch" : ""}`.trim();
                    const rawText = String(l.text || "");
                    const maxDisplayLen = 8000;
                    const isLong = rawText.length > maxDisplayLen;
                    const displayText = isLong
                      ? `${rawText.slice(0, 4000)} … <${rawText.length} chars> … ${rawText.slice(-3500)}`
                      : rawText;
                    const isBookmarked = logBookmarkTextSet.has(rawText);
                    return (
                      <span
                        key={`${lineIdx}`}
                        data-log-idx={lineIdx}
                        className={cls}
                        role="button"
                        tabIndex={0}
                        title={t.tr("Click to select. Shift+Click to select a range.", "点击以选择。Shift+点击以选择范围。")}
                        onClick={(e: any) => {
                          const target = e?.target as any;
                          if (target && typeof target.closest === "function" && target.closest("button")) return;
                          if (e.shiftKey && typeof logSelectStart === "number") {
                            setLogSelectEnd(lineIdx);
                          } else {
                            setLogSelectStart(lineIdx);
                            setLogSelectEnd(lineIdx);
                          }
                        }}
                        onKeyDown={(e: any) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (e.shiftKey && typeof logSelectStart === "number") {
                              setLogSelectEnd(lineIdx);
                            } else {
                              setLogSelectStart(lineIdx);
                              setLogSelectEnd(lineIdx);
                            }
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="logLineCopyBtn"
                          title={t.tr(`Copy line ${lineNo}${instSuffixEn}`, `复制第 ${lineNo} 行${instSuffixZh}`)}
                          aria-label={t.tr(`Copy line ${lineNo}${instSuffixEn}`, `复制第 ${lineNo} 行${instSuffixZh}`)}
                          onClick={(e: any) => {
                            e.stopPropagation();
                            copyText(l.text);
                          }}
                        >
                          <Icon name="copy" />
                        </button>
                        <button
                          type="button"
                          className={`logLineBookmarkBtn ${isBookmarked ? "active" : ""}`.trim()}
                          title={
                            isBookmarked
                              ? t.tr(`Remove bookmark from line ${lineNo}${instSuffixEn}`, `移除第 ${lineNo} 行书签${instSuffixZh}`)
                              : t.tr(`Bookmark line ${lineNo}${instSuffixEn}`, `为第 ${lineNo} 行添加书签${instSuffixZh}`)
                          }
                          aria-label={
                            isBookmarked
                              ? t.tr(`Remove bookmark from line ${lineNo}${instSuffixEn}`, `移除第 ${lineNo} 行书签${instSuffixZh}`)
                              : t.tr(`Bookmark line ${lineNo}${instSuffixEn}`, `为第 ${lineNo} 行添加书签${instSuffixZh}`)
                          }
                          onClick={(e: any) => {
                            e.stopPropagation();
                            toggleLogBookmark(lineIdx, rawText);
                          }}
                        >
                          <Icon name="pin" />
                        </button>
                        <span
                          className="logLineText"
                          style={{ whiteSpace: wrapLogs ? "pre-wrap" : "pre", wordBreak: wrapLogs ? "break-word" : "normal" }}
                          title={
                            isLong
                              ? t.tr("Long line truncated for performance. Use Copy line to copy full.", "超长日志为性能已截断显示。可用“复制该行”获取完整内容。")
                              : undefined
                          }
                        >
                          {highlightLogs && logFilter.mode === "text" && logFilter.q
                            ? highlightText(displayText, logFilter.q)
                            : highlightLogs && logFilter.mode === "regex" && logFilter.re
                              ? highlightRegex(displayText, logFilter.re)
                              : displayText}
                        </span>
                      </span>
                    );
                  })}
                </pre>
                <div style={{ height: logVirtual.bottomPad }} />
              </>
            )}
          </div>
          {newLogsCount > 0 && !logNearBottom && !logPaused ? (
            <button
              type="button"
              className="logNewPill"
              onClick={() => {
                const el = logScrollRef.current;
                if (!el) return;
                el.scrollTop = el.scrollHeight;
                setNewLogsCount(0);
                setAutoScroll(true);
              }}
              title={t.tr("Jump to bottom", "跳到底部")}
            >
              {t.tr(`${newLogsCount} new logs`, `${newLogsCount} 条新日志`)}
            </button>
          ) : null}
          {logScrollTop > 520 ? (
            <button
              type="button"
              className="logTopPill"
              onClick={() => {
                const el = logScrollRef.current;
                if (!el) return;
                el.scrollTop = 0;
                setLogScrollTop(0);
              }}
              title={t.tr("Back to top", "回到顶部")}
            >
              {t.tr("Top", "顶部")}
            </button>
          ) : null}
        </div>
        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
          <div className="hint">{t.tr("Tip: All shows current game + FRP logs.", "提示：All 会显示当前游戏 + FRP 的日志。")}</div>
          {logRangeLabel ? (
            <span className="muted">
              {t.tr("Range", "范围")}: <code>{logRangeLabel}</code>
            </span>
          ) : null}
        </div>

        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <span className="muted">{t.tr("Quick", "快捷")}:</span>
          <Select
            value=""
            onChange={async (v) => {
              if (v === "stop") {
                const ok = await confirmDialog(
                  t.tr("Send 'stop' to the server console? The server will shut down.", "向服务端控制台发送 'stop'？服务器将关闭。"),
                  { title: t.tr("Stop", "停止"), confirmLabel: t.tr("Stop", "停止"), cancelLabel: t.tr("Cancel", "取消"), danger: true }
                );
                if (!ok) return;
                await sendQuickCommand("stop");
                return;
              }
              if (v === "reload") {
                const ok = await confirmDialog(
                  t.tr(
                    "Send 'reload' to the server console? This is risky on many servers/plugins.",
                    "向服务端控制台发送 'reload'？这在很多服务端/插件上都有风险。"
                  ),
                  { title: "reload", confirmLabel: "reload", cancelLabel: t.tr("Cancel", "取消"), danger: true }
                );
                if (!ok) return;
                await sendQuickCommand("reload");
              }
            }}
            placeholder={t.tr("Danger Zone", "危险区")}
            options={[
              { value: "stop", label: t.tr("Stop", "停止"), disabled: !selectedDaemon?.connected || !instanceId.trim() },
              { value: "reload", label: "reload", disabled: !selectedDaemon?.connected || !instanceId.trim() },
            ]}
            style={{ width: 160 }}
          />
          <button type="button" disabled={!selectedDaemon?.connected || !instanceId.trim()} onClick={() => sendQuickCommand("save-all")}>
            save-all
          </button>
          <button
            type="button"
            disabled={!selectedDaemon?.connected || !instanceId.trim()}
            onClick={() => {
              setConsoleLine("say ");
              window.setTimeout(() => consoleInputRef.current?.focus(), 0);
            }}
          >
            say…
          </button>
          <button type="button" disabled={!selectedDaemon?.connected || !instanceId.trim()} onClick={() => sendQuickCommand("whitelist reload")}>
            whitelist reload
          </button>
        </div>

        <div className="row mt-3">
          <input
            ref={consoleInputRef}
            value={consoleLine}
            onChange={(e) => setConsoleLine(e.target.value)}
            placeholder={t.tr("Console command (e.g. say hi)", "控制台命令（例如 say hi）")}
            style={{ flex: 1, minWidth: 240 }}
            disabled={!selectedDaemon?.connected || !instanceId.trim()}
            onKeyDown={(e: any) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendConsoleWithHistory();
                return;
              }
              if (e.key === "ArrowUp") {
                if (!cmdHistory.length) return;
                e.preventDefault();
                const nextIdx = Math.max(0, cmdHistoryIdx - 1);
                setCmdHistoryIdx(nextIdx);
                setConsoleLine(cmdHistory[nextIdx] || "");
                return;
              }
              if (e.key === "ArrowDown") {
                if (!cmdHistory.length) return;
                e.preventDefault();
                const nextIdx = Math.min(cmdHistory.length, cmdHistoryIdx + 1);
                setCmdHistoryIdx(nextIdx);
                setConsoleLine(nextIdx >= cmdHistory.length ? "" : cmdHistory[nextIdx] || "");
              }
            }}
          />
          <button onClick={sendConsoleWithHistory} disabled={!consoleLine.trim() || !selectedDaemon?.connected || !instanceId.trim()}>
            {t.tr("Send", "发送")}
          </button>
        </div>

        {cmdCapture || cmdOutputs.length ? (
          <div className="itemCard mt-3">
            <div className="itemCardHeader">
              <div className="min-w-0">
                <div className="itemTitle">{t.tr("Command output", "命令输出")}</div>
                <div className="itemMeta">
                  {cmdCapture ? (
                    <>
                      {t.tr("capturing", "抓取中")}: <code>{cmdCapture.cmd}</code>
                    </>
                  ) : cmdOutputs[0] ? (
                    <>
                      <TimeAgo unix={cmdOutputs[0].startedUnix} /> · <code>{cmdOutputs[0].cmd}</code>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="btnGroup">
                <button
                  type="button"
                  className="iconBtn"
                  onClick={() => {
                    const lines = cmdCapture ? cmdCaptureLines : cmdOutputs[0]?.lines || [];
                    copyText((lines || []).join("\n") || "<empty>");
                  }}
                  disabled={!(cmdCapture ? cmdCaptureLines.length : cmdOutputs[0]?.lines?.length)}
                >
                  <Icon name="copy" />
                  {t.tr("Copy", "复制")}
                </button>
                <button
                  type="button"
                  className="iconBtn"
                  onClick={() => {
                    setCmdOutputs([]);
                    setCmdCapture(null);
                    setCmdCaptureLines([]);
                    cmdCaptureLinesRef.current = [];
                  }}
                  disabled={!cmdCapture && !cmdOutputs.length}
                >
                  {t.tr("Clear", "清空")}
                </button>
              </div>
            </div>
            <pre style={{ margin: 0, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
              {(cmdCapture ? cmdCaptureLines : cmdOutputs[0]?.lines || []).slice(-120).join("\n") || t.tr("<no output captured>", "<未捕获到输出>")}
            </pre>
          </div>
        ) : null}
      </div>

      <ManagedModal
        id="frp-diagnostics"
        open={frpDiagOpen}
        onOverlayClick={() => setFrpDiagOpen(false)}
        modalStyle={{ width: "min(980px, 100%)" }}
        ariaLabel={t.tr("FRP diagnostics", "FRP 诊断")}
      >
        <div className="modalHeader">
          <div>
            <div style={{ fontWeight: 800 }}>{t.tr("FRP diagnostics", "FRP 诊断")}</div>
            <div className="hint">
              {t.tr("game", "游戏")}: <code>{instanceId.trim() || "-"}</code> · {t.tr("daemon", "daemon")}: <code>{selectedDaemon?.id || "-"}</code>
            </div>
          </div>
          <button type="button" onClick={() => setFrpDiagOpen(false)}>
            {t.tr("Close", "关闭")}
          </button>
        </div>

        <div className="grid2 items-start">
          <div className="field">
            <label>{t.tr("Proxy name", "Proxy 名称")}</label>
            <Select
              value={frpDiagProxyName}
              onChange={(v) => {
                const name = String(v || "").trim();
                setFrpDiagProxyName(name);
                setFrpDiagRevealToken(false);
                setFrpDiagIni("");
                setFrpDiagIniStatus("");
                loadFrpDiagIni(name, false);
              }}
              options={frpDiagProxyOptions}
            />
            <div className="hint">{t.tr("Reads daemon-generated frpc.ini under frp/<name>/.", "读取 daemon 生成的 frpc.ini（位于 frp/<name>/）。")}</div>
          </div>

          <div className="field">
            <label>{t.tr("FRP server", "FRP 服务器")}</label>
            <code>
              {selectedProfile ? `${String(selectedProfile.server_addr || "-")}:${Math.round(Number(selectedProfile.server_port || 0)) || "-"}` : "-"}
            </code>
            <div className="hint" style={{ marginTop: 6 }}>
              {t.tr("Panel probe", "Panel 探测")}:{" "}
              {selectedProfile?.status?.online === true ? (
                <StatusBadge tone="ok">
                  {t.tr("online", "在线")} {Math.round(Number(selectedProfile.status.latencyMs || 0))}ms
                </StatusBadge>
              ) : selectedProfile?.status?.online === false ? (
                <StatusBadge tone="danger">{t.tr("offline", "离线")}</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">{t.tr("unknown", "未知")}</StatusBadge>
              )}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div className="hint">{frpDiagIniStatus}</div>
          <div className="btnGroup justify-end">
            <button
              type="button"
              className="iconBtn"
              onClick={() => loadFrpDiagIni(frpDiagProxyName, frpDiagRevealToken)}
              disabled={!selectedDaemon?.connected || !frpDiagProxyName.trim() || frpDiagIniBusy}
            >
              <Icon name="refresh" />
              {t.tr("Reload", "刷新")}
            </button>
            {!frpDiagRevealToken ? (
              <button
                type="button"
                onClick={async () => {
                  const name = frpDiagProxyName.trim();
                  if (!name) return;
                  const ok = await confirmDialog(t.tr(`Reveal token in frpc.ini for "${name}"?`, `显示「${name}」的 frpc.ini 中的 token？`), {
                    title: t.tr("Reveal token", "显示 token"),
                    confirmLabel: t.tr("Reveal", "显示"),
                    cancelLabel: t.tr("Cancel", "取消"),
                  });
                  if (!ok) return;
                  setFrpDiagRevealToken(true);
                  loadFrpDiagIni(name, true);
                }}
                disabled={!selectedDaemon?.connected || !frpDiagProxyName.trim() || frpDiagIniBusy}
              >
                {t.tr("Reveal token", "显示 token")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const name = frpDiagProxyName.trim();
                  setFrpDiagRevealToken(false);
                  loadFrpDiagIni(name, false);
                }}
                disabled={!frpDiagProxyName.trim() || frpDiagIniBusy}
              >
                {t.tr("Hide token", "隐藏 token")}
              </button>
            )}
            <CopyButton iconOnly text={frpDiagIni} tooltip={t.tr("Copy config", "复制配置")} ariaLabel={t.tr("Copy config", "复制配置")} disabled={!frpDiagIni} />
          </div>
        </div>

        <pre className="diffFrame" style={{ marginTop: 10, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {frpDiagIni || t.tr("<empty>", "<空>")}
        </pre>

        <div className="row" style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div className="min-w-0">
            <div style={{ fontWeight: 700 }}>{t.tr("Connectivity tests", "连通性检测")}</div>
            <div className="hint">{t.tr("Probe TCP reachability from daemon to FRP server.", "从 daemon 探测到 FRP 服务器的 TCP 连通性。")}</div>
          </div>
          <div className="btnGroup justify-end">
            <button
              type="button"
              className="iconBtn"
              onClick={runFrpDiagProbeNow}
              disabled={!selectedDaemon?.connected || !selectedProfile || frpDiagProbeBusy}
              title={!selectedProfile ? t.tr("Select an FRP profile first", "请先选择 FRP 配置") : undefined}
            >
              <Icon name="refresh" />
              {t.tr("Probe from daemon", "从 daemon 探测")}
            </button>
          </div>
        </div>
        {frpDiagProbeStatus ? <div className="hint">{frpDiagProbeStatus}</div> : null}
        {frpDiagProbeResult ? (
          <div className="hint" style={{ marginTop: 6 }}>
            {(() => {
              const online = (frpDiagProbeResult as any)?.online;
              const latency = Math.round(Number((frpDiagProbeResult as any)?.latency_ms || 0));
              const err = String((frpDiagProbeResult as any)?.error || "").trim();
              if (online === true) {
                return (
                  <StatusBadge tone="ok">
                    {t.tr("online", "在线")} {Number.isFinite(latency) ? `${latency}ms` : ""}
                  </StatusBadge>
                );
              }
              if (online === false) {
                return (
                  <StatusBadge tone="danger">
                    {t.tr("offline", "离线")} {err ? `· ${err}` : ""}
                  </StatusBadge>
                );
              }
              return <StatusBadge tone="neutral">{t.tr("unknown", "未知")}</StatusBadge>;
            })()}
          </div>
        ) : null}

        <div className="mt-3">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 700, minWidth: 0 }}>{t.tr("frpc logs tail", "frpc 日志尾")}</div>
            <CopyButton
              iconOnly
              text={frpDiagLogTailText}
              tooltip={t.tr("Copy logs", "复制日志")}
              ariaLabel={t.tr("Copy logs", "复制日志")}
              disabled={!frpDiagLogTailText}
            />
          </div>
          <pre className="diffFrame" style={{ marginTop: 10, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {frpDiagLogTailText || t.tr("<no logs>", "<无日志>")}
          </pre>
        </div>
      </ManagedModal>

      <ManagedModal
        id="logs-bookmarks"
        open={logBookmarksOpen}
        onOverlayClick={() => setLogBookmarksOpen(false)}
        modalStyle={{ width: "min(920px, 100%)" }}
        ariaLabel={t.tr("Log bookmarks", "日志书签")}
      >
        <div className="modalHeader">
          <div>
            <div style={{ fontWeight: 800 }}>{t.tr("Log bookmarks", "日志书签")}</div>
            <div className="hint">
              {t.tr("game", "游戏")}: <code>{instanceId.trim() || "-"}</code> · {t.tr("stored locally", "本地保存")}
            </div>
          </div>
          <button type="button" onClick={() => setLogBookmarksOpen(false)}>
            {t.tr("Close", "关闭")}
          </button>
        </div>

        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="logSearchBar" style={{ flex: 1, minWidth: 220 }}>
            <Icon name="search" />
            <input
              value={logBookmarksQueryRaw}
              onChange={(e: any) => setLogBookmarksQueryRaw(e.target.value)}
              placeholder={t.tr("Search bookmarks…", "搜索书签…")}
              style={{ width: "100%" }}
            />
            {logBookmarksQueryRaw.trim() ? (
	              <button type="button" className="iconBtn iconOnly ghost" title={t.tr("Clear", "清空")} aria-label={t.tr("Clear", "清空")} onClick={() => setLogBookmarksQueryRaw("")}>
	                ×
	              </button>
            ) : null}
          </div>
          <span className="badge">
            {t.tr("count", "数量")}: {filteredLogBookmarks.length}/{logBookmarks.length}
          </span>
          <button
            type="button"
            className="dangerBtn"
            onClick={async () => {
              if (!logBookmarks.length) return;
              const ok = await confirmDialog(t.tr("Clear all bookmarks for this instance?", "清空该实例的所有书签？"), {
                title: t.tr("Clear bookmarks", "清空书签"),
                confirmLabel: t.tr("Clear", "清空"),
                cancelLabel: t.tr("Cancel", "取消"),
                danger: true,
              });
              if (!ok) return;
              setLogBookmarks([]);
              pushToast(t.tr("Bookmarks cleared", "书签已清空"), "ok");
            }}
            disabled={!instanceId.trim() || !logBookmarks.length}
          >
            {t.tr("Clear all", "全部清空")}
          </button>
        </div>

        {filteredLogBookmarks.length ? (
          <div className="stack" style={{ marginTop: 12, gap: 10, maxHeight: 560, overflow: "auto" }}>
            {filteredLogBookmarks.slice(0, 200).map((b) => {
              const text = String(b.text || "");
              const preview = text.length > 10_000 ? `${text.slice(0, 5000)}\n… <${text.length} chars> …\n${text.slice(-4500)}` : text;
              const lineNo = Math.max(0, Math.round(Number(b.lineIdxHint || 0) || 0)) + 1;
              const label = String(b.label || "").trim();
              const copyLabel = label
                ? t.tr(`Copy bookmark #${lineNo}: ${label}`, `复制书签 #${lineNo}：${label}`)
                : t.tr(`Copy bookmark #${lineNo}`, `复制书签 #${lineNo}`);
              const removeLabel = label
                ? t.tr(`Remove bookmark #${lineNo}: ${label}`, `移除书签 #${lineNo}：${label}`)
                : t.tr(`Remove bookmark #${lineNo}`, `移除书签 #${lineNo}`);
              return (
                <div key={b.id} className="itemCard">
                  <div className="itemCardHeader" style={{ alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          value={b.label}
                          onChange={(e: any) => {
                            const next = String(e.target.value || "").slice(0, 120);
                            setLogBookmarks((prev) => (prev || []).map((x) => (x.id === b.id ? { ...x, label: next } : x)));
                          }}
                          placeholder={t.tr("Label (optional)", "标签（可选）")}
                          style={{ flex: 1, minWidth: 220 }}
                        />
                        <span className="badge">{b.view || "all"}</span>
                        {b.createdAtUnix ? (
                          <span className="muted">
                            <TimeAgo unix={b.createdAtUnix} />
                          </span>
                        ) : null}
                      </div>
                      <pre className="diffFrame" style={{ marginTop: 10, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {preview || "<empty>"}
                      </pre>
                    </div>
                    <div className="btnGroup justify-end">
                      <button type="button" onClick={() => jumpToBookmark(b)} disabled={!instanceId.trim()}>
                        {t.tr("Jump", "跳转")}
                      </button>
                      <CopyButton iconOnly text={text} tooltip={copyLabel} ariaLabel={copyLabel} disabled={!text} />
                      <button
                        type="button"
                        className="dangerBtn iconBtn iconOnly"
                        title={removeLabel}
                        aria-label={removeLabel}
                        onClick={() => setLogBookmarks((prev) => (prev || []).filter((x) => x.id !== b.id))}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="hint" style={{ marginTop: 12 }}>
            {t.tr("No bookmarks.", "暂无书签。")}
          </div>
        )}
      </ManagedModal>

      <ManagedModal
        id="logs-history-search"
        open={historySearchOpen}
        onOverlayClick={() => (!historySearchBusy ? setHistorySearchOpen(false) : null)}
        modalStyle={{ width: "min(980px, 100%)" }}
        ariaLabel={t.tr("Log history search", "日志历史搜索")}
      >
        <div className="modalHeader">
          <div>
            <div style={{ fontWeight: 800 }}>{t.tr("Log history search", "日志历史搜索")}</div>
            <div className="hint">
              {t.tr("game", "游戏")}: <code>{instanceId.trim() || "-"}</code> · <code>servers/&lt;instance&gt;/logs/</code>
            </div>
          </div>
          <button type="button" onClick={() => setHistorySearchOpen(false)} disabled={historySearchBusy}>
            {t.tr("Close", "关闭")}
          </button>
        </div>

        <div className="grid2 items-start">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>{t.tr("Query", "查询")}</label>
            <input
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(String(e.target.value || ""))}
              placeholder={t.tr("e.g. Exception, Can't keep up, Timed out…", "例如 Exception、Can't keep up、Timed out…")}
              onKeyDown={(e: any) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runHistorySearchNow();
                }
              }}
            />
            <div className="row" style={{ marginTop: 8, gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label className="checkRow" style={{ userSelect: "none" }}>
                <input type="checkbox" checked={historySearchRegex} onChange={(e) => setHistorySearchRegex(e.target.checked)} />{" "}
                {t.tr("Regex", "正则")}
              </label>
              {historyFilter.mode === "regex" && historyFilter.error ? (
                <span className="badge" title={historyFilter.error}>
                  {t.tr("regex error", "正则错误")}
                </span>
              ) : null}
              <span className="hint">{t.tr("Searches latest.log and rotated logs (including .gz).", "会搜索 latest.log 和历史轮转日志（含 .gz）。")}</span>
            </div>
          </div>
          <div className="field">
            <label>{t.tr("Max files", "最多文件")}</label>
            <input
              type="number"
              value={Number.isFinite(historySearchMaxFiles) ? historySearchMaxFiles : 12}
              onChange={(e) => setHistorySearchMaxFiles(Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 12))))}
              min={1}
              max={60}
            />
          </div>
          <div className="field">
            <label>{t.tr("Max matches", "最多匹配")}</label>
            <input
              type="number"
              value={Number.isFinite(historySearchMaxMatches) ? historySearchMaxMatches : 200}
              onChange={(e) => setHistorySearchMaxMatches(Math.max(1, Math.min(2000, Math.round(Number(e.target.value) || 200))))}
              min={1}
              max={2000}
            />
          </div>
          <div className="field">
            <label>{t.tr("Context before", "前置上下文")}</label>
            <input
              type="number"
              value={Number.isFinite(historySearchBefore) ? historySearchBefore : 0}
              onChange={(e) => setHistorySearchBefore(Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0))))}
              min={0}
              max={20}
            />
          </div>
          <div className="field">
            <label>{t.tr("Context after", "后置上下文")}</label>
            <input
              type="number"
              value={Number.isFinite(historySearchAfter) ? historySearchAfter : 0}
              onChange={(e) => setHistorySearchAfter(Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0))))}
              min={0}
              max={20}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div className="hint">{historySearchStatus}</div>
          <div className="btnGroup justify-end">
            <button type="button" onClick={() => setHistorySearchOpen(false)} disabled={historySearchBusy}>
              {t.tr("Cancel", "取消")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={runHistorySearchNow}
              disabled={!selectedDaemon?.connected || !instanceId.trim() || historySearchBusy || !String(historySearchQuery || "").trim()}
            >
              {historySearchBusy ? t.tr("Searching...", "搜索中...") : t.tr("Search", "搜索")}
            </button>
          </div>
        </div>

        {historySearchResult ? (
          <div className="mt-3">
            <div className="hint">
              {t.tr("matches", "匹配")}:{" "}
              <code>{Array.isArray(historySearchResult?.matches) ? historySearchResult.matches.length : 0}</code>
              {" · "}
              {t.tr("files scanned", "扫描文件")}:{" "}
              <code>{Array.isArray(historySearchResult?.files) ? historySearchResult.files.length : 0}</code>
              {historySearchResult?.truncated ? (
                <>
                  {" · "}
                  <span className="badge warn">{t.tr("truncated", "已截断")}</span>
                </>
              ) : null}
            </div>

            {Array.isArray(historySearchResult?.matches) && historySearchResult.matches.length ? (
              <div className="stack" style={{ marginTop: 10, gap: 10, maxHeight: 520, overflow: "auto" }}>
                {historySearchResult.matches.slice(0, 200).map((m: any, idx: number) => {
                  const file = String(m?.file || "").trim();
                  const path = String(m?.path || "").trim();
                  const lineNo = Math.max(0, Math.round(Number(m?.line_no || 0) || 0));
                  const approx = !!m?.line_no_approx;
                  const before = Array.isArray(m?.before) ? m.before.map((s: any) => String(s || "")) : [];
                  const after = Array.isArray(m?.after) ? m.after.map((s: any) => String(s || "")) : [];
                  const text = String(m?.text || "");
                  const mtimeUnix = Math.floor(Number(m?.file_mtime_unix || 0));
                  const title = file ? file : path ? path.split("/").pop() : t.tr("<unknown>", "<未知>");
                  const lineLabel = lineNo ? `${approx ? "~" : ""}L${lineNo}` : "-";
                  return (
                    <div key={`${path}:${lineNo}:${idx}`} className="itemCard">
                      <div className="itemCardHeader" style={{ alignItems: "flex-start" }}>
                        <div className="min-w-0">
                          <div className="itemTitle" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <code style={{ maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</code>
                            <span className="badge">{lineLabel}</span>
                            {mtimeUnix > 0 ? (
                              <span className="muted">
                                <TimeAgo unix={mtimeUnix} />
                              </span>
                            ) : null}
                          </div>
                          <div className="itemMeta" style={{ marginTop: 6 }}>
                            <span className="logLineText">
                              {historyFilter.mode === "text" && historyFilter.qLower
                                ? highlightText(text, historyFilter.qLower)
                                : historyFilter.mode === "regex" && historyFilter.re
                                  ? highlightRegex(text, historyFilter.re)
                                  : text}
                            </span>
                          </div>
                          {before.length || after.length ? (
                            <pre
                              className="diffFrame"
                              style={{ marginTop: 10, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                            >
                              {[
                                ...(before.length ? before.map((l: string) => `  ${l}`) : []),
                                `> ${text}`,
                                ...(after.length ? after.map((l: string) => `  ${l}`) : []),
                              ].join("\n")}
                            </pre>
                          ) : null}
                        </div>
                        <div className="btnGroup justify-end">
                          <CopyButton iconOnly text={text} tooltip={t.tr("Copy line", "复制该行")} ariaLabel={t.tr("Copy line", "复制该行")} disabled={!text} />
                          <button
                            type="button"
                            className="iconBtn"
                            onClick={async () => {
                              if (!path) return;
                              setTab("files");
                              await openFileByPath(path);
                              setHistorySearchOpen(false);
                            }}
                            disabled={!path}
                          >
                            {t.tr("Open file", "打开文件")}
                          </button>
                        </div>
                      </div>
                      <div className="itemCardBody" style={{ display: "none" }} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="hint" style={{ marginTop: 10 }}>
                {historySearchStatus || t.tr("No matches.", "没有匹配。")}
              </div>
            )}
          </div>
        ) : null}
      </ManagedModal>

      <ManagedModal
        id="games-backup-create"
        open={backupNewOpen}
        onOverlayClick={() => (!gameActionBusy ? setBackupNewOpen(false) : null)}
        modalStyle={{ width: "min(720px, 100%)" }}
        ariaLabel={t.tr("Create Backup", "创建备份")}
      >
        <div className="modalHeader">
              <div>
                <div style={{ fontWeight: 800 }}>{t.tr("Create Backup", "创建备份")}</div>
                <div className="hint">
                  {t.tr("game", "游戏")}: <code>{instanceId.trim() || "-"}</code>
                </div>
              </div>
              <button type="button" onClick={() => setBackupNewOpen(false)} disabled={gameActionBusy}>
                {t.tr("Close", "关闭")}
              </button>
            </div>

            <div className="grid2 items-start">
              <div className="field">
                <label>{t.tr("Format", "格式")}</label>
                <Select
                  value={backupNewFormat}
                  onChange={(v) => setBackupNewFormat((v as any) === "zip" ? "zip" : "tar.gz")}
                  options={[
                    { value: "tar.gz", label: "tar.gz" },
                    { value: "zip", label: "zip" },
                  ]}
                />
                <div className="hint">{t.tr("tar.gz is smaller; zip is faster for small worlds.", "tar.gz 更小；zip 在小世界可能更快。")}</div>
              </div>
              <div className="field">
                <label>{t.tr("Keep last", "保留最近")}</label>
                <input
                  type="number"
                  value={Number.isFinite(backupNewKeepLast) ? backupNewKeepLast : 0}
                  onChange={(e) => setBackupNewKeepLast(Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))))}
                  min={0}
                  max={1000}
                />
                <div className="hint">{t.tr("0 = keep everything (no prune).", "0 = 全部保留（不自动清理）。")}</div>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>{t.tr("Comment (optional)", "备注（可选）")}</label>
                <input
                  value={backupNewComment}
                  onChange={(e) => setBackupNewComment(e.target.value)}
                  placeholder={t.tr("e.g. before upgrading jar", "例如：升级 jar 前")}
                />
                <div className="hint">{t.tr("Stored as a .meta.json sidecar next to the archive.", "会写入到备份文件旁的 .meta.json。")}</div>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>{t.tr("Stop server", "停止服务器")}</label>
                <label className="checkRow">
                  <input type="checkbox" checked={backupNewStop} onChange={(e) => setBackupNewStop(e.target.checked)} />{" "}
                  {t.tr("Stop the instance before backup (recommended).", "备份前停止实例（推荐）。")}
                </label>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div className="hint">{gameActionBusy ? t.tr("working…", "处理中…") : ""}</div>
              <div className="btnGroup justify-end">
                <button type="button" onClick={() => setBackupNewOpen(false)} disabled={gameActionBusy}>
                  {t.tr("Cancel", "取消")}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    const inst = instanceId.trim();
                    if (!inst) return;
                    const format = backupNewFormat === "zip" ? "zip" : "tar.gz";
                    const keepLast = Math.max(0, Math.min(1000, Math.round(Number(backupNewKeepLast || 0) || 0)));
                    const comment = String(backupNewComment || "").trim();
                    await backupServer(inst, { format, keep_last: keepLast, stop: backupNewStop, comment });
                    setBackupNewOpen(false);
                  }}
                  disabled={!canControl}
                >
                  {t.tr("Create", "创建")}
                </button>
              </div>
            </div>
      </ManagedModal>

      <ManagedModal
        id="games-backup-retention"
        open={backupRetentionOpen}
        onOverlayClick={() => (!gameActionBusy ? setBackupRetentionOpen(false) : null)}
        modalStyle={{ width: "min(760px, 100%)" }}
        ariaLabel={t.tr("Backup retention policy", "备份保留策略")}
      >
        <div className="modalHeader">
          <div>
            <div style={{ fontWeight: 800 }}>{t.tr("Backup retention", "备份保留")}</div>
            <div className="hint">
              {t.tr("game", "游戏")}: <code>{instanceId.trim() || "-"}</code>
            </div>
            <div className="hint">
              {t.tr(
                "This sets a per-instance keep-last policy. Preview is based on current list order.",
                "这是按实例设置的“保留最近 N 个”策略。预览基于当前列表顺序。"
              )}
            </div>
          </div>
          <button type="button" onClick={() => setBackupRetentionOpen(false)} disabled={gameActionBusy}>
            {t.tr("Close", "关闭")}
          </button>
        </div>

        <div className="grid2 items-start">
          <div className="field">
            <label>{t.tr("Keep last", "保留最近")}</label>
            <input
              type="number"
              value={Number.isFinite(backupRetentionDraft) ? backupRetentionDraft : 0}
              onChange={(e) => setBackupRetentionDraft(Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))))}
              min={0}
              max={1000}
            />
            <div className="hint">{t.tr("0 = keep everything (no prune).", "0 = 全部保留（不自动清理）。")}</div>
          </div>
          <div className="field">
            <label>{t.tr("Preview", "预览")}</label>
            <div className="hint">
              {t.tr("total", "总计")}: <code>{Array.isArray(backupZips) ? backupZips.length : 0}</code>
              {" · "}
              {t.tr("keep", "保留")}: <code>{backupRetentionPreview.keep.length}</code>
              {" · "}
              {t.tr("delete", "删除")}: <code>{backupRetentionPreview.del.length}</code>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {(() => {
                const bytes = (backupRetentionPreview.del || []).reduce((sum, p) => {
                  const meta = backupMetaByPath[String(p || "")] || null;
                  const b = meta && Number.isFinite(Number(meta?.bytes)) ? Number(meta.bytes) : 0;
                  return sum + (b > 0 ? b : 0);
                }, 0);
                const anyBytes = (backupRetentionPreview.del || []).some((p) => {
                  const meta = backupMetaByPath[String(p || "")] || null;
                  const b = meta && Number.isFinite(Number(meta?.bytes)) ? Number(meta.bytes) : 0;
                  return b > 0;
                });
                return anyBytes ? (
                  <>
                    {t.tr("estimated delete size", "预计删除大小")}: <code>{fmtBytes(bytes)}</code>
                  </>
                ) : (
                  t.tr("No size metadata available for estimation.", "暂无可用于估算的大小元数据。")
                );
              })()}
            </div>
          </div>

          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>{t.tr("Will be deleted", "将被删除")}</label>
            {backupRetentionPreview.del.length ? (
              <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                <div className="hint">{t.tr("showing", "显示")} {Math.min(40, backupRetentionPreview.del.length)} / {backupRetentionPreview.del.length}</div>
                <ul style={{ margin: "8px 0 0 18px" }}>
                  {backupRetentionPreview.del.slice(0, 40).map((p) => {
                    const path = String(p || "");
                    const file = path.split("/").pop() || path;
                    return (
                      <li key={path}>
                        <code>{file}</code>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="hint">{t.tr("Nothing will be deleted.", "不会删除任何备份。")}</div>
            )}
          </div>
        </div>

        <div className="row" style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div className="hint">{serverOpStatus ? serverOpStatus : ""}</div>
          <div className="btnGroup justify-end">
            <button type="button" onClick={() => setBackupRetentionOpen(false)} disabled={gameActionBusy}>
              {t.tr("Cancel", "取消")}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={async () => {
                const keepLast = Math.max(0, Math.min(1000, Math.round(Number(backupRetentionDraft || 0) || 0)));
                await saveBackupRetentionKeepLast(keepLast);
              }}
              disabled={!selectedDaemon?.connected || !instanceId.trim() || gameActionBusy}
            >
              {t.tr("Save policy", "保存策略")}
            </button>
            <button
              type="button"
              className="dangerBtn"
              onClick={async () => {
                const inst = instanceId.trim();
                if (!inst) return;
                const keepLast = Math.max(0, Math.min(1000, Math.round(Number(backupRetentionDraft || 0) || 0)));
                const delCount = backupRetentionPreview.del.length;
                if (keepLast <= 0 || delCount <= 0) {
                  await saveBackupRetentionKeepLast(keepLast);
                  setBackupRetentionOpen(false);
                  return;
                }
                const ok = await confirmDialog(
                  t.tr(
                    `Prune backups now to keep last ${keepLast}?\n\nThis will delete ${delCount} backup(s).`,
                    `现在清理备份并保留最近 ${keepLast} 个？\n\n这将删除 ${delCount} 个备份。`
                  ),
                  {
                    title: t.tr("Prune backups", "清理备份"),
                    confirmLabel: t.tr("Prune", "清理"),
                    cancelLabel: t.tr("Cancel", "取消"),
                    danger: true,
                  }
                );
                if (!ok) return;
                await saveBackupRetentionKeepLast(keepLast);
                await pruneBackups(keepLast);
                setBackupRetentionOpen(false);
              }}
              disabled={!selectedDaemon?.connected || !instanceId.trim() || gameActionBusy}
            >
              {t.tr("Save & prune", "保存并清理")}
            </button>
          </div>
        </div>
      </ManagedModal>
    </div>
  );
}

export default memo(GamesView);
