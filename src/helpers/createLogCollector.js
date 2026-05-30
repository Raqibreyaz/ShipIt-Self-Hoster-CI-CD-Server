export default function createLogCollector(limit = 12_000) {
  let stdout = "";
  let stderr = "";

  const append = (current, chunk) => {
    const next = current + chunk;
    return next.length <= limit ? next : next.slice(next.length - limit);
  };

  return {
    onStdout(chunk) {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      stdout = append(stdout, text);
    },
    onStderr(chunk) {
      const text = chunk.toString("utf8");
      process.stderr.write(text);
      stderr = append(stderr, text);
    },
    getStdout() {
      return stdout;
    },
    getStderr() {
      return stderr;
    },
    getCombined() {
      return [stdout, stderr].filter(Boolean).join("\n");
    },
  };
}
