/**
 * `node-sql-parser` has incomplete PostgreSQL coverage: it cannot parse a column
 * whose type is a user-defined type (e.g. `"status" my_enum NOT NULL`) nor some
 * built-in / extension types such as `TIMETZ` or `VECTOR(n)` (pgvector), even
 * though drawDB itself understands all of them.
 *
 * It does, however, accept a double-quoted identifier in the type position. So we
 * quote the offending type usages (parentheses included) before parsing, turning
 * them into opaque identifiers the parser tolerates. `importSQL/postgres.js` then
 * unwraps the quotes and resolves the real type (matching custom enums/composite
 * types, or looking the name up in drawDB's type table).
 *
 * This is a no-op for SQL that declares no custom types and uses no unsupported
 * built-ins.
 */

// Built-in / extension PostgreSQL types drawDB supports but node-sql-parser
// cannot parse natively. Lower-case; matched case-insensitively.
const UNSUPPORTED_BUILTIN_TYPES = ["timetz", "vector", "halfvec", "sparsevec"];

export function quoteCustomTypes(sql) {
  const names = [];

  const declRe = /CREATE\s+TYPE\s+("?)([A-Za-z0-9_$]+)\1\s+AS\b/gi;
  let m;
  while ((m = declRe.exec(sql)) !== null) {
    names.push(m[2]);
  }

  for (const t of UNSUPPORTED_BUILTIN_TYPES) {
    if (!names.some((n) => n.toLowerCase() === t)) names.push(t);
  }

  // Replace longer names first so a shorter name can't partially match a longer
  // one that shares its prefix.
  names.sort((a, b) => b.length - a.length);

  let out = sql;
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A bare usage of the type with an optional `(size)`/`(precision,scale)`,
    // surrounded by separators. The leading separator class excludes `"`, so
    // already-quoted usages are left untouched.
    const usageRe = new RegExp(
      `(^|[\\s(,])(${esc})(\\s*\\([^)]*\\))?(?=[\\s,)[])`,
      "gi",
    );
    out = out.replace(usageRe, (full, pre, _tok, paren, offset, str) => {
      // Don't touch the `CREATE TYPE <name>` declaration itself.
      const before = str.slice(Math.max(0, offset - 16), offset + pre.length);
      if (/\bTYPE\s*$/i.test(before)) return full;
      const size = paren ? paren.replace(/\s+/g, "") : "";
      return `${pre}"${name}${size}"`;
    });
  }

  return out;
}
