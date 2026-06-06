export default function checkChangesAndInstallationRequirement(
  commits,
  deployDirectory,
  packageManifest,
) {
  if (!commits || !Array.isArray(commits)) {
    console.warn("[checkChanges] Expected commits to be an array — skipping.");
    return { hasChanges: false, shouldInstall: false };
  }

  // Guard against commits that don't include all three arrays (GitHub can omit
  // empty ones), and normalise every path to lowercase up-front.
  const changedFiles = commits
    .flatMap((commit) => [
      ...(commit.added ?? []),
      ...(commit.removed ?? []),
      ...(commit.modified ?? []),
    ])
    .map((f) => f.toLowerCase());

  console.log(`[checkChanges] Checking "${deployDirectory}" for changes…`);

  // If no workDir is configured, treat every push as a change.
  const normalizedDir = deployDirectory?.toLowerCase() ?? "";
  const hasChanges =
    !normalizedDir ||
    normalizedDir === "/" ||
    changedFiles.some((f) => f.startsWith(normalizedDir) && !f.endsWith(".md"));

  if (!hasChanges) {
    console.log(
      `[checkChanges] No relevant changes in "${deployDirectory}" — skipping.`,
    );
    return { hasChanges: false, shouldInstall: false };
  }

  // Determine whether a package install step is needed.
  console.log("[checkChanges] Checking for package manifest changes…");
  const shouldInstall =
    Array.isArray(packageManifest) &&
    packageManifest.length > 0 &&
    changedFiles.some(
      (f) =>
        f.startsWith(normalizedDir) &&
        packageManifest.some((manifestFile) =>
          f.endsWith(manifestFile.toLowerCase()),
        ),
    );

  if (!shouldInstall) {
    console.log(
      "[checkChanges] No package manifest changed — install step skipped.",
    );
  }

  return { hasChanges, shouldInstall };
}
