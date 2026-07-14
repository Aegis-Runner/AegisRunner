// Tiny flag parser — zero deps by design (this package must install instantly
// in CI containers). Spec: { flagName: { type: 'bool'|'string'|'list'|'int',
// default? } }. Flags are --kebab-case on the wire, camelCase in the result.
// Booleans support --no-<flag> so default-true flags (e.g. --wait) can be
// turned off.

const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export function parseArgs(argv, spec) {
  const opts = {};
  const positional = [];
  const byFlag = new Map(); // '--suite' -> ['suite', def]
  for (const [name, def] of Object.entries(spec)) {
    byFlag.set('--' + kebab(name), [name, def]);
    if (def.type === 'bool') byFlag.set('--no-' + kebab(name), [name, { ...def, negated: true }]);
    if (def.default !== undefined) opts[name] = def.default;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    // --flag=value form
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const entry = byFlag.get(flag);
    if (!entry) throw new UsageError(`Unknown flag: ${flag}`);
    const [name, def] = entry;
    if (def.type === 'bool') {
      opts[name] = !def.negated;
      continue;
    }
    let value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined) throw new UsageError(`Flag ${flag} requires a value`);
    if (def.type === 'int') {
      value = Number.parseInt(value, 10);
      if (Number.isNaN(value)) throw new UsageError(`Flag ${flag} expects a number`);
    }
    if (def.type === 'list') (opts[name] ??= []).push(value);
    else opts[name] = value;
  }
  return { opts, positional };
}

// Distinguishes "you typed it wrong" (exit 2 + usage hint) from runtime errors.
export class UsageError extends Error {}
