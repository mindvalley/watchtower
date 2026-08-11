'use strict';

// Vue single-file components are not parseable by lizard, so the <script> block
// is extracted and analysed on its own. The line offset is not a nicety: findings
// carry file paths and line numbers into the report UI, and a location pointing
// at a temp file is worse than no location at all — it looks actionable and is
// not. The caller maps reported lines back with (line - 1) + lineOffset.
//
// Deliberately a scanner, not a Vue parser. We take the first <script> block and
// bail on anything malformed rather than guessing, because a wrong offset is a
// silently wrong location.

const OPEN_RE = /<script\b([^>]*)>/i;
const CLOSE = '</script>';

function extractScript(source) {
  if (typeof source !== 'string') return null;
  const open = OPEN_RE.exec(source);
  if (!open) return null;

  const attrs = open[1] || '';
  const langMatch = /\blang\s*=\s*["']([^"']+)["']/i.exec(attrs);
  const declared = langMatch ? langMatch[1].toLowerCase() : 'js';
  const lang = declared === 'ts' || declared === 'typescript' ? 'ts' : 'js';

  const bodyStart = open.index + open[0].length;
  const closeIdx = source.indexOf(CLOSE, bodyStart);
  if (closeIdx === -1) return null; // unterminated — never fall through to EOF

  const code = source.slice(bodyStart, closeIdx).replace(/^\r?\n/, '');

  // Lines before the opening tag, plus the tag's own line. The body conventionally
  // starts on the line after <script>; if content sits on the same line as the tag
  // the offset is that line instead.
  const beforeTag = source.slice(0, open.index + open[0].length);
  const tagLine = beforeTag.split('\n').length;
  const sameLineContent = /^[^\r\n]*\S/.test(source.slice(bodyStart, closeIdx));
  const lineOffset = sameLineContent ? tagLine : tagLine + 1;

  return { lang, code, lineOffset };
}

module.exports = { extractScript };
