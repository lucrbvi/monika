import { useEffect, useRef, useState } from "react";
import { dispatchClick } from "./renderer";

const MOD_SHIFT = 4;
const MOD_ALT = 8;
const MOD_CTRL = 16;
const MOD_MASK = MOD_SHIFT | MOD_ALT | MOD_CTRL;

export type MouseInfo = {
  /** Terminal cell column (xterm SGR, 1-based). */
  column: number;
  /** Terminal cell row (1-based). */
  row: number;
  action: "press" | "release";
  button: "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "none";
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
  /** CSI first parameter before stripping modifiers. */
  rawCode: number;
};

export type Key = {
  raw: Buffer;
  ctrl: boolean;
  name: string | null;
  mouse?: MouseInfo;
};

const ESCAPE_NAMES: Record<string, string> = {
  "[A": "up",
  "[B": "down",
  "[C": "right",
  "[D": "left",
  "[H": "home",
  "[F": "end",
  "[3~": "delete",
  "[5~": "pageup",
  "[6~": "pagedown",
};

const ENABLE_MOUSE_SGR = "\x1b[?1006h\x1b[?1000h";
const DISABLE_MOUSE_SGR = "\x1b[?1000l\x1b[?1006l";

let stdinRefCount = 0;
let mouseRefCount = 0;
let pending = Buffer.alloc(0);
const subscribers = new Set<(key: Key) => void>();

function restoreTerminalInput() {
  if (!process.stdin.isTTY) return;
  process.stdout.write(DISABLE_MOUSE_SGR);
  detachStdin();
  process.stdin.setRawMode(false);
  process.stdin.pause();
  stdinRefCount = 0;
  mouseRefCount = 0;
}

function handleProcessExit() {
  restoreTerminalInput();
}

function decodeMouseButton(code: number): MouseInfo["button"] {
  const b = code & ~MOD_MASK;
  if (b === 64) return "wheel-up";
  if (b === 65) return "wheel-down";
  if (b >= 32 && b <= 34) return (["left", "middle", "right"] as const)[b - 32];
  if (b <= 2) return (["left", "middle", "right"] as const)[b];
  return "none";
}

function parseModifiers(code: number): MouseInfo["modifiers"] {
  return {
    shift: (code & MOD_SHIFT) !== 0,
    alt: (code & MOD_ALT) !== 0,
    ctrl: (code & MOD_CTRL) !== 0,
  };
}

function tryParseSgrMouse(buf: Buffer): { consumed: number; key: Key } | null {
  if (buf.length < 9) return null;
  if (buf[0] !== 0x1b || buf[1] !== 0x5b || buf[2] !== 0x3c) return null;
  let i = 3;
  while (i < buf.length && buf[i] !== 0x4d && buf[i] !== 0x6d) i++;
  if (i >= buf.length) return null;
  const inner = buf.subarray(3, i).toString("ascii");
  const m = /^(\d+);(\d+);(\d+)$/.exec(inner);
  if (!m) return null;
  const rawCode = Number(m[1]);
  const column = Number(m[2]);
  const row = Number(m[3]);
  const released = buf[i] === 0x6d;
  const slice = buf.subarray(0, i + 1);
  return {
    consumed: i + 1,
    key: {
      raw: Buffer.from(slice),
      ctrl: false,
      name: null,
      mouse: {
        column,
        row,
        action: released ? "release" : "press",
        button: decodeMouseButton(rawCode),
        modifiers: parseModifiers(rawCode),
        rawCode,
      },
    },
  };
}

function tryParseNamedEscape(buf: Buffer): { consumed: number; key: Key } | null {
  const ordered = Object.entries(ESCAPE_NAMES).sort((a, b) => b[0].length - a[0].length);
  for (const [suffix, name] of ordered) {
    const seq = Buffer.from(`\x1b${suffix}`);
    if (buf.length >= seq.length && buf.subarray(0, seq.length).equals(seq)) {
      return {
        consumed: seq.length,
        key: { raw: buf.subarray(0, seq.length), ctrl: false, name },
      };
    }
  }
  return null;
}

/** Consume a full CSI sequence ending in 0x40–0x7e (unknown to us). */
function tryParseGenericCsi(buf: Buffer): { consumed: number; key: Key } | null {
  if (buf[0] !== 0x1b || buf[1] !== 0x5b) return null;
  for (let i = 2; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x40 && c <= 0x7e) {
      return {
        consumed: i + 1,
        key: { raw: buf.subarray(0, i + 1), ctrl: false, name: null },
      };
    }
  }
  return null;
}

function parseNext(buf: Buffer): { consumed: number; key: Key } | null {
  if (buf.length === 0) return null;

  const sgr = tryParseSgrMouse(buf);
  if (sgr) return sgr;

  if (buf[0] === 0x1b) {
    if (buf.length === 1) return null;
    const named = tryParseNamedEscape(buf);
    if (named) return named;
    if (buf[1] === 0x5b) {
      const csi = tryParseGenericCsi(buf);
      if (csi) return csi;
      return null;
    }
    return {
      consumed: 2,
      key: { raw: buf.subarray(0, 2), ctrl: false, name: null },
    };
  }

  const b = buf[0];
  const ctrl = b < 32;
  const name = ctrl ? String.fromCharCode(b + 64).toLowerCase() : String.fromCharCode(b);
  return {
    consumed: 1,
    key: { raw: buf.subarray(0, 1), ctrl, name },
  };
}

function pump(data: Buffer) {
  pending = Buffer.concat([pending, data]);
  while (true) {
    const next = parseNext(pending);
    if (!next || next.consumed === 0) break;
    pending = pending.subarray(next.consumed);
    for (const fn of subscribers) fn(next.key);
  }
}

function attachStdin() {
  process.stdin.on("data", pump);
}

function detachStdin() {
  process.stdin.off("data", pump);
  pending = Buffer.alloc(0);
}

function acquireStdin() {
  if (++stdinRefCount === 1 && process.stdin.isTTY) {
    process.once("exit", handleProcessExit);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    attachStdin();
  }
}

function releaseStdin() {
  if (--stdinRefCount === 0 && process.stdin.isTTY) {
    process.off("exit", handleProcessExit);
    restoreTerminalInput();
  }
}

function acquireMouse() {
  if (++mouseRefCount === 1 && process.stdin.isTTY) {
    process.stdout.write(ENABLE_MOUSE_SGR);
  }
}

function releaseMouse() {
  if (mouseRefCount === 0) return;
  if (--mouseRefCount === 0 && process.stdin.isTTY) {
    process.stdout.write(DISABLE_MOUSE_SGR);
  }
}

/**
 * Listen to key events
 * @param callback The callback to call when a key event is detected
 * @example
 * ```ts
 * useInput((key) => {
 *   console.log(key.name); // "up", "down", "left", "right", "home", "end", "delete", "pageup", "pagedown"
 * });
 */
export function useInput(callback: (key: Key) => void): void {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    if (!process.stdin.isTTY) return;
    const fn = (key: Key) => {
      ref.current(key);
    };
    subscribers.add(fn);
    acquireStdin();
    return () => {
      subscribers.delete(fn);
      releaseStdin();
    };
  }, []);
}

/**
 * Listen to mouse events
 * 
 * ```ts
 * useMouse((mouse) => {
 *   console.log(mouse.button); // "left", "right", "middle", "wheel-up", "wheel-down", "none"
 * });
 * ```
 * @param callback The callback to call when a mouse event is detected
 */
export function useMouse(callback: (mouse: MouseInfo) => void): void {
  useInput(({ mouse }) => {
    if (mouse) callback(mouse);
  });

  useEffect(() => {
    if (!process.stdin.isTTY) return;
    acquireMouse();
    return () => {
      releaseMouse();
    };
  }, []);
}

/**
 * Enables `onClick` prop dispatching on rendered elements.
 * Call once in your root component. Left-clicks are matched against the visible
 * text of elements that have an `onClick` prop.
 */
export function useClick(): void {
  useMouse((m) => {
    if (m.button === "left" && m.action === "press") dispatchClick(m.column, m.row);
  });
}

/**
 * Get the terminal dimensions
 * @returns The terminal width and height
 */
export function useTerminalResolution(): { columns: number; rows: number } {
  const [dims, setDims] = useState({ columns: process.stdout.columns, rows: process.stdout.rows });
  useEffect(() => {
    const onResize = () => setDims({ columns: process.stdout.columns, rows: process.stdout.rows });
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);
  return dims;
}
