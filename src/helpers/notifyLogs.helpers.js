export function tailLogs(text, maxLines = 60, maxChars = 8000) {
  const redacted = text
    .replace(
      /(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s]+/gi,
      "$1=[REDACTED]",
    )
    .slice(-maxChars);

  return redacted.split("\n").slice(-maxLines).join("\n");
}

export function oneLine(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function defaultSummary(payload) {
  if (payload.status === "started") {
    return `Deployment started for ${payload.repo} on ${payload.branch}`;
  }
  if (payload.status === "success") {
    return `Deployment succeeded for ${payload.repo} on ${payload.branch}`;
  }
  return `Deployment failed for ${payload.repo} on ${payload.branch}`;
}

export function formatDateTime(value, locale = "en-IN", timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function trimBlock(text, maxLines = 40, maxChars = 3000) {
  const normalized = String(text ?? "")
    .trim()
    .slice(-maxChars);
  return normalized.split("\n").slice(-maxLines).join("\n");
}
