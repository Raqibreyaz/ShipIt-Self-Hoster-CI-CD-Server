import path from "node:path";
import createLogCollector from "../helpers/createLogCollector.js";
import deployStatusUpdater from "./deployStatus.service.js";
import sshAndGetCommandRunner from "../helpers/sshAndGetCommandRunner.js";
import getLocalCommandRunner from "../helpers/getLocalCommandRunner.js";

// ---------------------------------------------------------------------------
// runDeployment — executes all SSH steps, returns a structured DeploymentResult
//
// @param {object} deployConfig  — one entry from settings.json, enriched with
//                                 `shouldInstall` by the controller.
// @returns {DeploymentResult}
//   {
//     status:     "success" | "failed",
//     startedAt:  Date,
//     finishedAt: Date,
//     durationMs: number,
//     exitCode:   number,
//     signal:     string | null,
//     fullLog:    string,   // combined stdout+stderr (up to collector limit)
//   }
// ---------------------------------------------------------------------------
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

  try {
    const releaseDirName = new Date().toISOString().replace(/[:.]/g, "-");
    const releaseRoot = `${projectRoot}/releases/${releaseDirName}`;
    const workingDirFullPath = path.posix.join(releaseRoot, workingDirName);
    const runId = `${deliveryId}:backend`;

    const logServerUrl = process.env.LOG_SERVER_URL;
    if (!logServerUrl) {
      throw new Error("Log server URL env var is missing.");
    }
    logsTargetUrl = `${logServerUrl}/logs/${runId}`;
    const updateStatus = deployStatusUpdater();

    await updateStatus("pending", "Backend Deployment in Progress...");

    // get command runner on basis of ssh/local
    const runCommand =
      deployConfig.target.type === "ssh"
        ? sshAndGetCommandRunner(
            deployConfig.target.auth.sshKey,
            deployConfig.target.host,
            deployConfig.target.username,
            logCollector,
          )
        : getLocalCommandRunner(logCollector);

    // create a release directory into the releases dir
    await runCommand(`mkdir -p "${projectRoot}/releases"`, {});

    // clone the repo as the new release directory(only required branch)
    await runCommand(
      `git clone -b "${branch}" --single-branch "https://github.com/${repoFullName}" "${releaseRoot}"`,
      {},
    );

    // install dependencies into the new release directory
    await runCommand(deployConfig.workflow.install, {
      cwd: workingDirFullPath,
    });

    // build the project(if needed)
    if (deployConfig.workflow.build) {
      await runCommand(deployConfig.workflow.build, {
        cwd: workingDirFullPath,
      });
    }

    // symlink the shared .env file
    await runCommand(
      `ln -sfn "${projectRoot}/shared/.env" "${workingDirFullPath}/.env"`,
      {},
    );

    // store the previous release dir for rollback case
    const previousReleaseResult = await runCommand(
      `readlink ./current`,
      { cwd: projectRoot },

      true,
    );
    const previousReleaseDir = previousReleaseResult.stdout?.trim() || null;

    // update the 'current' symlink to point on the new working dir release
    await runCommand(`ln -sfn "${releaseRoot}" ./current`, {
      cwd: projectRoot,
    });

    // reload the server
    await runCommand(deployConfig.workflow.reload, { cwd: projectRoot });

    // do a health-check to confirm it is up and running
    const healthUrl =
      deployConfig.target.healthUrl || "http://127.0.0.1:3000/health";
    const healthResult = await runCommand(
      `curl -fsS -o /dev/null "${healthUrl}"`,
      {},

      true, //ignore error
    );

    if (healthResult.code !== 0) {
      logCollector.onStdout("Health check failed. Starting rollback...");

      /* roll back to previous code */
      if (previousReleaseDir) {
        // update the 'current' symlink to point on the previous release
        await runCommand(`ln -sfn "${previousReleaseDir}" ./current`, {
          cwd: projectRoot,
        });
        // reload the server
        await runCommand(deployConfig.workflow.reload, { cwd: projectRoot });

        // remove the current release directory
        await runCommand(`rm -rf "${releaseRoot}"`, {});
      }

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
