import { createContext } from "react";
import type { ReactElement } from "react";
import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants";

type Props = Record<string, unknown>;

interface InstanceNode {
  type: string;
  props: Props;
  children: AnyNode[];
  hidden?: boolean;
}

interface TextNode {
  text: string;
  hidden?: boolean;
}

type AnyNode = InstanceNode | TextNode;

interface Container {
  children: AnyNode[];
  flush: (container: Container) => void;
}

function isText(node: AnyNode): node is TextNode {
  return "text" in node;
}

type ClickZone = { row: number; colStart: number; colEnd: number; handler: () => void };
let activeClickZones: ClickZone[] = [];

const HEADING_COLORS = [
  "",
  "\x1b[1;36m",
  "\x1b[1;34m",
  "\x1b[1;35m",
  "\x1b[1;33m",
  "\x1b[1;32m",
  "\x1b[1;31m",
];
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

class RenderContext {
  output = "";
  row = 1;
  col = 1;
  readonly zones: ClickZone[] = [];
  private stack: { handler: () => void; row: number; col: number }[] = [];

  write(s: string) {
    this.output += s;
    for (let i = 0; i < s.length; ) {
      if (s[i] === "\x1b" && s[i + 1] === "[") {
        i += 2;
        while (i < s.length && !(s.charCodeAt(i) >= 0x40 && s.charCodeAt(i) <= 0x7e)) i++;
        if (i < s.length) i++;
        continue;
      }
      if (s[i] === "\n") {
        this.row++;
        this.col = 1;
      } else this.col++;
      i++;
    }
  }

  pushClick(handler: () => void) {
    this.stack.push({ handler, row: this.row, col: this.col });
  }

  popClick() {
    const s = this.stack.pop();
    if (s && s.row === this.row && this.col > s.col) {
      this.zones.push({ row: s.row, colStart: s.col, colEnd: this.col - 1, handler: s.handler });
    }
  }
}

function renderChildren(node: InstanceNode, ctx: RenderContext): void {
  for (const child of node.children) renderNode(child, ctx);
}

function renderNode(node: AnyNode, ctx: RenderContext): void {
  if (isText(node)) {
    if (!node.hidden) ctx.write(node.text);
    return;
  }
  if (node.hidden) return;

  const click = typeof node.props.onClick === "function";
  if (click) ctx.pushClick(node.props.onClick as () => void);

  switch (node.type) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const lvl = Number(node.type[1]);
      ctx.write(HEADING_COLORS[lvl] ?? "\x1b[1m");
      renderChildren(node, ctx);
      ctx.write("\x1b[0m\n");
      break;
    }
    case "strong":
    case "b":
      ctx.write("\x1b[1m");
      renderChildren(node, ctx);
      ctx.write("\x1b[22m");
      break;
    case "em":
    case "i":
      ctx.write("\x1b[3m");
      renderChildren(node, ctx);
      ctx.write("\x1b[23m");
      break;
    case "del":
    case "s":
      ctx.write("\x1b[9m");
      renderChildren(node, ctx);
      ctx.write("\x1b[29m");
      break;
    case "code":
      ctx.write("\x1b[7m ");
      renderChildren(node, ctx);
      ctx.write(" \x1b[27m");
      break;
    case "pre":
      ctx.write("\x1b[2m");
      renderChildren(node, ctx);
      ctx.write("\x1b[22m\n");
      break;
    case "p":
      renderChildren(node, ctx);
      ctx.write("\n");
      break;
    case "br":
      ctx.write("\n");
      break;
    case "ul":
    case "ol":
      renderChildren(node, ctx);
      break;
    case "li":
      ctx.write("- ");
      renderChildren(node, ctx);
      ctx.write("\n");
      break;
    case "hr": {
      const cols = process.stdout.columns ?? 80;
      ctx.write(`\x1b[2m${"─".repeat(cols)}\x1b[22m\n`);
      break;
    }
    case "blockquote":
      ctx.write("\x1b[2m> ");
      renderChildren(node, ctx);
      ctx.write("\x1b[22m\n");
      break;
    case "a":
      renderChildren(node, ctx);
      ctx.write(` \x1b[2m(${String(node.props.href ?? "#")})\x1b[22m`);
      break;
    case "table":
      renderTable(node, ctx);
      break;
    default:
      renderChildren(node, ctx);
      break;
  }

  if (click) ctx.popClick();
}

// --- Tables ---

function collectRows(node: InstanceNode): InstanceNode[] {
  const rows: InstanceNode[] = [];
  for (const child of node.children) {
    if (isText(child)) continue;
    if (child.type === "tr") rows.push(child);
    else if (child.type === "thead" || child.type === "tbody" || child.type === "tfoot")
      rows.push(...collectRows(child));
  }
  return rows;
}

function renderTable(table: InstanceNode, ctx: RenderContext): void {
  const rows = collectRows(table);
  if (rows.length === 0) return;

  const cells = rows.map((row) =>
    row.children
      .filter((c): c is InstanceNode => !isText(c) && (c.type === "td" || c.type === "th"))
      .map((cell) => {
        const tmp = new RenderContext();
        renderChildren(cell, tmp);
        const ansi = tmp.output.trim();
        return { ansi, width: stripAnsi(ansi).length };
      }),
  );

  const numCols = Math.max(...cells.map((r) => r.length));
  const widths = Array.from({ length: numCols }, (_, c) =>
    Math.max(3, ...cells.map((r) => r[c]?.width ?? 0)),
  );

  for (let i = 0; i < cells.length; i++) {
    for (let j = 0; j < numCols; j++) {
      const cell = cells[i][j] ?? { ansi: "", width: 0 };
      ctx.write("| ");
      ctx.write(cell.ansi);
      ctx.write(" ".repeat(widths[j] - cell.width));
      ctx.write(" ");
    }
    ctx.write("|\n");
    if (i === 0) {
      for (let j = 0; j < numCols; j++) {
        ctx.write("| ");
        ctx.write("-".repeat(widths[j]));
        ctx.write(" ");
      }
      ctx.write("|\n");
    }
  }
  ctx.write("\n");
}

// --- Flush helper ---

function renderTree(children: AnyNode[]): { output: string; zones: ClickZone[] } {
  const ctx = new RenderContext();
  for (const child of children) renderNode(child, ctx);
  return { output: ctx.output, zones: ctx.zones };
}

function offsetClickZones(zones: ClickZone[], rowOffset: number): ClickZone[] {
  return zones.map((zone) => ({ ...zone, row: zone.row + rowOffset }));
}

export function dispatchClick(column: number, row: number): boolean {
  for (const zone of activeClickZones) {
    if (row === zone.row && column >= zone.colStart && column <= zone.colEnd) {
      zone.handler();
      return true;
    }
  }
  return false;
}

function visualLineCount(output: string, cols: number): number {
  const lines = output.split("\n");
  let count = 0;
  for (const line of lines) {
    const len = stripAnsi(line).length;
    count += len === 0 ? 1 : Math.ceil(len / cols);
  }
  if (output.endsWith("\n") && lines.length > 1) count--;
  return count;
}

type CursorPosition = { row: number; col: number };

function queryCursorPosition(timeoutMs = 50): Promise<CursorPosition | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(null);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const rawCapable = "setRawMode" in stdin && typeof stdin.setRawMode === "function";
    const wasRaw = rawCapable ? Boolean((stdin as typeof stdin & { isRaw?: boolean }).isRaw) : false;
    const wasPaused = typeof stdin.isPaused === "function" ? stdin.isPaused() : false;
    let done = false;
    let buffer = "";

    const finish = (value: CursorPosition | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.off("data", onData);
      if (rawCapable && !wasRaw) stdin.setRawMode(false);
      if (wasPaused) stdin.pause();
      resolve(value);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("ascii");
      const match = /\x1b\[(\d+);(\d+)R/.exec(buffer);
      if (!match) return;
      finish({ row: Number(match[1]), col: Number(match[2]) });
    };

    stdin.on("data", onData);
    if (rawCapable && !wasRaw) stdin.setRawMode(true);
    stdin.resume();
    process.stdout.write("\x1b[6n");

    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

// --- React 19 reconciler ---

const NOT_PENDING: unique symbol = Symbol.for("monika.not_pending") as never;
const HostTransitionCtx = createContext(NOT_PENDING);

let currentUpdatePriority = DefaultEventPriority;

const reconciler = Reconciler({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsMicrotasks: true,
  isPrimaryRenderer: true,
  noTimeout: -1,

  setCurrentUpdatePriority: (priority: number) => {
    currentUpdatePriority = priority;
  },
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority: () => currentUpdatePriority,
  trackSchedulerEvent: () => {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1,
  shouldAttemptEagerTransition: () => false,

  scheduleMicrotask: queueMicrotask,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  createInstance: (type: string, props: Props): InstanceNode => ({ type, props, children: [] }),
  createTextInstance: (text: string): TextNode => ({ text }),

  appendInitialChild: (parent: InstanceNode, child: AnyNode) => {
    parent.children.push(child);
  },
  appendChild: (parent: InstanceNode, child: AnyNode) => {
    parent.children.push(child);
  },
  appendChildToContainer: (container: Container, child: AnyNode) => {
    container.children.push(child);
  },

  insertBefore: (parent: InstanceNode, child: AnyNode, before: AnyNode) => {
    parent.children.splice(parent.children.indexOf(before), 0, child);
  },
  insertInContainerBefore: (container: Container, child: AnyNode, before: AnyNode) => {
    container.children.splice(container.children.indexOf(before), 0, child);
  },

  removeChild: (parent: InstanceNode, child: AnyNode) => {
    parent.children.splice(parent.children.indexOf(child), 1);
  },
  removeChildFromContainer: (container: Container, child: AnyNode) => {
    container.children.splice(container.children.indexOf(child), 1);
  },
  clearContainer: (container: Container) => {
    container.children = [];
  },

  finalizeInitialChildren: () => false,
  prepareUpdate: (_inst: InstanceNode, _type: string, old: Props, next: Props) => {
    for (const key in next) if (next[key] !== old[key]) return next;
    for (const key in old) if (!(key in next)) return next;
    return null;
  },
  commitUpdate: (inst: InstanceNode, payload: Props) => {
    inst.props = { ...inst.props, ...payload };
  },
  commitTextUpdate: (node: TextNode, _old: string, next: string) => {
    node.text = next;
  },
  commitMount: () => {},
  resetTextContent: () => {},
  shouldSetTextContent: () => false,
  hideInstance: (inst: InstanceNode) => {
    inst.hidden = true;
  },
  hideTextInstance: (node: TextNode) => {
    node.hidden = true;
  },
  unhideInstance: (inst: InstanceNode) => {
    inst.hidden = false;
  },
  unhideTextInstance: (node: TextNode) => {
    node.hidden = false;
  },

  getRootHostContext: () => ({}),
  getChildHostContext: (ctx: object) => ctx,
  getPublicInstance: (inst: AnyNode) => inst,
  prepareForCommit: () => null,
  preparePortalMount: () => {},

  resetAfterCommit: (container: Container) => {
    container.flush(container);
  },

  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  NotPendingTransition: NOT_PENDING,
  HostTransitionContext: HostTransitionCtx,
  resetFormInstance: () => {},
  bindToConsole: (type: string, args: unknown[]) => {
    const method =
      (console as unknown as Record<string, (...a: unknown[]) => void>)[type] ?? console.log;
    return method.bind(console, ...args);
  },

  getInstanceFromNode: () => null,
  detachDeletedInstance: () => {},
} as unknown as Parameters<typeof Reconciler>[0]);

function createRoot(container: Container, element: ReactElement) {
  const onError = (e: Error) => {
    console.error("[monika]", e);
  };
  const root = reconciler.createContainer(container, 0, null, false, null, "", onError, onError, onError, () => {});
  reconciler.updateContainer(element, root, null, null);
  return root;
}

/**
 * Fullscreen mode: clears the terminal on each commit, re-renders on resize.
 * onClick dispatching works out of the box (output starts at row 1).
 */
export function renderTUI(element: ReactElement): void {
  const container: Container = {
    children: [],
    flush: (c) => {
      const { output, zones } = renderTree(c.children);
      activeClickZones = zones;
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(output);
    },
  };
  createRoot(container, element);
  process.stdout.on("resize", () => container.flush(container));
}

/**
 * Inline mode: overwrites previous output in place, no screen clear.
 */
export function renderCLI(element: ReactElement): void {
  let lastOutput = "";
  let anchorRow = 1;
  const container: Container = {
    children: [],
    flush: (c) => {
      const cols = process.stdout.columns ?? 80;
      if (lastOutput) {
        const up = visualLineCount(lastOutput, cols);
        process.stdout.write(`\x1b[${up}A\x1b[0J`);
      }
      const { output, zones } = renderTree(c.children);
      lastOutput = output;
      activeClickZones = offsetClickZones(zones, anchorRow - 1);
      process.stdout.write(lastOutput);
    },
  };

  void queryCursorPosition().then((cursor) => {
    if (cursor) {
      anchorRow = cursor.col === 1 ? cursor.row : cursor.row + 1;
      if (cursor.col !== 1) process.stdout.write("\n");
    }

    createRoot(container, element);
    process.stdout.on("resize", () => {
      void queryCursorPosition().then((nextCursor) => {
        if (nextCursor && lastOutput) {
          const height = visualLineCount(lastOutput, process.stdout.columns ?? 80);
          anchorRow = Math.max(1, nextCursor.row - height + (nextCursor.col === 1 ? 0 : 1));
        }
        container.flush(container);
      });
    });
  });
}
