import { NodeSSH } from "node-ssh";

export default async function sshAndGetCommandRunner(
  sshKeyName,
  host,
  username,
  logCollector,
) {
  const sshClient = new NodeSSH();
  const sshPrivateKey = process.env[sshKeyName];
  if (!sshPrivateKey) {
    throw new Error(
      "SSH private key env var is missing — cannot connect to remote host.",
    );
  }
  await sshClient.connect({
    host,
    username,
    privateKey: sshPrivateKey,
  });

  return async (command, options, ignoreError = false) => {
    const result = await sshClient.execCommand(command, {
      ...options,
      onStdout: logCollector.onStdout,
      onStderr: logCollector.onStderr,
    });

    const exitCode = typeof result.code === "number" ? result.code : 0;
    if (exitCode !== 0 && !ignoreError) {
      const err = new Error(
        `Remote command failed (exit ${exitCode}): ${command}`,
      );
      err.exitCode = exitCode;
      err.stdout = result.stdout;
      err.stderr = result.stderr;
      throw err;
    }

    return result;
  };
}
