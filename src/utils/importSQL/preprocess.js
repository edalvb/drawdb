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

// Splits SQL into top-level statements (by `;`), correctly skipping over line
// and block comments, single-quoted strings, double-quoted identifiers and
// dollar-quoted bodies (`$$ ... $$` / `$tag$ ... $tag$`) — so a `;` inside a
// PL/pgSQL function body does not split a statement.
function splitStatements(sql) {
  const statements = [];
  const n = sql.length;
  let i = 0;
  let start = 0;

  const dollarTagAt = (pos) => {
    const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(pos));
    return m ? m[0] : null;
  };

  while (i < n) {
    const c = sql[i];

    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) {
            i += 2; // escaped quote ('' or "")
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "$") {
      const tag = dollarTagAt(i);
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        continue;
      }
    }
    if (c === ";") {
      statements.push(sql.slice(start, i + 1));
      i++;
      start = i;
      continue;
    }
    i++;
  }
  if (start < n) statements.push(sql.slice(start));
  return statements;
}

// True for statements whose object type drawDB cannot model and node-sql-parser
// cannot parse (functions, procedures, triggers, anonymous blocks, rules,
// policies) or that use an index access method the parser rejects (pgvector's
// hnsw / ivfflat).
function isUnsupportedStatement(statement) {
  // Drop leading comments / whitespace so the keyword check sees the statement.
  const head = statement
    .replace(/^(?:\s|--[^\n]*\n|--[^\n]*$|\/\*[\s\S]*?\*\/)+/g, "")
    .toUpperCase();

  if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|AGGREGATE)\b/.test(head))
    return true;
  if (/^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b/.test(head)) return true;
  if (/^CREATE\s+RULE\b/.test(head)) return true;
  if (/^CREATE\s+POLICY\b/.test(head)) return true;
  if (/^DO\b/.test(head)) return true;
  if (
    /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/.test(head) &&
    /\bUSING\s+(?:HNSW|IVFFLAT)\b/.test(head)
  )
    return true;

  return false;
}

/**
 * Removes statements that node-sql-parser cannot handle and that drawDB does not
 * model anyway (PL/pgSQL functions, triggers, etc.), so importing a real-world
 * dump doesn't abort on the first unsupported statement. No-op when there are
 * none. Postgres-oriented (relies on dollar-quote scanning).
 */
export function stripUnsupportedStatements(sql) {
  return splitStatements(sql)
    .filter((s) => s.trim() === "" || !isUnsupportedStatement(s))
    .join("");
}

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
