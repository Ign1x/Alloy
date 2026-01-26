"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useAppActions, useAppCore, useAppGames, useAppI18n, useAppPanel } from "../appCtx";
import { swrPeek, swrRevalidate } from "../swrCache";
import CopyButton from "../ui/CopyButton";
import EnvHelpButton from "../ui/EnvHelpButton";
import Field from "../ui/Field";
import { ManagedModal } from "../ui/ModalStack";
import Select from "../ui/Select";
import TimeAgo from "../ui/TimeAgo";

const SWR_TTL_ADMIN_LIST_MS = 20_000;

function PanelView() {
  const { t, fmtUnix } = useAppI18n();
  const { apiFetch, confirmDialog } = useAppActions();
  const { authMe, notifications, selectedDaemon } = useAppCore();
  const { serverDirs } = useAppGames();
  const { panelSettings, panelSettingsStatus, refreshPanelSettings, savePanelSettings, updateInfo, updateStatus, updateBusy, checkUpdates, loadSchedule, saveScheduleJson, runScheduleTask } =
    useAppPanel();

  const [draft, setDraft] = useState<any>(panelSettings || null);
  const [settingsQuery, setSettingsQuery] = useState<string>("");
  const [activeTocId, setActiveTocId] = useState<string>("panel-updates");
  const [scheduleText, setScheduleText] = useState<string>("");
  const [scheduleStatus, setScheduleStatus] = useState<string>("");
  const [schedulePath, setSchedulePath] = useState<string>("");
  const [scheduleBusy, setScheduleBusy] = useState<boolean>(false);

  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState<string>("");
  const [sessionsBusy, setSessionsBusy] = useState<boolean>(false);
  const [sessionsQuery, setSessionsQuery] = useState<string>("");

  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [auditStatus, setAuditStatus] = useState<string>("");
  const [auditBusy, setAuditBusy] = useState<boolean>(false);
  const [auditActionQuery, setAuditActionQuery] = useState<string>("");
  const [auditUserQuery, setAuditUserQuery] = useState<string>("");
  const [auditTextQuery, setAuditTextQuery] = useState<string>("");
  const [auditRange, setAuditRange] = useState<string>("7d");
  const [auditLimit, setAuditLimit] = useState<string>("200");
  const [auditTruncated, setAuditTruncated] = useState<boolean>(false);

  const [activitySource, setActivitySource] = useState<"all" | "audit" | "notifications">("all");
  const [activityToastKind, setActivityToastKind] = useState<"all" | "info" | "ok" | "error">("all");
  const [activityQuery, setActivityQuery] = useState<string>("");
  const [activityLimit, setActivityLimit] = useState<string>("200");

  const [users, setUsers] = useState<any[]>([]);
  const [usersStatus, setUsersStatus] = useState<string>("");
  const [usersBusy, setUsersBusy] = useState<boolean>(false);
  const [passwordPolicy, setPasswordPolicy] = useState<{ min_length: number; reject_common: boolean } | null>(null);
  const [passwordPolicyStatus, setPasswordPolicyStatus] = useState<string>("");
  const [securityHeaders, setSecurityHeaders] = useState<any | null>(null);
  const [securityHeadersStatus, setSecurityHeadersStatus] = useState<string>("");
  const [securityHeadersBusy, setSecurityHeadersBusy] = useState<boolean>(false);
  const [newUsername, setNewUsername] = useState<string>("");
  const [newUserPassword, setNewUserPassword] = useState<string>("");
  const [resetPwdOpen, setResetPwdOpen] = useState<boolean>(false);
  const [resetPwdUserId, setResetPwdUserId] = useState<string>("");
  const [resetPwdUsername, setResetPwdUsername] = useState<string>("");
  const [resetPwdValue, setResetPwdValue] = useState<string>("");

  const [totpOpen, setTotpOpen] = useState<boolean>(false);
  const [totpBusy, setTotpBusy] = useState<boolean>(false);
  const [totpStatus, setTotpStatus] = useState<string>("");
  const [totpSecret, setTotpSecret] = useState<string>("");
  const [totpUri, setTotpUri] = useState<string>("");
  const [totpCode, setTotpCode] = useState<string>("");
  const [totpRecoveryCodes, setTotpRecoveryCodes] = useState<string[] | null>(null);

  const [apiTokens, setApiTokens] = useState<any[]>([]);
  const [apiTokensStatus, setApiTokensStatus] = useState<string>("");
  const [apiTokensBusy, setApiTokensBusy] = useState<boolean>(false);
  const [newTokenName, setNewTokenName] = useState<string>("");
  const [apiTokenQuery, setApiTokenQuery] = useState<string>("");
  const [createdToken, setCreatedToken] = useState<string>("");

  const [rotateSecretOpen, setRotateSecretOpen] = useState<boolean>(false);
  const [rotateSecretBusy, setRotateSecretBusy] = useState<boolean>(false);
  const [rotateSecretStatus, setRotateSecretStatus] = useState<string>("");
  const [rotateSecretConfirm, setRotateSecretConfirm] = useState<string>("");

  const [backupPresetInstanceId, setBackupPresetInstanceId] = useState<string>("");
  const [backupPresetScheduleKind, setBackupPresetScheduleKind] = useState<"interval" | "daily" | "weekly">("daily");
  const [backupPresetEveryHours, setBackupPresetEveryHours] = useState<number>(24);
  const [backupPresetAtHour, setBackupPresetAtHour] = useState<number>(3);
  const [backupPresetAtMinute, setBackupPresetAtMinute] = useState<number>(0);
  const [backupPresetWeekday, setBackupPresetWeekday] = useState<number>(1); // Mon
  const [backupPresetKeepLast, setBackupPresetKeepLast] = useState<number>(7);
  const [backupPresetStopServer, setBackupPresetStopServer] = useState<boolean>(true);
  const [templateKind, setTemplateKind] = useState<"backup" | "restart" | "stop" | "prune_logs" | "announce">("backup");
  const [pruneLogsKeepLast, setPruneLogsKeepLast] = useState<number>(30);
  const [announceMessage, setAnnounceMessage] = useState<string>("");

  useEffect(() => {
    setDraft(panelSettings || null);
  }, [panelSettings]);

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      const key = "api:/api/auth/sessions";
      const peek = swrPeek<any[]>(key, SWR_TTL_ADMIN_LIST_MS);
      if (peek) {
        setSessions(Array.isArray(peek.value) ? peek.value : []);
        setSessionsStatus(peek.stale ? t.tr("Refreshing...", "刷新中...") : "");
        if (!peek.stale) return;
      }

      setSessionsBusy(true);
      setSessionsStatus(peek ? t.tr("Refreshing...", "刷新中...") : t.tr("Loading...", "加载中..."));
      try {
        const list = await swrRevalidate<any[]>(key, SWR_TTL_ADMIN_LIST_MS, async () => {
          const res = await apiFetch("/api/auth/sessions", { cache: "no-store" });
          const json = await res.json().catch(() => null);
          if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
          return Array.isArray(json?.sessions) ? json.sessions : [];
        });
        if (cancelled) return;
        setSessions(list);
        setSessionsStatus("");
      } catch (e: any) {
        if (cancelled) return;
        if (!peek) setSessions([]);
        setSessionsStatus(String(e?.message || e));
      } finally {
        if (!cancelled) setSessionsBusy(false);
      }
    }
    loadSessions();
    return () => {
      cancelled = true;
    };
  }, [apiFetch, t]);

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      const key = "api:/api/auth/users";
      const peek = swrPeek<any[]>(key, SWR_TTL_ADMIN_LIST_MS);
      if (peek) {
        setUsers(Array.isArray(peek.value) ? peek.value : []);
        setUsersStatus(peek.stale ? t.tr("Refreshing...", "刷新中...") : "");
        if (!peek.stale) return;
      }

      setUsersBusy(true);
      setUsersStatus(peek ? t.tr("Refreshing...", "刷新中...") : t.tr("Loading...", "加载中..."));
      try {
        const list = await swrRevalidate<any[]>(key, SWR_TTL_ADMIN_LIST_MS, async () => {
          const res = await apiFetch("/api/auth/users", { cache: "no-store" });
          const json = await res.json().catch(() => null);
          if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
          return Array.isArray(json?.users) ? json.users : [];
        });
        if (cancelled) return;
        setUsers(list);
        setUsersStatus("");
      } catch (e: any) {
        if (cancelled) return;
        if (!peek) setUsers([]);
        setUsersStatus(String(e?.message || e));
      } finally {
        if (!cancelled) setUsersBusy(false);
      }
    }
    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [apiFetch, t]);

  useEffect(() => {
    let cancelled = false;
    async function loadPasswordPolicy() {
      setPasswordPolicyStatus(t.tr("Loading...", "加载中..."));
      try {
        const res = await apiFetch("/api/auth/password-policy", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
        const minLen = Number(json?.policy?.min_length || 0);
        const rejectCommon = !!json?.policy?.reject_common;
        setPasswordPolicy({
          min_length: Number.isFinite(minLen) && minLen > 0 ? minLen : 8,
          reject_common: rejectCommon,
        });
        setPasswordPolicyStatus("");
      } catch (e: any) {
        if (cancelled) return;
        setPasswordPolicy(null);
        setPasswordPolicyStatus(String(e?.message || e));
      }
    }
    loadPasswordPolicy();
    return () => {
      cancelled = true;
    };
  }, [apiFetch, t]);

  async function refreshSecurityHeaders() {
    setSecurityHeadersBusy(true);
    setSecurityHeadersStatus("");
    try {
      const res = await apiFetch("/api/config", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setSecurityHeaders(json?.security_headers || null);
    } catch (e: any) {
      setSecurityHeaders(null);
      setSecurityHeadersStatus(String(e?.message || e));
    } finally {
      setSecurityHeadersBusy(false);
    }
  }

  useEffect(() => {
    const p = refreshSecurityHeaders();
    if (p && typeof (p as any).then === "function") (p as any).catch(() => null);
  }, [apiFetch, t]);

  useEffect(() => {
    let cancelled = false;
    async function loadTokens() {
      setApiTokensBusy(true);
      setApiTokensStatus(t.tr("Loading...", "加载中..."));
      try {
        const res = await apiFetch("/api/auth/api-tokens", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
        setApiTokens(Array.isArray(json?.tokens) ? json.tokens : []);
        setApiTokensStatus("");
      } catch (e: any) {
        if (cancelled) return;
        setApiTokens([]);
        setApiTokensStatus(String(e?.message || e));
      } finally {
        if (!cancelled) setApiTokensBusy(false);
      }
    }
    loadTokens();
    return () => {
      cancelled = true;
    };
  }, [apiFetch, t]);

  useEffect(() => {
    const p = refreshAudit();
    if (p && typeof (p as any).then === "function") (p as any).catch(() => null);
  }, [apiFetch, t]);

  async function refreshSessions() {
    setSessionsBusy(true);
    setSessionsStatus(t.tr("Loading...", "加载中..."));
    try {
      const list = await swrRevalidate<any[]>("api:/api/auth/sessions", SWR_TTL_ADMIN_LIST_MS, async () => {
        const res = await apiFetch("/api/auth/sessions", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
        return Array.isArray(json?.sessions) ? json.sessions : [];
      });
      setSessions(list);
      setSessionsStatus("");
    } catch (e: any) {
      setSessions([]);
      setSessionsStatus(String(e?.message || e));
    } finally {
      setSessionsBusy(false);
    }
  }

  async function revokeSession(id: string, masked: string) {
    const ok = await confirmDialog(
      t.tr(`Revoke session ${masked}?`, `撤销会话 ${masked}？`),
      { title: t.tr("Revoke session", "撤销会话"), confirmLabel: t.tr("Revoke", "撤销"), cancelLabel: t.tr("Cancel", "取消"), danger: true }
    );
    if (!ok) return;
    setSessionsBusy(true);
    setSessionsStatus(t.tr("Revoking...", "撤销中..."));
    try {
      const res = await apiFetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      await refreshSessions();
      setSessionsStatus(t.tr("Revoked", "已撤销"));
      window.setTimeout(() => setSessionsStatus(""), 900);
    } catch (e: any) {
      setSessionsStatus(String(e?.message || e));
    } finally {
      setSessionsBusy(false);
    }
  }

  async function revokeAllSessions(keepCurrent: boolean) {
    const ok = await confirmDialog(
      keepCurrent
        ? t.tr("Revoke all other sessions (keep current)?", "撤销除当前以外的所有会话（保留当前）？")
        : t.tr("Revoke ALL sessions (including current)? You will be logged out.", "撤销全部会话（包括当前）？你将被登出。"),
      { title: t.tr("Revoke sessions", "撤销会话"), confirmLabel: t.tr("Revoke", "撤销"), cancelLabel: t.tr("Cancel", "取消"), danger: true }
    );
    if (!ok) return;
    setSessionsBusy(true);
    setSessionsStatus(t.tr("Revoking...", "撤销中..."));
    try {
      const res = await apiFetch("/api/auth/sessions/revoke-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_current: keepCurrent }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      await refreshSessions();
      setSessionsStatus(t.tr("Done", "已完成"));
      window.setTimeout(() => setSessionsStatus(""), 900);
    } catch (e: any) {
      setSessionsStatus(String(e?.message || e));
    } finally {
      setSessionsBusy(false);
    }
  }

  async function refreshUsers() {
    setUsersBusy(true);
    setUsersStatus(t.tr("Loading...", "加载中..."));
    try {
      const list = await swrRevalidate<any[]>("api:/api/auth/users", SWR_TTL_ADMIN_LIST_MS, async () => {
        const res = await apiFetch("/api/auth/users", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
        return Array.isArray(json?.users) ? json.users : [];
      });
      setUsers(list);
      setUsersStatus("");
    } catch (e: any) {
      setUsers([]);
      setUsersStatus(String(e?.message || e));
    } finally {
      setUsersBusy(false);
    }
  }

  async function openTotpSetup() {
    setTotpOpen(true);
    setTotpStatus("");
    setTotpSecret("");
    setTotpUri("");
    setTotpCode("");
    setTotpRecoveryCodes(null);

    setTotpBusy(true);
    setTotpStatus(t.tr("Generating...", "生成中..."));
    try {
      const res = await apiFetch("/api/auth/totp/begin", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setTotpSecret(String(json?.secret_b32 || ""));
      setTotpUri(String(json?.otpauth_uri || ""));
      setTotpStatus("");
    } catch (e: any) {
      setTotpStatus(String(e?.message || e));
    } finally {
      setTotpBusy(false);
    }
  }

  async function enableTotpNow() {
    const secret = String(totpSecret || "").trim();
    const code = String(totpCode || "").trim();
    if (!secret) {
      setTotpStatus(t.tr("secret missing (begin again)", "secret 缺失（请重新开始）"));
      return;
    }
    if (!code) {
      setTotpStatus(t.tr("code is required", "需要填写验证码"));
      return;
    }
    setTotpBusy(true);
    setTotpStatus(t.tr("Enabling...", "开启中..."));
    try {
      const res = await apiFetch("/api/auth/totp/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_b32: secret, code }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setTotpRecoveryCodes(Array.isArray(json?.recovery_codes) ? json.recovery_codes.map((x: any) => String(x)) : []);
      setTotpStatus(t.tr("Enabled", "已开启"));
      await refreshUsers();
      await refreshSessions();
    } catch (e: any) {
      setTotpStatus(String(e?.message || e));
    } finally {
      setTotpBusy(false);
    }
  }

  async function disableTotpNow(u: any) {
    const id = String(u?.id || "").trim();
    const username = String(u?.username || "").trim() || "-";
    if (!id) return;
    const ok = await confirmDialog(
      t.tr(`Disable 2FA for ${username}?`, `为 ${username} 关闭 2FA？`),
      { title: t.tr("Disable 2FA", "关闭 2FA"), confirmLabel: t.tr("Disable", "关闭"), cancelLabel: t.tr("Cancel", "取消"), danger: true }
    );
    if (!ok) return;
    setUsersBusy(true);
    setUsersStatus(t.tr("Disabling...", "关闭中..."));
    try {
      const res = await apiFetch("/api/auth/totp/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      await refreshUsers();
      setUsersStatus(t.tr("Done", "完成"));
      window.setTimeout(() => setUsersStatus(""), 900);
    } catch (e: any) {
      setUsersStatus(String(e?.message || e));
    } finally {
      setUsersBusy(false);
    }
  }

  async function rotatePanelSecretNow() {
    if (!String(rotateSecretConfirm || "").trim()) {
      setRotateSecretStatus(t.tr("Type ROTATE to confirm", "输入 ROTATE 以确认"));
      return;
    }
    if (String(rotateSecretConfirm || "").trim().toUpperCase() !== "ROTATE") {
      setRotateSecretStatus(t.tr("Type ROTATE to confirm", "输入 ROTATE 以确认"));
      return;
    }

    const ok = await confirmDialog(
      t.tr("Rotate panel secret and invalidate ALL sessions? You will be logged out.", "轮换 Panel secret 并撤销所有会话？你将被登出。"),
      { title: t.tr("Rotate Secret", "轮换 Secret"), confirmLabel: t.tr("Rotate", "轮换"), cancelLabel: t.tr("Cancel", "取消"), danger: true }
    );
    if (!ok) return;

    setRotateSecretBusy(true);
    setRotateSecretStatus(t.tr("Rotating...", "轮换中..."));
    try {
      const res = await apiFetch("/api/auth/secret/rotate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setRotateSecretStatus(t.tr("Done", "完成"));
      // The server will clear the session cookie; UI will prompt login again.
    } catch (e: any) {
      setRotateSecretStatus(String(e?.message || e));
    } finally {
      setRotateSecretBusy(false);
    }
  }

  async function createUserNow() {
    setUsersStatus("");
    setUsersBusy(true);
    try {
      const res = await apiFetch("/api/auth/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newUserPassword }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setNewUsername("");
      setNewUserPassword("");
      await refreshUsers();
      setUsersStatus(t.tr("Created", "已创建"));
      window.setTimeout(() => setUsersStatus(""), 900);
    } catch (e: any) {
      setUsersStatus(String(e?.message || e));
    } finally {
      setUsersBusy(false);
    }
  }

  async function deleteUserNow(u: any) {
    const id = String(u?.id || "").trim();
    const username = String(u?.username || "").trim();
    if (!id) return;
    const ok = await confirmDialog(t.tr(`Delete user ${username}?`, `删除用户 ${username}？`), {
      title: t.tr("Delete User", "删除用户"),
      confirmLabel: t.tr("Delete", "删除"),
      cancelLabel: t.tr("Cancel", "取消"),
      danger: true,
    });
    if (!ok) return;
    setUsersBusy(true);
    setUsersStatus(t.tr("Deleting...", "删除中..."));
    try {
      const res = await apiFetch("/api/auth/users/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      await refreshUsers();
      await refreshSessions();
      setUsersStatus(t.tr("Deleted", "已删除"));
      window.setTimeout(() => setUsersStatus(""), 900);
    } catch (e: any) {
      setUsersStatus(String(e?.message || e));
    } finally {
      setUsersBusy(false);
    }
  }

  function openResetPassword(u: any) {
    const id = String(u?.id || "").trim();
    const username = String(u?.username || "").trim();
    if (!id) return;
    setResetPwdUserId(id);
    setResetPwdUsername(username);
    setResetPwdValue("");
    setResetPwdOpen(true);
  }

  async function submitResetPassword() {
    const id = resetPwdUserId.trim();
    if (!id) return;
    setUsersBusy(true);
    setUsersStatus(t.tr("Saving...", "保存中..."));
    try {
      const res = await apiFetch("/api/auth/users/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password: resetPwdValue }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setResetPwdOpen(false);
      setResetPwdValue("");
      await refreshUsers();
      await refreshSessions();
      setUsersStatus(t.tr("Saved", "已保存"));
      window.setTimeout(() => setUsersStatus(""), 900);
    } catch (e: any) {
      setUsersStatus(String(e?.message || e));
    } finally {
      setUsersBusy(false);
    }
  }

  async function refreshApiTokens() {
    setApiTokensBusy(true);
    setApiTokensStatus(t.tr("Loading...", "加载中..."));
    try {
      const res = await apiFetch("/api/auth/api-tokens", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setApiTokens(Array.isArray(json?.tokens) ? json.tokens : []);
      setApiTokensStatus("");
    } catch (e: any) {
      setApiTokens([]);
      setApiTokensStatus(String(e?.message || e));
    } finally {
      setApiTokensBusy(false);
    }
  }

  async function createApiTokenNow() {
    setApiTokensBusy(true);
    setApiTokensStatus(t.tr("Creating...", "创建中..."));
    try {
      const res = await apiFetch("/api/auth/api-tokens/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTokenName }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setCreatedToken(String(json?.token || ""));
      setNewTokenName("");
      await refreshApiTokens();
      setApiTokensStatus(t.tr("Created", "已创建"));
      window.setTimeout(() => setApiTokensStatus(""), 900);
    } catch (e: any) {
      setApiTokensStatus(String(e?.message || e));
    } finally {
      setApiTokensBusy(false);
    }
  }

  async function revokeApiTokenNow(idRaw: string) {
    const id = String(idRaw || "").trim();
    if (!id) return;
    const ok = await confirmDialog(t.tr("Revoke this API token?", "撤销此 API token？"), {
      title: t.tr("Revoke token", "撤销 token"),
      confirmLabel: t.tr("Revoke", "撤销"),
      cancelLabel: t.tr("Cancel", "取消"),
      danger: true,
    });
    if (!ok) return;
    setApiTokensBusy(true);
    setApiTokensStatus(t.tr("Revoking...", "撤销中..."));
    try {
      const res = await apiFetch("/api/auth/api-tokens/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      await refreshApiTokens();
      setApiTokensStatus(t.tr("Revoked", "已撤销"));
      window.setTimeout(() => setApiTokensStatus(""), 900);
    } catch (e: any) {
      setApiTokensStatus(String(e?.message || e));
    } finally {
      setApiTokensBusy(false);
    }
  }

  function sinceUnixForAuditRange(range: string, nowUnix: number) {
    const r = String(range || "").trim().toLowerCase();
    if (r === "1h") return nowUnix - 60 * 60;
    if (r === "24h") return nowUnix - 60 * 60 * 24;
    if (r === "7d") return nowUnix - 60 * 60 * 24 * 7;
    if (r === "30d") return nowUnix - 60 * 60 * 24 * 30;
    return 0;
  }

  async function refreshAudit() {
    setAuditBusy(true);
    setAuditStatus(t.tr("Loading...", "加载中..."));
    try {
      const now = Math.floor(Date.now() / 1000);
      const limitRaw = Number(auditLimit || 0);
      const limit = Math.max(50, Math.min(1000, Math.round(Number.isFinite(limitRaw) ? limitRaw : 200)));
      const sinceUnix = sinceUnixForAuditRange(auditRange, now);

      const qs = new URLSearchParams();
      qs.set("limit", String(limit));
      if (sinceUnix > 0) qs.set("since_unix", String(sinceUnix));

      const actionQ = auditActionQuery.trim();
      const userQ = auditUserQuery.trim();
      const q = auditTextQuery.trim();
      if (actionQ) qs.set("action", actionQ);
      if (userQ) qs.set("user", userQ);
      if (q) qs.set("q", q);

      const res = await apiFetch(`/api/audit?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || t.tr("failed", "失败"));
      setAuditEntries(Array.isArray(json?.entries) ? json.entries : []);
      setAuditTruncated(!!json?.truncated);
      setAuditStatus("");
    } catch (e: any) {
      setAuditEntries([]);
      setAuditTruncated(false);
      setAuditStatus(String(e?.message || e));
    } finally {
      setAuditBusy(false);
    }
  }

  function exportAuditJson() {
    try {
      const blob = new Blob([auditExportJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 800);
    } catch {
      // ignore
    }
  }

  function exportActivityJson() {
    try {
      const blob = new Blob([activityExportJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 800);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (backupPresetInstanceId.trim()) return;
    if (Array.isArray(serverDirs) && serverDirs.length) setBackupPresetInstanceId(String(serverDirs[0] || ""));
  }, [backupPresetInstanceId, serverDirs]);

  const parsedSchedule = useMemo(() => {
    const raw = String(scheduleText || "").trim();
    if (!raw) return { ok: true, schedule: { tasks: [] as any[] } };
    try {
      const schedule = JSON.parse(raw);
      return { ok: true, schedule };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e), schedule: null };
    }
  }, [scheduleText]);

  const q = settingsQuery.trim().toLowerCase();
  const show = (...terms: string[]) => !q || terms.some((t) => String(t || "").toLowerCase().includes(q));

  const showBrandSettings =
    show("brand name", "brand", "title", "sidebar") ||
    show("brand tagline", "tagline") ||
    show("logo", "logo url", "icon");
  const showCfSettings = show("curseforge", "api key", "cf_");
  const showDefaultsSettings =
    show("default version", "version") ||
    show("default game port", "port", "25565") ||
    show("default memory", "memory", "xms", "xmx") ||
    show("eula", "accept eula") ||
    show("frp", "default frp") ||
    show("frp remote port", "remote port", "25566");

  const filteredApiTokens = useMemo(() => {
    const q = apiTokenQuery.trim().toLowerCase();
    if (!q) return apiTokens;
    return (Array.isArray(apiTokens) ? apiTokens : []).filter((tok: any) => {
      const name = String(tok?.name || "").toLowerCase();
      const fp = String(tok?.fingerprint || "").toLowerCase();
      return name.includes(q) || fp.includes(q);
    });
  }, [apiTokenQuery, apiTokens]);

  const filteredSessions = useMemo(() => {
    const q = sessionsQuery.trim().toLowerCase();
    if (!q) return sessions;
    return (Array.isArray(sessions) ? sessions : []).filter((s: any) => {
      const masked = String(s?.token_masked || "");
      const user = String(s?.username || s?.user_id || "");
      const ip = String(s?.ip || "");
      const ua = String(s?.user_agent || "");
      const hay = `${masked} ${user} ${ip} ${ua}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sessions, sessionsQuery]);

  const auditExportJson = useMemo(() => JSON.stringify(Array.isArray(auditEntries) ? auditEntries : [], null, 2), [auditEntries]);

  const activityItems = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const sinceUnix = sinceUnixForAuditRange(auditRange, now);
    const q = activityQuery.trim().toLowerCase();
    const limitRaw = Number(activityLimit || 0);
    const limit = Math.max(50, Math.min(1000, Math.round(Number.isFinite(limitRaw) ? limitRaw : 200)));

    const items: any[] = [];

    if (activitySource !== "audit") {
      for (const n of Array.isArray(notifications) ? notifications : []) {
        const ts = Math.floor(Number(n?.atMs || 0) / 1000);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        if (sinceUnix > 0 && ts < sinceUnix) continue;
        const kind = String(n?.kind || "info") as any;
        if (activityToastKind !== "all" && kind !== activityToastKind) continue;
        const msg = String(n?.message || "").trim();
        const detail = String(n?.detail || "").trim();
        if (q) {
          const hay = `${kind} ${msg} ${detail}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        items.push({ source: "notification", kind, ts_unix: ts, message: msg, detail, raw: n });
      }
    }

    if (activitySource !== "notifications") {
      for (const e of Array.isArray(auditEntries) ? auditEntries : []) {
        const ts = Number(e?.ts_unix || 0);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        if (sinceUnix > 0 && ts < sinceUnix) continue;
        const action = String(e?.action || "");
        const user = String(e?.user || "");
        const ip = String(e?.ip || "");
        const auth = String(e?.auth || "");
        const detailStr = e?.detail ? JSON.stringify(e.detail) : "";
        if (q) {
          const hay = `${action} ${user} ${ip} ${auth} ${detailStr}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        items.push({ source: "audit", kind: "audit", ts_unix: ts, action, user, auth, ip, detail: e?.detail || null, raw: e });
      }
    }

    items.sort((a, b) => Number(b?.ts_unix || 0) - Number(a?.ts_unix || 0));
    return items.slice(0, limit);
  }, [activityLimit, activityQuery, activitySource, activityToastKind, auditEntries, auditRange, notifications]);

  const activityExportJson = useMemo(() => {
    const out = activityItems.map((x: any) => {
      const ts_unix = Number(x?.ts_unix || 0) || 0;
      const source = String(x?.source || "");
      if (source === "audit") {
        return {
          ts_unix,
          source,
          action: String(x?.action || ""),
          user: String(x?.user || ""),
          auth: String(x?.auth || ""),
          ip: String(x?.ip || ""),
          detail: x?.detail ?? null,
        };
      }
      return {
        ts_unix,
        source,
        kind: String(x?.kind || "info"),
        message: String(x?.message || ""),
        detail: String(x?.detail || ""),
      };
    });
    return JSON.stringify(out, null, 2);
  }, [activityItems]);

  const passwordMinLen = passwordPolicy?.min_length && passwordPolicy.min_length > 0 ? passwordPolicy.min_length : 8;
  const passwordHint = passwordPolicy
    ? passwordPolicy.reject_common
      ? t.tr(`min ${passwordMinLen} chars; reject common passwords`, `至少 ${passwordMinLen} 个字符；拒绝常见密码`)
      : t.tr(`min ${passwordMinLen} chars`, `至少 ${passwordMinLen} 个字符`)
    : passwordPolicyStatus
      ? t.tr("Password policy unavailable (server will validate)", "密码策略不可用（以服务端校验为准）")
      : t.tr("Password policy loading... (server will validate)", "密码策略加载中…（以服务端校验为准）");

  function uniqueTaskId(existingTasks: any[], base: string) {
    const used = new Set((existingTasks || []).map((t) => String(t?.id || "").trim()).filter(Boolean));
    const root = String(base || "task").trim() || "task";
    if (!used.has(root)) return root;
    for (let i = 2; i <= 500; i++) {
      const id = `${root}-${i}`;
      if (!used.has(id)) return id;
    }
    return `${root}-${Math.floor(Date.now() / 1000)}`;
  }

  function applyScheduleUpdate(nextSchedule: any) {
    setScheduleText(JSON.stringify(nextSchedule ?? { tasks: [] }, null, 2) + "\n");
  }

  function clampInt(v: any, min: number, max: number, fallback: number) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function nextDailyAtUnix(hour: number, minute: number) {
    const h = clampInt(hour, 0, 23, 3);
    const m = clampInt(minute, 0, 59, 0);
    const now = new Date();
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return Math.floor(next.getTime() / 1000);
  }

  function nextWeeklyAtUnix(weekday: number, hour: number, minute: number) {
    const dow = clampInt(weekday, 0, 6, 1);
    const h = clampInt(hour, 0, 23, 3);
    const m = clampInt(minute, 0, 59, 0);
    const now = new Date();
    const nowDow = now.getDay();
    let addDays = (dow - nowDow + 7) % 7;
    const next = new Date(now);
    next.setDate(next.getDate() + addDays);
    next.setHours(h, m, 0, 0);
    if (addDays === 0 && next.getTime() <= now.getTime()) {
      addDays = 7;
      next.setDate(next.getDate() + 7);
    }
    return Math.floor(next.getTime() / 1000);
  }

  function buildCronLikeSchedule() {
    const kind = backupPresetScheduleKind;
    if (kind === "interval") {
      const hours = Math.max(1, clampInt(backupPresetEveryHours, 1, 24 * 365, 24));
      const everySec = Math.max(60, Math.round(hours * 3600));
      const nowUnix = Math.floor(Date.now() / 1000);
      return { every_sec: everySec, last_run_unix: nowUnix, next_run_unix: nowUnix + everySec, cron: `@every ${hours}h` };
    }
    if (kind === "weekly") {
      const everySec = 7 * 86400;
      const nextAt = nextWeeklyAtUnix(backupPresetWeekday, backupPresetAtHour, backupPresetAtMinute);
      return {
        every_sec: everySec,
        last_run_unix: nextAt - everySec,
        next_run_unix: nextAt,
        cron: `${clampInt(backupPresetAtMinute, 0, 59, 0)} ${clampInt(backupPresetAtHour, 0, 23, 3)} * * ${clampInt(backupPresetWeekday, 0, 6, 1)}`,
      };
    }
    // daily
    const everySec = 86400;
    const nextAt = nextDailyAtUnix(backupPresetAtHour, backupPresetAtMinute);
    return {
      every_sec: everySec,
      last_run_unix: nextAt - everySec,
      next_run_unix: nextAt,
      cron: `${clampInt(backupPresetAtMinute, 0, 59, 0)} ${clampInt(backupPresetAtHour, 0, 23, 3)} * * *`,
    };
  }

  function addTemplateTask() {
    if (!parsedSchedule.ok) return;
    if (scheduleBusy) return;

    const inst = String(backupPresetInstanceId || "").trim();
    if (!inst) {
      setScheduleStatus(t.tr("instance_id is required", "instance_id 不能为空"));
      return;
    }

    const scheduleSpec = buildCronLikeSchedule();

    const prev = (parsedSchedule as any).schedule;
    const next: any = typeof prev === "object" && prev ? { ...prev } : { tasks: [] };
    const tasks = Array.isArray(next.tasks) ? [...next.tasks] : [];
    const kind = templateKind;
    let task: any = null;

    if (kind === "backup") {
      const keepRaw = Math.round(Number(backupPresetKeepLast));
      const keepLast = Number.isFinite(keepRaw) && keepRaw >= 0 ? Math.min(keepRaw, 1000) : 0;
      const id = uniqueTaskId(tasks, `backup-${inst}`);
      task = {
        id,
        type: "backup",
        instance_id: inst,
        every_sec: scheduleSpec.every_sec,
        last_run_unix: scheduleSpec.last_run_unix,
        ...(keepLast > 0 ? { keep_last: keepLast } : {}),
        ...(backupPresetStopServer ? {} : { stop: false }),
      };
    } else if (kind === "restart") {
      const id = uniqueTaskId(tasks, `restart-${inst}`);
      task = { id, type: "restart", instance_id: inst, every_sec: scheduleSpec.every_sec, last_run_unix: scheduleSpec.last_run_unix };
    } else if (kind === "stop") {
      const id = uniqueTaskId(tasks, `stop-${inst}`);
      task = { id, type: "stop", instance_id: inst, every_sec: scheduleSpec.every_sec, last_run_unix: scheduleSpec.last_run_unix };
    } else if (kind === "prune_logs") {
      const keepRaw = Math.round(Number(pruneLogsKeepLast));
      const keepLast = Number.isFinite(keepRaw) ? Math.max(1, Math.min(keepRaw, 1000)) : 30;
      const id = uniqueTaskId(tasks, `prune-logs-${inst}`);
      task = { id, type: "prune_logs", instance_id: inst, every_sec: scheduleSpec.every_sec, last_run_unix: scheduleSpec.last_run_unix, keep_last: keepLast };
    } else if (kind === "announce") {
      const msg = String(announceMessage || "").trim();
      if (!msg) {
        setScheduleStatus(t.tr("message is required", "message 不能为空"));
        return;
      }
      if (msg.includes("\n") || msg.includes("\r")) {
        setScheduleStatus(t.tr("message must be single-line", "message 不能换行"));
        return;
      }
      if (msg.length > 400) {
        setScheduleStatus(t.tr("message too long (max 400)", "message 太长（最多 400）"));
        return;
      }
      const id = uniqueTaskId(tasks, `announce-${inst}`);
      task = { id, type: "announce", instance_id: inst, every_sec: scheduleSpec.every_sec, last_run_unix: scheduleSpec.last_run_unix, message: msg };
    }

    if (!task) return;
    tasks.push(task);
    next.tasks = tasks;
    applyScheduleUpdate(next);
    setScheduleStatus(t.tr("Added task. Remember to Save.", "已添加任务。记得保存。"));
    window.setTimeout(() => setScheduleStatus(""), 1200);
  }

  async function fetchSchedule() {
    const out = await loadSchedule();
    const p = String(out?.path || "");
    setSchedulePath(p);
    const s = out?.schedule ?? { tasks: [] };
    setScheduleText(JSON.stringify(s, null, 2) + "\n");
  }

  async function reloadSchedule() {
    if (scheduleBusy) return;
    setScheduleBusy(true);
    setScheduleStatus(t.tr("Loading...", "加载中..."));
    try {
      await fetchSchedule();
      setScheduleStatus(t.tr("Loaded", "已加载"));
      window.setTimeout(() => setScheduleStatus(""), 900);
    } catch (e: any) {
      setScheduleStatus(String(e?.message || e));
    } finally {
      setScheduleBusy(false);
    }
  }

  async function saveSchedule() {
    if (scheduleBusy) return;
    const ok = await confirmDialog(t.tr(`Save schedule.json to daemon ${selectedDaemon?.id || "-"}?`, `保存 schedule.json 到 Daemon ${selectedDaemon?.id || "-"}？`), {
      title: t.tr("Save Scheduler", "保存定时任务"),
      confirmLabel: t.tr("Save", "保存"),
      cancelLabel: t.tr("Cancel", "取消"),
      danger: true,
    });
    if (!ok) return;

    setScheduleBusy(true);
    setScheduleStatus(t.tr("Saving...", "保存中..."));
    try {
      const out = await saveScheduleJson(scheduleText);
      setSchedulePath(String(out?.path || schedulePath));
      setScheduleStatus(t.tr("Saved", "已保存"));
      window.setTimeout(() => setScheduleStatus(""), 900);
    } catch (e: any) {
      setScheduleStatus(String(e?.message || e));
    } finally {
      setScheduleBusy(false);
    }
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const backupSchedulePreview = buildCronLikeSchedule();

  function nextRunLabel(task: any) {
    if (task?.enabled === false) return "-";
    const everyRaw = Number(task?.every_sec || 0);
    const atRaw = Number(task?.at_unix || 0);
    const last = Number(task?.last_run_unix || 0);
    if (Number.isFinite(everyRaw) && everyRaw > 0) {
      const every = Math.max(60, Math.round(everyRaw));
      const dueAt = last + every;
      if (nowUnix >= dueAt) return t.tr("Due", "已到期");
      return fmtUnix(dueAt);
    }
    if (Number.isFinite(atRaw) && atRaw > 0) {
      if (last < atRaw && nowUnix >= atRaw) return t.tr("Due", "已到期");
      if (last < atRaw) return fmtUnix(atRaw);
    }
    return "-";
  }

  function summarizeUserAgent(uaRaw: string) {
    const ua = String(uaRaw || "").trim();
    if (!ua) return t.tr("Unknown device", "未知设备");
    const u = ua.toLowerCase();

    let browser = "";
    if (u.includes("edg/")) browser = "Edge";
    else if (u.includes("opr/") || u.includes("opera")) browser = "Opera";
    else if (u.includes("chrome/") && !u.includes("chromium")) browser = "Chrome";
    else if (u.includes("chromium")) browser = "Chromium";
    else if (u.includes("firefox/")) browser = "Firefox";
    else if (u.includes("safari/") && u.includes("applewebkit") && !u.includes("chrome/")) browser = "Safari";
    else if (u.includes("curl/")) browser = "curl";

    let os = "";
    if (u.includes("windows nt")) os = "Windows";
    else if (u.includes("android")) os = "Android";
    else if (u.includes("iphone") || u.includes("ipad")) os = "iOS";
    else if (u.includes("mac os x")) os = "macOS";
    else if (u.includes("linux")) os = "Linux";

    const out = [browser, os].filter(Boolean).join(" · ");
    return out || t.tr("Unknown device", "未知设备");
  }

  const toc = useMemo(
    () => [
      { id: "panel-updates", label: t.tr("Updates", "更新") },
      { id: "panel-settings", label: t.tr("Panel", "面板") },
      { id: "panel-security-headers", label: t.tr("Security Headers", "安全响应头") },
      { id: "panel-users", label: t.tr("Users", "用户") },
      { id: "panel-tokens", label: t.tr("API Tokens", "API Tokens") },
      { id: "panel-tasks", label: t.tr("Tasks", "任务") },
      { id: "panel-sessions", label: t.tr("Sessions", "会话") },
      { id: "panel-activity", label: t.tr("Activity", "活动") },
      { id: "panel-audit", label: t.tr("Audit Log", "审计日志") },
    ],
    [t]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") return;
    const els = toc
      .map((x) => document.getElementById(x.id))
      .filter((x): x is HTMLElement => !!x);
    if (!els.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0))[0];
        if (best?.target instanceof HTMLElement) setActiveTocId(best.target.id);
      },
      { root: null, threshold: [0.01, 0.1, 0.25], rootMargin: "-20% 0px -70% 0px" }
    );

    for (const el of els) obs.observe(el);
    return () => obs.disconnect();
  }, [toc]);

  function scrollToPanelSection(id: string) {
    setActiveTocId(id);
    try {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      // ignore
    }
  }

  return (
    <div className="stack">
      <div className="panelLayout">
        <div className="card panelToc">
          <div className="hint">{t.tr("On this page", "本页导航")}</div>
          <div className="panelTocNav">
            {toc.map((x) => (
              <button
                key={x.id}
                type="button"
                className={["ghost", "panelTocBtn", x.id === activeTocId ? "active" : ""].filter(Boolean).join(" ")}
                onClick={() => scrollToPanelSection(x.id)}
                aria-current={x.id === activeTocId ? "location" : undefined}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>

        <div className="stack panelMain">
          <div className="card" id="panel-updates">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>{t.tr("Updates", "更新")}</h2>
              {updateStatus ? (
                <div className="hint">{updateStatus}</div>
              ) : updateInfo ? (
                <div className="hint">
                  {t.tr("latest", "最新")}: <code>{String(updateInfo?.latest?.version || "-")}</code>
                </div>
              ) : (
                <div className="hint">{t.tr("Manual check for newer releases.", "手动检查是否有新版本。")}</div>
              )}
            </div>
          </div>
          <div className="toolbarRight">
            <button type="button" className="iconBtn" onClick={() => checkUpdates({ force: true })} disabled={updateBusy}>
              {t.tr("Check updates", "检查更新")}
            </button>
          </div>
        </div>

        {updateInfo ? (
          <div className="grid2" style={{ alignItems: "start" }}>
            <div className="itemCard">
              <div className="hint">
                {t.tr("Panel", "面板")}: <code>{String(updateInfo?.panel?.current || "-")}</code>{" "}
                {updateInfo?.panel?.update_available ? <span className="badge warn">{t.tr("update", "可更新")}</span> : <span className="badge ok">{t.tr("ok", "正常")}</span>}
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {t.tr("Daemons outdated", "Daemon 过期")}: <code>{String(updateInfo?.daemons?.outdated_count || 0)}</code>
              </div>
            </div>
            <div className="itemCard">
              <div className="hint">
                {t.tr("Latest", "最新")}: <code>{String(updateInfo?.latest?.version || "-")}</code>
              </div>
              {updateInfo?.latest?.url ? (
                <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                  <code style={{ wordBreak: "break-all" }}>{String(updateInfo.latest.url)}</code>
                  <CopyButton
                    text={String(updateInfo.latest.url)}
                    label={t.tr("Copy URL", "复制 URL")}
                    tooltip={t.tr("Copy URL", "复制 URL")}
                    ariaLabel={t.tr("Copy URL", "复制 URL")}
                  />
                </div>
              ) : null}
              <div className="hint" style={{ marginTop: 6 }}>
                {t.tr("Tip", "提示")}:{" "}
                {t.tr("For docker compose deployments, run: docker compose pull && docker compose up -d", "如果使用 docker compose 部署：运行 docker compose pull && docker compose up -d")}
              </div>
            </div>
          </div>
        ) : (
          <div className="emptyState">
            <div style={{ fontWeight: 800 }}>{t.tr("No update info yet", "暂无更新信息")}</div>
            <div className="hint" style={{ marginTop: 6 }}>{t.tr("Click Check updates to fetch the latest release info.", "点击「检查更新」以获取最新版本信息。")}</div>
            <div className="btnGroup" style={{ justifyContent: "center", marginTop: 10 }}>
              <button type="button" className="primary" onClick={() => checkUpdates({ force: true })} disabled={updateBusy}>
                {t.tr("Check updates", "检查更新")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={["card", q ? "panelSettingsSearchActive" : ""].filter(Boolean).join(" ")} id="panel-settings">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>{t.tr("Panel", "面板")}</h2>
              {panelSettingsStatus ? <div className="hint">{panelSettingsStatus}</div> : null}
            </div>
          </div>
          <div className="toolbarRight">
            <input
              value={settingsQuery}
              onChange={(e) => setSettingsQuery(e.target.value)}
              placeholder={t.tr("Search settings…", "搜索设置…")}
              style={{ width: 220 }}
            />
            <button type="button" className="iconBtn" onClick={refreshPanelSettings}>
              {t.tr("Reload", "刷新")}
            </button>
          </div>
        </div>

        {!draft ? (
          <div className="emptyState">
            <div style={{ fontWeight: 800 }}>{t.tr("No settings loaded", "未加载设置")}</div>
            <div className="hint" style={{ marginTop: 6 }}>{t.tr("Click Reload to load current panel settings.", "点击「刷新」以加载面板设置。")}</div>
            <div className="btnGroup" style={{ justifyContent: "center", marginTop: 10 }}>
              <button type="button" className="primary" onClick={refreshPanelSettings}>
                {t.tr("Reload", "刷新")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid2 panelSettingsGrid">
              {showBrandSettings ? <div className="settingsSectionTitle">{t.tr("Brand", "品牌")}</div> : null}
              {show("brand name", "brand", "title", "sidebar") ? (
                <Field
                  label={t.tr("Brand Name", "品牌名称")}
                  hint={t.tr("Shown in sidebar and browser title.", "显示在侧边栏与浏览器标题")}
                >
                  <input value={String(draft.brand_name || "")} onChange={(e) => setDraft((d: any) => ({ ...d, brand_name: e.target.value }))} />
                </Field>
              ) : null}
              {show("brand tagline", "tagline") ? (
                <Field label={t.tr("Brand Tagline", "品牌标语")} hint={t.tr("Optional.", "可留空")}>
                  <input
                    value={String(draft.brand_tagline || "")}
                    onChange={(e) => setDraft((d: any) => ({ ...d, brand_tagline: e.target.value }))}
                  />
                </Field>
              ) : null}
              {show("logo", "logo url", "icon") ? (
                <Field
                  label={t.tr("Logo URL", "Logo URL")}
                  hint={t.tr("Default: /logo.svg (or a custom URL).", "默认：/logo.svg（可填自定义 URL）")}
                  style={{ gridColumn: "1 / -1" }}
                >
                  <input value={String(draft.logo_url || "")} onChange={(e) => setDraft((d: any) => ({ ...d, logo_url: e.target.value }))} />
                </Field>
              ) : null}

              {showCfSettings ? <div className="settingsSectionTitle">{t.tr("CurseForge", "CurseForge")}</div> : null}
              {show("curseforge", "api key", "cf_") ? (
                <Field
                  label={
                    <span className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "nowrap" }}>
                      <span>{t.tr("CurseForge API Key (optional)", "CurseForge API Key（可选）")}</span>
                      <EnvHelpButton env="ELEGANTMC_CURSEFORGE_API_KEY" doc="readme" />
                    </span>
                  }
                  hint={t.tr(
                    "After setting this, CurseForge search/install works without environment variables.",
                    "配置后可直接使用 CurseForge 搜索/下载安装（不需要再改环境变量）"
                  )}
                  style={{ gridColumn: "1 / -1" }}
                >
                  <input
                    type="password"
                    value={String(draft.curseforge_api_key || "")}
                    onChange={(e) => setDraft((d: any) => ({ ...d, curseforge_api_key: e.target.value }))}
                    placeholder="cf_..."
                    autoComplete="off"
                  />
                </Field>
              ) : null}

              {showDefaultsSettings ? <div className="settingsSectionTitle">{t.tr("Defaults", "默认值")}</div> : null}
              {show("default version", "version") ? (
                <Field label={t.tr("Default Version", "默认版本")}>
                  <input
                    value={String(draft.defaults?.version || "")}
                    onChange={(e) => setDraft((d: any) => ({ ...d, defaults: { ...(d.defaults || {}), version: e.target.value } }))}
                    placeholder="1.20.1"
                  />
                </Field>
              ) : null}
              {show("default game port", "port", "25565") ? (
                <Field label={t.tr("Default Game Port", "默认端口")}>
                  <input
                    type="number"
                    value={Number.isFinite(Number(draft.defaults?.game_port)) ? Number(draft.defaults.game_port) : 25565}
                    onChange={(e) => setDraft((d: any) => ({ ...d, defaults: { ...(d.defaults || {}), game_port: Number(e.target.value) } }))}
                    min={1}
                    max={65535}
                  />
                </Field>
              ) : null}
              {show("default memory", "memory", "xms", "xmx") ? (
                <Field label={t.tr("Default Memory", "默认内存")}>
                  <div className="row">
                    <input
                      value={String(draft.defaults?.xms || "")}
                      onChange={(e) => setDraft((d: any) => ({ ...d, defaults: { ...(d.defaults || {}), xms: e.target.value } }))}
                      placeholder="Xms (e.g. 1G)"
                    />
                    <input
                      value={String(draft.defaults?.xmx || "")}
                      onChange={(e) => setDraft((d: any) => ({ ...d, defaults: { ...(d.defaults || {}), xmx: e.target.value } }))}
                      placeholder="Xmx (e.g. 2G)"
                    />
                  </div>
                </Field>
              ) : null}
              {show("eula", "accept eula") ? (
                <Field label={t.tr("Default EULA", "默认同意 EULA")}>
                  <label className="checkRow">
                    <input
                      type="checkbox"
                      checked={draft.defaults?.accept_eula == null ? true : !!draft.defaults.accept_eula}
                      onChange={(e) =>
                        setDraft((d: any) => ({ ...d, defaults: { ...(d.defaults || {}), accept_eula: e.target.checked } }))
                      }
                    />
                    {t.tr("auto write eula.txt", "自动写入 eula.txt")}
                  </label>
                </Field>
              ) : null}
              {show("frp", "default frp") ? (
                <Field label={t.tr("Default FRP", "默认启用 FRP")}>
                  <label className="checkRow">
                    <input
                      type="checkbox"
                      checked={draft.defaults?.enable_frp == null ? true : !!draft.defaults.enable_frp}
                      onChange={(e) =>
                        setDraft((d: any) => ({ ...d, defaults: { ...(d.defaults || {}), enable_frp: e.target.checked } }))
                      }
                    />
                    {t.tr("enable by default", "默认启用")}
                  </label>
                </Field>
              ) : null}
              {show("frp remote port", "remote port", "25566") ? (
                <Field label={t.tr("Default FRP Remote Port", "默认 FRP Remote Port")} hint={t.tr("0 means server-assigned.", "0 表示由服务端分配")}>
                  <input
                    type="number"
                    value={Number.isFinite(Number(draft.defaults?.frp_remote_port)) ? Number(draft.defaults.frp_remote_port) : 25566}
                    onChange={(e) => setDraft((d: any) => ({ ...d, defaults: { ...(d.defaults || {}), frp_remote_port: Number(e.target.value) } }))}
                    min={0}
                    max={65535}
                  />
                </Field>
              ) : null}
            </div>

            <div className="btnGroup" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button type="button" className="primary" onClick={() => savePanelSettings(draft)}>
                {t.tr("Save", "保存")}
              </button>
            </div>
          </>
	        )}
	      </div>

      <div className="card" id="panel-security-headers">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>
                {t.tr("Security Headers", "安全响应头")}
                <EnvHelpButton
                  env={["ELEGANTMC_PANEL_HSTS_PRESET", "ELEGANTMC_PANEL_CSP_PRESET", "ELEGANTMC_PANEL_REFERRER_POLICY_PRESET"]}
                  doc="security"
                />
              </h2>
              {securityHeadersBusy ? (
                <div className="hint">{t.tr("Loading...", "加载中...")}</div>
              ) : securityHeadersStatus ? (
                <div className="hint">{securityHeadersStatus}</div>
              ) : (
                <div className="hint">{t.tr("Current HTTP response headers computed from env.", "当前根据环境变量计算出的响应头配置。")}</div>
              )}
            </div>
          </div>
            <div className="toolbarRight">
              <button type="button" className="iconBtn" onClick={refreshSecurityHeaders} disabled={securityHeadersBusy}>
                {t.tr("Refresh", "刷新")}
              </button>
            </div>
          </div>

          {securityHeaders ? (
            <div className="grid2" style={{ alignItems: "start" }}>
              <div className="itemCard">
                <div className="hint">{t.tr("Referrer-Policy", "Referrer-Policy")}</div>
                <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                  <code style={{ wordBreak: "break-all" }}>{String(securityHeaders?.referrer_policy?.value || "-")}</code>
                  <CopyButton
                    text={String(securityHeaders?.referrer_policy?.value || "")}
                    iconOnly
                    tooltip={t.tr("Copy value", "复制值")}
                    ariaLabel={t.tr("Copy value", "复制值")}
                  />
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  {t.tr("preset", "预设")}: <code>{String(securityHeaders?.referrer_policy?.preset || "-")}</code>
                </div>
              </div>

              <div className="itemCard">
                <div className="hint">{t.tr("HSTS", "HSTS")}</div>
                <div className="hint" style={{ marginTop: 6 }}>
                  {t.tr("preset", "预设")}: <code>{String(securityHeaders?.hsts?.preset || "off")}</code>{" "}
                  {securityHeaders?.hsts?.enabled ? <span className="badge ok">{t.tr("on", "开启")}</span> : <span className="badge">{t.tr("off", "关闭")}</span>}
                </div>
                {securityHeaders?.hsts?.enabled ? (
                  <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                    <code style={{ wordBreak: "break-all" }}>{String(securityHeaders?.hsts?.value || "")}</code>
                    <CopyButton
                      text={String(securityHeaders?.hsts?.value || "")}
                      iconOnly
                      tooltip={t.tr("Copy value", "复制值")}
                      ariaLabel={t.tr("Copy value", "复制值")}
                    />
                  </div>
                ) : (
                  <div className="hint" style={{ marginTop: 6 }}>{t.tr("Disabled", "未启用")}</div>
                )}
              </div>

              <div className="itemCard" style={{ gridColumn: "1 / -1" }}>
                <div className="hint">{t.tr("CSP", "CSP")}</div>
                <div className="hint" style={{ marginTop: 6 }}>
                  {t.tr("preset", "预设")}: <code>{String(securityHeaders?.csp?.preset || "default")}</code>{" "}
                  {securityHeaders?.csp?.enabled ? <span className="badge ok">{t.tr("on", "开启")}</span> : <span className="badge">{t.tr("off", "关闭")}</span>}
                </div>
                {securityHeaders?.csp?.enabled ? (
                  <>
                    <div className="hint" style={{ marginTop: 6 }}>
                      {t.tr("header", "头")}: <code>{String(securityHeaders?.csp?.header_name || "Content-Security-Policy")}</code>
                    </div>
                    <pre className="codeBlock" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                      {String(securityHeaders?.csp?.value || "")}
                    </pre>
                    <div className="btnGroup" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                      <CopyButton text={String(securityHeaders?.csp?.value || "")} />
                    </div>
                  </>
                ) : (
                  <div className="hint" style={{ marginTop: 6 }}>{t.tr("Disabled", "未启用")}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="emptyState" style={{ marginTop: 12 }}>
              {securityHeadersBusy ? t.tr("Loading...", "加载中...") : securityHeadersStatus ? securityHeadersStatus : t.tr("No data.", "暂无数据。")}
            </div>
          )}
        </div>

	      <div className="card" id="panel-users">
	        <div className="toolbar">
	          <div className="toolbarLeft" style={{ alignItems: "center" }}>
	            <div>
              <h2>{t.tr("Users", "用户")}</h2>
              {usersStatus ? <div className="hint">{usersStatus}</div> : <div className="hint">{t.tr("Manage admin users.", "管理管理员用户。")}</div>}
            </div>
          </div>
          <div className="toolbarRight">
            <button type="button" className="iconBtn" onClick={refreshUsers} disabled={usersBusy}>
              {t.tr("Refresh", "刷新")}
            </button>
          </div>
        </div>

        <div className="grid2" style={{ alignItems: "end" }}>
          <Field label={t.tr("username", "用户名")} hint={t.tr("A-Z a-z 0-9 . _ - (max 32)", "A-Z a-z 0-9 . _ -（最长 32）")}>
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="alice" autoCapitalize="none" autoCorrect="off" />
          </Field>
          <Field label={t.tr("password", "密码")} hint={passwordHint}>
            <input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="••••••••" />
          </Field>
        </div>
        <div className="btnGroup" style={{ marginTop: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="primary"
            onClick={createUserNow}
            disabled={usersBusy || !newUsername.trim() || !newUserPassword.trim() || (passwordPolicy ? newUserPassword.length < passwordMinLen : false)}
          >
            {t.tr("Create user", "创建用户")}
          </button>
        </div>

        {users.length ? (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t.tr("Username", "用户名")}</th>
                <th>{t.tr("2FA", "2FA")}</th>
                <th>{t.tr("Created", "创建")}</th>
                <th>{t.tr("Updated", "更新")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => {
                const id = String(u?.id || "").trim();
                const username = String(u?.username || "").trim() || "-";
                const createdUnix = u?.created_at_unix ? Number(u.created_at_unix) : 0;
                const updatedUnix = u?.updated_at_unix ? Number(u.updated_at_unix) : 0;
                const totp = !!u?.totp_enabled;
                const isSelf = !!authMe?.user_id && String(authMe.user_id) === id;
                return (
                  <tr key={id || username}>
                    <td style={{ minWidth: 220 }}>
                      <code>{username}</code>
                    </td>
                    <td>{totp ? <span className="badge ok">{t.tr("on", "开启")}</span> : <span className="badge">{t.tr("off", "关闭")}</span>}</td>
                    <td>{createdUnix ? <TimeAgo unix={createdUnix} /> : "-"}</td>
                    <td>{updatedUnix ? <TimeAgo unix={updatedUnix} /> : "-"}</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="btnGroup" style={{ justifyContent: "flex-end" }}>
                        {isSelf && !totp ? (
                          <button type="button" onClick={openTotpSetup} disabled={usersBusy}>
                            {t.tr("Enable 2FA…", "开启 2FA…")}
                          </button>
                        ) : null}
                        {totp ? (
                          <button type="button" className="dangerBtn" onClick={() => disableTotpNow(u)} disabled={usersBusy || !id}>
                            {t.tr("Disable 2FA", "关闭 2FA")}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => openResetPassword(u)} disabled={usersBusy || !id}>
                          {t.tr("Reset password", "重置密码")}
                        </button>
                        <button type="button" className="dangerBtn" onClick={() => deleteUserNow(u)} disabled={usersBusy || !id || users.length <= 1}>
                          {t.tr("Delete", "删除")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="emptyState">{t.tr("No users.", "暂无用户。")}</div>
        )}
      </div>

      <div className="card" id="panel-tokens">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>{t.tr("API Tokens", "API Tokens")}</h2>
              {apiTokensStatus ? <div className="hint">{apiTokensStatus}</div> : <div className="hint">{t.tr("Use tokens for automation (Authorization: Bearer ...).", "用于自动化（Authorization: Bearer ...）。")}</div>}
            </div>
          </div>
          <div className="toolbarRight">
            <button type="button" className="iconBtn" onClick={refreshApiTokens} disabled={apiTokensBusy}>
              {t.tr("Refresh", "刷新")}
            </button>
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <Field label={t.tr("name", "名称")} style={{ minWidth: 260, flex: 1 }}>
            <input value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} placeholder={t.tr("e.g. backup-bot", "例如 backup-bot")} />
          </Field>
          <div className="btnGroup" style={{ alignSelf: "end", justifyContent: "flex-end" }}>
            <button type="button" className="primary" onClick={createApiTokenNow} disabled={apiTokensBusy}>
              {t.tr("Create token", "创建 token")}
            </button>
          </div>
        </div>

        {createdToken ? (
          <div className="itemCard" style={{ marginTop: 12 }}>
            <div className="hint">{t.tr("New token (copy now; it won't be shown again):", "新 token（请立即复制；不会再次显示）：")}</div>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 6 }}>
              <code style={{ wordBreak: "break-all" }}>{createdToken}</code>
              <div className="btnGroup" style={{ justifyContent: "flex-end" }}>
                <CopyButton text={createdToken} />
                <button type="button" onClick={() => setCreatedToken("")}>
                  {t.tr("Hide", "隐藏")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "end" }}>
          <Field
            label={t.tr("Search", "搜索")}
            hint={
              apiTokens.length
                ? t.tr(`Showing ${filteredApiTokens.length} of ${apiTokens.length}`, `显示 ${filteredApiTokens.length}/${apiTokens.length}`)
                : t.tr("No tokens yet.", "暂无 token。")
            }
            style={{ minWidth: 260, flex: 1 }}
          >
            <input
              value={apiTokenQuery}
              onChange={(e) => setApiTokenQuery(e.target.value)}
              placeholder={t.tr("Search by name or fingerprint…", "按名称或指纹搜索…")}
            />
          </Field>
          <div className="hint" style={{ alignSelf: "end" }}>
            {t.tr("Treat tokens like passwords.", "Token 相当于密码，请妥善保管。")}
          </div>
        </div>

        {filteredApiTokens.length ? (
          <div className="grid2" style={{ marginTop: 12, alignItems: "start" }}>
            {filteredApiTokens.map((tok: any) => {
              const id = String(tok?.id || "").trim();
              const fp = String(tok?.fingerprint || "").trim();
              const name = String(tok?.name || "").trim() || t.tr("Unnamed token", "未命名 token");
              const createdUnix = tok?.created_at_unix ? Number(tok.created_at_unix) : 0;
              const lastUsedUnix = tok?.last_used_at_unix ? Number(tok.last_used_at_unix) : 0;
              const masked = fp ? `emc_••••••••••••••••••••-${fp}` : "emc_••••••••••••••••••••";
              const stale = lastUsedUnix > 0 && nowUnix - lastUsedUnix > 60 * 60 * 24 * 30;
              return (
                <div key={id || fp || name} className="itemCard">
                  <div className="itemCardHeader">
                    <div style={{ minWidth: 0 }}>
                      <div className="itemTitle">{name}</div>
                      <div className="itemMeta">
                        {t.tr("Created", "创建")}: {createdUnix ? <TimeAgo unix={createdUnix} /> : "-"} · {t.tr("Last used", "最近使用")}:{" "}
                        {lastUsedUnix ? <TimeAgo unix={lastUsedUnix} /> : t.tr("Never", "从未")}
                      </div>
                    </div>
                    <div className="itemActions">
                      {!lastUsedUnix ? <span className="badge warn">{t.tr("never used", "从未使用")}</span> : stale ? <span className="badge">{t.tr("stale", "长期未用")}</span> : null}
                      <button type="button" className="dangerBtn" onClick={() => revokeApiTokenNow(id)} disabled={apiTokensBusy || !id}>
                        {t.tr("Revoke", "撤销")}
                      </button>
                    </div>
                  </div>

                  <div className="grid2" style={{ alignItems: "start" }}>
                    <div className="kv">
                      <div className="k">{t.tr("Token (masked)", "Token（隐藏）")}</div>
                      <div className="v">
                        <code style={{ wordBreak: "break-all" }}>{masked}</code>
                      </div>
                    </div>
                    <div className="kv">
                      <div className="k">{t.tr("Fingerprint", "指纹")}</div>
                      <div className="v">
                        <code>{fp || "-"}</code>
                        <CopyButton
                          text={fp || ""}
                          iconOnly
                          tooltip={t.tr("Copy fingerprint", "复制指纹")}
                          ariaLabel={t.tr("Copy fingerprint", "复制指纹")}
                          disabled={!fp}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : apiTokens.length ? (
          <div className="emptyState">{t.tr("No matches.", "没有匹配项。")}</div>
        ) : (
          <div className="emptyState">{t.tr("No tokens.", "暂无 tokens。")}</div>
        )}
      </div>

      <div className="card" id="panel-tasks">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>{t.tr("Scheduler", "定时任务")}</h2>
              {scheduleStatus ? (
                <div className="hint">{scheduleStatus}</div>
              ) : (
                <div className="hint">{t.tr("Edit daemon schedule.json (scheduler tasks)", "编辑 daemon schedule.json（定时任务）")}</div>
              )}
              <div className="hint" style={{ marginTop: 6 }}>
                {t.tr("daemon", "daemon")}: <code>{selectedDaemon?.id || "-"}</code> · {t.tr("file", "文件")}:{" "}
                <code>{schedulePath || t.tr("(unknown)", "(未知)")}</code>
              </div>
            </div>
          </div>
          <div className="toolbarRight">
            <button type="button" className="iconBtn" onClick={reloadSchedule} disabled={!selectedDaemon?.connected || scheduleBusy}>
              {t.tr("Reload", "刷新")}
            </button>
            <button type="button" className="primary iconBtn" onClick={saveSchedule} disabled={!selectedDaemon?.connected || scheduleBusy || !parsedSchedule.ok}>
              {t.tr("Save", "保存")}
            </button>
          </div>
        </div>

        {!parsedSchedule.ok ? (
          <div className="fieldError">
            {t.tr("JSON parse error", "JSON 解析错误")}: {parsedSchedule.error}
          </div>
        ) : null}

        <div className="cardSub" style={{ marginTop: 10 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700 }}>{t.tr("Task Templates", "任务模板")}</div>
              <div className="hint">{t.tr("Add common tasks without hand-editing JSON.", "无需手改 JSON，快速添加常用任务。")}</div>
            </div>
            <button type="button" onClick={addTemplateTask} disabled={!selectedDaemon?.connected || scheduleBusy || !parsedSchedule.ok}>
              {t.tr("Add task", "添加任务")}
            </button>
	          </div>
	          <div className="grid2" style={{ marginTop: 10, alignItems: "end" }}>
	            <Field label={t.tr("Template", "模板")}>
	              <Select
	                value={templateKind}
	                onChange={(v) => setTemplateKind((v as any) || "backup")}
	                options={[
	                  { value: "backup", label: t.tr("Backup", "备份") },
	                  { value: "restart", label: t.tr("Restart", "重启") },
	                  { value: "stop", label: t.tr("Stop", "停止") },
	                  { value: "prune_logs", label: t.tr("Prune logs", "清理日志") },
	                  { value: "announce", label: t.tr("Announce", "公告") },
	                ]}
	              />
	            </Field>
	            <Field label={t.tr("Instance", "实例")}>
	              {Array.isArray(serverDirs) && serverDirs.length ? (
	                <Select
	                  value={backupPresetInstanceId}
	                  onChange={(v: string) => setBackupPresetInstanceId(v)}
	                  options={serverDirs.map((s: any) => ({ value: String(s || ""), label: String(s || "") }))}
	                  placeholder={t.tr("Select instance…", "选择实例…")}
	                />
	              ) : (
	                <input
	                  value={backupPresetInstanceId}
	                  onChange={(e) => setBackupPresetInstanceId(e.target.value)}
	                  placeholder={t.tr("instance_id (e.g. server1)", "instance_id（例如 server1）")}
	                />
	              )}
	            </Field>
	
	            <Field
	              label={t.tr("Schedule", "时间")}
	              hint={
	                <>
	                  {t.tr("Next run", "下次运行")}: <code><TimeAgo unix={Number(backupSchedulePreview.next_run_unix || nowUnix)} /></code> ·{" "}
	                  <span className="muted">
	                    {t.tr("cron (ref)", "cron（参考）")}: <code>{String(backupSchedulePreview.cron || "-")}</code>
	                  </span>
	                </>
	              }
	            >
	              <Select
	                value={backupPresetScheduleKind}
	                onChange={(v) => setBackupPresetScheduleKind((v as any) || "daily")}
	                options={[
	                  { value: "daily", label: t.tr("Daily at…", "每天在…") },
	                  { value: "weekly", label: t.tr("Weekly at…", "每周在…") },
	                  { value: "interval", label: t.tr("Interval", "固定间隔") },
	                ]}
	              />
	              {backupPresetScheduleKind === "interval" ? (
	                <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
	                  <input
                    type="number"
                    min={1}
                    max={24 * 365}
                    step={1}
                    value={backupPresetEveryHours}
                    onChange={(e) => setBackupPresetEveryHours(Math.max(1, Math.round(Number(e.target.value))))}
                  />
                  <span className="muted">{t.tr("hours", "小时")}</span>
                </div>
              ) : backupPresetScheduleKind === "weekly" ? (
                <div style={{ marginTop: 8 }}>
                  <div className="row" style={{ alignItems: "center" }}>
                    <Select
                      value={String(backupPresetWeekday)}
                      onChange={(v) => setBackupPresetWeekday(Math.max(0, Math.min(6, Math.round(Number(v)))))}
                      options={[
                        { value: "1", label: t.tr("Mon", "周一") },
                        { value: "2", label: t.tr("Tue", "周二") },
                        { value: "3", label: t.tr("Wed", "周三") },
                        { value: "4", label: t.tr("Thu", "周四") },
                        { value: "5", label: t.tr("Fri", "周五") },
                        { value: "6", label: t.tr("Sat", "周六") },
                        { value: "0", label: t.tr("Sun", "周日") },
                      ]}
                    />
                    <input
                      type="number"
                      min={0}
                      max={23}
                      step={1}
                      value={backupPresetAtHour}
                      onChange={(e) => setBackupPresetAtHour(Math.max(0, Math.min(23, Math.round(Number(e.target.value)))))}
                      style={{ width: 86 }}
                    />
                    <span className="muted">:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={1}
                      value={backupPresetAtMinute}
                      onChange={(e) => setBackupPresetAtMinute(Math.max(0, Math.min(59, Math.round(Number(e.target.value)))))}
                      style={{ width: 86 }}
                    />
                  </div>
                </div>
              ) : (
                <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    value={backupPresetAtHour}
                    onChange={(e) => setBackupPresetAtHour(Math.max(0, Math.min(23, Math.round(Number(e.target.value)))))}
                  />
                  <span className="muted">:</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    step={1}
                    value={backupPresetAtMinute}
                    onChange={(e) => setBackupPresetAtMinute(Math.max(0, Math.min(59, Math.round(Number(e.target.value)))))}
	                  />
	                </div>
	              )}
	            </Field>

            {templateKind === "backup" ? (
              <>
                <Field label={t.tr("Keep last (0 = no prune)", "保留数量（0 = 不清理）")}>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={backupPresetKeepLast}
                    onChange={(e) => setBackupPresetKeepLast(Math.max(0, Math.round(Number(e.target.value))))}
                  />
                </Field>
                <Field label={t.tr("Options", "选项")}>
                  <label className="checkRow">
                    <input type="checkbox" checked={backupPresetStopServer} onChange={(e) => setBackupPresetStopServer(e.target.checked)} />
                    {t.tr("Stop server before backup (recommended)", "备份前停止服务器（推荐）")}
                  </label>
                </Field>
              </>
            ) : null}

            {templateKind === "prune_logs" ? (
              <Field
                label={t.tr("Keep last logs", "保留日志数量")}
                hint={t.tr("Keeps newest files in logs/ and deletes older ones.", "保留 logs/ 下最新的文件，删除更旧的。")}
              >
                <input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={pruneLogsKeepLast}
                  onChange={(e) => setPruneLogsKeepLast(Math.max(1, Math.round(Number(e.target.value))))}
                />
              </Field>
            ) : null}

            {templateKind === "announce" ? (
              <Field label={t.tr("Message", "消息")} hint={t.tr("Sends: say <message>", "将执行：say <消息>")} style={{ gridColumn: "1 / -1" }}>
                <input
                  value={announceMessage}
                  onChange={(e) => setAnnounceMessage(e.target.value)}
                  maxLength={400}
                  placeholder={t.tr("e.g. Server will restart in 5 minutes", "例如：服务器将在 5 分钟后重启")}
                />
              </Field>
            ) : null}

            <Field hint={t.tr("Tip: Save updates schedule.json on the daemon.", "提示：点击 Save 才会写入 daemon 的 schedule.json。")} style={{ gridColumn: "1 / -1" }}>
              {null}
            </Field>
          </div>
        </div>

        <textarea
          value={scheduleText}
          onChange={(e) => setScheduleText(e.target.value)}
          rows={14}
          placeholder='{"tasks":[{"id":"daily-backup","type":"backup","instance_id":"server1","every_sec":86400,"keep_last":7},{"id":"daily-restart","type":"restart","instance_id":"server1","every_sec":86400}]}'
          style={{ width: "100%", marginTop: 10 }}
          disabled={!selectedDaemon?.connected}
        />

        {parsedSchedule.ok && Array.isArray((parsedSchedule as any).schedule?.tasks) ? (
          <div style={{ marginTop: 12 }}>
	            <h3>{t.tr("Tasks", "任务")}</h3>
	            <table>
	              <thead>
	                <tr>
	                  <th>{t.tr("ID", "ID")}</th>
	                  <th>{t.tr("Type", "类型")}</th>
	                  <th>{t.tr("Instance", "实例")}</th>
	                  <th>{t.tr("Every", "间隔")}</th>
	                  <th>{t.tr("At", "时间")}</th>
	                  <th>{t.tr("Next run", "下次运行")}</th>
	                  <th>{t.tr("Last run", "上次运行")}</th>
	                  <th>{t.tr("Error", "错误")}</th>
	                  <th />
	                </tr>
	              </thead>
              <tbody>
                {((parsedSchedule as any).schedule?.tasks || []).map((t: any) => (
                  <tr key={String(t.id || t.instance_id || t.type || "")}>
                    <td>
                      <code>{String(t.id || "-")}</code>
                    </td>
                    <td>{String(t.type || "-")}</td>
                    <td>
                      <code>{String(t.instance_id || "-")}</code>
	                    </td>
	                    <td>{t.every_sec ? `${Number(t.every_sec)}s` : "-"}</td>
	                    <td>{t.at_unix ? <TimeAgo unix={Number(t.at_unix)} /> : "-"}</td>
	                    <td>{nextRunLabel(t)}</td>
	                    <td>{t.last_run_unix ? <TimeAgo unix={Number(t.last_run_unix)} /> : "-"}</td>
	                    <td style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
	                      {String(t.last_error || "")}
	                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={async () => {
                          const id = String(t.id || "").trim();
                          if (!id) return;
                          const ok = await confirmDialog(t.tr(`Run task "${id}" now?`, `立即运行任务「${id}」？`), {
                            title: t.tr("Run Task", "运行任务"),
                            confirmLabel: t.tr("Run", "运行"),
                            cancelLabel: t.tr("Cancel", "取消"),
                            danger: ["restart", "stop", "prune_logs"].includes(String(t.type || "").toLowerCase()),
                          });
                          if (!ok) return;
                          setScheduleBusy(true);
                          setScheduleStatus(t.tr(`Running ${id} ...`, `正在运行 ${id} ...`));
                          try {
                            await runScheduleTask(id);
                            await fetchSchedule();
                            setScheduleStatus(t.tr("Done", "完成"));
                            window.setTimeout(() => setScheduleStatus(""), 900);
                          } catch (e: any) {
                            setScheduleStatus(String(e?.message || e));
                          } finally {
                            setScheduleBusy(false);
                          }
                        }}
                        disabled={!selectedDaemon?.connected || scheduleBusy}
                      >
                        {t.tr("Run now", "立即运行")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint" style={{ marginTop: 8 }}>
              {t.tr(
                "Note: Scheduler runs on the daemon (polls schedule.json). Save updates the file; Run now triggers a single task immediately.",
                "提示：Scheduler 运行在 Daemon 上（轮询 schedule.json）。Save 会更新文件；Run now 立即触发单个任务。"
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="card" id="panel-sessions">
        <div className="toolbar">
          <div className="toolbarLeft" style={{ alignItems: "center" }}>
            <div>
              <h2>{t.tr("Sessions", "会话")}</h2>
              {sessionsStatus ? <div className="hint">{sessionsStatus}</div> : <div className="hint">{t.tr("Manage active admin sessions.", "管理当前已登录的管理员会话。")}</div>}
            </div>
          </div>
          <div className="toolbarRight">
            <button type="button" className="iconBtn" onClick={refreshSessions} disabled={sessionsBusy}>
              {t.tr("Refresh", "刷新")}
            </button>
            <button type="button" onClick={() => revokeAllSessions(true)} disabled={sessionsBusy || sessions.length <= 1}>
              {t.tr("Revoke others", "撤销其他")}
            </button>
            <button type="button" className="dangerBtn" onClick={() => revokeAllSessions(false)} disabled={sessionsBusy || sessions.length === 0}>
              {t.tr("Revoke all", "撤销全部")}
            </button>
            <button
              type="button"
              className="dangerBtn"
              onClick={() => {
                setRotateSecretConfirm("");
                setRotateSecretStatus("");
                setRotateSecretOpen(true);
              }}
              disabled={rotateSecretBusy}
            >
              {t.tr("Rotate secret…", "轮换 secret…")}
            </button>
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "end" }}>
          <Field
            label={t.tr("Search", "搜索")}
            hint={
              sessions.length
                ? t.tr(`Showing ${filteredSessions.length} of ${sessions.length}`, `显示 ${filteredSessions.length}/${sessions.length}`)
                : t.tr("No sessions yet.", "暂无会话。")
            }
            style={{ minWidth: 260, flex: 1 }}
          >
            <input
              value={sessionsQuery}
              onChange={(e) => setSessionsQuery(e.target.value)}
              placeholder={t.tr("Search by user, IP, or device…", "按用户、IP 或设备搜索…")}
            />
          </Field>
          <div className="hint" style={{ alignSelf: "end" }}>
            {t.tr("Revoke sessions you don't recognize.", "撤销你不认识的会话。")}
          </div>
        </div>

        {filteredSessions.length ? (
          <div className="cardGrid" style={{ marginTop: 12 }}>
            {filteredSessions.map((s: any) => {
              const id = String(s?.id || "").trim();
              const masked = String(s?.token_masked || "").trim() || "-";
              const user = String(s?.username || s?.user_id || "").trim() || "-";
              const createdUnix = s?.created_at_unix ? Number(s.created_at_unix) : 0;
              const lastSeenUnix = s?.last_seen_at_unix ? Number(s.last_seen_at_unix) : 0;
              const expiresUnix = s?.expires_at_unix ? Number(s.expires_at_unix) : 0;
              const ip = String(s?.ip || "").trim();
              const ua = String(s?.user_agent || "").trim();
              const device = summarizeUserAgent(ua);
              const current = !!s?.current;
              const uaShort = ua.length > 90 ? `${ua.slice(0, 90)}…` : ua;

              return (
                <div key={id || masked} className={`itemCard sessionCard ${current ? "current" : ""}`}>
                  <div className="itemCardHeader">
                    <div style={{ minWidth: 0 }}>
                      <div className="itemTitle">
                        <code>{masked}</code>
                      </div>
                      <div className="itemMeta">
                        {device}
                        {ip ? ` · ${ip}` : ""}
                      </div>
                    </div>
                    <div className="itemActions">
                      {current ? <span className="badge ok">{t.tr("current", "当前")}</span> : null}
                      <button type="button" className="dangerBtn" onClick={() => revokeSession(id, masked)} disabled={sessionsBusy || !id}>
                        {t.tr("Revoke", "撤销")}
                      </button>
                    </div>
                  </div>

                  <div className="grid2" style={{ alignItems: "start" }}>
                    <div className="kv">
                      <div className="k">{t.tr("User", "用户")}</div>
                      <div className="v">
                        <code>{user}</code>
                      </div>
                    </div>
                    <div className="kv">
                      <div className="k">{t.tr("IP", "IP")}</div>
                      <div className="v">
                        <code>{ip || "-"}</code>
                        <CopyButton text={ip} iconOnly tooltip={t.tr("Copy IP", "复制 IP")} ariaLabel={t.tr("Copy IP", "复制 IP")} disabled={!ip} />
                      </div>
                    </div>
                    <div className="kv">
                      <div className="k">{t.tr("Created", "创建")}</div>
                      <div className="v">{createdUnix ? <TimeAgo unix={createdUnix} /> : "-"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">{t.tr("Last seen", "最近访问")}</div>
                      <div className="v">{lastSeenUnix ? <TimeAgo unix={lastSeenUnix} /> : "-"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">{t.tr("Expires", "过期")}</div>
                      <div className="v">{expiresUnix ? <TimeAgo unix={expiresUnix} /> : "-"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">{t.tr("User agent", "User Agent")}</div>
                      <div className="v">
                        <code title={ua}>{uaShort || "-"}</code>
                        <CopyButton
                          text={ua}
                          iconOnly
                          tooltip={t.tr("Copy user agent", "复制 User Agent")}
                          ariaLabel={t.tr("Copy user agent", "复制 User Agent")}
                          disabled={!ua}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : sessions.length ? (
          <div className="emptyState">{t.tr("No matches.", "没有匹配项。")}</div>
	        ) : (
	          <div className="emptyState">{t.tr("No sessions found.", "暂无会话。")}</div>
	        )}
	      </div>

        <div className="card" id="panel-activity">
          <div className="toolbar">
            <div className="toolbarLeft" style={{ alignItems: "center" }}>
              <div>
                <h2>{t.tr("Activity", "活动")}</h2>
                <div className="hint">{t.tr("Merged feed of toast notifications + server audit entries.", "合并显示通知（toasts）与服务端审计日志。")}</div>
              </div>
            </div>
            <div className="toolbarRight">
              <button type="button" className="iconBtn" onClick={refreshAudit} disabled={auditBusy}>
                {t.tr("Refresh audit", "刷新审计")}
              </button>
              <CopyButton
                text={activityExportJson}
                disabled={!activityItems.length}
                label={t.tr("Copy JSON", "复制 JSON")}
                tooltip={t.tr("Copy JSON", "复制 JSON")}
                ariaLabel={t.tr("Copy JSON", "复制 JSON")}
              />
              <button type="button" className="iconBtn" onClick={exportActivityJson} disabled={!activityItems.length}>
                {t.tr("Export JSON", "导出 JSON")}
              </button>
            </div>
          </div>

          <div className="grid2" style={{ alignItems: "end", marginTop: 12 }}>
            <Field label={t.tr("Source", "来源")}>
              <Select
                value={activitySource}
                onChange={(v) => setActivitySource((String(v || "") as any) || "all")}
                options={[
                  { value: "all", label: t.tr("All", "全部") },
                  { value: "notifications", label: t.tr("Notifications", "通知") },
                  { value: "audit", label: t.tr("Audit", "审计") },
                ]}
              />
            </Field>
            <Field label={t.tr("Toast kind", "通知类型")}>
              <Select
                value={activityToastKind}
                onChange={(v) => setActivityToastKind((String(v || "") as any) || "all")}
                disabled={activitySource === "audit"}
                options={[
                  { value: "all", label: t.tr("All", "全部") },
                  { value: "info", label: t.tr("Info", "信息") },
                  { value: "ok", label: t.tr("OK", "成功") },
                  { value: "error", label: t.tr("Error", "错误") },
                ]}
              />
            </Field>
            <Field label={t.tr("Time range", "时间范围")} hint={t.tr("Same as Audit Log.", "与审计日志一致。")}>
              <Select
                value={auditRange}
                onChange={(v) => setAuditRange(String(v || ""))}
                options={[
                  { value: "1h", label: t.tr("Last 1h", "最近 1 小时") },
                  { value: "24h", label: t.tr("Last 24h", "最近 24 小时") },
                  { value: "7d", label: t.tr("Last 7d", "最近 7 天") },
                  { value: "30d", label: t.tr("Last 30d", "最近 30 天") },
                  { value: "all", label: t.tr("All", "全部") },
                ]}
              />
            </Field>
            <Field label={t.tr("Limit", "数量")}>
              <Select
                value={activityLimit}
                onChange={(v) => setActivityLimit(String(v || ""))}
                options={[
                  { value: "100", label: "100" },
                  { value: "200", label: "200" },
                  { value: "500", label: "500" },
                  { value: "1000", label: "1000" },
                ]}
              />
            </Field>
            <Field label={t.tr("Search", "搜索")} hint={t.tr("Matches message/action/user/detail.", "匹配消息/动作/用户/详情。")} style={{ gridColumn: "1 / -1" }}>
              <input value={activityQuery} onChange={(e) => setActivityQuery(e.target.value)} placeholder={t.tr("Type to filter…", "输入以筛选…")} />
            </Field>
          </div>

          {activityItems.length ? (
            <div className="tableScroll" style={{ marginTop: 12, maxHeight: 520, overflow: "auto" }}>
              <table className="compact">
                <thead>
                  <tr>
                    <th>{t.tr("Time", "时间")}</th>
                    <th>{t.tr("Source", "来源")}</th>
                    <th>{t.tr("Summary", "摘要")}</th>
                    <th>{t.tr("Detail", "详情")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {activityItems.map((x: any, idx: number) => {
                    const ts = Number(x?.ts_unix || 0);
                    const src = String(x?.source || "");
                    const isAudit = src === "audit";
                    const toastKind = String(x?.kind || "info");
                    const title = isAudit ? String(x?.action || "-") : String(x?.message || "-");
                    const user = isAudit ? String(x?.user || "-") : "";
                    const detailStr = isAudit ? (x?.detail ? JSON.stringify(x.detail) : "") : String(x?.detail || "");
                    const detailShort = detailStr.length > 160 ? `${detailStr.slice(0, 160)}…` : detailStr || "-";
                    const rowJson = JSON.stringify(x?.raw || x, null, 2);
                    const srcBadge = isAudit ? t.tr("audit", "审计") : t.tr("toast", "通知");
                    const kindBadgeClass = toastKind === "error" ? "warn" : toastKind === "ok" ? "ok" : "";
                    const toastBadge = isAudit ? null : (
                      <span className={`badge ${kindBadgeClass}`.trim()}>{toastKind || "info"}</span>
                    );
                    return (
                      <tr key={`${src}-${ts}-${idx}`}>
                        <td style={{ whiteSpace: "nowrap" }}>{ts ? <TimeAgo unix={ts} /> : "-"}</td>
                        <td>
                          <span className={`badge ${isAudit ? "warn" : ""}`.trim()}>{srcBadge}</span>
                        </td>
                        <td style={{ minWidth: 260 }}>
                          {toastBadge ? (
                            <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                              {toastBadge}
                              <code title={title}>{title}</code>
                            </span>
                          ) : (
                            <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                              <code title={title}>{title}</code>
                              {user ? <span className="muted">{user}</span> : null}
                            </span>
                          )}
                        </td>
                        <td style={{ maxWidth: 520 }}>
                          <code title={detailStr}>{detailShort}</code>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <CopyButton text={rowJson} iconOnly tooltip={t.tr("Copy entry", "复制条目")} ariaLabel={t.tr("Copy entry", "复制条目")} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="emptyState" style={{ marginTop: 12 }}>
              {t.tr("No activity yet.", "暂无活动。")}
            </div>
          )}
        </div>

	      <div className="card" id="panel-audit">
	        <div className="toolbar">
	          <div className="toolbarLeft" style={{ alignItems: "center" }}>
	            <div>
              <h2>{t.tr("Audit Log", "审计日志")}</h2>
              {auditStatus ? (
                <div className="hint">{auditStatus}</div>
              ) : (
                <div className="hint">
                  {t.tr("Security/audit events from the server (audit.log).", "来自服务端的安全/审计事件（audit.log）。")}{" "}
                  {auditTruncated ? <span className="badge warn">{t.tr("truncated", "已截断")}</span> : null}
                </div>
              )}
            </div>
          </div>
          <div className="toolbarRight">
            <button type="button" className="iconBtn" onClick={refreshAudit} disabled={auditBusy}>
              {t.tr("Refresh", "刷新")}
            </button>
            <CopyButton
              text={auditExportJson}
              disabled={!auditEntries.length}
              label={t.tr("Copy JSON", "复制 JSON")}
              tooltip={t.tr("Copy JSON", "复制 JSON")}
              ariaLabel={t.tr("Copy JSON", "复制 JSON")}
            />
            <button type="button" className="iconBtn" onClick={exportAuditJson} disabled={!auditEntries.length}>
              {t.tr("Export JSON", "导出 JSON")}
            </button>
          </div>
        </div>

        <div className="grid2" style={{ alignItems: "end", marginTop: 12 }}>
          <Field label={t.tr("Action", "动作")} hint={t.tr("e.g. auth.login_ok", "例如 auth.login_ok")}>
            <input value={auditActionQuery} onChange={(e) => setAuditActionQuery(e.target.value)} placeholder="auth." />
          </Field>
          <Field label={t.tr("User", "用户")} hint={t.tr("e.g. admin", "例如 admin")}>
            <input value={auditUserQuery} onChange={(e) => setAuditUserQuery(e.target.value)} placeholder="admin" />
          </Field>
          <Field label={t.tr("Time range", "时间范围")}>
            <Select
              value={auditRange}
              onChange={(v) => setAuditRange(String(v || ""))}
              options={[
                { value: "1h", label: t.tr("Last 1h", "最近 1 小时") },
                { value: "24h", label: t.tr("Last 24h", "最近 24 小时") },
                { value: "7d", label: t.tr("Last 7d", "最近 7 天") },
                { value: "30d", label: t.tr("Last 30d", "最近 30 天") },
                { value: "all", label: t.tr("All", "全部") },
              ]}
            />
          </Field>
          <Field label={t.tr("Limit", "数量")}>
            <Select
              value={auditLimit}
              onChange={(v) => setAuditLimit(String(v || ""))}
              options={[
                { value: "100", label: "100" },
                { value: "200", label: "200" },
                { value: "500", label: "500" },
                { value: "1000", label: "1000" },
              ]}
            />
          </Field>
          <Field
            label={t.tr("Search", "搜索")}
            hint={t.tr("Matches action/user/IP/detail.", "匹配动作/用户/IP/详情。")}
            style={{ gridColumn: "1 / -1" }}
          >
            <input value={auditTextQuery} onChange={(e) => setAuditTextQuery(e.target.value)} placeholder={t.tr("Type to filter…", "输入以筛选…")} />
          </Field>
        </div>

        {auditEntries.length ? (
          <div className="tableScroll" style={{ marginTop: 12, maxHeight: 520, overflow: "auto" }}>
            <table className="compact">
              <thead>
                <tr>
                  <th>{t.tr("Time", "时间")}</th>
                  <th>{t.tr("Action", "动作")}</th>
                  <th>{t.tr("User", "用户")}</th>
                  <th>{t.tr("Auth", "认证")}</th>
                  <th>{t.tr("IP", "IP")}</th>
                  <th>{t.tr("Detail", "详情")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {auditEntries.map((e: any, idx: number) => {
                  const ts = Number(e?.ts_unix || 0);
                  const action = String(e?.action || "-");
                  const user = String(e?.user || "-");
                  const auth = String(e?.auth || "-");
                  const ip = String(e?.ip || "-");
                  const detailStr = e?.detail ? JSON.stringify(e.detail) : "";
                  const detailShort = detailStr.length > 140 ? `${detailStr.slice(0, 140)}…` : detailStr || "-";
                  const rowJson = JSON.stringify(e, null, 2);
                  return (
                    <tr key={`${ts}-${idx}`}>
                      <td style={{ whiteSpace: "nowrap" }}>{ts ? <TimeAgo unix={ts} /> : "-"}</td>
                      <td>
                        <code>{action}</code>
                      </td>
                      <td>{user ? <code>{user}</code> : "-"}</td>
                      <td>
                        <span className={`badge ${auth === "session" ? "ok" : auth === "api_token" ? "warn" : ""}`.trim()}>{auth || "-"}</span>
                      </td>
                      <td>{ip ? <code>{ip}</code> : "-"}</td>
                      <td style={{ maxWidth: 520 }}>
                        <code title={detailStr}>{detailShort}</code>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <CopyButton text={rowJson} iconOnly tooltip={t.tr("Copy entry", "复制条目")} ariaLabel={t.tr("Copy entry", "复制条目")} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState" style={{ marginTop: 12 }}>
            {auditBusy ? t.tr("Loading...", "加载中...") : t.tr("No audit entries found.", "暂无审计日志。")}
          </div>
        )}
      </div>
        </div>
      </div>

      <ManagedModal
        id="panel-reset-password"
        open={resetPwdOpen}
        onOverlayClick={() => (!usersBusy ? setResetPwdOpen(false) : null)}
        modalStyle={{ width: "min(560px, 100%)" }}
        ariaLabel={t.tr("Reset Password", "重置密码")}
      >
        <div className="modalHeader">
              <div>
                <div style={{ fontWeight: 800 }}>{t.tr("Reset Password", "重置密码")}</div>
                <div className="hint">
                  {t.tr("User", "用户")}: <code>{resetPwdUsername || "-"}</code>
                </div>
                <div className="hint">{t.tr("This will revoke all sessions for that user.", "这会撤销该用户的所有会话。")}</div>
                {usersStatus ? <div className="hint">{usersStatus}</div> : null}
              </div>
              <button type="button" onClick={() => setResetPwdOpen(false)} disabled={usersBusy}>
                {t.tr("Close", "关闭")}
              </button>
            </div>
            <Field label={t.tr("New password", "新密码")} hint={passwordHint}>
              <input type="password" value={resetPwdValue} onChange={(e) => setResetPwdValue(e.target.value)} placeholder="••••••••" autoFocus />
            </Field>
            <div className="btnGroup" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setResetPwdOpen(false)} disabled={usersBusy}>
                {t.tr("Cancel", "取消")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={submitResetPassword}
                disabled={usersBusy || !resetPwdUserId.trim() || !resetPwdValue.trim() || (passwordPolicy ? resetPwdValue.length < passwordMinLen : false)}
              >
                {t.tr("Save", "保存")}
              </button>
            </div>
      </ManagedModal>

      <ManagedModal
        id="panel-totp"
        open={totpOpen}
        onOverlayClick={() => (!totpBusy ? setTotpOpen(false) : null)}
        modalStyle={{ width: "min(720px, 100%)" }}
        ariaLabel={t.tr("Enable 2FA (TOTP)", "开启 2FA（TOTP）")}
      >
        <div className="modalHeader">
              <div>
                <div style={{ fontWeight: 800 }}>{t.tr("Enable 2FA (TOTP)", "开启 2FA（TOTP）")}</div>
                <div className="hint">{t.tr("Only for your own account. Save recovery codes somewhere safe.", "仅用于当前账号。请妥善保存恢复码。")}</div>
                {totpStatus ? <div className="hint">{totpStatus}</div> : null}
              </div>
              <button type="button" onClick={() => setTotpOpen(false)} disabled={totpBusy}>
                {t.tr("Close", "关闭")}
              </button>
            </div>

            {totpRecoveryCodes ? (
              <div>
                <div className="hint">{t.tr("Recovery codes (copy now; they won't be shown again):", "恢复码（请立即复制；不会再次显示）：")}</div>
                <pre className="codeBlock" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                  {(totpRecoveryCodes || []).join("\n")}
                </pre>
                <div className="btnGroup" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                  <CopyButton text={(totpRecoveryCodes || []).join("\n")} />
                  <button type="button" className="primary" onClick={() => setTotpOpen(false)} disabled={totpBusy}>
                    {t.tr("Done", "完成")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid2" style={{ alignItems: "end" }}>
                  <Field
                    label={t.tr("Secret (base32)", "密钥（base32）")}
                    hint={t.tr("Add to your authenticator app.", "添加到你的验证器 App。")}
                    style={{ gridColumn: "1 / -1" }}
                  >
                    <input value={totpSecret} readOnly />
                  </Field>
                  <Field label={t.tr("otpauth URI", "otpauth URI")} style={{ gridColumn: "1 / -1" }}>
                    <input value={totpUri} readOnly />
                    <div className="btnGroup" style={{ marginTop: 8, justifyContent: "flex-end" }}>
                      <CopyButton
                        text={totpSecret}
                        disabled={!totpSecret}
                        label={t.tr("Copy secret", "复制密钥")}
                        tooltip={t.tr("Copy secret", "复制密钥")}
                        ariaLabel={t.tr("Copy secret", "复制密钥")}
                      />
                      <CopyButton
                        text={totpUri}
                        disabled={!totpUri}
                        label={t.tr("Copy URI", "复制 URI")}
                        tooltip={t.tr("Copy URI", "复制 URI")}
                        ariaLabel={t.tr("Copy URI", "复制 URI")}
                      />
                    </div>
                  </Field>
                  <Field
                    label={t.tr("Code", "验证码")}
                    hint={t.tr("Enter the 6-digit code to confirm.", "输入 6 位动态码以确认。")}
                    style={{ gridColumn: "1 / -1" }}
                  >
                    <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="123456" autoCapitalize="none" autoCorrect="off" />
                  </Field>
                </div>
                <div className="btnGroup" style={{ marginTop: 12, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setTotpOpen(false)} disabled={totpBusy}>
                    {t.tr("Cancel", "取消")}
                  </button>
                  <button type="button" className="primary" onClick={enableTotpNow} disabled={totpBusy || !totpSecret || !totpCode.trim()}>
                    {t.tr("Enable 2FA", "开启 2FA")}
                  </button>
                </div>
              </>
            )}
      </ManagedModal>

      <ManagedModal
        id="panel-rotate-secret"
        open={rotateSecretOpen}
        onOverlayClick={() => (!rotateSecretBusy ? setRotateSecretOpen(false) : null)}
        modalStyle={{ width: "min(640px, 100%)" }}
        ariaLabel={t.tr("Rotate Panel Secret", "轮换 Panel Secret")}
      >
        <div className="modalHeader">
              <div>
                <div style={{ fontWeight: 800 }}>{t.tr("Rotate Panel Secret", "轮换 Panel Secret")}</div>
                <div className="hint">{t.tr("This invalidates ALL sessions immediately.", "这会立即撤销所有会话。")}</div>
                {rotateSecretStatus ? <div className="hint">{rotateSecretStatus}</div> : null}
              </div>
              <button type="button" onClick={() => setRotateSecretOpen(false)} disabled={rotateSecretBusy}>
                {t.tr("Close", "关闭")}
              </button>
            </div>
            <Field label={t.tr('Type "ROTATE" to confirm', '输入 "ROTATE" 以确认')}>
              <input value={rotateSecretConfirm} onChange={(e) => setRotateSecretConfirm(e.target.value)} placeholder="ROTATE" autoCapitalize="none" autoCorrect="off" />
            </Field>
            <div className="btnGroup" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setRotateSecretOpen(false)} disabled={rotateSecretBusy}>
                {t.tr("Cancel", "取消")}
              </button>
              <button type="button" className="dangerBtn" onClick={rotatePanelSecretNow} disabled={rotateSecretBusy}>
                {t.tr("Rotate", "轮换")}
              </button>
            </div>
      </ManagedModal>
    </div>
  );
}

export default memo(PanelView);
