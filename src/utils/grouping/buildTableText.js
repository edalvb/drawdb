// Turns a table into a short descriptive string used to compute its embedding.
// Table/field names carry little signal on their own, so we tokenize
// snake_case / camelCase into words and enrich the table name with its fields
// and comment. The name is repeated to weight it above the field list.

function humanize(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase -> camel Case
    .replace(/[_\-.]+/g, " ") // snake_case / kebab-case -> spaces
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildTableText(table) {
  const name = humanize(table.name);
  const fields = (table.fields || []).map((f) => humanize(f.name)).join(" ");
  const comment = humanize(table.comment);
  return [name, name, fields, comment].filter(Boolean).join(" ");
}
