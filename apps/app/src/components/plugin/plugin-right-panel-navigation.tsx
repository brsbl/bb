import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { BbNavigate } from "@bb/plugin-sdk";

export type PluginRightPanelOpenHandler = (
  request: Parameters<BbNavigate["experimental_openRightPanel"]>[0],
) => boolean;

const PluginRightPanelNavigationContext =
  createContext<PluginRightPanelOpenHandler | null>(null);

export function getPluginPanelRightPanelStateId({
  panelPath,
  paneId,
  pluginId,
}: {
  panelPath: string;
  paneId?: string;
  pluginId: string;
}): string {
  return `plugin-panel:${pluginId}:${panelPath}:${paneId ?? "standalone"}`;
}

const registeredOpeners = new Map<
  string,
  Map<symbol, PluginRightPanelOpenHandler>
>();

export function useRegisterPluginRightPanelOpenHandler(
  panelStateId: string,
  handler: PluginRightPanelOpenHandler,
): void {
  const registrationId = useRef(Symbol(panelStateId));
  useLayoutEffect(() => {
    const id = registrationId.current;
    const registrations = registeredOpeners.get(panelStateId) ?? new Map();
    registrations.set(id, handler);
    registeredOpeners.set(panelStateId, registrations);
    return () => {
      registrations.delete(id);
      if (registrations.size === 0) registeredOpeners.delete(panelStateId);
    };
  }, [handler, panelStateId]);
}

export function PluginRightPanelNavigationBridgeProvider({
  children,
  panelStateId,
}: {
  children: ReactNode;
  panelStateId: string;
}) {
  const handler = useMemo<PluginRightPanelOpenHandler>(
    () => (request) => {
      const registrations = registeredOpeners.get(panelStateId);
      const active = registrations
        ? Array.from(registrations.values()).at(-1)
        : undefined;
      return active?.(request) ?? false;
    },
    [panelStateId],
  );
  return (
    <PluginRightPanelNavigationProvider experimentalOpenRightPanel={handler}>
      {children}
    </PluginRightPanelNavigationProvider>
  );
}

export function PluginRightPanelNavigationProvider({
  children,
  experimentalOpenRightPanel,
}: {
  children: ReactNode;
  experimentalOpenRightPanel: PluginRightPanelOpenHandler;
}) {
  return (
    <PluginRightPanelNavigationContext.Provider
      value={experimentalOpenRightPanel}
    >
      {children}
    </PluginRightPanelNavigationContext.Provider>
  );
}

export function usePluginRightPanelOpenHandler(): PluginRightPanelOpenHandler | null {
  return useContext(PluginRightPanelNavigationContext);
}
