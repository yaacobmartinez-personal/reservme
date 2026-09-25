/**
 * `next dev`, but against the Neon database in .env.local.
 *
 * It copies exactly one variable across — DATABASE_URL — and leaves the rest of
 * .env.development.local in charge. That is deliberate: .env.local also holds
 * RESEND_API_KEY, and a dev server that quietly inherited it would send real
 * mail to whatever address a test typed.
 *
 * Next's own loader never overwrites a variable that is already set, so the one
 * we put in process.env here wins over the docker URL.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

function readVar(file, name) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`${file} not found — it holds the Neon DATABASE_URL.`);
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (match && match[1] === name) {
      return match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error(`${name} is not set in ${file}.`);
}

const url = readVar(".env.local", "DATABASE_URL");
const host = new URL(url.replace(/^postgresql:/, "http:")).host;
console.log(`dev server -> ${host}\n`);

spawn(process.execPath, ["./node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
}).on("exit", (code) => process.exit(code ?? 0));
