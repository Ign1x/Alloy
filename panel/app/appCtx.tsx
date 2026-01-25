"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

export const AppI18nCtx = createContext<any>(null);
export const AppActionsCtx = createContext<any>(null);
export const AppCoreCtx = createContext<any>(null);
export const AppPanelCtx = createContext<any>(null);
export const AppNodesCtx = createContext<any>(null);
export const AppGamesCtx = createContext<any>(null);
export const AppFrpCtx = createContext<any>(null);
export const AppFilesCtx = createContext<any>(null);
export const AppAdvancedCtx = createContext<any>(null);

export function AppProviders({
  i18n,
  actions,
  core,
  panel,
  nodes,
  games,
  frp,
  files,
  advanced,
  children,
}: {
  i18n: any;
  actions: any;
  core: any;
  panel: any;
  nodes: any;
  games: any;
  frp: any;
  files: any;
  advanced: any;
  children: ReactNode;
}) {
  return (
    <AppI18nCtx.Provider value={i18n}>
      <AppActionsCtx.Provider value={actions}>
        <AppCoreCtx.Provider value={core}>
          <AppPanelCtx.Provider value={panel}>
            <AppNodesCtx.Provider value={nodes}>
              <AppGamesCtx.Provider value={games}>
                <AppFrpCtx.Provider value={frp}>
                  <AppFilesCtx.Provider value={files}>
                    <AppAdvancedCtx.Provider value={advanced}>{children}</AppAdvancedCtx.Provider>
                  </AppFilesCtx.Provider>
                </AppFrpCtx.Provider>
              </AppGamesCtx.Provider>
            </AppNodesCtx.Provider>
          </AppPanelCtx.Provider>
        </AppCoreCtx.Provider>
      </AppActionsCtx.Provider>
    </AppI18nCtx.Provider>
  );
}

function useRequiredCtx(ctx: any, name: string) {
  const v = useContext(ctx as any);
  if (!v) throw new Error(`${name} missing`);
  return v;
}

export function useAppI18n(): any {
  return useRequiredCtx(AppI18nCtx, "AppI18nCtx");
}

export function useAppActions(): any {
  return useRequiredCtx(AppActionsCtx, "AppActionsCtx");
}

export function useAppCore(): any {
  return useRequiredCtx(AppCoreCtx, "AppCoreCtx");
}

export function useAppPanel(): any {
  return useRequiredCtx(AppPanelCtx, "AppPanelCtx");
}

export function useAppNodes(): any {
  return useRequiredCtx(AppNodesCtx, "AppNodesCtx");
}

export function useAppGames(): any {
  return useRequiredCtx(AppGamesCtx, "AppGamesCtx");
}

export function useAppFrp(): any {
  return useRequiredCtx(AppFrpCtx, "AppFrpCtx");
}

export function useAppFiles(): any {
  return useRequiredCtx(AppFilesCtx, "AppFilesCtx");
}

export function useAppAdvanced(): any {
  return useRequiredCtx(AppAdvancedCtx, "AppAdvancedCtx");
}
