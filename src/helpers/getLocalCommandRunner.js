import { spawn } from "node:child_process";

export default function getLocalCommandRunner(logCollector) {
  return async (command, options, ignoreError = false) => {
    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
        ...options,
      });

      let stdout = "";
      let stderr = "";

      childProcess.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
        logCollector?.onStdout?.(chunk);
      });

      childProcess.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
        logCollector?.onStderr?.(chunk);
      });

      childProcess.on("error", reject);

      childProcess.on("close", (code, signal) => {
        const result = {
          code: code ?? 0,
          signal: signal ?? null,
          stdout,
          stderr,
          failed: (code ?? 0) !== 0,
        };

        if (result.failed && !ignoreError) {
          const err = new Error(
            `Local command failed (exit ${result.code}): ${command}`,
          );
          err.exitCode = result.code;
          err.signal = result.signal;
          err.stdout = result.stdout;
          err.stderr = result.stderr;
          err.result = result;
          reject(err);
          return;
        }

        resolve(result);
      });
    });
  };
}
