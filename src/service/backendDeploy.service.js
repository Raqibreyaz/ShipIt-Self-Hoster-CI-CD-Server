import path from "node:path";
import { NodeSSH } from "node-ssh";
import createLogCollector from "../helpers/createLogCollector.js";
import runRemoteCommand from "../helpers/runRemoteCommand.js";
import setDeployStatus from "./deployStatus.service.js";

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
export async function runDeployment(deployConfig, deliveryId, commitSha) {
  const sshClient = new NodeSSH();
  const logCollector = createLogCollector();
  const startedAt = new Date();

  const repoOwner = deployConfig.trigger.owner;
  const deployContext = deployConfig.trigger.context;
  const repo = deployConfig.trigger.repo;
  const branch = deployConfig.trigger?.branch ?? "main";
  const projectRoot = deployConfig.target.projectPath;
  const workingDirName = deployConfig.workflow.workDir ?? "";

  const releaseDirName = new Date().toISOString().replace(/[:.]/g, "-");
  const releaseRoot = `${projectRoot}/releases/${releaseDirName}`;
  const workingDirFullPath = path.posix.join(releaseRoot, workingDirName);

  const sshPrivateKey = process.env[deployConfig.target.auth.sshKey];
  if (!sshPrivateKey) {
    throw new Error(
      "SSH private key env var is missing — cannot connect to remote host.",
    );
  }

  const logServerUrl = process.env.LOG_SERVER_URL;
  if (!logServerUrl) {
    throw new Error("Log server URL env var is missing.");
  }
  const logsTargetUrl = `${logServerUrl}/logs/${deliveryId}`;

  try {
    await setDeployStatus({
      owner: repoOwner,
      context: deployContext,
      description: "Deployment in Progress...",
      repo,
      sha: commitSha,
      state: "pending",
      targetUrl: logsTargetUrl,
    });

    await sshClient.connect({
      host: deployConfig.target.host,
      username: deployConfig.target.username,
      privateKey: sshPrivateKey,
    });

    // create a release directory into the releases dir
    await runRemoteCommand(
      sshClient,
      `mkdir -p "${projectRoot}/releases"`,
      {},
      logCollector,
    );

    // clone the repo as the new release directory(only required branch)
    await runRemoteCommand(
      sshClient,
      `git clone -b "${branch}" --single-branch "https://github.com/${repo}" "${releaseRoot}"`,
      {},
      logCollector,
    );

    // install dependencies into the new release directory
    await runRemoteCommand(
      sshClient,
      deployConfig.workflow.install,
      { cwd: workingDirFullPath },
      logCollector,
    );

    // build the project(if needed)
    if (deployConfig.workflow.build) {
      await runRemoteCommand(
        sshClient,
        deployConfig.workflow.build,
        { cwd: workingDirFullPath },
        logCollector,
      );
    }

    // symlink the shared .env file
    await runRemoteCommand(
      sshClient,
      `ln -sfn "${projectRoot}/shared/.env" "${workingDirFullPath}/.env"`,
      {},
      logCollector,
    );

    // store the previous release dir for rollback case
    const previousReleaseResult = await runRemoteCommand(
      sshClient,
      `readlink ./current`,
      { cwd: projectRoot },
      logCollector,
      true,
    );
    const previousReleaseDir = previousReleaseResult.stdout?.trim() || null;

    // update the 'current' symlink to point on the new working dir release
    await runRemoteCommand(
      sshClient,
      `ln -sfn "${releaseRoot}" ./current`,
      { cwd: projectRoot },
      logCollector,
    );

    // reload the server
    await runRemoteCommand(
      sshClient,
      deployConfig.workflow.reload,
      { cwd: projectRoot },
      logCollector,
    );

    // do a health-check to confirm it is up and running
    const healthUrl =
      deployConfig.target.healthUrl || "http://127.0.0.1:3000/health";
    const healthResult = await runRemoteCommand(
      sshClient,
      `curl -fsS -o /dev/null "${healthUrl}"`,
      {},
      logCollector,
      true, //ignore error
    );

    if (healthResult.code !== 0) {
      logCollector.onStdout("Health check failed. Starting rollback...");

      /* roll back to previous code */
      if (previousReleaseDir) {
        // update the 'current' symlink to point on the previous release
        await runRemoteCommand(
          sshClient,
          `ln -sfn "${previousReleaseDir}" ./current`,
          { cwd: projectRoot },
          logCollector,
        );
        // reload the server
        await runRemoteCommand(
          sshClient,
          deployConfig.workflow.reload,
          { cwd: projectRoot },
          logCollector,
        );

        // remove the current release directory
        await runRemoteCommand(
          sshClient,
          `rm -rf "${releaseRoot}"`,
          {},
          logCollector,
        );
      }

      throw new Error("Health check failed. Rolled back to previous version.");
    }

    logCollector.onStdout("Server Health Check Passed Successfully.");

    await setDeployStatus({
      owner: repoOwner,
      context: deployContext,
      description: "Deployment successfully Completed.",
      repo,
      sha: commitSha,
      state: "success",
      targetUrl: logsTargetUrl,
    });

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
    await setDeployStatus({
      owner: repoOwner,
      context: deployContext,
      description: "Deployment failed.",
      repo,
      sha: commitSha,
      state: "failure",
      targetUrl: logsTargetUrl,
    });

    return {
      status: "failed",
      startedAt,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      exitCode: error?.exitCode ?? 1,
      signal: null,
      fullLog:
        logCollector.getCombined() || error?.stderr || error?.message || "",
    };
  } finally {
    sshClient.dispose();
  }
}
