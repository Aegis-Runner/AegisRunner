// Client-side JUnit XML builder. Terminal /ci/runs/:id responses include a
// `cases` array (name/suiteName/status/durationMs/errorMessage) — when
// present we emit REAL per-case rows grouped by suite. Older backends only
// expose aggregate counts, so we fall back to synthesizing one <testcase>
// per counted case (correct totals, dashboard link for detail).

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[c]));

export function buildJUnit(run, dashboardUrl) {
  if (Array.isArray(run.cases) && run.cases.length) return buildJUnitFromCases(run);
  return buildJUnitFromCounts(run, dashboardUrl);
}

function buildJUnitFromCases(run) {
  const timestamp = run.createdAt ? String(run.createdAt).replace(/\.\d+.*$/, '') : '';
  // Group by the case's own suite so mixed multi-suite runs report correctly.
  const bySuite = new Map();
  for (const c of run.cases) {
    const suite = c.suiteName || 'Tests';
    if (!bySuite.has(suite)) bySuite.set(suite, []);
    bySuite.get(suite).push(c);
  }
  let total = 0, failures = 0, skipped = 0, timeMs = 0;
  const suites = [];
  for (const [suite, cs] of bySuite) {
    let sFail = 0, sSkip = 0, sTime = 0;
    const rows = cs.map((c) => {
      const t = ((c.durationMs ?? 0) / 1000).toFixed(3);
      sTime += c.durationMs ?? 0;
      if (c.status === 'skipped') {
        sSkip++;
        return `    <testcase name="${esc(c.name)}" classname="${esc(suite)}" time="${t}"><skipped/></testcase>`;
      }
      if (c.status !== 'passed') {
        sFail++;
        return `    <testcase name="${esc(c.name)}" classname="${esc(suite)}" time="${t}">
      <failure message="${esc(c.errorMessage || c.status)}"${c.failureType ? ` type="${esc(c.failureType)}"` : ''}/>
    </testcase>`;
      }
      return `    <testcase name="${esc(c.name)}" classname="${esc(suite)}" time="${t}"/>`;
    });
    total += cs.length; failures += sFail; skipped += sSkip; timeMs += sTime;
    suites.push(`  <testsuite name="${esc(suite)}" tests="${cs.length}" failures="${sFail}" skipped="${sSkip}" time="${(sTime / 1000).toFixed(3)}"${timestamp ? ` timestamp="${esc(timestamp)}"` : ''}>
${rows.join('\n')}
  </testsuite>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="AegisRunner" tests="${total}" failures="${failures}" skipped="${skipped}" time="${(timeMs / 1000).toFixed(3)}">
${suites.join('\n')}
</testsuites>
`;
}

function buildJUnitFromCounts(run, dashboardUrl) {
  const passed = run.passedCases ?? 0;
  const failed = run.failedCases ?? 0;
  const skipped = run.skippedCases ?? 0;
  const total = run.totalCases ?? passed + failed + skipped;
  const timeSec = ((run.duration_ms ?? 0) / 1000).toFixed(3);
  // Spread run time evenly — we only know the total.
  const perCase = total > 0 ? ((run.duration_ms ?? 0) / total / 1000).toFixed(3) : '0.000';
  const timestamp = run.createdAt ? String(run.createdAt).replace(/\.\d+.*$/, '') : '';
  const detail = dashboardUrl ? ` Details: ${dashboardUrl}` : '';

  const cases = [];
  const cls = 'aegisrunner.run';
  for (let i = 1; i <= passed; i++) {
    cases.push(`    <testcase name="passed case ${i} of ${total}" classname="${cls}" time="${perCase}"/>`);
  }
  for (let i = 1; i <= failed; i++) {
    cases.push(`    <testcase name="failed case ${i} of ${total}" classname="${cls}" time="${perCase}">
      <failure message="${esc(`Test case failed (run ${run.id}, status ${run.status}).${detail}`)}"/>
    </testcase>`);
  }
  for (let i = 1; i <= skipped; i++) {
    cases.push(`    <testcase name="skipped case ${i} of ${total}" classname="${cls}" time="${perCase}">
      <skipped/>
    </testcase>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="AegisRunner" tests="${total}" failures="${failed}" skipped="${skipped}" time="${timeSec}">
  <testsuite name="AegisRunner run ${esc(run.id ?? '')}" tests="${total}" failures="${failed}" skipped="${skipped}" time="${timeSec}"${timestamp ? ` timestamp="${esc(timestamp)}"` : ''}>
${cases.join('\n')}
  </testsuite>
</testsuites>
`;
}
