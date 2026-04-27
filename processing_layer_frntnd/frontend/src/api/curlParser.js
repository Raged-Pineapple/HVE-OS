/**
 * parseCurl(cmd) — minimal curl command parser
 * Supports: -X, --request, -H, --header, -d, --data, --data-raw, -u, URL
 */
export function parseCurl(cmd) {
  // Tokenize respecting quoted strings
  const tokens = [];
  let cur = '';
  let inQ = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (inQ) {
      if (c === inQ) inQ = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      inQ = c;
    } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += c;
    }
  }
  if (cur) tokens.push(cur);

  // Remove leading 'curl'
  if (tokens[0]?.toLowerCase() === 'curl') tokens.shift();

  let method = 'GET';
  let url = '';
  const headers = {};
  let body = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--request') {
      method = tokens[++i]?.toUpperCase() || 'GET';
    } else if (t === '-H' || t === '--header') {
      const raw = tokens[++i] || '';
      const colon = raw.indexOf(':');
      if (colon !== -1) {
        headers[raw.slice(0, colon).trim()] = raw.slice(colon + 1).trim();
      }
    } else if (t === '-d' || t === '--data' || t === '--data-raw') {
      body = tokens[++i] || null;
    } else if (t === '-u' || t === '--user') {
      const cred = tokens[++i] || '';
      headers['Authorization'] = 'Basic ' + btoa(cred);
    } else if (!t.startsWith('-')) {
      url = t;
    }
  }

  // Infer Content-Type if body present
  if (body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (body && method === 'GET') method = 'POST';

  return { method, url, headers, body };
}
