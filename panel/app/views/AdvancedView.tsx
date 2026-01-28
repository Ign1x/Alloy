"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useAppActions, useAppAdvanced, useAppCore, useAppI18n } from "../appCtx";
import Select from "../ui/Select";
import TimeAgo from "../ui/TimeAgo";

type AdvPreset = {
  id: string;
  label: string;
  daemonId: string;
  name: string;
  args: string;
  updatedAtUnix: number;
};

const ADV_PRESET_LS_KEY = "elegantmc_adv_presets_v1";

function AdvancedView() {
  const { t } = useAppI18n();
  const { openHelpModal, promptDialog, confirmDialog } = useAppActions();
  const { selectedDaemon, selected, setSelected, daemons, setTab } = useAppCore();
  const { cmdName, setCmdName, cmdArgs, setCmdArgs, cmdResult, runAdvancedCommand } = useAppAdvanced();

  const [presets, setPresets] = useState<AdvPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>("");

  const activePreset = useMemo(() => {
    return presets.find((p) => p && p.id === activePresetId) || null;
  }, [presets, activePresetId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ADV_PRESET_LS_KEY) || "";
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? (parsed as any[]) : [];
      const norm = list
        .map((p) => {
          const id = String(p?.id || "").trim();
          const label = String(p?.label || "").trim();
          if (!id || !label) return null;
          return {
            id,
            label,
            daemonId: String(p?.daemonId || "").trim(),
            name: String(p?.name || ""),
            args: String(p?.args || "{}"),
            updatedAtUnix: Number(p?.updatedAtUnix || 0) || 0,
          } satisfies AdvPreset;
        })
        .filter(Boolean) as AdvPreset[];
      setPresets(norm);
    } catch {
      // ignore
    }
  }, []);

  function persistPresets(next: AdvPreset[]) {
    setPresets(next);
    try {
      localStorage.setItem(ADV_PRESET_LS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!activePresetId) return;
    if (presets.some((p) => p.id === activePresetId)) return;
    setActivePresetId("");
  }, [activePresetId, presets]);

  function applyPresetById(idRaw: string) {
    const id = String(idRaw || "").trim();
    setActivePresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setCmdName(String(p.name || ""));
    setCmdArgs(String(p.args || ""));
    const d = String(p.daemonId || "").trim();
    if (d) setSelected(d);
  }

  async function savePresetNow() {
    const label = await promptDialog({
      title: t.tr("Save Preset", "保存预设"),
      message: t.tr("Save current command as a preset for reuse.", "将当前命令保存为预设，便于复用。"),
      placeholder: t.tr("Preset name", "预设名称"),
      okLabel: t.tr("Save", "保存"),
      cancelLabel: t.tr("Cancel", "取消"),
    });
    if (label == null) return;
    const name = String(label || "").trim();
    if (!name) return;

    const nowUnix = Math.floor(Date.now() / 1000);
    const id = `adv-${nowUnix}-${Math.random().toString(16).slice(2)}`;
    const next: AdvPreset = {
      id,
      label: name,
      daemonId: String(selected || "").trim(),
      name: String(cmdName || ""),
      args: String(cmdArgs || ""),
      updatedAtUnix: nowUnix,
    };
    const merged = [next, ...presets].slice(0, 60);
    persistPresets(merged);
    setActivePresetId(id);
  }

  async function overwritePresetNow() {
    if (!activePreset) return;
    const ok = await confirmDialog(t.tr(`Overwrite preset "${activePreset.label}"?`, `覆盖预设「${activePreset.label}」？`), {
      title: t.tr("Overwrite Preset", "覆盖预设"),
      confirmLabel: t.tr("Overwrite", "覆盖"),
      cancelLabel: t.tr("Cancel", "取消"),
      danger: true,
    });
    if (!ok) return;
    const nowUnix = Math.floor(Date.now() / 1000);
    const merged = presets.map((p) =>
      p.id === activePreset.id
        ? {
            ...p,
            daemonId: String(selected || "").trim(),
            name: String(cmdName || ""),
            args: String(cmdArgs || ""),
            updatedAtUnix: nowUnix,
          }
        : p
    );
    persistPresets(merged);
  }

  async function deletePresetNow() {
    if (!activePreset) return;
    const ok = await confirmDialog(t.tr(`Delete preset "${activePreset.label}"?`, `删除预设「${activePreset.label}」？`), {
      title: t.tr("Delete Preset", "删除预设"),
      confirmLabel: t.tr("Delete", "删除"),
      cancelLabel: t.tr("Cancel", "取消"),
      danger: true,
    });
    if (!ok) return;
    const merged = presets.filter((p) => p.id !== activePreset.id);
    persistPresets(merged);
    setActivePresetId("");
  }

  if (selectedDaemon && !selectedDaemon.connected) {
    return (
      <div className="card">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>{t.tr("Advanced Command", "高级命令")}</h2>
              <div className="hint">
                {t.tr("daemon", "daemon")}: <code>{String(selectedDaemon?.id || "-")}</code> · {t.tr("status", "状态")}:{" "}
                <span className="badge">{t.tr("offline", "离线")}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="emptyState">
          <div style={{ fontWeight: 800 }}>{t.tr("Daemon offline", "Daemon 离线")}</div>
          <div className="hint" style={{ marginTop: 6 }}>
            {t.tr("This page needs an online daemon to run advanced commands.", "本页需要 Daemon 在线才能执行高级命令。")} {t.tr("last seen", "最后在线")}:{" "}
            <code>{selectedDaemon?.lastSeenUnix ? <TimeAgo unix={selectedDaemon.lastSeenUnix} /> : "-"}</code>
          </div>
          <div className="hint" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
            {t.tr(
              "Recommended checks:\n1) Is the daemon process/container running?\n2) Verify ELEGANTMC_PANEL_WS_URL / DNS / firewall.\n3) Verify daemon token matches the node in Panel.",
              "建议排查：\n1) Daemon 进程/容器是否在运行？\n2) 检查 ELEGANTMC_PANEL_WS_URL / DNS / 防火墙。\n3) 检查 daemon token 是否与 Panel 中节点一致。"
            )}
          </div>
          <div className="btnGroup" style={{ justifyContent: "center", marginTop: 10 }}>
            <button type="button" className="primary" onClick={() => setTab("nodes")}>
              {t.tr("Go to Nodes", "前往 Nodes")}
            </button>
            <button type="button" className="iconBtn" onClick={openHelpModal}>
              {t.tr("Troubleshoot", "排查")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>{t.tr("Advanced Command", "高级命令")}</h2>

      <div className="grid2" style={{ alignItems: "end" }}>
        <div className="field">
          <label>{t.tr("Preset", "预设")}</label>
          <Select
            value={activePresetId}
            onChange={(v) => applyPresetById(String(v || ""))}
            options={presets.map((p) => ({ value: p.id, label: p.label }))}
            placeholder={t.tr("Select a preset…", "选择预设…")}
          />
          {activePreset ? (
            <div className="hint" style={{ marginTop: 6 }}>
              {t.tr("updated", "更新")}: <TimeAgo unix={activePreset.updatedAtUnix} />
            </div>
          ) : null}
        </div>
        <div className="field">
          <label>{t.tr("Actions", "操作")}</label>
          <div className="btnGroup" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            <button type="button" onClick={savePresetNow}>
              {t.tr("Save", "保存")}
            </button>
            <button type="button" onClick={overwritePresetNow} disabled={!activePreset}>
              {t.tr("Overwrite", "覆盖")}
            </button>
            <button type="button" className="dangerBtn" onClick={deletePresetNow} disabled={!activePreset}>
              {t.tr("Delete", "删除")}
            </button>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label>{t.tr("Name", "名称")}</label>
          <input
            value={cmdName}
            onChange={(e: any) => setCmdName(e.target.value)}
            placeholder={t.tr("ping / frp_start / mc_start ...", "ping / frp_start / mc_start ...")}
          />
        </div>
        <div className="field">
          <label>{t.tr("Daemon", "Daemon")}</label>
          <Select
            value={selected}
            onChange={(v) => setSelected(v)}
            options={daemons.map((d: any) => ({ value: d.id, label: `${d.id} ${d.connected ? "(online)" : "(offline)"}` }))}
          />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>{t.tr("Args (JSON)", "参数 (JSON)")}</label>
          <textarea value={cmdArgs} onChange={(e: any) => setCmdArgs(e.target.value)} rows={8} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={runAdvancedCommand}>
          {t.tr("Run", "执行")}
        </button>
        <span className="muted">
          {t.tr("selected", "当前")}: <b>{selectedDaemon?.id || "-"}</b>
        </span>
      </div>
      {cmdResult ? (
        <div style={{ marginTop: 12 }}>
          <h3>{t.tr("Result", "结果")}</h3>
          <pre>{JSON.stringify(cmdResult, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

export default memo(AdvancedView);
