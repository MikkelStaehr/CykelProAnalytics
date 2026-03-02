import { spawn } from "child_process";
import path from "path";

export interface ScriptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Last non-empty line of stdout, parsed as JSON. Null if unparseable. */
  parsed: Record<string, unknown> | null;
}

/**
 * Run a Python script as a child process and collect its output.
 *
 * stdout is returned in full (progress lines + final JSON line).
 * The last non-empty stdout line is parsed as JSON for convenience.
 * Inherits the current process environment so .env.local vars are available.
 */
export async function runScript(
  scriptName: string,
  args: string[]
): Promise<ScriptResult> {
  const scriptPath = path.join(process.cwd(), "scripts", scriptName);

  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath, ...args], {
      env: process.env as NodeJS.ProcessEnv,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const lines = stdout.split("\n").filter((l) => l.trim() !== "");
      const lastLine = lines[lines.length - 1] ?? "";

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(lastLine);
      } catch {
        // stdout didn't end with JSON — that's fine, caller handles it
      }

      resolve({ exitCode: code ?? 1, stdout, stderr, parsed });
    });
  });
}
