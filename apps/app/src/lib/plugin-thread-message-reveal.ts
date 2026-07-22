export type PluginThreadMessageRevealResult = "revealed" | "missing";
export type PluginThreadMessageRevealHandler = (
  messageId: string,
) => Promise<PluginThreadMessageRevealResult>;

const revealHandlers = new Map<string, PluginThreadMessageRevealHandler>();

export function registerPluginThreadMessageRevealHandler(
  threadId: string,
  handler: PluginThreadMessageRevealHandler,
): () => void {
  revealHandlers.set(threadId, handler);
  return () => {
    if (revealHandlers.get(threadId) === handler) {
      revealHandlers.delete(threadId);
    }
  };
}

/**
 * Reveal through the currently mounted native timeline for `threadId`.
 * Absence is deliberately reported as missing rather than falling back to a
 * different route or another thread's DOM.
 */
export function revealPluginThreadMessage(
  threadId: string,
  messageId: string,
): Promise<PluginThreadMessageRevealResult> {
  const handler = revealHandlers.get(threadId);
  return handler?.(messageId) ?? Promise.resolve("missing");
}
