import { Octokit } from "@octokit/rest";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

/**
 * Sets a commit status — what you see as the green/red check rows on a commit.
 *
 * @param {Object} opts
 * @param {string} opts.owner       - GitHub repo owner (user or org)
 * @param {string} opts.repo        - Repo name
 * @param {string} opts.sha         - Full commit SHA
 * @param {string} opts.state       - "pending" | "success" | "failure"
 * @param {string} opts.context     - Label shown in the UI, e.g. "deploy/staging"
 * @param {string} opts.description - Short summary, shown next to the icon (max 140 chars)
 * @param {string} opts.targetUrl   - "Details" link GitHub shows next to the status
 */
export default function deployStatusUpdater(
  repoOwner,
  deployContext,
  repoName,
  commitSha,
  logsTargetUrl,
) {
  return async (state, description) => {
    try {
      // skip silently if token not configured
      if (!process.env.GITHUB_TOKEN) return;

      const { data } = await octokit.repos.createCommitStatus({
        owner: repoOwner,
        repo: repoName,
        sha: commitSha,
        state, // required
        context: deployContext, // the label/name row shown on the commit
        description, // short text shown next to icon
        target_url: logsTargetUrl, // "Details" link
      });

      console.log(`[${data.context}] → ${data.state}`);
      console.log(`  Description : ${data.description}`);
      console.log(`  Details URL : ${data.target_url}`);
      console.log(`  Status URL  : ${data.url}`);
      return data;
    } catch (err) {
      console.error(`[deployStatus] Failed to update status to ${state}:`, err);
    }
  };
}

// ── Example: lifecycle of a deployment ─────────────────────────────────────

// const config = {
//   owner: "your-org",
//   repo: "your-repo",
//   sha: "a1b2c3d4e5f6...", // full 40-char commit SHA
// };

// 1. Mark as pending when deploy starts
// await setDeployStatus({
//   ...config,
//   state: "pending",
//   context: "deploy/production",
//   description: "Deployment in progress...",
//   targetUrl: "https://your-ci.example.com/runs/123",
// });

// ... your actual deploy logic here ...

// 2. Mark as success when done
// await setDeployStatus({
//   ...config,
//   state: "success",
//   context: "deploy/production",
//   description: "Deployed to production ✓",
//   targetUrl: "https://your-ci.example.com/runs/123",
// });

// Or on failure:
// await setDeployStatus({
//   ...config,
//   state:       "failure",
//   context:     "deploy/production",
//   description: "Deployment failed — see logs",
//   targetUrl:   "https://your-ci.example.com/runs/123",
// });
