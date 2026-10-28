import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function readStylesheet(path: string): string {
  return readFileSync(path, "utf8").replace(/@import\s+["']([^"']+)["'];/g, (_match, imported: string) =>
    readStylesheet(resolve(dirname(path), imported)),
  );
}

export function readAppCss(): string {
  return readStylesheet(resolve(process.cwd(), "src/app.css"));
}
