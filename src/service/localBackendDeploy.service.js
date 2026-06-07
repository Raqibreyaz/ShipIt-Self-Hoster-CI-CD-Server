import path from "node:path";
import createLogCollector from "../helpers/createLogCollector.js";
import setDeployStatus from "./deployStatus.service.js";

export default async function runBackendDeployment(
  deployConfig,
  deliveryId,
  commitSha,
) {
  const logCollector = createLogCollector();
  const startedAt = new Date();

  const deployContext = deployConfig.trigger.context;
  const repoFullName = deployConfig.trigger.repo;
  const [repoOwner, repoName] = deployConfig.trigger.repo.split("/");
  const branch = deployConfig.trigger?.branch ?? "main";
  const projectRoot = deployConfig.target.projectPath;
  const workingDirName = deployConfig.workflow.workDir ?? "";

  let logsTargetUrl;

  const updateStatus = async (state, description) => {
    try {
      await setDeployStatus({
        owner: repoOwner,
        context: deployContext,
        description,
        repo: repoName,
        sha: commitSha,
        state,
        targetUrl: logsTargetUrl,
      });
    } catch (err) {
      console.error(`[deployStatus] Failed to update status to ${state}:`, err);
    }
  };

  try {
    const healthUrl =
      deployConfig.target.healthUrl || "http://127.0.0.1:3000/health";
    const releaseDirName = new Date().toISOString().replace(/[:.]/g, "-");
    const releaseRoot = `${projectRoot}/releases/${releaseDirName}`;
    const workingDirFullPath = path.posix.join(releaseRoot, workingDirName);

    const logServerUrl = process.env.LOG_SERVER_URL;
    if (!logServerUrl) {
      throw new Error("Log server URL env var is missing.");
    }
    const runId = `${deliveryId}:backend`;
    logsTargetUrl = `${logServerUrl}/logs/${runId}`;

    await updateStatus("pending", "Backend Deployment in Progress...");

    `
        mkdir -p "${projectRoot}/releases"
        
        git clone -b "${branch}" --single-branch "https://github.com/${repoFullName}" "${releaseRoot}"

        cd ${workingDirFullPath}
        ${deployConfig.workflow.install}

        ${deployConfig.workflow.build ?? ""}

        ln -sfn "${projectRoot}/shared/.env" "${workingDirFullPath}/.env"

        cd ${projectRoot}
        readlink ./current

        ln -sfn "${releaseRoot}" ./current

        ${deployConfig.workflow.reload}

        curl -fsS -o /dev/null "${healthUrl}"
    `;

    const previousReleaseDir = previousReleaseResult.stdout?.trim() || null;

    // do a health-check to confirm it is up and running
    const healthResult = {};

    if (healthResult.code !== 0) {
      logCollector.onStdout("Health check failed. Starting rollback...");

      const failScript = `
        cd ${projectRoot}

        ln -sfn "${previousReleaseDir}" ./current

        ${deployConfig.workflow.reload}

        ${previousReleaseDir ? `rm -rf "${releaseRoot}"` : ""}
        `;

      throw new Error("Health check failed. Rolled back to previous version.");
    }

    logCollector.onStdout("Server Health Check Passed Successfully.");

    await updateStatus("success", "Backend Deployment successfully Completed.");

    return {
      status: "success",
      startedAt,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      exitCode: 0,
      signal: null,
      fullLog: logCollector.getCombined(),
    };
  } catch (error) {
    logCollector.onStderr(`Deployment execution error: ${error.message}`);
    await updateStatus("failure", "Backend Deployment failed.");

    return {
      status: "failed",
      startedAt,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      exitCode: 1,
      signal: null,
      fullLog: logCollector.getCombined(),
    };
  } finally {
    sshClient.dispose();
  }
}
