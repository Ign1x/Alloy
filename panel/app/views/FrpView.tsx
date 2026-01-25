"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useAppActions, useAppCore, useAppFrp, useAppI18n } from "../appCtx";
import Icon from "../ui/Icon";
import DangerZone from "../ui/DangerZone";
import TimeAgo from "../ui/TimeAgo";
import StatusBadge from "../ui/StatusBadge";
import Sparkline from "../ui/Sparkline";

function percentile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const qq = Math.max(0, Math.min(1, Number(q)));
  const pos = (sorted.length - 1) * qq;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] ?? 0;
  const w = pos - lo;
  return (sorted[lo] ?? 0) * (1 - w) + (sorted[hi] ?? 0) * w;
}

function computeJitterMs(values: number[]) {
  const xs = values.filter((n) => Number.isFinite(n)).slice(-120);
  if (xs.length < 6) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  return Math.max(0, Math.round(p95 - p50));
}

function FrpView() {
  const { t } = useAppI18n();
  const { apiFetch, copyText, confirmDialog, promptDialog } = useAppActions();
  const { setTab } = useAppCore();
  const { profiles, profilesStatus, refreshProfiles, openAddFrpModal, setEnableFrp, setFrpProfileId, removeFrpProfile, setProfilesStatus } = useAppFrp();

  const [testingId, setTestingId] = useState<string>("");
  const [savingId, setSavingId] = useState<string>("");
  const [queryRaw, setQueryRaw] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [metaDraftById, setMetaDraftById] = useState<Record<string, { tagsRaw: string; note: string }>>({});
  const [latHistById, setLatHistById] = useState<Record<string, Array<{ t: number; v: number | null }>>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem("elegantmc_frp_latency_hist_v1");
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const next: Record<string, Array<{ t: number; v: number | null }>> = {};
      for (const [id, arr] of Object.entries(parsed)) {
        if (!Array.isArray(arr)) continue;
        const cleaned = arr
          .map((p: any) => ({
            t: Math.floor(Number(p?.t || p?.ts_unix || 0)),
            v: p?.v == null ? null : Math.round(Number(p?.v || p?.latency_ms || 0)),
          }))
          .filter((p: any) => Number.isFinite(p.t) && p.t > 0)
          .slice(-120);
        if (cleaned.length) next[String(id || "")] = cleaned;
      }
      setLatHistById(next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryRaw), 150);
    return () => window.clearTimeout(t);
  }, [queryRaw]);

  useEffect(() => {
    const list = Array.isArray(profiles) ? profiles : [];
    setMetaDraftById((prev) => {
      const next: Record<string, { tagsRaw: string; note: string }> = { ...(prev || {}) };
      const seen = new Set<string>();
      for (const p of list) {
        const id = String(p?.id || "").trim();
        if (!id) continue;
        seen.add(id);
        if (next[id]) continue;
        const tags = Array.isArray((p as any)?.tags) ? ((p as any).tags as any[]).map((s) => String(s || "").trim()).filter(Boolean) : [];
        const note = String((p as any)?.note || "");
        next[id] = { tagsRaw: tags.join(", "), note };
      }
      for (const id of Object.keys(next)) {
        if (!seen.has(id)) delete next[id];
      }
      return next;
    });
  }, [profiles]);

  useEffect(() => {
    const list = Array.isArray(profiles) ? profiles : [];
    if (!list.length) return;
    setLatHistById((prev) => {
      const next: Record<string, Array<{ t: number; v: number | null }>> = { ...(prev || {}) };
      let changed = false;
      const now = Math.floor(Date.now() / 1000);

      for (const p of list) {
        const id = String((p as any)?.id || "").trim();
        if (!id) continue;
        const checkedAt = Math.floor(Number((p as any)?.status?.checkedAtUnix || 0));
        if (!Number.isFinite(checkedAt) || checkedAt <= 0) continue;
        if (checkedAt > now + 30) continue;

        const online = (p as any)?.status?.online;
        const latency = Number((p as any)?.status?.latencyMs || 0);
        const v = online === true && Number.isFinite(latency) ? Math.max(0, Math.round(latency)) : null;

        const arr = Array.isArray(next[id]) ? next[id] : [];
        const last = arr.length ? arr[arr.length - 1] : null;
        if (last && last.t === checkedAt) continue;

        next[id] = [...arr, { t: checkedAt, v }].slice(-120);
        changed = true;
      }

      if (changed) {
        try {
          localStorage.setItem("elegantmc_frp_latency_hist_v1", JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, [profiles]);

  const profilesView = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    const list = Array.isArray(profiles) ? profiles : [];
    if (!q) return list;
    return list.filter((p: any) => {
      const tags = Array.isArray(p?.tags) ? p.tags.join(" ") : "";
      const note = String(p?.note || "");
      const hay = `${p?.name || ""} ${p?.server_addr || ""}:${p?.server_port || ""} ${tags} ${note}`.toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, query]);

  async function saveProfileMeta(p: any) {
    const id = String(p?.id || "").trim();
    if (!id) return;
    const draft = (metaDraftById || {})[id] || { tagsRaw: "", note: "" };
    const tags = String(draft?.tagsRaw || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const note = String(draft?.note || "");

    try {
      setSavingId(id);
      setProfilesStatus(t.tr("Saving...", "保存中..."));
      const res = await apiFetch(`/api/frp/profiles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags, note }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "failed");
      setMetaDraftById((prev) => ({ ...(prev || {}), [id]: { tagsRaw: tags.join(", "), note } }));
      await refreshProfiles();
      setProfilesStatus(t.tr("Saved", "已保存"));
      setTimeout(() => setProfilesStatus(""), 900);
    } catch (e: any) {
      setProfilesStatus(String(e?.message || e));
    } finally {
      setSavingId("");
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>{t.tr("Saved FRP Servers", "已保存的 FRP Server")}</h2>
              {profilesStatus ? (
                <div className="hint">
                  {profilesStatus}
                  {profiles.length ? (
                    <>
                      {" · "}
                      {t.tr("showing", "显示")}: {profilesView.length}/{profiles.length}
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="hint">
                  {t.tr("After saving, you can reuse it from Games.", "保存后可在 Games 里一键复用")}
                  {profiles.length ? (
                    <>
                      {" · "}
                      {t.tr("showing", "显示")}: {profilesView.length}/{profiles.length}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          <div className="toolbarRight">
            <div className="logSearchBar" style={{ minWidth: 260, flex: "1 1 auto" }}>
              <Icon name="search" />
              <input
                value={queryRaw}
                onChange={(e: any) => setQueryRaw(e.target.value)}
                placeholder={t.tr("Search profiles…", "搜索配置…")}
                style={{ width: "100%" }}
              />
              {queryRaw.trim() ? (
	                <button type="button" className="iconBtn iconOnly ghost" title={t.tr("Clear", "清空")} aria-label={t.tr("Clear", "清空")} onClick={() => setQueryRaw("")}>
	                  ×
	                </button>
              ) : null}
            </div>
            <button type="button" className="primary iconBtn" onClick={openAddFrpModal}>
              <Icon name="plus" />
              {t.tr("Add", "添加")}
            </button>
            <button type="button" className="iconBtn" onClick={refreshProfiles}>
              <Icon name="refresh" />
              {t.tr("Refresh", "刷新")}
            </button>
            <button type="button" className="iconBtn" onClick={() => refreshProfiles({ force: true })}>
              <Icon name="refresh" />
              {t.tr("Test All", "全部测试")}
            </button>
          </div>
        </div>

        {profiles.length ? (
          profilesView.length ? (
            <div className="cardGrid">
            {profilesView.map((p: any) => {
              const online = p.status?.online;
              const latency = Number(p.status?.latencyMs || 0);
              const checkedAt = p.status?.checkedAtUnix || null;
              const hist = Array.isArray(latHistById?.[p.id]) ? latHistById[p.id] : [];
              const histValues = hist.map((x) => x.v);
              const histNums = histValues.filter((v: any) => typeof v === "number" && Number.isFinite(v)) as number[];
              const jitterMs = computeJitterMs(histNums);
              const sparkMax = (() => {
                if (!histNums.length) return 200;
                const m = Math.max(...histNums);
                if (!Number.isFinite(m) || m <= 0) return 200;
                return Math.min(2000, Math.max(80, Math.round(m * 1.25)));
              })();
              const tags = Array.isArray(p.tags) ? p.tags : [];
              const note = String(p.note || "");
              const draft = (metaDraftById || {})[p.id] || { tagsRaw: tags.join(", "), note };
              const dirty = String(draft.tagsRaw || "").trim() !== tags.join(", ") || String(draft.note || "") !== note;
              return (
                <div key={p.id} className="itemCard frpCard">
                  <div className="itemCardHeader">
                    <div style={{ minWidth: 0 }}>
                      <div className="itemTitle">{p.name}</div>
                      <div className="itemMeta">
                        <code>
                          {p.server_addr}:{p.server_port}
                        </code>
                      </div>
                    </div>
                    {online === true ? (
                      <StatusBadge tone="ok">
                        {t.tr("online", "在线")} {latency}ms
                      </StatusBadge>
                    ) : online === false ? (
                      <StatusBadge tone="danger">{t.tr("offline", "离线")}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">{t.tr("unknown", "未知")}</StatusBadge>
                    )}
                  </div>

                  <div className="hint">
                    {t.tr("checked", "检测")}: <TimeAgo unix={checkedAt} />
                  </div>
                  {p.status?.error && online === false ? <div className="hint">{p.status.error}</div> : null}

                  {hist.length ? (
                    <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                      <Sparkline values={histValues} width={180} height={30} min={0} max={sparkMax} windowSize={60} />
                      <span className="hint">
                        {t.tr("jitter", "抖动")}: <code>{jitterMs ? `${jitterMs}ms` : "-"}</code>
                      </span>
                    </div>
                  ) : null}

                  {tags.length ? (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {tags.map((tag: string) => (
                        <span key={tag} className="badge">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {note.trim() ? (
                    <div className="hint" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                      {note.length > 220 ? `${note.slice(0, 220)}…` : note}
                    </div>
                  ) : null}

                  <div className="grid2" style={{ marginTop: 10, alignItems: "start" }}>
                    <div className="field">
                      <label>{t.tr("Tags", "标签")}</label>
                      <input
                        value={draft.tagsRaw}
                        onChange={(e: any) =>
                          setMetaDraftById((prev) => ({ ...(prev || {}), [p.id]: { ...(prev?.[p.id] || { tagsRaw: "", note: "" }), tagsRaw: String(e.target.value || "") } }))
                        }
                        placeholder={t.tr("comma separated", "用逗号分隔")}
                      />
                    </div>
                    <div className="field">
                      <label>{t.tr("Note", "备注")}</label>
                      <textarea
                        value={draft.note}
                        onChange={(e: any) =>
                          setMetaDraftById((prev) => ({ ...(prev || {}), [p.id]: { ...(prev?.[p.id] || { tagsRaw: "", note: "" }), note: String(e.target.value || "") } }))
                        }
                        rows={3}
                        placeholder={t.tr("optional", "可选")}
                      />
                    </div>
                  </div>

                  <div className="row" style={{ marginTop: 10, justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="iconBtn"
                      onClick={() =>
                        setMetaDraftById((prev) => ({
                          ...(prev || {}),
                          [p.id]: { tagsRaw: tags.join(", "), note },
                        }))
                      }
                      disabled={!dirty || savingId === p.id}
                    >
                      {t.tr("Reset", "重置")}
                    </button>
                    <button type="button" className="primary" onClick={() => saveProfileMeta(p)} disabled={!dirty || savingId === p.id}>
                      {savingId === p.id ? t.tr("Saving...", "保存中...") : t.tr("Save", "保存")}
                    </button>
                  </div>

                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span className="muted">{t.tr("token", "token")}</span>
                    <code>{String(p.token_masked || t.tr("(none)", "(无)"))}</code>
                    <button
                      type="button"
                      className="iconBtn"
                      onClick={async () => {
                        const ok = await confirmDialog(t.tr(`Reveal and copy token for FRP profile "${p.name}"?`, `显示并复制 FRP 配置「${p.name}」的 token？`), {
                          title: t.tr("Reveal Token", "显示 Token"),
                          confirmLabel: t.tr("Reveal", "显示"),
                          cancelLabel: t.tr("Cancel", "取消"),
                        });
                        if (!ok) return;
                        try {
                          const res = await apiFetch(`/api/frp/profiles/${encodeURIComponent(p.id)}/token`, { cache: "no-store" });
                          const json = await res.json();
                          if (!res.ok) throw new Error(json?.error || "failed");
                          await copyText(String(json?.token || ""));
                          setProfilesStatus(t.tr("Copied", "已复制"));
                          setTimeout(() => setProfilesStatus(""), 800);
                        } catch (e: any) {
                          setProfilesStatus(String(e?.message || e));
                        }
                      }}
                      disabled={!p.has_token}
                    >
                      <Icon name="copy" />
                      {t.tr("Copy", "复制")}
                    </button>
                  </div>

                  <div className="itemFooter frpCardFooter">
                    <div className="btnGroup frpCardActions">
                      <button
                        type="button"
                        onClick={() => {
                          setEnableFrp(true);
                          setFrpProfileId(p.id);
                          setTab("games");
                        }}
                      >
                        {t.tr("Use", "使用")}
                      </button>
                      <button
                        type="button"
                        className="iconBtn"
                        onClick={async () => {
                          try {
                            setTestingId(p.id);
                            setProfilesStatus(t.tr(`Testing ${p.name} ...`, `正在测试 ${p.name} ...`));
                            const res = await apiFetch(`/api/frp/profiles/${encodeURIComponent(p.id)}/probe`, {
                              method: "POST",
                              cache: "no-store",
                            });
                            const json = await res.json().catch(() => null);
                            if (!res.ok) throw new Error(json?.error || "failed");
                            await refreshProfiles();
                          } catch (e: any) {
                            setProfilesStatus(String(e?.message || e));
                          } finally {
                            setTestingId("");
                          }
                        }}
                        disabled={testingId === p.id}
                        title={t.tr("Test reachability from Panel to FRP server", "测试 Panel 到 FRP Server 的连通性")}
                      >
                        <Icon name="refresh" />
                        {t.tr("Test", "测试")}
                      </button>
                    </div>
                  </div>

                  <DangerZone
                    title={t.tr("Danger Zone", "危险区")}
                    hint={t.tr("Deleting a profile cannot be undone (you can recreate it later).", "删除后不可撤销（可稍后重新创建）。")}
                  >
                    <div className="btnGroup" style={{ justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="dangerBtn iconBtn"
                        onClick={async () => {
                          const name = String(p?.name || "").trim() || "-";
                          const ok = await confirmDialog(t.tr(`Delete FRP profile "${name}"?`, `删除 FRP 配置「${name}」？`), {
                            title: t.tr("Delete", "删除"),
                            confirmLabel: t.tr("Delete", "删除"),
                            cancelLabel: t.tr("Cancel", "取消"),
                            danger: true,
                          });
                          if (!ok) return;
                          const typed = await promptDialog({
                            title: t.tr("Confirm Delete", "确认删除"),
                            message: t.tr(`Type "${name}" to confirm deleting this profile.`, `输入「${name}」以确认删除该配置。`),
                            placeholder: name,
                            okLabel: t.tr("Delete", "删除"),
                            cancelLabel: t.tr("Cancel", "取消"),
                          });
                          if (typed !== name) return;
                          await removeFrpProfile(p.id);
                        }}
                      >
                        <Icon name="trash" />
                        {t.tr("Delete", "删除")}
                      </button>
                    </div>
                  </DangerZone>
                </div>
              );
              })}
            </div>
          ) : (
            <div className="emptyState">
              <div style={{ fontWeight: 800 }}>{t.tr("No matches", "无匹配")}</div>
              <div className="hint" style={{ marginTop: 6 }}>
                {t.tr("Try a different search query.", "请尝试其他关键词。")}
              </div>
            </div>
          )
        ) : profilesStatus === "Loading..." || profilesStatus === "加载中..." ? (
          <div className="cardGrid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton" />
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <div style={{ fontWeight: 800 }}>{t.tr("No FRP profiles yet", "暂无 FRP 配置")}</div>
            <div className="hint" style={{ marginTop: 6 }}>
              {t.tr("Add an FRP server profile, then reuse it from Games.", "先添加一个 FRP Server 配置，然后在 Games 里一键复用。")}
            </div>
            <div className="btnGroup" style={{ justifyContent: "center", marginTop: 10 }}>
              <button type="button" className="primary iconBtn" onClick={openAddFrpModal}>
                <Icon name="plus" />
                {t.tr("Add", "添加")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(FrpView);
