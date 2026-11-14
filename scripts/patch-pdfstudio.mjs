import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(process.cwd(), "node_modules", "pdfstudio", "dist");
const patches = [
  {
    path: join(root, "runner.js"),
    from: 'import("node" + ":fs/promises")',
    to: 'import(/* webpackIgnore: true */ ("node" + ":fs/promises"))',
  },
  {
    path: join(root, "wasm", "qpdf.js"),
    from: 'import("node:module")',
    to: 'import(/* webpackIgnore: true */ "node:module")',
  },
];

for (const patch of patches) {
  let source = await readFile(patch.path, "utf8");
  if (source.includes(patch.to)) continue;
  if (!source.includes(patch.from)) {
    throw new Error("Unexpected pdfstudio source; cannot apply browser compatibility patch: " + patch.path);
  }
  source = source.replace(patch.from, patch.to);
  await writeFile(patch.path, source);
}
console.log("Applied browser-only bundler compatibility patch to pdfstudio.");
