import path from "node:path";
import { spawn } from "node:child_process";
import redisClient from "../config/redis.config.js";
import verifyGithubWebhookSignature from "../helpers/verifyGithubWebhookSignature.helpers.js";
import notifyDeveloper from "../service/notifyDeveloper.service.js";
import checkChangesAndInstallationRequirement from "../helpers/checkChangesAndInstallationRequirement.helpers.js";
import { tailLogs } from "../helpers/notifyLogs.helpers.js";

export const githubWebhook = async (req, res) => {
  const signature = req.headers["x-hub-signature-256"];
  const eventType = req.headers["x-github-event"];
  const deliveryId = req.headers["x-github-delivery"];

  console.log("verifying signature...");
  // reject malformed event
  if (!verifyGithubWebhookSignature(signature, req.body)) {
    console.log("malformed event received!");
    return res.sendStatus(400);
  }

  console.log("signature verified!!");

  // ignore non-push event
  if (eventType !== "push") {
    console.log("non push event received!");
    return res.sendStatus(200);
  }

  // return error for bad delivery id
  if (!deliveryId) return res.sendStatus(400);

  // ignore if the event already processed
  const inserted = await redisClient.set(`github:webhook:${deliveryId}`, "1", {
    expiration: {
      type: "EX",
      value: 60 * 15,
    },
    condition: "NX",
  });
  if (inserted === null) {
    console.log("skipping duplicate event.");
    return res.sendStatus(200);
  }

  const payload = JSON.parse(req.body.toString("utf-8"));

  const { hasChanges, shouldInstall } = checkChangesAndInstallationRequirement(
    payload.commits,
  );

  // skip if no changes done in backend
  if (!hasChanges) {
    return res.sendStatus(200);
  }

  // sending early ACK to github
  res.sendStatus(200);

  const scriptPath = path.join(import.meta.dirname, "..", "scripts/deploy.sh");

  const startedAt = Date.now();
  const headCommit =
    payload.head_commit || payload.commits[payload.commits.length - 1];

  const context = {
    repo: payload.repository?.full_name,
    branch: payload.ref?.replace("refs/heads/", ""),
    commitMessage: headCommit?.message,
    pusher: payload.pusher?.name || payload.sender?.login,
    deliveryId,
    shouldInstall,
  };

  await notifyDeveloper({
    status: "started",
    ...context,
    startedAt: new Date(startedAt).toISOString(),
    summary: `Deployment started for ${context.repo} on branch ${context.branch}`,
  });

  let stdErrBuf = "";
  let stdOutBuf = "";

  const childProcess = spawn("bash", [scriptPath], {
    env: { ...process.env, SHOULD_INSTALL: String(shouldInstall) },
  });

  childProcess.stderr.on("data", (chunk) => {
    stdErrBuf += chunk.toString();
    process.stderr.write(chunk);
  });
  childProcess.stdout.on("data", (chunk) => {
    stdOutBuf += chunk.toString();
    process.stdout.write(chunk);
  });

  childProcess.on("close", async (code, signal) => {
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    const combinedLogs = `${stdOutBuf}\n${stdErrBuf}`.trim();

    if (code === 0) {
      console.log("Script executed successfully!");

      return await notifyDeveloper({
        status: "success",
        ...context,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs,
        exitCode: code,
        signal,
        summary: `Deployment succeeded for ${context.repo} on branch ${context.branch} in ${Math.round(durationMs / 1000)}s`,
        logExcerpt: tailLogs(combinedLogs, 30, 4000),
      });
    }

    await notifyDeveloper({
      status: "failed",
      ...context,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs,
      exitCode: code,
      signal,
      summary: `Deployment failed for ${context.repo} on branch ${context.branch} with exit code ${code ?? "null"}`,
      logExcerpt: tailLogs(combinedLogs || "no logs captured!", 80, 8000),
    });

    console.log("Script failed!");
  });
  childProcess.on("error", async (error) => {
    console.log("Error in spawning the process!", error);

    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    await notifyDeveloper({
      status: "failed",
      ...context,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs,
      exitCode: null,
      signal: null,
      summary: `Deployment process could not start: ${error.message}`,
      logExcerpt: tailLogs(
        `${stdOutBuf}\n${stdErrBuf}\n${error.stack || error.message}`,
      ),
    });
  });
};
