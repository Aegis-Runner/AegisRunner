// Thin client over the CI trigger API (backend/internal/handlers/ci_trigger.go).
// Auth is a CI trigger token ("aegis_..." — Manage → CI/CD);
// the backend accepts it with or without the aegis_ prefix, we pass it as-is.

export const DEFAULT_API = 'https://app.aegisrunner.com/api/v1';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function makeClient({ api, token }) {
  const base = (api || DEFAULT_API).replace(/\/+$/, '');
  const request = async (method, path, body) => {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError(0, `Cannot reach ${base}: ${err.cause?.message || err.message}`);
    }
    // Fiber error responses are {error|message: "..."} JSON; fall back to raw text.
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { message: text }; }
    if (!res.ok && res.status !== 202) {
      throw new ApiError(res.status, data.error || data.message || `HTTP ${res.status}`);
    }
    return data;
  };

  return {
    trigger: (body) => request('POST', '/ci/trigger', body),
    runStatus: (runId) => request('GET', `/ci/runs/${encodeURIComponent(runId)}`),
  };
}

// Poll GET /ci/runs/:id until isFinished, with a single rewriting progress
// line on TTYs (CI logs get one line per poll-minute instead, to avoid \r spam).
export async function pollRun(client, runId, { timeoutSec, intervalMs = 5000, log }) {
  const deadline = Date.now() + timeoutSec * 1000;
  const started = Date.now();
  let lastPlainLog = 0;
  for (;;) {
    const run = await client.runStatus(runId);
    if (run.isFinished) {
      if (process.stderr.isTTY) process.stderr.write('\n');
      return run;
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    const line = `[aegis] ${run.status} — ${run.passedCases ?? 0} passed, ${run.failedCases ?? 0} failed, ` +
      `${run.skippedCases ?? 0} skipped of ${run.totalCases ?? '?'} (${elapsed}s)`;
    if (process.stderr.isTTY) {
      process.stderr.write('\r\x1b[2K' + line);
    } else if (Date.now() - lastPlainLog > 60_000) {
      log(line);
      lastPlainLog = Date.now();
    }
    if (Date.now() + intervalMs > deadline) {
      if (process.stderr.isTTY) process.stderr.write('\n');
      throw new ApiError(0, `Timed out after ${timeoutSec}s waiting for run ${runId} (still ${run.status})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
