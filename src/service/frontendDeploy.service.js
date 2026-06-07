import path from "node:path";
import { spawn } from "node:child_process";
import createLogCollector from "../helpers/createLogCollector.js";
import deployStatusUpdater from "./deployStatus.service.js";

export default async function runFrontendDeployment(
  deployConfig,
  deliveryId,
  commitSha,
) {
  const logCollector = createLogCollector();
  const startedAt = new Date();

  const siteMode = deployConfig.workflow.mode;
  const deployContext = deployConfig.trigger.context;
  const repoFullName = deployConfig.trigger.repo;
  const [repoOwner, repoName] = repoFullName.split("/");

  try {
    const runId = `${deliveryId}:frontend`;
    const logServerUrl = process.env.LOG_SERVER_URL;
    if (!logServerUrl) {
      throw new Error("Log server URL env var is missing.");
    }
    logsTargetUrl = `${logServerUrl}/logs/${runId}`;
    const updateStatus = deployStatusUpdater(
      repoOwner,
      deployContext,
      repoName,
      commitSha,
      logsTargetUrl,
    );

    await updateStatus("pending", "Frontend Deployment in Progress...");

    const projectName = new Date().toISOString().replace(/[:.]/g, "-");
    const appDir = path.posix.join(
      projectName,
      deployConfig.workflow.workDir ?? "",
    );
    const publishPathInApp =
      siteMode === "static" ? "." : (deployConfig.target.publishDir ?? "dist");

    const bucketName = process.env[deployConfig.target.auth.s3BucketName];
    const cloudfrontId = process.env[deployConfig.target.auth.cloudfrontId];
    const accessKeyId = process.env[deployConfig.target.auth.accessKeyId];
    const secretAccessKey =
      process.env[deployConfig.target.auth.secretAccessKey];
    const region = process.env[deployConfig.target.auth.region];

    if (
      !bucketName ||
      !cloudfrontId ||
      !accessKeyId ||
      !secretAccessKey ||
      !region
    ) {
      throw new Error(
        "Missing required AWS environment variables for frontend deployment.",
      );
    }

    const script = `
        set -e

        export AWS_ACCESS_KEY_ID="${accessKeyId}"
        export AWS_SECRET_ACCESS_KEY="${secretAccessKey}"
        export AWS_REGION="${region}"

        mkdir -p /tmp/s3
        cd /tmp/s3
        git clone "https://github.com/${repoFullName}" "${projectName}"
        cd "${appDir}"

        # download nodejs
        if ! command -v node >/dev/null 2>&1; then
          echo "Node.js not found. Installing..."
          curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -n -E bash - || { echo "Failed to setup Node.js repo"; exit 1; }
          sudo -n apt-get update || true
          sudo -n apt-get install -y nodejs || { echo "Failed to install Node.js"; exit 1; }
        else
          echo "Node.js already installed: $(node -v)"
        fi

        # download aws cli sdk
        if ! command -v aws >/dev/null 2>&1; then
          echo "AWS CLI not found. Installing..."
          curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
          unzip -q /tmp/awscliv2.zip -d /tmp
          sudo -n /tmp/aws/install || { echo "Failed to install AWS CLI"; exit 1; }
          rm -rf /tmp/aws /tmp/awscliv2.zip
        else
          echo "AWS CLI already installed: $(aws --version 2>&1)"
        fi

        # download package manager
        pm=""

        if [ -f pnpm-lock.yaml ]; then
          pm="pnpm"
        elif [ -f yarn.lock ]; then
          pm="yarn"
        elif [ -f package-lock.json ]; then
          pm="npm"
        elif [ -f package.json ]; then
          pm=$(grep -oP '"packageManager"\s*:\s*"\K[^@"]+' package.json || true)
        fi

        echo "Detected package manager: $pm"

        if [ "$pm" = "pnpm" ] && ! command -v pnpm >/dev/null 2>&1; then
          echo "pnpm not installed. Installing..."
          corepack enable || sudo -n npm install -g corepack
          corepack prepare pnpm@latest --activate
        fi

        if [ "$pm" = "yarn" ] && ! command -v yarn >/dev/null 2>&1; then
          echo "yarn not installed. Installing..."
          corepack enable || sudo -n npm install -g corepack
          corepack prepare yarn@stable --activate
        fi

        ${deployConfig.workflow.install ?? ""}
        ${deployConfig.workflow.build ?? ""}

        test -d "${publishPathInApp}" || { echo "Publish dir not found: ${publishPathInApp}"; exit 1; }

        aws s3 sync "${publishPathInApp}" "s3://${bucketName}" --delete

        aws cloudfront create-invalidation --distribution-id "${cloudfrontId}" --paths "/*"
    `;

    const childProcess = spawn("bash", ["-c", script]);

    childProcess.stdout.on("data", logCollector.onStdout);
    childProcess.stderr.on("data", logCollector.onStderr);

    return await new Promise((resolve) => {
      childProcess.on("close", async (code, signal) => {
        if (code === 0) {
          await updateStatus(
            "success",
            "Frontend Deployment successfully Completed.",
          );
          resolve({
            status: "success",
            startedAt,
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            exitCode: 0,
            signal: null,
            fullLog: logCollector.getCombined(),
          });
        } else {
          await updateStatus("failure", "Frontend Deployment Failed.");
          resolve({
            status: "failed",
            startedAt,
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            exitCode: code,
            signal: signal,
            fullLog: logCollector.getCombined(),
          });
        }
      });

      childProcess.on("error", async (error) => {
        logCollector.onStderr(error.message);
        await updateStatus("failure", "Frontend Deployment failed.");
        resolve({
          status: "failed",
          startedAt,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          exitCode: 1,
          signal: null,
          fullLog: logCollector.getCombined(),
        });
      });
    });
  } catch (error) {
    logCollector.onStderr(`Deployment execution error: ${error.message}`);
    await updateStatus("failure", "Frontend Deployment failed.");
    return {
      status: "failed",
      startedAt,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      exitCode: 1,
      signal: null,
      fullLog: logCollector.getCombined(),
    };
  }
}
