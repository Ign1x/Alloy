"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppActions, useAppCore, useAppI18n, useAppNodes, useAppPanel } from "../appCtx";
import Icon from "../ui/Icon";
import Select from "../ui/Select";
import TimeAgo from "../ui/TimeAgo";
import StatusBadge from "../ui/StatusBadge";

function NodesView() {
  const { t, fmtBytes } = useAppI18n();
  const { apiFetch, copyText, pct, makeDeployComposeYml, confirmDialog, openShareView } = useAppActions();
  const { setSelected, setTab } = useAppCore();
  const { panelInfo } = useAppPanel();
  const {
    nodes,
    nodesStatus,
    setNodesStatus,
    pinnedDaemonIds,
    togglePinnedDaemon,
    nodeNotesById,
    setNodes,
    openNodeDetails,
    openAddNodeModal,
    openAddNodeAndDeploy,
    openDeployDaemonModal,
    exportDiagnosticsBundle,
  } = useAppNodes();

  const [query, setQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [sortBy, setSortBy] = useState<"online" | "last" | "cpu" | "mem" | "id">("online");

  const pinnedSet = useMemo(
    () => new Set((Array.isArray(pinnedDaemonIds) ? pinnedDaemonIds : []).map((s: any) => String(s || "").trim()).filter(Boolean)),
    [pinnedDaemonIds]
  );

  const viewNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = Array.isArray(nodes) ? nodes.slice() : [];
    list.sort((a: any, b: any) => {
      const ap = pinnedSet.has(String(a?.id || "")) ? 1 : 0;
      const bp = pinnedSet.has(String(b?.id || "")) ? 1 : 0;
      if (ap !== bp) return bp - ap;

      const ac = a?.connected ? 1 : 0;
      const bc = b?.connected ? 1 : 0;

      const aLast = Number(a?.lastSeenUnix || 0);
      const bLast = Number(b?.lastSeenUnix || 0);
      const aCpu = typeof a?.heartbeat?.cpu?.usage_percent === "number" ? a.heartbeat.cpu.usage_percent : -1;
      const bCpu = typeof b?.heartbeat?.cpu?.usage_percent === "number" ? b.heartbeat.cpu.usage_percent : -1;
      const aMem = a?.heartbeat?.mem?.total_bytes ? pct(a.heartbeat.mem.used_bytes, a.heartbeat.mem.total_bytes) : -1;
      const bMem = b?.heartbeat?.mem?.total_bytes ? pct(b.heartbeat.mem.used_bytes, b.heartbeat.mem.total_bytes) : -1;

      if (sortBy === "online") {
        if (ac !== bc) return bc - ac;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
      }
      if (sortBy === "last") return bLast - aLast;
      if (sortBy === "cpu") return bCpu - aCpu;
      if (sortBy === "mem") return bMem - aMem;
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    });

    const filtered =
      statusFilter === "online" ? list.filter((n: any) => !!n?.connected) : statusFilter === "offline" ? list.filter((n: any) => !n?.connected) : list;

    if (!q) return filtered;
    return filtered.filter((n: any) => String(n?.id || "").toLowerCase().includes(q));
  }, [nodes, pinnedSet, query, pct, sortBy, statusFilter]);

  const nodesVirtualEnabled = viewNodes.length > 220;
  const nodeRowH = 86;
  const nodesListScrollRef = useRef<HTMLDivElement | null>(null);
  const [nodesListScrollTop, setNodesListScrollTop] = useState<number>(0);
  const [nodesListViewportH, setNodesListViewportH] = useState<number>(520);
  const [nodesListPendingFocusIdx, setNodesListPendingFocusIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!nodesVirtualEnabled) return;
    const el = nodesListScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setNodesListViewportH(Math.max(120, el.clientHeight || 520));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodesVirtualEnabled]);

  const nodesListVirtual = useMemo(() => {
    const list = Array.isArray(viewNodes) ? viewNodes : [];
    const total = list.length;
    const enabled = nodesVirtualEnabled;
    if (!enabled) return { enabled: false, visible: list, start: 0, topPad: 0, bottomPad: 0 };

    const overscan = 8;
    const start = Math.max(0, Math.floor(nodesListScrollTop / nodeRowH) - overscan);
    const visibleCount = Math.ceil(nodesListViewportH / nodeRowH) + overscan * 2;
    const end = Math.min(total, start + visibleCount);
    const topPad = start * nodeRowH;
    const bottomPad = Math.max(0, (total - end) * nodeRowH);
    return { enabled: true, visible: list.slice(start, end), start, topPad, bottomPad };
  }, [viewNodes, nodesVirtualEnabled, nodesListScrollTop, nodesListViewportH]);

  function focusNodeRow(idx: number) {
    if (!nodesListVirtual.enabled) return;
    const total = viewNodes.length;
    const next = Math.max(0, Math.min(total - 1, Math.round(Number(idx || 0))));
    const el = nodesListScrollRef.current;
    if (el) {
      const top = next * nodeRowH;
      const bottom = top + nodeRowH;
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;
      if (top < viewTop) el.scrollTop = top;
      else if (bottom > viewBottom) el.scrollTop = Math.max(0, bottom - el.clientHeight);
    }
    setNodesListPendingFocusIdx(next);
  }

  useEffect(() => {
    if (!nodesListVirtual.enabled) return;
    if (nodesListPendingFocusIdx == null) return;
    const start = nodesListVirtual.start;
    const end = start + nodesListVirtual.visible.length;
    if (nodesListPendingFocusIdx < start || nodesListPendingFocusIdx >= end) return;
    const root = nodesListScrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-virt-idx="${nodesListPendingFocusIdx}"]`);
    if (!el) return;
    try {
      el.focus();
      setNodesListPendingFocusIdx(null);
    } catch {
      // ignore
    }
  }, [nodesListPendingFocusIdx, nodesListVirtual.enabled, nodesListVirtual.start, nodesListVirtual.visible.length]);

  return (
    <div className="stack">
      <div className="card">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>{t.tr("Nodes", "节点")}</h2>
              {nodesStatus ? <div className="hint">{nodesStatus}</div> : null}
            </div>
          </div>
          <div className="toolbarRight">
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as any)}
              options={[
                { value: "all", label: t.tr("All", "全部") },
                { value: "online", label: t.tr("Online", "在线") },
                { value: "offline", label: t.tr("Offline", "离线") },
              ]}
              style={{ width: 140 }}
            />
            <Select
              value={sortBy}
              onChange={(v) => setSortBy(v as any)}
              options={[
                { value: "online", label: t.tr("Online first", "在线优先") },
                { value: "last", label: t.tr("Last seen", "最近在线") },
                { value: "cpu", label: "CPU%" },
                { value: "mem", label: "MEM%" },
                { value: "id", label: "ID" },
              ]}
              style={{ width: 160 }}
            />
            <input
              value={query}
              onChange={(e: any) => setQuery(e.target.value)}
              placeholder={t.tr("Search nodes…", "搜索节点…")}
              style={{ width: 220 }}
            />
            <button type="button" className="primary iconBtn" onClick={openAddNodeModal}>
              <Icon name="plus" />
              {t.tr("Add", "添加")}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={async () => {
                setNodesStatus(t.tr("Loading...", "加载中..."));
                try {
                  const res = await apiFetch("/api/nodes", { cache: "no-store" });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json?.error || "failed");
                  setNodes(json.nodes || []);
                  setNodesStatus("");
                } catch (e: any) {
                  setNodes([]);
                  setNodesStatus(String(e?.message || e));
                }
              }}
            >
              <Icon name="refresh" />
              {t.tr("Refresh", "刷新")}
            </button>
            <span className="badge">
              {viewNodes.length}/{nodes.length}
            </span>
          </div>
        </div>

        {viewNodes.length ? (
          nodesListVirtual.enabled ? (
            <div
              ref={nodesListScrollRef}
              className="virtList"
              style={{ maxHeight: 720 }}
              onScroll={(e) => setNodesListScrollTop(e.currentTarget.scrollTop)}
              role="list"
              aria-label={t.tr("Nodes", "节点")}
            >
              {nodesListVirtual.topPad > 0 ? <div style={{ height: nodesListVirtual.topPad }} /> : null}
              {nodesListVirtual.visible.map((n: any, localIdx: number) => {
                const absIdx = nodesListVirtual.start + localIdx;
                const hb = n.heartbeat || {};
                const cpu = typeof hb?.cpu?.usage_percent === "number" ? hb.cpu.usage_percent : null;
                const mem = hb?.mem || {};
                const disk = hb?.disk || {};
                const instances = Array.isArray(hb?.instances) ? hb.instances : [];
                const memPct = mem?.total_bytes ? pct(mem.used_bytes, mem.total_bytes) : null;
                const diskPct = disk?.total_bytes ? pct(disk.used_bytes, disk.total_bytes) : null;
                const cpuKind = cpu == null ? "" : cpu >= 90 ? "bad" : cpu >= 70 ? "warn" : "ok";
                const memKind = memPct == null ? "" : memPct >= 90 ? "bad" : memPct >= 75 ? "warn" : "ok";
                const diskKind = diskPct == null ? "" : diskPct >= 92 ? "bad" : diskPct >= 80 ? "warn" : "ok";
                const isPinned = pinnedSet.has(String(n?.id || ""));
                const daemonVer = String(n?.hello?.version || "").trim();
                const panelVer = String(panelInfo?.version || "").trim();
                const verMismatch = !!daemonVer && !!panelVer && daemonVer !== panelVer && panelVer !== "dev";
                const nodeId = String(n?.id || "");
                const note = String((nodeNotesById || {})[nodeId] || "").trim();
                const line = [
                  `${t.tr("last", "最近")}:`,
                  `${t.tr("instances", "实例")}: ${instances.length}`,
                  daemonVer ? `v${daemonVer}` : "",
                  cpu == null ? "" : `CPU ${cpu.toFixed(0)}%`,
                  memPct == null ? "" : `MEM ${memPct.toFixed(0)}%`,
                  diskPct == null ? "" : `DISK ${diskPct.toFixed(0)}%`,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    key={nodeId}
                    data-virt-idx={absIdx}
                    className="virtRow"
                    style={{ height: nodeRowH, opacity: n.connected ? 1 : 0.78 }}
                    role="listitem"
                    tabIndex={0}
                    onClick={() => openNodeDetails(nodeId)}
                    onKeyDown={(e) => {
                      const target = e.target as any;
                      if (target && typeof target.closest === "function" && target.closest("button") && target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openNodeDetails(nodeId);
                        return;
                      }
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        focusNodeRow(absIdx + 1);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        focusNodeRow(absIdx - 1);
                      }
                    }}
                  >
                    <div className="virtRowMain">
                      <div className="virtRowTitle">
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{nodeId}</span>
                        <StatusBadge tone={n.connected ? "ok" : "danger"}>{n.connected ? t.tr("online", "在线") : t.tr("offline", "离线")}</StatusBadge>
                        {verMismatch ? (
                          <span className="badge warn" title={t.tr("Panel/daemon version mismatch", "Panel/daemon 版本不一致")}>
                            {t.tr("version mismatch", "版本不一致")}
                          </span>
                        ) : null}
                        {isPinned ? <span className="badge">{t.tr("pinned", "已置顶")}</span> : null}
                        {note ? (
                          <span className="badge" title={note}>
                            {t.tr("note", "备注")}
                          </span>
                        ) : null}
                      </div>
                      <div className="virtRowSub nodeRowSub" title={line}>
                        <span className="virtRowMetaText">
                          {t.tr("last", "最近")}: <TimeAgo unix={n.lastSeenUnix} /> · {t.tr("instances", "实例")}: {instances.length}
                          {daemonVer ? ` · v${daemonVer}` : ""}
                        </span>
                        <span className="nodeRowMetrics" aria-hidden="true">
                          {cpu == null ? null : (
                            <span className={["nodeMetricPill", cpuKind].filter(Boolean).join(" ")}>
                              <span className="nodeMetricLabel">CPU</span>
                              <span className="nodeMetricValue">{cpu.toFixed(0)}%</span>
                            </span>
                          )}
                          {memPct == null ? null : (
                            <span className={["nodeMetricPill", memKind].filter(Boolean).join(" ")}>
                              <span className="nodeMetricLabel">MEM</span>
                              <span className="nodeMetricValue">{memPct.toFixed(0)}%</span>
                            </span>
                          )}
                          {diskPct == null ? null : (
                            <span className={["nodeMetricPill", diskKind].filter(Boolean).join(" ")}>
                              <span className="nodeMetricLabel">DISK</span>
                              <span className="nodeMetricValue">{diskPct.toFixed(0)}%</span>
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="virtRowActions">
                      <button
                        type="button"
                        className="iconBtn iconOnly"
                        title={isPinned ? t.tr(`Unpin node ${nodeId}`, `取消置顶节点 ${nodeId}`) : t.tr(`Pin node ${nodeId}`, `置顶节点 ${nodeId}`)}
                        aria-label={isPinned ? t.tr(`Unpin node ${nodeId}`, `取消置顶节点 ${nodeId}`) : t.tr(`Pin node ${nodeId}`, `置顶节点 ${nodeId}`)}
                        aria-pressed={isPinned}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePinnedDaemon(nodeId);
                        }}
                      >
                        <Icon name="pin" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openNodeDetails(nodeId);
                        }}
                      >
                        {t.tr("Details", "详情")}
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(nodeId);
                          setTab("games");
                        }}
                      >
                        {t.tr("Manage", "管理")}
                      </button>
                    </div>
                  </div>
                );
              })}
              {nodesListVirtual.bottomPad > 0 ? <div style={{ height: nodesListVirtual.bottomPad }} /> : null}
            </div>
          ) : (
            <div className="cardGrid">
              {viewNodes.map((n: any) => {
              const hb = n.heartbeat || {};
              const cpu = typeof hb?.cpu?.usage_percent === "number" ? hb.cpu.usage_percent : null;
              const mem = hb?.mem || {};
              const disk = hb?.disk || {};
              const instances = Array.isArray(hb?.instances) ? hb.instances : [];
	              const memPct = mem?.total_bytes ? pct(mem.used_bytes, mem.total_bytes) : null;
	              const diskPct = disk?.total_bytes ? pct(disk.used_bytes, disk.total_bytes) : null;
	              const cpuKind = cpu == null ? "" : cpu >= 90 ? "bad" : cpu >= 70 ? "warn" : "ok";
	              const memKind = memPct == null ? "" : memPct >= 90 ? "bad" : memPct >= 75 ? "warn" : "ok";
	              const diskKind = diskPct == null ? "" : diskPct >= 92 ? "bad" : diskPct >= 80 ? "warn" : "ok";
	              const isPinned = pinnedSet.has(String(n?.id || ""));
	              const daemonVer = String(n?.hello?.version || "").trim();
	              const panelVer = String(panelInfo?.version || "").trim();
	              const verMismatch = !!daemonVer && !!panelVer && daemonVer !== panelVer && panelVer !== "dev";
                const nodeId = String(n?.id || "");
	              const note = String((nodeNotesById || {})[nodeId] || "").trim();
	              return (
	                <div key={n.id} className="itemCard" style={{ opacity: n.connected ? 1 : 0.78 }}>
	                  <div className="itemCardHeader">
                    <div style={{ minWidth: 0 }}>
                      <div className="itemTitle">{n.id}</div>
                      <div className="itemMeta">
                        {t.tr("last", "最近")}: <TimeAgo unix={n.lastSeenUnix} /> · {t.tr("instances", "实例")}: {instances.length}
                        {daemonVer ? ` · v${daemonVer}` : ""}
                      </div>
	                    </div>
	                    <div className="row" style={{ gap: 8 }}>
	                      <button
	                        type="button"
	                        className="iconBtn iconOnly"
	                        title={
                            isPinned ? t.tr(`Unpin node ${nodeId}`, `取消置顶节点 ${nodeId}`) : t.tr(`Pin node ${nodeId}`, `置顶节点 ${nodeId}`)
                          }
	                        aria-label={
                            isPinned ? t.tr(`Unpin node ${nodeId}`, `取消置顶节点 ${nodeId}`) : t.tr(`Pin node ${nodeId}`, `置顶节点 ${nodeId}`)
                          }
	                        aria-pressed={isPinned}
	                        onClick={() => togglePinnedDaemon(nodeId)}
	                      >
	                        <Icon name="pin" />
	                      </button>
	                      <StatusBadge tone={n.connected ? "ok" : "danger"}>{n.connected ? t.tr("online", "在线") : t.tr("offline", "离线")}</StatusBadge>
	                      {verMismatch ? (
	                        <span className="badge warn" title={t.tr("Panel/daemon version mismatch", "Panel/daemon 版本不一致")}>
	                          {t.tr("version mismatch", "版本不一致")}
	                        </span>
                      ) : null}
	                      {note ? (
	                        <span className="badge" title={note}>
	                          {t.tr("note", "备注")}
	                        </span>
	                      ) : null}
                    </div>
                  </div>

                  <div className="metricGrid">
                    <div className={["metricCard", cpuKind].filter(Boolean).join(" ")}>
                      <div className="metricHead">
                        <Icon name="cpu" /> CPU
                      </div>
                      <div className="metricValue">{cpu == null ? "—" : `${cpu.toFixed(0)}%`}</div>
                      <div className="metricSub">{cpu == null ? t.tr("No data", "暂无数据") : t.tr("usage", "使用率")}</div>
                    </div>
                    <div className={["metricCard", memKind].filter(Boolean).join(" ")}>
                      <div className="metricHead">
                        <Icon name="memory" /> MEM
                      </div>
                      <div className="metricValue">{memPct == null ? "—" : `${memPct.toFixed(0)}%`}</div>
                      <div className="metricSub">
                        {mem?.total_bytes ? (
                          <>
                            {fmtBytes(mem.used_bytes)}/{fmtBytes(mem.total_bytes)}
                          </>
                        ) : (
                          t.tr("No data", "暂无数据")
                        )}
                      </div>
                    </div>
                    <div className={["metricCard", diskKind].filter(Boolean).join(" ")}>
                      <div className="metricHead">
                        <Icon name="disk" /> DISK
                      </div>
                      <div className="metricValue">{diskPct == null ? "—" : `${diskPct.toFixed(0)}%`}</div>
                      <div className="metricSub">
                        {disk?.total_bytes ? (
                          <>
                            {fmtBytes(disk.used_bytes)}/{fmtBytes(disk.total_bytes)} · {fmtBytes(disk.free_bytes)} {t.tr("free", "可用")}
                          </>
                        ) : (
                          t.tr("No data", "暂无数据")
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="row" style={{ justifyContent: "space-between", gap: 10, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className="muted">{t.tr("token", "token")}</span>
                      <code>{String(n.token_masked || t.tr("(hidden)", "(隐藏)"))}</code>
                      <button
                        type="button"
                        className="iconBtn iconOnly"
                        title={t.tr(`Copy token for node ${nodeId}`, `复制节点 ${nodeId} 的 token`)}
                        aria-label={t.tr(`Copy token for node ${nodeId}`, `复制节点 ${nodeId} 的 token`)}
                        onClick={async () => {
                          const ok = await confirmDialog(t.tr(`Reveal and copy token for node ${n.id}?`, `显示并复制节点 ${n.id} 的 token？`), {
                            title: t.tr("Reveal Token", "显示 Token"),
                            confirmLabel: t.tr("Reveal", "显示"),
                            cancelLabel: t.tr("Cancel", "取消"),
                          });
                          if (!ok) return;
                          try {
                            const res = await apiFetch(`/api/nodes/${encodeURIComponent(n.id)}/token`, { cache: "no-store" });
                            const json = await res.json();
                            if (!res.ok) throw new Error(json?.error || "failed");
                            await copyText(String(json?.token || ""));
                            setNodesStatus(t.tr("Copied", "已复制"));
                            setTimeout(() => setNodesStatus(""), 800);
                          } catch (e: any) {
                            setNodesStatus(String(e?.message || e));
                          }
                        }}
                      >
                        <Icon name="copy" />
                      </button>
                    </div>
                  </div>

                  <div className="itemFooter">
                    <div className="btnGroup" style={{ justifyContent: "flex-start" }}>
                      <button type="button" onClick={() => openNodeDetails(n.id)}>
                        {t.tr("Details", "详情")}
                      </button>
                      <button type="button" className="iconBtn" onClick={() => openShareView({ kind: "node", daemonId: n.id })}>
                        <Icon name="link" /> {t.tr("Share view", "分享视图")}
                      </button>
                      <button
                        type="button"
                        className="iconBtn"
                        onClick={async () => {
                          const ok = await confirmDialog(t.tr(`Copy docker-compose snippet for node ${n.id}? (includes token)`, `复制节点 ${n.id} 的 docker-compose 片段？（包含 token）`), {
                            title: t.tr("Copy Deploy Snippet", "复制部署片段"),
                            confirmLabel: t.tr("Copy", "复制"),
                            cancelLabel: t.tr("Cancel", "取消"),
                          });
                          if (!ok) return;
                          setNodesStatus("");
                          try {
                            const res = await apiFetch(`/api/nodes/${encodeURIComponent(n.id)}/token`, { cache: "no-store" });
                            const json = await res.json();
                            if (!res.ok) throw new Error(json?.error || "failed");
                            const token = String(json?.token || "");
                            const yml = makeDeployComposeYml(n.id, token);
                            await copyText(yml);
                            setNodesStatus(t.tr("Copied", "已复制"));
                            setTimeout(() => setNodesStatus(""), 800);
                          } catch (e: any) {
                            setNodesStatus(String(e?.message || e));
                          }
                        }}
                      >
                        <Icon name="copy" />
                        {t.tr("Copy Compose", "复制 Compose")}
                      </button>
                      <button
                        type="button"
                        className="iconBtn"
                        onClick={async () => {
                          const ok = await confirmDialog(t.tr(`Reveal token and generate compose for node ${n.id}?`, `显示 token 并为节点 ${n.id} 生成 compose？`), {
                            title: t.tr("Deploy Node", "部署节点"),
                            confirmLabel: t.tr("Generate", "生成"),
                            cancelLabel: t.tr("Cancel", "取消"),
                          });
                          if (!ok) return;
                          setNodesStatus("");
                          try {
                            const res = await apiFetch(`/api/nodes/${encodeURIComponent(n.id)}/token`, { cache: "no-store" });
                            const json = await res.json();
                            if (!res.ok) throw new Error(json?.error || "failed");
                            openDeployDaemonModal(n.id, String(json?.token || ""));
                          } catch (e: any) {
                            setNodesStatus(String(e?.message || e));
                          }
                        }}
                      >
                        <Icon name="download" />
                        {t.tr("Deploy", "部署")}
                      </button>
                      <button type="button" className="iconBtn" onClick={() => exportDiagnosticsBundle(n.id)} disabled={!n.connected}>
                        <Icon name="download" />
                        {t.tr("Diagnostics", "诊断包")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(n.id);
                          setTab("games");
                        }}
                      >
                        {t.tr("Manage", "管理")}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="iconBtn"
                      onClick={() => openNodeDetails(n.id)}
                    >
                      {t.tr("Danger Zone…", "危险区…")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          )
        ) : nodesStatus === "Loading..." || nodesStatus === "加载中..." ? (
          <div className="cardGrid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton" />
            ))}
          </div>
        ) : (
          <div className="emptyState">
            {nodes.length ? (
              t.tr("No results.", "没有匹配结果。")
            ) : (
              <>
                <div style={{ fontWeight: 800 }}>{t.tr("No nodes yet", "暂无节点")}</div>
                <div className="hint" style={{ marginTop: 6 }}>
                  {t.tr(
                    "Click Add to create a node (token), then Deploy to generate a docker compose snippet.",
                    "点击 Add 创建一个节点（生成 token），然后点 Deploy 生成 docker compose 一键部署。"
                  )}
                </div>
                <div className="btnGroup" style={{ justifyContent: "center", marginTop: 10 }}>
                  <button type="button" className="primary iconBtn" onClick={openAddNodeModal}>
                    <Icon name="plus" />
                    {t.tr("Add", "添加")}
                  </button>
                  <button type="button" className="iconBtn" onClick={openAddNodeAndDeploy}>
                    <Icon name="download" />
                    {t.tr("Deploy", "部署")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(NodesView);
