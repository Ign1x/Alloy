"use client";

import { memo } from "react";
import { useAppActions, useAppAdvanced, useAppCore, useAppI18n } from "../appCtx";
import Select from "../ui/Select";
import TimeAgo from "../ui/TimeAgo";

function AdvancedView() {
  const { t } = useAppI18n();
  const { openHelpModal } = useAppActions();
  const { selectedDaemon, selected, setSelected, daemons, setTab } = useAppCore();
  const { cmdName, setCmdName, cmdArgs, setCmdArgs, cmdResult, runAdvancedCommand } = useAppAdvanced();

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
