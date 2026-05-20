export default function checkChangesAndInstallationRequirement(commits) {
  if (!commits || !Array.isArray(commits)) {
    console.log("commits should be an array.");
    return { hasChanges: false, shouldInstall: false };
  }

  const changedFiles = commits.flatMap((commit) => [
    ...commit.added,
    ...commit.removed,
    ...commit.modified,
  ]);

  console.log("checking backend changes...");

  const hasChanges = changedFiles.some((f) => {
    const name = f.toLowerCase();
    return name.startsWith("backend/") && !name.endsWith(".md");
  });

  if (!hasChanges) {
    console.log("no changes in backend, ignoring deployment!!");
    return { hasChanges, shouldInstall: false };
  }

  // do 'pnpm install' when package.json changed
  console.log("checking new packages installation requirement...");
  const shouldInstall = changedFiles.some((f) => {
    const name = f.toLowerCase();
    return name === "backend/package.json" || name === "backend/pnpm-lock.yaml";
  });

  if (!shouldInstall) console.log("no new package installation required!!");

  return { hasChanges, shouldInstall };
}
