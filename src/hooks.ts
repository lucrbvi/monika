import { useEffect, useRef, useState } from "react";

export type Key = {
  raw: Buffer;
  ctrl: boolean;
  name: string | null;
};

const ESCAPE_NAMES: Record<string, string> = {
  "[A": "up", "[B": "down", "[C": "right", "[D": "left",
  "[H": "home", "[F": "end",
  "[3~": "delete", "[5~": "pageup", "[6~": "pagedown",
};

function parseKey(data: Buffer): Key {
  const ctrl = data[0] !== undefined && data[0] < 32;

  let name: string | null = null;
  if (data[0] === 0x1b && data.length > 1) {
    name = ESCAPE_NAMES[data.subarray(1).toString()] ?? null;
  } else if (data.length === 1 && data[0] !== undefined) {
    name = ctrl
      ? String.fromCharCode(data[0] + 64).toLowerCase()
      : String.fromCharCode(data[0]);
  }

  return { raw: data, ctrl, name };
}

let stdinRefCount = 0;

function acquireStdin() {
  if (++stdinRefCount === 1 && process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
}

function releaseStdin() {
  if (--stdinRefCount === 0 && process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

export function useInput(callback: (key: Key) => void): void {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    if (!process.stdin.isTTY) return;
    acquireStdin();

    const onData = (data: Buffer) => ref.current(parseKey(data));
    process.stdin.on("data", onData);

    return () => {
      process.stdin.off("data", onData);
      releaseStdin();
    };
  }, []);
}

export function useTerminal(): { columns: number; rows: number } {
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
