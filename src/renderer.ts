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

function tableToMarkdown(node: InstanceNode): string {
  const rows = collectRows(node);
  if (rows.length === 0) return "";

  const grid = rows.map((row) =>
    row.children
      .filter((c): c is InstanceNode => !isText(c) && (c.type === "td" || c.type === "th"))
      .map((cell) => cell.children.map(toMarkdown).join("").trim()),
  );

  const cols = Math.max(...grid.map((r) => r.length));
  const lines: string[] = [];
  for (let i = 0; i < grid.length; i++) {
    while (grid[i].length < cols) grid[i].push("");
    lines.push(`| ${grid[i].join(" | ")} |`);
    if (i === 0) lines.push(`| ${grid[i].map(() => "---").join(" | ")} |`);
  }
  return lines.join("\n") + "\n\n";
}

function toMarkdown(node: AnyNode): string {
  if (isText(node)) return node.hidden ? "" : node.text;
  if (node.hidden) return "";
  const inner = node.children.map(toMarkdown).join("");
  switch (node.type) {
    case "h1":
      return `# ${inner}\n`;
    case "h2":
      return `## ${inner}\n`;
    case "h3":
      return `### ${inner}\n`;
    case "h4":
      return `#### ${inner}\n`;
    case "h5":
      return `##### ${inner}\n`;
    case "h6":
      return `###### ${inner}\n`;
    case "strong":
    case "b":
      return `**${inner}**`;
    case "em":
    case "i":
      return `*${inner}*`;
    case "del":
    case "s":
      return `~~${inner}~~`;
    case "code":
      return `\`${inner}\``;
    case "pre":
      return `\`\`\`\n${inner}\n\`\`\`\n`;
    case "p":
      return `${inner}\n\n`;
    case "br":
      return "  \n";
    case "ul":
    case "ol":
      return `${inner}\n`;
    case "li":
      return `- ${inner}\n`;
    case "hr":
      return `---\n\n`;
    case "blockquote":
      return `> ${inner}\n`;
    case "a":
      return `[${inner}](${String(node.props.href ?? "#")})`;
    case "table":
      return tableToMarkdown(node);
    case "thead":
    case "tbody":
    case "tfoot":
    case "tr":
    case "th":
    case "td":
      return inner;
    default:
      return inner;
  }
}

const HEADING_COLORS = [
  "",
  "\x1b[1;36m",
  "\x1b[1;34m",
  "\x1b[1;35m",
  "\x1b[1;33m",
  "\x1b[1;32m",
  "\x1b[1;31m",
];

function toAnsi(markdown: string): string {
  const cols = process.stdout.columns ?? 80;
  return Bun.markdown.render(
    markdown,
    {
      heading: (text, { level }) => `${HEADING_COLORS[level] ?? "\x1b[1m"}${text}\x1b[0m\n`,
      strong: (text) => `\x1b[1m${text}\x1b[22m`,
      emphasis: (text) => `\x1b[3m${text}\x1b[23m`,
      strikethrough: (text) => `\x1b[9m${text}\x1b[29m`,
      codespan: (text) => `\x1b[7m ${text} \x1b[27m`,
      code: (text) => `\x1b[2m${text}\x1b[22m\n`,
      paragraph: (text) => `${text}\n`,
      hr: () => `\x1b[2m${"─".repeat(cols)}\x1b[22m\n`,
      link: (text, { href }) => `${text} \x1b[2m(${href})\x1b[22m`,
    },
    { strikethrough: true, tables: true, tasklists: true },
  );
}

// Strip ANSI escape sequences to get the visible text length
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// Count visual lines: each logical line may wrap across multiple terminal rows
function visualLineCount(output: string, cols: number): number {
  const lines = output.split("\n");
  // last element after split on trailing \n is empty, skip it
  let count = 0;
  for (const line of lines) {
    const len = stripAnsi(line).length;
    count += len === 0 ? 1 : Math.ceil(len / cols);
  }
  // If output ends with \n, split produces an extra empty string — don't count it
  if (output.endsWith("\n") && lines.length > 1) count--;
  return count;
}

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

  // Priority management (React 19)
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

  // Suspense — not supported, return safe no-ops/nulls
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
  const root = reconciler.createContainer(container, 0, null, false, null, "", onError, null);
  reconciler.updateContainer(element, root, null, null);
  return root;
}

/**
 * Render a React element into the terminal using the whole terminal width.
 * Use `renderCLI` for a classic fixed-width layout.
 * @param element - The React element to render.
 */
export function renderTUI(element: ReactElement): void {
  const container: Container = {
    children: [],
    flush: (c) => {
      const md = c.children.map(toMarkdown).join("");
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(toAnsi(md));
    },
  };
  createRoot(container, element);
  process.stdout.on("resize", () => container.flush(container));
}

/**
 * Render a React element into the terminal using a fixed-width layout.
 * Use `renderTUI` for a fullscreen layout that clears the terminal on each commit and re-flushes on resize.
 * @param element - The React element to render.
 */
export function renderCLI(element: ReactElement): void {
  let lastOutput = "";
  const container: Container = {
    children: [],
    flush: (c) => {
      const cols = process.stdout.columns ?? 80;
      if (lastOutput) {
        // Recalculate at current width — terminal already reflowed the old text
        const up = visualLineCount(lastOutput, cols);
        process.stdout.write(`\x1b[${up}A\x1b[0J`);
      }
      const md = c.children.map(toMarkdown).join("");
      lastOutput = toAnsi(md);
      process.stdout.write(lastOutput);
    },
  };
  createRoot(container, element);
}
