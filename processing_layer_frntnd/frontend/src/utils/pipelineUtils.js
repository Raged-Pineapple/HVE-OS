/**
 * Safely parses a Python-style literal string (dict/list) into a JS object.
 * Avoids `new Function` / `eval` which are blocked by SES lockdown.
 */
export const parsePythonLiteral = (str) => {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  try {
    // Step 1: Replace Python keywords with JSON equivalents
    let json = trimmed
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');

    // Step 2: Swap single-quote string delimiters to double quotes using a state machine.
    // We only swap the quote characters that act as delimiters, not apostrophes within strings.
    json = swapPythonQuotes(json);

    return JSON.parse(json);
  } catch (e) {
    return null;
  }
};

const swapPythonQuotes = (str) => {
  let result = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const escaped = i > 0 && str[i - 1] === '\\';

    if (ch === "'" && !inDouble && !escaped) {
      inSingle = !inSingle;
      result += '"';
    } else if (ch === '"' && !inSingle && !escaped) {
      inDouble = !inDouble;
      result += '"';
    } else {
      result += ch;
    }
  }
  return result;
};

/**
 * Extract the canonical attribute key from a React Flow handle id.
 * Handles all handle naming conventions used across nodes.
 */
export const attrKeyFromHandle = (handleId) => {
  if (!handleId) return 'default';
  if (handleId.startsWith('attr-out-')) return handleId.slice('attr-out-'.length);
  if (handleId.startsWith('add-out-')) return handleId.slice('add-out-'.length);
  if (handleId.startsWith('entity-out-pinned-')) return handleId.slice('entity-out-pinned-'.length);
  return handleId;
};

/**
 * Resolve the value of `attrKey` from an entity object,
 * supporting dot-path keys and nested stringified Python dicts.
 */
export const resolveAttrValue = (entity, attrKey) => {
  if (!entity || attrKey == null) return null;

  // Direct access first
  let value = entity[attrKey] ?? null;

  // Dot-path traversal
  if (value === null && attrKey.includes('.')) {
    const parts = attrKey.split('.');
    let current = entity;
    for (const p of parts) {
      if (current === null || current === undefined) break;
      if (typeof current === 'string') {
        const parsed = parsePythonLiteral(current);
        if (parsed) current = parsed;
      }
      current = current[p];
    }
    if (current !== undefined && current !== null) value = current;
  }

  return value;
};
