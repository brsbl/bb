import { useEffect, useRef, type ReactNode } from "react";
import type { experimental_PluginRenderedTextSelection } from "@bb/plugin-sdk";

export interface SelectionAnchorPoint {
  x: number;
  y: number;
}

export type SelectionAnchorSide = "top" | "bottom";

export interface SelectionAnchor {
  point: SelectionAnchorPoint;
  side: SelectionAnchorSide;
}

export interface MessageProseSelection {
  text: string;
  rect: DOMRect;
  /** Present for selections captured inside canonical message prose roots. */
  renderedText?: experimental_PluginRenderedTextSelection;
  anchorPoint?: SelectionAnchorPoint;
  anchorSide?: SelectionAnchorSide;
  sourceSeqEnd?: number;
}

export interface SelectableMessageProseProps {
  children: ReactNode;
  className?: string;
  /**
   * Reports the current in-bounds selection (or `null` when the selection is
   * empty/collapsed/outside this node). Optional so the timeline can mount
   * this wrapper before the controller that consumes selections is wired in.
   */
  onSelect?: (selection: MessageProseSelection | null) => void;
}

export const MULTI_CLICK_SELECTION_REPORT_DELAY_MS = 180;
const SELECTION_DRAG_DIRECTION_THRESHOLD_PX = 4;

/**
 * Pure predicate: does `selection` fall entirely within `node`?
 *
 * Extracted so it is unit-testable without a DOM/selection harness. `node`
 * and the selection nodes only need a `contains(other)` method, so this also
 * accepts lightweight fakes in tests.
 */
export function isSelectionWithinNode(
  node: Pick<Node, "contains"> | null,
  selection: {
    isCollapsed: boolean;
    anchorNode: Node | null;
    focusNode: Node | null;
    commonAncestorContainer: Node | null;
  } | null,
): boolean {
  if (node === null || selection === null) return false;
  if (selection.isCollapsed) return false;

  const { anchorNode, focusNode, commonAncestorContainer } = selection;
  if (anchorNode === null || focusNode === null) return false;

  return (
    node.contains(anchorNode) &&
    node.contains(focusNode) &&
    (commonAncestorContainer === null || node.contains(commonAncestorContainer))
  );
}

function firstClientRect(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects.item(index);
    if (rect === null) {
      continue;
    }
    if (rect.width > 0 || rect.height > 0) {
      return rect;
    }
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function isSelectionBoundarySpillWithinNode(
  node: HTMLElement,
  range: Range,
  selectionText: string,
): boolean {
  if (typeof range.intersectsNode !== "function") {
    return false;
  }
  if (!range.intersectsNode(node)) {
    return false;
  }

  const normalizedSelectionText = normalizeSelectionText(selectionText);
  if (normalizedSelectionText.length === 0) {
    return false;
  }

  // Triple-clicking a final paragraph can place the focus/common nodes just
  // outside this wrapper while selecting only this node's text plus newlines.
  return normalizeSelectionText(node.textContent ?? "").includes(
    normalizedSelectionText,
  );
}

function textOffsetAtBoundary(
  root: HTMLElement,
  container: Node,
  offset: number,
): number | null {
  if (container !== root && !root.contains(container)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  try {
    prefix.setEnd(container, offset);
  } catch {
    return null;
  }
  return (prefix.cloneContents().textContent ?? "").length;
}

function slicePrefixWithoutSplittingSurrogate(
  text: string,
  end: number,
): string {
  let start = Math.max(0, end - 32);
  const first = text.charCodeAt(start);
  if (
    start > 0 &&
    first >= 0xdc00 &&
    first <= 0xdfff &&
    text.charCodeAt(start - 1) >= 0xd800 &&
    text.charCodeAt(start - 1) <= 0xdbff
  ) {
    start += 1;
  }
  return text.slice(start, end);
}

function sliceSuffixWithoutSplittingSurrogate(
  text: string,
  start: number,
): string {
  let end = Math.min(text.length, start + 32);
  const last = text.charCodeAt(end - 1);
  if (
    end < text.length &&
    last >= 0xd800 &&
    last <= 0xdbff &&
    text.charCodeAt(end) >= 0xdc00 &&
    text.charCodeAt(end) <= 0xdfff
  ) {
    end -= 1;
  }
  return text.slice(start, end);
}

export function renderedTextSelectionFromRange(
  root: HTMLElement,
  range: Range,
  geometryRange: Range = range,
): experimental_PluginRenderedTextSelection | null {
  const start = textOffsetAtBoundary(
    root,
    range.startContainer,
    range.startOffset,
  );
  const end = textOffsetAtBoundary(root, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;

  const text = root.textContent ?? "";
  const exact = text.slice(start, end);
  if (exact.trim().length === 0) return null;
  const rects: experimental_PluginRenderedTextSelection["rects"][number][] = [];
  const clientRects = geometryRange.getClientRects();
  for (let index = 0; index < clientRects.length; index += 1) {
    const rect = clientRects.item(index);
    if (rect === null || (rect.width <= 0 && rect.height <= 0)) continue;
    rects.push({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }
  if (rects.length === 0) {
    const rect = geometryRange.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      rects.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  }
  if (rects.length === 0) return null;

  return {
    version: 1,
    coordinateSpace: "rendered-text-utf16",
    start,
    end,
    exact,
    prefix: slicePrefixWithoutSplittingSurrogate(text, start),
    suffix: sliceSuffixWithoutSplittingSurrogate(text, end),
    rects,
  };
}

function toMessageProseSelection({
  anchor,
  rect,
  renderedText,
}: {
  anchor: SelectionAnchor | null;
  rect: DOMRect | null;
  renderedText: experimental_PluginRenderedTextSelection | null;
}): MessageProseSelection | null {
  if (renderedText === null || rect === null) return null;
  const selection: MessageProseSelection = {
    text: renderedText.exact,
    rect,
    renderedText,
  };
  if (anchor !== null) {
    selection.anchorPoint = anchor.point;
    selection.anchorSide = anchor.side;
  }
  return selection;
}

export function anchorPointFromMouseEvent(
  event: Pick<MouseEvent, "clientX" | "clientY">,
): SelectionAnchorPoint | null {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }
  return { x: event.clientX, y: event.clientY };
}

export function usesLiveSelectionRange(
  pointerType: string | undefined,
): boolean {
  return (
    pointerType !== undefined && pointerType !== "" && pointerType !== "mouse"
  );
}

export function selectionAnchorFromPointerRelease(
  startPoint: SelectionAnchorPoint | null,
  releaseEvent: Pick<MouseEvent, "clientX" | "clientY"> & {
    pointerType?: string;
  },
): SelectionAnchor | null {
  // Touch and pen selection handles can keep moving after the initial pointer
  // release. Anchor those selections from the live Range rect instead of a
  // release coordinate that becomes stale as the user adjusts the handles.
  if (usesLiveSelectionRange(releaseEvent.pointerType)) {
    return null;
  }
  const releasePoint = anchorPointFromMouseEvent(releaseEvent);
  if (releasePoint === null) {
    return null;
  }

  return {
    point: releasePoint,
    side:
      startPoint !== null &&
      releasePoint.y - startPoint.y > SELECTION_DRAG_DIRECTION_THRESHOLD_PX
        ? "bottom"
        : "top",
  };
}

function isEventTargetWithinNode(
  event: Event,
  node: HTMLElement | null,
): boolean {
  if (node === null || !(event.target instanceof Node)) return false;
  return node.contains(event.target);
}

function readSelectionWithinNode(
  node: HTMLElement | null,
  anchor: SelectionAnchor | null,
): MessageProseSelection | null {
  if (node === null || typeof window === "undefined") return null;

  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);

  const accepted = isSelectionWithinNode(node, {
    isCollapsed: selection.isCollapsed,
    anchorNode: selection.anchorNode,
    focusNode: selection.focusNode,
    commonAncestorContainer: range.commonAncestorContainer,
  });
  if (accepted) {
    const rect = firstClientRect(range);
    const renderedText = renderedTextSelectionFromRange(node, range);
    return toMessageProseSelection({ anchor, rect, renderedText });
  }

  const text = selection.toString();
  if (isSelectionBoundarySpillWithinNode(node, range, text)) {
    const clippedRange = document.createRange();
    if (node.contains(range.startContainer)) {
      clippedRange.setStart(range.startContainer, range.startOffset);
    } else {
      clippedRange.setStart(node, 0);
    }
    if (node.contains(range.endContainer)) {
      clippedRange.setEnd(range.endContainer, range.endOffset);
    } else {
      clippedRange.setEnd(node, node.childNodes.length);
    }
    const rect = firstClientRect(range);
    const renderedText = renderedTextSelectionFromRange(
      node,
      clippedRange,
      range,
    );
    return toMessageProseSelection({ anchor, rect, renderedText });
  }

  return null;
}

/**
 * Wraps agent prose and reports text selections whose endpoints both fall
 * inside the wrapped node. Selections that escape the node (or are collapsed)
 * report `null` so a consumer can dismiss any floating affordance.
 */
export function SelectableMessageProse({
  children,
  className,
  onSelect,
}: SelectableMessageProseProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame: number | null = null;
    // Read pointer selections only after release so the floating menu does not
    // block the cursor or chase the range while the user is still dragging.
    // Only emit `null` once, after this node had reported a real selection, so
    // N messages don't thrash a shared controller.
    let hadSelection = false;
    let pointerIsDown = false;
    let pointerUsesLiveSelectionRange = false;
    let pointerStartedInNode = false;
    let pointerStartPoint: SelectionAnchorPoint | null = null;
    let pendingReportAnchor: SelectionAnchor | null = null;
    let lastPointerReleaseAnchor: SelectionAnchor | null = null;
    let multiClickTimer: number | null = null;
    const report = () => {
      frame = null;
      const anchor = pendingReportAnchor;
      pendingReportAnchor = null;
      const next = readSelectionWithinNode(nodeRef.current, anchor);
      if (next === null && !hadSelection) return;
      hadSelection = next !== null;
      onSelectRef.current?.(next);
    };
    const cancelFrame = () => {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    };
    const cancelMultiClickTimer = () => {
      if (multiClickTimer === null) return;
      window.clearTimeout(multiClickTimer);
      multiClickTimer = null;
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(report);
    };
    const scheduleWithAnchor = (anchor: SelectionAnchor | null) => {
      if (anchor !== null) {
        pendingReportAnchor = anchor;
      }
      schedule();
    };
    const scheduleFresh = (anchor: SelectionAnchor | null = null) => {
      cancelMultiClickTimer();
      cancelFrame();
      scheduleWithAnchor(anchor);
    };
    const scheduleAfterMultiClickDelay = (
      anchor: SelectionAnchor | null = null,
    ) => {
      cancelFrame();
      cancelMultiClickTimer();
      multiClickTimer = window.setTimeout(() => {
        multiClickTimer = null;
        scheduleWithAnchor(anchor);
      }, MULTI_CLICK_SELECTION_REPORT_DELAY_MS);
    };
    const handleSelectionChange = () => {
      // Mouse drag selections wait for release so the menu does not chase the
      // cursor. Mobile long-press selection is finalized while the touch is
      // still down, and iOS may cancel rather than release that pointer, so
      // read touch/pen ranges as soon as Selection reports them.
      if (pointerIsDown && !pointerUsesLiveSelectionRange) {
        return;
      }
      if (multiClickTimer !== null) {
        return;
      }
      schedule();
    };
    const handlePointerDown = (event: PointerEvent) => {
      cancelMultiClickTimer();
      cancelFrame();
      pendingReportAnchor = null;
      pointerStartedInNode = isEventTargetWithinNode(event, nodeRef.current);
      pointerStartPoint = pointerStartedInNode
        ? anchorPointFromMouseEvent(event)
        : null;
      pointerUsesLiveSelectionRange = usesLiveSelectionRange(event.pointerType);
      pointerIsDown = true;
    };
    const handlePointerRelease = (event: PointerEvent | MouseEvent) => {
      const anchor = pointerStartedInNode
        ? selectionAnchorFromPointerRelease(pointerStartPoint, event)
        : null;
      if (anchor !== null) {
        lastPointerReleaseAnchor = anchor;
      }
      pointerIsDown = false;
      pointerUsesLiveSelectionRange = false;
      pointerStartedInNode = false;
      pointerStartPoint = null;
      scheduleWithAnchor(anchor);
    };
    const handlePointerCancel = () => {
      pointerIsDown = false;
      pointerUsesLiveSelectionRange = false;
      pointerStartedInNode = false;
      pointerStartPoint = null;
      schedule();
    };
    const handleMultiClick = (event: MouseEvent) => {
      if (event.detail < 2) {
        return;
      }
      const clickAnchor =
        selectionAnchorFromPointerRelease(null, event) ??
        lastPointerReleaseAnchor;
      if (event.detail === 2) {
        scheduleAfterMultiClickDelay(clickAnchor);
        return;
      }
      // Multi-click selection can be finalized after pointerup. Replace any
      // stale pointerup read with one explicitly tied to the completed click.
      scheduleFresh(clickAnchor);
    };
    const handleDoubleClick = () => {
      scheduleAfterMultiClickDelay(lastPointerReleaseAnchor);
    };
    const node = nodeRef.current;

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerRelease);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("mouseup", handlePointerRelease);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("keyup", schedule);
    node?.addEventListener("click", handleMultiClick);
    node?.addEventListener("dblclick", handleDoubleClick);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      cancelMultiClickTimer();
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerRelease);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("mouseup", handlePointerRelease);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keyup", schedule);
      node?.removeEventListener("click", handleMultiClick);
      node?.removeEventListener("dblclick", handleDoubleClick);
    };
  }, []);

  return (
    <div
      ref={nodeRef}
      className={className}
      // The compact sidebar listens globally for a right-swipe from the main
      // inset. A long-press text selection uses the same touch sequence, so
      // keep sidebar swipe recognition out of selectable message prose.
      data-no-sidebar-swipe
      data-bb-experimental-message-prose-root=""
    >
      {children}
    </div>
  );
}
