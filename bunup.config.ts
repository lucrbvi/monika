import { defineConfig } from "bunup";

export default defineConfig([
  {
    name: "library",
    entry: ["src/index.ts"],
    target: "bun",
    minify: true,
    dts: { tsgo: true },
    clean: true,
    banner: "// MONIKA - React renderer for the terminal, powered by Bun's markdown API",
  },
  {
    name: "cli",
    entry: "example.tsx",
    target: "bun",
    minify: true,
    compile: true,
  },
]);
