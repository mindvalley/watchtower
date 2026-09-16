/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 281:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const loader = __nccwpck_require__(950)
const dumper = __nccwpck_require__(980)

function renamed (from, to) {
  return function () {
    throw new Error('Function yaml.' + from + ' is removed in js-yaml 4. ' +
      'Use yaml.' + to + ' instead, which is now safe by default.')
  }
}

module.exports.Type = __nccwpck_require__(557)
module.exports.Schema = __nccwpck_require__(46)
module.exports.FAILSAFE_SCHEMA = __nccwpck_require__(832)
module.exports.JSON_SCHEMA = __nccwpck_require__(927)
module.exports.CORE_SCHEMA = __nccwpck_require__(746)
module.exports.DEFAULT_SCHEMA = __nccwpck_require__(336)
module.exports.load = loader.load
module.exports.loadAll = loader.loadAll
module.exports.dump = dumper.dump
module.exports.YAMLException = __nccwpck_require__(248)

// Re-export all types in case user wants to create custom schema
module.exports.types = {
  binary: __nccwpck_require__(149),
  float: __nccwpck_require__(584),
  map: __nccwpck_require__(316),
  null: __nccwpck_require__(333),
  pairs: __nccwpck_require__(267),
  set: __nccwpck_require__(758),
  timestamp: __nccwpck_require__(966),
  bool: __nccwpck_require__(296),
  int: __nccwpck_require__(271),
  merge: __nccwpck_require__(854),
  omap: __nccwpck_require__(649),
  seq: __nccwpck_require__(161),
  str: __nccwpck_require__(929)
}

// Removed functions from JS-YAML 3.0.x
module.exports.safeLoad = renamed('safeLoad', 'load')
module.exports.safeLoadAll = renamed('safeLoadAll', 'loadAll')
module.exports.safeDump = renamed('safeDump', 'dump')


/***/ }),

/***/ 816:
/***/ ((module) => {



function isNothing (subject) {
  return (typeof subject === 'undefined') || (subject === null)
}

function isObject (subject) {
  return (typeof subject === 'object') && (subject !== null)
}

function toArray (sequence) {
  if (Array.isArray(sequence)) return sequence
  else if (isNothing(sequence)) return []

  return [sequence]
}

function extend (target, source) {
  if (source) {
    const sourceKeys = Object.keys(source)

    for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
      const key = sourceKeys[index]
      target[key] = source[key]
    }
  }

  return target
}

function repeat (string, count) {
  let result = ''

  for (let cycle = 0; cycle < count; cycle += 1) {
    result += string
  }

  return result
}

function isNegativeZero (number) {
  return (number === 0) && (Number.NEGATIVE_INFINITY === 1 / number)
}

module.exports.isNothing = isNothing
module.exports.isObject = isObject
module.exports.toArray = toArray
module.exports.repeat = repeat
module.exports.isNegativeZero = isNegativeZero
module.exports.extend = extend


/***/ }),

/***/ 980:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const common = __nccwpck_require__(816)
const YAMLException = __nccwpck_require__(248)
const DEFAULT_SCHEMA = __nccwpck_require__(336)

const _toString = Object.prototype.toString
const _hasOwnProperty = Object.prototype.hasOwnProperty

const CHAR_BOM = 0xFEFF
const CHAR_TAB = 0x09 /* Tab */
const CHAR_LINE_FEED = 0x0A /* LF */
const CHAR_CARRIAGE_RETURN = 0x0D /* CR */
const CHAR_SPACE = 0x20 /* Space */
const CHAR_EXCLAMATION = 0x21 /* ! */
const CHAR_DOUBLE_QUOTE = 0x22 /* " */
const CHAR_SHARP = 0x23 /* # */
const CHAR_PERCENT = 0x25 /* % */
const CHAR_AMPERSAND = 0x26 /* & */
const CHAR_SINGLE_QUOTE = 0x27 /* ' */
const CHAR_ASTERISK = 0x2A /* * */
const CHAR_COMMA = 0x2C /* , */
const CHAR_MINUS = 0x2D /* - */
const CHAR_COLON = 0x3A /* : */
const CHAR_EQUALS = 0x3D /* = */
const CHAR_GREATER_THAN = 0x3E /* > */
const CHAR_QUESTION = 0x3F /* ? */
const CHAR_COMMERCIAL_AT = 0x40 /* @ */
const CHAR_LEFT_SQUARE_BRACKET = 0x5B /* [ */
const CHAR_RIGHT_SQUARE_BRACKET = 0x5D /* ] */
const CHAR_GRAVE_ACCENT = 0x60 /* ` */
const CHAR_LEFT_CURLY_BRACKET = 0x7B /* { */
const CHAR_VERTICAL_LINE = 0x7C /* | */
const CHAR_RIGHT_CURLY_BRACKET = 0x7D /* } */

const ESCAPE_SEQUENCES = {}

ESCAPE_SEQUENCES[0x00] = '\\0'
ESCAPE_SEQUENCES[0x07] = '\\a'
ESCAPE_SEQUENCES[0x08] = '\\b'
ESCAPE_SEQUENCES[0x09] = '\\t'
ESCAPE_SEQUENCES[0x0A] = '\\n'
ESCAPE_SEQUENCES[0x0B] = '\\v'
ESCAPE_SEQUENCES[0x0C] = '\\f'
ESCAPE_SEQUENCES[0x0D] = '\\r'
ESCAPE_SEQUENCES[0x1B] = '\\e'
ESCAPE_SEQUENCES[0x22] = '\\"'
ESCAPE_SEQUENCES[0x5C] = '\\\\'
ESCAPE_SEQUENCES[0x85] = '\\N'
ESCAPE_SEQUENCES[0xA0] = '\\_'
ESCAPE_SEQUENCES[0x2028] = '\\L'
ESCAPE_SEQUENCES[0x2029] = '\\P'

const DEPRECATED_BOOLEANS_SYNTAX = [
  'y', 'Y', 'yes', 'Yes', 'YES', 'on', 'On', 'ON',
  'n', 'N', 'no', 'No', 'NO', 'off', 'Off', 'OFF'
]

const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/

function compileStyleMap (schema, map) {
  if (map === null) return {}

  const result = {}
  const keys = Object.keys(map)

  for (let index = 0, length = keys.length; index < length; index += 1) {
    let tag = keys[index]
    let style = String(map[tag])

    if (tag.slice(0, 2) === '!!') {
      tag = 'tag:yaml.org,2002:' + tag.slice(2)
    }
    const type = schema.compiledTypeMap['fallback'][tag]

    if (type && _hasOwnProperty.call(type.styleAliases, style)) {
      style = type.styleAliases[style]
    }

    result[tag] = style
  }

  return result
}

function encodeHex (character) {
  let handle
  let length

  const string = character.toString(16).toUpperCase()

  if (character <= 0xFF) {
    handle = 'x'
    length = 2
  } else if (character <= 0xFFFF) {
    handle = 'u'
    length = 4
  } else if (character <= 0xFFFFFFFF) {
    handle = 'U'
    length = 8
  } else {
    throw new YAMLException('code point within a string may not be greater than 0xFFFFFFFF')
  }

  return '\\' + handle + common.repeat('0', length - string.length) + string
}

const QUOTING_TYPE_SINGLE = 1
const QUOTING_TYPE_DOUBLE = 2

function State (options) {
  this.schema = options['schema'] || DEFAULT_SCHEMA
  this.indent = Math.max(1, (options['indent'] || 2))
  this.noArrayIndent = options['noArrayIndent'] || false
  this.skipInvalid = options['skipInvalid'] || false
  this.flowLevel = (common.isNothing(options['flowLevel']) ? -1 : options['flowLevel'])
  this.styleMap = compileStyleMap(this.schema, options['styles'] || null)
  this.sortKeys = options['sortKeys'] || false
  this.lineWidth = options['lineWidth'] || 80
  this.noRefs = options['noRefs'] || false
  this.noCompatMode = options['noCompatMode'] || false
  this.condenseFlow = options['condenseFlow'] || false
  this.quotingType = options['quotingType'] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE
  this.forceQuotes = options['forceQuotes'] || false
  this.replacer = typeof options['replacer'] === 'function' ? options['replacer'] : null

  this.implicitTypes = this.schema.compiledImplicit
  this.explicitTypes = this.schema.compiledExplicit

  this.tag = null
  this.result = ''

  this.duplicates = []
  this.usedDuplicates = null
}

// Indents every line in a string. Empty lines (\n only) are not indented.
function indentString (string, spaces) {
  const ind = common.repeat(' ', spaces)
  let position = 0
  let result = ''
  const length = string.length

  while (position < length) {
    let line
    const next = string.indexOf('\n', position)
    if (next === -1) {
      line = string.slice(position)
      position = length
    } else {
      line = string.slice(position, next + 1)
      position = next + 1
    }

    if (line.length && line !== '\n') result += ind

    result += line
  }

  return result
}

function generateNextLine (state, level) {
  return '\n' + common.repeat(' ', state.indent * level)
}

function testImplicitResolving (state, str) {
  for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
    const type = state.implicitTypes[index]

    if (type.resolve(str)) {
      return true
    }
  }

  return false
}

// [33] s-white ::= s-space | s-tab
function isWhitespace (c) {
  return c === CHAR_SPACE || c === CHAR_TAB
}

// Returns true if the character can be printed without escaping.
// From YAML 1.2: "any allowed characters known to be non-printable
// should also be escaped. [However,] This isn’t mandatory"
// Derived from nb-char - \t - #x85 - #xA0 - #x2028 - #x2029.
function isPrintable (c) {
  return (c >= 0x00020 && c <= 0x00007E) ||
    ((c >= 0x000A1 && c <= 0x00D7FF) && c !== 0x2028 && c !== 0x2029) ||
    ((c >= 0x0E000 && c <= 0x00FFFD) && c !== CHAR_BOM) ||
    (c >= 0x10000 && c <= 0x10FFFF)
}

// [34] ns-char ::= nb-char - s-white
// [27] nb-char ::= c-printable - b-char - c-byte-order-mark
// [26] b-char  ::= b-line-feed | b-carriage-return
// Including s-white (for some reason, examples doesn't match specs in this aspect)
// ns-char ::= c-printable - b-line-feed - b-carriage-return - c-byte-order-mark
function isNsCharOrWhitespace (c) {
  return isPrintable(c) &&
    c !== CHAR_BOM &&
    // - b-char
    c !== CHAR_CARRIAGE_RETURN &&
    c !== CHAR_LINE_FEED
}

// [127]  ns-plain-safe(c) ::= c = flow-out  ⇒ ns-plain-safe-out
//                             c = flow-in   ⇒ ns-plain-safe-in
//                             c = block-key ⇒ ns-plain-safe-out
//                             c = flow-key  ⇒ ns-plain-safe-in
// [128] ns-plain-safe-out ::= ns-char
// [129]  ns-plain-safe-in ::= ns-char - c-flow-indicator
// [130]  ns-plain-char(c) ::=  ( ns-plain-safe(c) - “:” - “#” )
//                            | ( /* An ns-char preceding */ “#” )
//                            | ( “:” /* Followed by an ns-plain-safe(c) */ )
function isPlainSafe (c, prev, inblock) {
  const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c)
  const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c)
  return (
    (
      // ns-plain-safe
      inblock // c = flow-in
        ? cIsNsCharOrWhitespace
        : cIsNsCharOrWhitespace &&
          // - c-flow-indicator
          c !== CHAR_COMMA &&
          c !== CHAR_LEFT_SQUARE_BRACKET &&
          c !== CHAR_RIGHT_SQUARE_BRACKET &&
          c !== CHAR_LEFT_CURLY_BRACKET &&
          c !== CHAR_RIGHT_CURLY_BRACKET
    ) &&
    // ns-plain-char
    c !== CHAR_SHARP && // false on '#'
    !(prev === CHAR_COLON && !cIsNsChar)
  ) || // false on ': '
  (isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP) || // change to true on '[^ ]#'
  (prev === CHAR_COLON && cIsNsChar) // change to true on ':[^ ]'
}

// Simplified test for values allowed as the first character in plain style.
function isPlainSafeFirst (c) {
  // Uses a subset of ns-char - c-indicator
  // where ns-char = nb-char - s-white.
  // No support of ( ( “?” | “:” | “-” ) /* Followed by an ns-plain-safe(c)) */ ) part
  return isPrintable(c) &&
    c !== CHAR_BOM &&
    !isWhitespace(c) && // - s-white
    // - (c-indicator ::=
    // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
    c !== CHAR_MINUS &&
    c !== CHAR_QUESTION &&
    c !== CHAR_COLON &&
    c !== CHAR_COMMA &&
    c !== CHAR_LEFT_SQUARE_BRACKET &&
    c !== CHAR_RIGHT_SQUARE_BRACKET &&
    c !== CHAR_LEFT_CURLY_BRACKET &&
    c !== CHAR_RIGHT_CURLY_BRACKET &&
    // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
    c !== CHAR_SHARP &&
    c !== CHAR_AMPERSAND &&
    c !== CHAR_ASTERISK &&
    c !== CHAR_EXCLAMATION &&
    c !== CHAR_VERTICAL_LINE &&
    c !== CHAR_EQUALS &&
    c !== CHAR_GREATER_THAN &&
    c !== CHAR_SINGLE_QUOTE &&
    c !== CHAR_DOUBLE_QUOTE &&
    // | “%” | “@” | “`”)
    c !== CHAR_PERCENT &&
    c !== CHAR_COMMERCIAL_AT &&
    c !== CHAR_GRAVE_ACCENT
}

// Simplified test for values allowed as the last character in plain style.
function isPlainSafeLast (c) {
  // just not whitespace or colon, it will be checked to be plain character later
  return !isWhitespace(c) && c !== CHAR_COLON
}

// Same as 'string'.codePointAt(pos), but works in older browsers.
function codePointAt (string, pos) {
  const first = string.charCodeAt(pos)
  let second

  if (first >= 0xD800 && first <= 0xDBFF && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1)
    if (second >= 0xDC00 && second <= 0xDFFF) {
      // https://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
      return (first - 0xD800) * 0x400 + second - 0xDC00 + 0x10000
    }
  }
  return first
}

// Determines whether block indentation indicator is required.
function needIndentIndicator (string) {
  const leadingSpaceRe = /^\n* /
  return leadingSpaceRe.test(string)
}

const STYLE_PLAIN = 1
const STYLE_SINGLE = 2
const STYLE_LITERAL = 3
const STYLE_FOLDED = 4
const STYLE_DOUBLE = 5

// Determines which scalar styles are possible and returns the preferred style.
// lineWidth = -1 => no limit.
// Pre-conditions: str.length > 0.
// Post-conditions:
//    STYLE_PLAIN or STYLE_SINGLE => no \n are in the string.
//    STYLE_LITERAL => no lines are suitable for folding (or lineWidth is -1).
//    STYLE_FOLDED => a line > lineWidth and can be folded (and lineWidth != -1).
function chooseScalarStyle (string, singleLineOnly, indentPerLevel, lineWidth,
  testAmbiguousType, quotingType, forceQuotes, inblock) {
  let i
  let char = 0
  let prevChar = null
  let hasLineBreak = false
  let hasFoldableLine = false // only checked if shouldTrackWidth
  const shouldTrackWidth = lineWidth !== -1
  let previousLineBreak = -1 // count the first line correctly
  let plain = isPlainSafeFirst(codePointAt(string, 0)) &&
    isPlainSafeLast(codePointAt(string, string.length - 1))

  if (singleLineOnly || forceQuotes) {
    // Case: no block styles.
    // Check for disallowed characters to rule out plain and single.
    for (i = 0; i < string.length; char >= 0x10000 ? i += 2 : i++) {
      char = codePointAt(string, i)
      if (!isPrintable(char)) {
        return STYLE_DOUBLE
      }
      plain = plain && isPlainSafe(char, prevChar, inblock)
      prevChar = char
    }
  } else {
    // Case: block styles permitted.
    for (i = 0; i < string.length; char >= 0x10000 ? i += 2 : i++) {
      char = codePointAt(string, i)
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true
        // Check if any line can be folded.
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine ||
            // Foldable line = too long, and not more-indented.
            (i - previousLineBreak - 1 > lineWidth &&
             string[previousLineBreak + 1] !== ' ')
          previousLineBreak = i
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE
      }
      plain = plain && isPlainSafe(char, prevChar, inblock)
      prevChar = char
    }
    // in case the end is missing a \n
    hasFoldableLine = hasFoldableLine || (shouldTrackWidth &&
      (i - previousLineBreak - 1 > lineWidth &&
       string[previousLineBreak + 1] !== ' '))
  }
  // Although every style can represent \n without escaping, prefer block styles
  // for multiline, since they're more readable and they don't add empty lines.
  // Also prefer folding a super-long line.
  if (!hasLineBreak && !hasFoldableLine) {
    // Strings interpretable as another type have to be quoted;
    // e.g. the string 'true' vs. the boolean true.
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE
  }
  // Edge case: block indentation indicator can only have one digit.
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE
  }
  // At this point we know block styles are valid.
  // Prefer literal style unless we want to fold.
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE
}

// Note: line breaking/folding is implemented for only the folded style.
// NB. We drop the last trailing newline (if any) of a returned block scalar
//  since the dumper adds its own newline. This always works:
//    • No ending newline => unaffected; already using strip "-" chomping.
//    • Ending newline    => removed then restored.
//  Importantly, this keeps the "+" chomp indicator from gaining an extra line.
function writeScalar (state, string, level, iskey, inblock) {
  state.dump = (function () {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''"
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? ('"' + string + '"') : ("'" + string + "'")
      }
    }

    const indent = state.indent * Math.max(1, level) // no 0-indent scalars
    // As indentation gets deeper, let the width decrease monotonically
    // to the lower bound min(state.lineWidth, 40).
    // Note that this implies
    //  state.lineWidth ≤ 40 + state.indent: width is fixed at the lower bound.
    //  state.lineWidth > 40 + state.indent: width decreases until the lower bound.
    // This behaves better than a constant minimum width which disallows narrower options,
    // or an indent threshold which causes the width to suddenly increase.
    const lineWidth = (state.lineWidth === -1)
      ? -1
      : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent)

    // Without knowing if keys are implicit/explicit, assume implicit for safety.
    const singleLineOnly = iskey ||
      // No block styles in flow mode.
      (state.flowLevel > -1 && level >= state.flowLevel)
    function testAmbiguity (string) {
      return testImplicitResolving(state, string)
    }

    switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth,
      testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
      case STYLE_PLAIN:
        return string
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'"
      case STYLE_LITERAL:
        return '|' + blockHeader(string, state.indent) +
          dropEndingNewline(indentString(string, indent))
      case STYLE_FOLDED:
        return '>' + blockHeader(string, state.indent) +
          dropEndingNewline(indentString(foldString(string, lineWidth), indent))
      case STYLE_DOUBLE:
        return '"' + escapeString(string, lineWidth) + '"'
      default:
        throw new YAMLException('impossible error: invalid scalar style')
    }
  }())
}

// Pre-conditions: string is valid for a block scalar, 1 <= indentPerLevel <= 9.
function blockHeader (string, indentPerLevel) {
  const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : ''

  // note the special case: the string '\n' counts as a "trailing" empty line.
  const clip = string[string.length - 1] === '\n'
  const keep = clip && (string[string.length - 2] === '\n' || string === '\n')
  const chomp = keep ? '+' : (clip ? '' : '-')

  return indentIndicator + chomp + '\n'
}

// (See the note for writeScalar.)
function dropEndingNewline (string) {
  return string[string.length - 1] === '\n' ? string.slice(0, -1) : string
}

// Note: a long line without a suitable break point will exceed the width limit.
// Pre-conditions: every char in str isPrintable, str.length > 0, width > 0.
function foldString (string, width) {
  // In folded style, $k$ consecutive newlines output as $k+1$ newlines—
  // unless they're before or after a more-indented line, or at the very
  // beginning or end, in which case $k$ maps to $k$.
  // Therefore, parse each chunk as newline(s) followed by a content line.
  const lineRe = /(\n+)([^\n]*)/g

  // first line (possibly an empty line)
  let result = (function () {
    let nextLF = string.indexOf('\n')
    nextLF = nextLF !== -1 ? nextLF : string.length
    lineRe.lastIndex = nextLF
    return foldLine(string.slice(0, nextLF), width)
  }())
  // If we haven't reached the first content line yet, don't add an extra \n.
  let prevMoreIndented = string[0] === '\n' || string[0] === ' '
  let moreIndented

  // rest of the lines
  let match
  while ((match = lineRe.exec(string))) {
    const prefix = match[1]
    const line = match[2]

    moreIndented = (line[0] === ' ')
    result += prefix +
      ((!prevMoreIndented && !moreIndented && line !== '') ? '\n' : '') +
      foldLine(line, width)
    prevMoreIndented = moreIndented
  }

  return result
}

// Greedy line breaking.
// Picks the longest line under the limit each time,
// otherwise settles for the shortest line over the limit.
// NB. More-indented lines *cannot* be folded, as that would add an extra \n.
function foldLine (line, width) {
  if (line === '' || line[0] === ' ') return line

  // Since a more-indented line adds a \n, breaks can't be followed by a space.
  const breakRe = / [^ ]/g // note: the match index will always be <= length-2.
  let match
  // start is an inclusive index. end, curr, and next are exclusive.
  let start = 0
  let end
  let curr = 0
  let next = 0
  let result = ''

  // Invariants: 0 <= start <= length-1.
  //   0 <= curr <= next <= max(0, length-2). curr - start <= width.
  // Inside the loop:
  //   A match implies length >= 2, so curr and next are <= length-2.
  while ((match = breakRe.exec(line))) {
    next = match.index
    // maintain invariant: curr - start <= width
    if (next - start > width) {
      end = (curr > start) ? curr : next // derive end <= length-2
      result += '\n' + line.slice(start, end)
      // skip the space that was output as \n
      start = end + 1                    // derive start <= length-1
    }
    curr = next
  }

  // By the invariants, start <= length-1, so there is something left over.
  // It is either the whole string or a part starting from non-whitespace.
  result += '\n'
  // Insert a break if the remainder is too long and there is a break available.
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + '\n' + line.slice(curr + 1)
  } else {
    result += line.slice(start)
  }

  return result.slice(1) // drop extra \n joiner
}

// Escapes a double-quoted string.
function escapeString (string) {
  let result = ''
  let char = 0

  for (let i = 0; i < string.length; char >= 0x10000 ? i += 2 : i++) {
    char = codePointAt(string, i)
    const escapeSeq = ESCAPE_SEQUENCES[char]

    if (!escapeSeq && isPrintable(char)) {
      result += string[i]
      if (char >= 0x10000) result += string[i + 1]
    } else {
      result += escapeSeq || encodeHex(char)
    }
  }

  return result
}

function writeFlowSequence (state, level, object) {
  let _result = ''
  const _tag = state.tag

  for (let index = 0, length = object.length; index < length; index += 1) {
    let value = object[index]

    if (state.replacer) {
      value = state.replacer.call(object, String(index), value)
    }

    // Write only valid elements, put null instead of invalid elements.
    if (writeNode(state, level, value, false, false) ||
        (typeof value === 'undefined' &&
         writeNode(state, level, null, false, false))) {
      if (_result !== '') _result += ',' + (!state.condenseFlow ? ' ' : '')
      _result += state.dump
    }
  }

  state.tag = _tag
  state.dump = '[' + _result + ']'
}

function writeBlockSequence (state, level, object, compact) {
  let _result = ''
  const _tag = state.tag

  for (let index = 0, length = object.length; index < length; index += 1) {
    let value = object[index]

    if (state.replacer) {
      value = state.replacer.call(object, String(index), value)
    }

    // Write only valid elements, put null instead of invalid elements.
    if (writeNode(state, level + 1, value, true, true, false, true) ||
        (typeof value === 'undefined' &&
         writeNode(state, level + 1, null, true, true, false, true))) {
      if (!compact || _result !== '') {
        _result += generateNextLine(state, level)
      }

      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += '-'
      } else {
        _result += '- '
      }

      _result += state.dump
    }
  }

  state.tag = _tag
  state.dump = _result || '[]' // Empty sequence if no valid values.
}

function writeFlowMapping (state, level, object) {
  let _result = ''
  const _tag = state.tag
  const objectKeyList = Object.keys(object)

  for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
    let pairBuffer = ''
    if (_result !== '') pairBuffer += ', '

    if (state.condenseFlow) pairBuffer += '"'

    const objectKey = objectKeyList[index]
    let objectValue = object[objectKey]

    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue)
    }

    if (!writeNode(state, level, objectKey, false, false)) {
      continue // Skip this pair because of invalid key;
    }

    if (state.dump.length > 1024) pairBuffer += '? '

    pairBuffer += state.dump + (state.condenseFlow ? '"' : '') + ':' + (state.condenseFlow ? '' : ' ')

    if (!writeNode(state, level, objectValue, false, false)) {
      continue // Skip this pair because of invalid value.
    }

    pairBuffer += state.dump

    // Both key and value are valid.
    _result += pairBuffer
  }

  state.tag = _tag
  state.dump = '{' + _result + '}'
}

function writeBlockMapping (state, level, object, compact) {
  let _result = ''
  const _tag = state.tag
  const objectKeyList = Object.keys(object)

  // Allow sorting keys so that the output file is deterministic
  if (state.sortKeys === true) {
    // Default sorting
    objectKeyList.sort()
  } else if (typeof state.sortKeys === 'function') {
    // Custom sort function
    objectKeyList.sort(state.sortKeys)
  } else if (state.sortKeys) {
    // Something is wrong
    throw new YAMLException('sortKeys must be a boolean or a function')
  }

  for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
    let pairBuffer = ''

    if (!compact || _result !== '') {
      pairBuffer += generateNextLine(state, level)
    }

    const objectKey = objectKeyList[index]
    let objectValue = object[objectKey]

    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue)
    }

    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue // Skip this pair because of invalid key.
    }

    const explicitPair = (state.tag !== null && state.tag !== '?') ||
                   (state.dump && state.dump.length > 1024)

    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += '?'
      } else {
        pairBuffer += '? '
      }
    }

    pairBuffer += state.dump

    if (explicitPair) {
      pairBuffer += generateNextLine(state, level)
    }

    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue // Skip this pair because of invalid value.
    }

    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ':'
    } else {
      pairBuffer += ': '
    }

    pairBuffer += state.dump

    // Both key and value are valid.
    _result += pairBuffer
  }

  state.tag = _tag
  state.dump = _result || '{}' // Empty mapping if no valid pairs.
}

function detectType (state, object, explicit) {
  const typeList = explicit ? state.explicitTypes : state.implicitTypes

  for (let index = 0, length = typeList.length; index < length; index += 1) {
    const type = typeList[index]

    if ((type.instanceOf || type.predicate) &&
        (!type.instanceOf || ((typeof object === 'object') && (object instanceof type.instanceOf))) &&
        (!type.predicate || type.predicate(object))) {
      if (explicit) {
        if (type.multi && type.representName) {
          state.tag = type.representName(object)
        } else {
          state.tag = type.tag
        }
      } else {
        state.tag = '?'
      }

      if (type.represent) {
        const style = state.styleMap[type.tag] || type.defaultStyle

        let _result
        if (_toString.call(type.represent) === '[object Function]') {
          _result = type.represent(object, style)
        } else if (_hasOwnProperty.call(type.represent, style)) {
          _result = type.represent[style](object, style)
        } else {
          throw new YAMLException('!<' + type.tag + '> tag resolver accepts not "' + style + '" style')
        }

        state.dump = _result
      }

      return true
    }
  }

  return false
}

// Serializes `object` and writes it to global `result`.
// Returns true on success, or false on invalid object.
//
function writeNode (state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null
  state.dump = object

  if (!detectType(state, object, false)) {
    detectType(state, object, true)
  }

  const type = _toString.call(state.dump)
  const inblock = block

  if (block) {
    block = (state.flowLevel < 0 || state.flowLevel > level)
  }

  const objectOrArray = type === '[object Object]' || type === '[object Array]'
  let duplicateIndex
  let duplicate

  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object)
    duplicate = duplicateIndex !== -1
  }

  if ((state.tag !== null && state.tag !== '?') || duplicate || (state.indent !== 2 && level > 0)) {
    compact = false
  }

  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = '*ref_' + duplicateIndex
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true
    }
    if (type === '[object Object]') {
      if (block && (Object.keys(state.dump).length !== 0)) {
        writeBlockMapping(state, level, state.dump, compact)
        if (duplicate) {
          state.dump = '&ref_' + duplicateIndex + state.dump
        }
      } else {
        writeFlowMapping(state, level, state.dump)
        if (duplicate) {
          state.dump = '&ref_' + duplicateIndex + ' ' + state.dump
        }
      }
    } else if (type === '[object Array]') {
      if (block && (state.dump.length !== 0)) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact)
        } else {
          writeBlockSequence(state, level, state.dump, compact)
        }
        if (duplicate) {
          state.dump = '&ref_' + duplicateIndex + state.dump
        }
      } else {
        writeFlowSequence(state, level, state.dump)
        if (duplicate) {
          state.dump = '&ref_' + duplicateIndex + ' ' + state.dump
        }
      }
    } else if (type === '[object String]') {
      if (state.tag !== '?') {
        writeScalar(state, state.dump, level, iskey, inblock)
      }
    } else if (type === '[object Undefined]') {
      return false
    } else {
      if (state.skipInvalid) return false
      throw new YAMLException('unacceptable kind of an object to dump ' + type)
    }

    if (state.tag !== null && state.tag !== '?') {
      // Need to encode all characters except those allowed by the spec:
      //
      // [35] ns-dec-digit    ::=  [#x30-#x39] /* 0-9 */
      // [36] ns-hex-digit    ::=  ns-dec-digit
      //                         | [#x41-#x46] /* A-F */ | [#x61-#x66] /* a-f */
      // [37] ns-ascii-letter ::=  [#x41-#x5A] /* A-Z */ | [#x61-#x7A] /* a-z */
      // [38] ns-word-char    ::=  ns-dec-digit | ns-ascii-letter | “-”
      // [39] ns-uri-char     ::=  “%” ns-hex-digit ns-hex-digit | ns-word-char | “#”
      //                         | “;” | “/” | “?” | “:” | “@” | “&” | “=” | “+” | “$” | “,”
      //                         | “_” | “.” | “!” | “~” | “*” | “'” | “(” | “)” | “[” | “]”
      //
      // Also need to encode '!' because it has special meaning (end of tag prefix).
      //
      let tagStr = encodeURI(
        state.tag[0] === '!' ? state.tag.slice(1) : state.tag
      ).replace(/!/g, '%21')

      if (state.tag[0] === '!') {
        tagStr = '!' + tagStr
      } else if (tagStr.slice(0, 18) === 'tag:yaml.org,2002:') {
        tagStr = '!!' + tagStr.slice(18)
      } else {
        tagStr = '!<' + tagStr + '>'
      }

      state.dump = tagStr + ' ' + state.dump
    }
  }

  return true
}

function getDuplicateReferences (object, state) {
  const objects = []
  const duplicatesIndexes = []

  inspectNode(object, objects, duplicatesIndexes)

  const length = duplicatesIndexes.length
  for (let index = 0; index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]])
  }
  state.usedDuplicates = new Array(length)
}

function inspectNode (object, objects, duplicatesIndexes) {
  if (object !== null && typeof object === 'object') {
    const index = objects.indexOf(object)
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index)
      }
    } else {
      objects.push(object)

      if (Array.isArray(object)) {
        for (let i = 0, length = object.length; i < length; i += 1) {
          inspectNode(object[i], objects, duplicatesIndexes)
        }
      } else {
        const objectKeyList = Object.keys(object)

        for (let i = 0, length = objectKeyList.length; i < length; i += 1) {
          inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes)
        }
      }
    }
  }
}

function dump (input, options) {
  options = options || {}

  const state = new State(options)

  if (!state.noRefs) getDuplicateReferences(input, state)

  let value = input

  if (state.replacer) {
    value = state.replacer.call({ '': value }, '', value)
  }

  if (writeNode(state, 0, value, true, true)) return state.dump + '\n'

  return ''
}

module.exports.dump = dump


/***/ }),

/***/ 248:
/***/ ((module) => {

// YAML error class. http://stackoverflow.com/questions/8458984
//


function formatError (exception, compact) {
  let where = ''
  const message = exception.reason || '(unknown reason)'

  if (!exception.mark) return message

  if (exception.mark.name) {
    where += 'in "' + exception.mark.name + '" '
  }

  where += '(' + (exception.mark.line + 1) + ':' + (exception.mark.column + 1) + ')'

  if (!compact && exception.mark.snippet) {
    where += '\n\n' + exception.mark.snippet
  }

  return message + ' ' + where
}

function YAMLException (reason, mark) {
  // Super constructor
  Error.call(this)

  this.name = 'YAMLException'
  this.reason = reason
  this.mark = mark
  this.message = formatError(this, false)

  // Include stack trace in error object
  if (Error.captureStackTrace) {
    // Chrome and NodeJS
    Error.captureStackTrace(this, this.constructor)
  } else {
    // FF, IE 10+ and Safari 6+. Fallback for others
    this.stack = (new Error()).stack || ''
  }
}

// Inherit from Error
YAMLException.prototype = Object.create(Error.prototype)
YAMLException.prototype.constructor = YAMLException

YAMLException.prototype.toString = function toString (compact) {
  return this.name + ': ' + formatError(this, compact)
}

module.exports = YAMLException


/***/ }),

/***/ 950:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const common = __nccwpck_require__(816)
const YAMLException = __nccwpck_require__(248)
const makeSnippet = __nccwpck_require__(440)
const DEFAULT_SCHEMA = __nccwpck_require__(336)

const _hasOwnProperty = Object.prototype.hasOwnProperty

const CONTEXT_FLOW_IN = 1
const CONTEXT_FLOW_OUT = 2
const CONTEXT_BLOCK_IN = 3
const CONTEXT_BLOCK_OUT = 4

const CHOMPING_CLIP = 1
const CHOMPING_STRIP = 2
const CHOMPING_KEEP = 3

// eslint-disable-next-line no-control-regex
const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/
const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/
// eslint-disable-next-line no-useless-escape
const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/
// eslint-disable-next-line no-useless-escape
const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/
// eslint-disable-next-line no-useless-escape
const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i

function _class (obj) { return Object.prototype.toString.call(obj) }

function isEol (c) {
  return (c === 0x0A/* LF */) || (c === 0x0D/* CR */)
}

function isWhiteSpace (c) {
  return (c === 0x09/* Tab */) || (c === 0x20/* Space */)
}

function isWsOrEol (c) {
  return (c === 0x09/* Tab */) ||
         (c === 0x20/* Space */) ||
         (c === 0x0A/* LF */) ||
         (c === 0x0D/* CR */)
}

function isFlowIndicator (c) {
  return c === 0x2C/* , */ ||
         c === 0x5B/* [ */ ||
         c === 0x5D/* ] */ ||
         c === 0x7B/* { */ ||
         c === 0x7D/* } */
}

function fromHexCode (c) {
  if ((c >= 0x30/* 0 */) && (c <= 0x39/* 9 */)) {
    return c - 0x30
  }

  const lc = c | 0x20

  if ((lc >= 0x61/* a */) && (lc <= 0x66/* f */)) {
    return lc - 0x61 + 10
  }

  return -1
}

function escapedHexLen (c) {
  if (c === 0x78/* x */) { return 2 }
  if (c === 0x75/* u */) { return 4 }
  if (c === 0x55/* U */) { return 8 }
  return 0
}

function fromDecimalCode (c) {
  if ((c >= 0x30/* 0 */) && (c <= 0x39/* 9 */)) {
    return c - 0x30
  }

  return -1
}

function simpleEscapeSequence (c) {
  switch (c) {
    case 0x30/* 0 */: return '\x00'
    case 0x61/* a */: return '\x07'
    case 0x62/* b */: return '\x08'
    case 0x74/* t */: return '\x09'
    case 0x09/* Tab */: return '\x09'
    case 0x6E/* n */: return '\x0A'
    case 0x76/* v */: return '\x0B'
    case 0x66/* f */: return '\x0C'
    case 0x72/* r */: return '\x0D'
    case 0x65/* e */: return '\x1B'
    case 0x20/* Space */: return ' '
    case 0x22/* " */: return '\x22'
    case 0x2F/* / */: return '/'
    case 0x5C/* \ */: return '\x5C'
    case 0x4E/* N */: return '\x85'
    case 0x5F/* _ */: return '\xA0'
    case 0x4C/* L */: return '\u2028'
    case 0x50/* P */: return '\u2029'
    default: return ''
  }
}

function charFromCodepoint (c) {
  if (c <= 0xFFFF) {
    return String.fromCharCode(c)
  }
  // Encode UTF-16 surrogate pair
  // https://en.wikipedia.org/wiki/UTF-16#Code_points_U.2B010000_to_U.2B10FFFF
  return String.fromCharCode(
    ((c - 0x010000) >> 10) + 0xD800,
    ((c - 0x010000) & 0x03FF) + 0xDC00
  )
}

// set a property of a literal object, while protecting against prototype pollution,
// see https://github.com/nodeca/js-yaml/issues/164 for more details
function setProperty (object, key, value) {
  // used for this specific key only because Object.defineProperty is slow
  if (key === '__proto__') {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: value
    })
  } else {
    object[key] = value
  }
}

const simpleEscapeCheck = new Array(256) // integer, for fast access
const simpleEscapeMap = new Array(256)
for (let i = 0; i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0
  simpleEscapeMap[i] = simpleEscapeSequence(i)
}

function State (input, options) {
  this.input = input

  this.filename = options['filename'] || null
  this.schema = options['schema'] || DEFAULT_SCHEMA
  this.onWarning = options['onWarning'] || null
  // (Hidden) Remove? makes the loader to expect YAML 1.1 documents
  // if such documents have no explicit %YAML directive
  this.legacy = options['legacy'] || false

  this.json = options['json'] || false
  this.listener = options['listener'] || null
  this.maxDepth = typeof options['maxDepth'] === 'number' ? options['maxDepth'] : 100
  this.maxTotalMergeKeys = typeof options['maxTotalMergeKeys'] === 'number' ? options['maxTotalMergeKeys'] : 10000

  this.implicitTypes = this.schema.compiledImplicit
  this.typeMap = this.schema.compiledTypeMap

  this.length = input.length
  this.position = 0
  this.line = 0
  this.lineStart = 0
  this.lineIndent = 0
  this.depth = 0
  this.totalMergeKeys = 0

  // position of first leading tab in the current line,
  // used to make sure there are no tabs in the indentation
  this.firstTabInLine = -1

  this.documents = []
  this.anchorMapTransactions = []

  /*
  this.version;
  this.checkLineBreaks;
  this.tagMap;
  this.anchorMap;
  this.tag;
  this.anchor;
  this.kind;
  this.result; */
}

function generateError (state, message) {
  const mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1), // omit trailing \0
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  }

  mark.snippet = makeSnippet(mark)

  return new YAMLException(message, mark)
}

function throwError (state, message) {
  throw generateError(state, message)
}

function throwWarning (state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message))
  }
}

function storeAnchor (state, name, value) {
  const transactions = state.anchorMapTransactions

  if (transactions.length !== 0) {
    const transaction = transactions[transactions.length - 1]

    if (!_hasOwnProperty.call(transaction, name)) {
      transaction[name] = {
        existed: _hasOwnProperty.call(state.anchorMap, name),
        value: state.anchorMap[name]
      }
    }
  }

  state.anchorMap[name] = value
}

function beginAnchorTransaction (state) {
  state.anchorMapTransactions.push(Object.create(null))
}

function commitAnchorTransaction (state) {
  const transaction = state.anchorMapTransactions.pop()
  const transactions = state.anchorMapTransactions

  if (transactions.length === 0) return

  const parent = transactions[transactions.length - 1]
  const names = Object.keys(transaction)

  for (let index = 0, length = names.length; index < length; index += 1) {
    const name = names[index]

    if (!_hasOwnProperty.call(parent, name)) {
      parent[name] = transaction[name]
    }
  }
}

function rollbackAnchorTransaction (state) {
  const transaction = state.anchorMapTransactions.pop()
  const names = Object.keys(transaction)

  for (let index = names.length - 1; index >= 0; index -= 1) {
    const entry = transaction[names[index]]

    if (entry.existed) {
      state.anchorMap[names[index]] = entry.value
    } else {
      delete state.anchorMap[names[index]]
    }
  }
}

function snapshotState (state) {
  return {
    position: state.position,
    line: state.line,
    lineStart: state.lineStart,
    lineIndent: state.lineIndent,
    firstTabInLine: state.firstTabInLine,
    tag: state.tag,
    anchor: state.anchor,
    kind: state.kind,
    result: state.result
  }
}

function restoreState (state, snapshot) {
  state.position = snapshot.position
  state.line = snapshot.line
  state.lineStart = snapshot.lineStart
  state.lineIndent = snapshot.lineIndent
  state.firstTabInLine = snapshot.firstTabInLine
  state.tag = snapshot.tag
  state.anchor = snapshot.anchor
  state.kind = snapshot.kind
  state.result = snapshot.result
}

const directiveHandlers = {

  YAML: function handleYamlDirective (state, name, args) {
    if (state.version !== null) {
      throwError(state, 'duplication of %YAML directive')
    }

    if (args.length !== 1) {
      throwError(state, 'YAML directive accepts exactly one argument')
    }

    const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0])

    if (match === null) {
      throwError(state, 'ill-formed argument of the YAML directive')
    }

    const major = parseInt(match[1], 10)
    const minor = parseInt(match[2], 10)

    if (major !== 1) {
      throwError(state, 'unacceptable YAML version of the document')
    }

    state.version = args[0]
    state.checkLineBreaks = (minor < 2)

    if (minor !== 1 && minor !== 2) {
      throwWarning(state, 'unsupported YAML version of the document')
    }
  },

  TAG: function handleTagDirective (state, name, args) {
    let prefix

    if (args.length !== 2) {
      throwError(state, 'TAG directive accepts exactly two arguments')
    }

    const handle = args[0]
    prefix = args[1]

    if (!PATTERN_TAG_HANDLE.test(handle)) {
      throwError(state, 'ill-formed tag handle (first argument) of the TAG directive')
    }

    if (_hasOwnProperty.call(state.tagMap, handle)) {
      throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle')
    }

    if (!PATTERN_TAG_URI.test(prefix)) {
      throwError(state, 'ill-formed tag prefix (second argument) of the TAG directive')
    }

    try {
      prefix = decodeURIComponent(prefix)
    } catch (err) {
      throwError(state, 'tag prefix is malformed: ' + prefix)
    }

    state.tagMap[handle] = prefix
  }
}

function captureSegment (state, start, end, checkJson) {
  if (start < end) {
    const _result = state.input.slice(start, end)

    if (checkJson) {
      for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
        const _character = _result.charCodeAt(_position)
        if (!(_character === 0x09 ||
              (_character >= 0x20 && _character <= 0x10FFFF))) {
          throwError(state, 'expected valid JSON character')
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, 'the stream contains non-printable characters')
    }

    state.result += _result
  }
}

function chargeMergeWork (state) {
  state.totalMergeKeys++

  if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) {
    throwError(state, 'merge keys exceeded maxTotalMergeKeys (' + state.maxTotalMergeKeys + ')')
  }
}

function mergeMappings (state, destination, source, overridableKeys) {
  if (!common.isObject(source)) {
    throwError(state, 'cannot merge mappings; the provided source object is unacceptable')
  }

  // Count the source mapping itself to bound sequences of empty mappings.
  chargeMergeWork(state)

  const sourceKeys = Object.keys(source)

  for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
    const key = sourceKeys[index]

    chargeMergeWork(state)

    if (!_hasOwnProperty.call(destination, key)) {
      setProperty(destination, key, source[key])
      overridableKeys[key] = true
    }
  }
}

function storeMappingPair (state, _result, overridableKeys, keyTag, keyNode, valueNode,
  startLine, startLineStart, startPos) {
  // The output is a plain object here, so keys can only be strings.
  // We need to convert keyNode to a string, but doing so can hang the process
  // (deeply nested arrays that explode exponentially using aliases).
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode)

    for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, 'nested arrays are not supported inside keys')
      }

      if (typeof keyNode === 'object' && _class(keyNode[index]) === '[object Object]') {
        keyNode[index] = '[object Object]'
      }
    }
  }

  // Avoid code execution in load() via toString property
  // (still use its own toString for arrays, timestamps,
  // and whatever user schema extensions happen to have @@toStringTag)
  if (typeof keyNode === 'object' && _class(keyNode) === '[object Object]') {
    keyNode = '[object Object]'
  }

  keyNode = String(keyNode)

  if (_result === null) {
    _result = {}
  }

  if (keyTag === 'tag:yaml.org,2002:merge') {
    if (Array.isArray(valueNode)) {
      if (valueNode.length > 100) {
        throwError(state, 'abnormal merge sequence size')
      }

      for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys)
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys)
    }
  } else {
    if (!state.json &&
        !_hasOwnProperty.call(overridableKeys, keyNode) &&
        _hasOwnProperty.call(_result, keyNode)) {
      state.line = startLine || state.line
      state.lineStart = startLineStart || state.lineStart
      state.position = startPos || state.position
      throwError(state, 'duplicated mapping key')
    }

    setProperty(_result, keyNode, valueNode)
    delete overridableKeys[keyNode]
  }

  return _result
}

function readLineBreak (state) {
  const ch = state.input.charCodeAt(state.position)

  if (ch === 0x0A/* LF */) {
    state.position++
  } else if (ch === 0x0D/* CR */) {
    state.position++
    if (state.input.charCodeAt(state.position) === 0x0A/* LF */) {
      state.position++
    }
  } else {
    throwError(state, 'a line break is expected')
  }

  state.line += 1
  state.lineStart = state.position
  state.firstTabInLine = -1
}

function skipSeparationSpace (state, allowComments, checkIndent) {
  let lineBreaks = 0
  let ch = state.input.charCodeAt(state.position)

  while (ch !== 0) {
    while (isWhiteSpace(ch)) {
      if (ch === 0x09/* Tab */ && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position
      }
      ch = state.input.charCodeAt(++state.position)
    }

    if (allowComments && ch === 0x23/* # */) {
      do {
        ch = state.input.charCodeAt(++state.position)
      } while (ch !== 0x0A/* LF */ && ch !== 0x0D/* CR */ && ch !== 0)
    }

    if (isEol(ch)) {
      readLineBreak(state)

      ch = state.input.charCodeAt(state.position)
      lineBreaks++
      state.lineIndent = 0

      while (ch === 0x20/* Space */) {
        state.lineIndent++
        ch = state.input.charCodeAt(++state.position)
      }
    } else {
      break
    }
  }

  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, 'deficient indentation')
  }

  return lineBreaks
}

function testDocumentSeparator (state) {
  let _position = state.position
  let ch = state.input.charCodeAt(_position)

  // Condition state.position === state.lineStart is tested
  // in parent on each call, for efficiency. No needs to test here again.
  if ((ch === 0x2D/* - */ || ch === 0x2E/* . */) &&
      ch === state.input.charCodeAt(_position + 1) &&
      ch === state.input.charCodeAt(_position + 2)) {
    _position += 3

    ch = state.input.charCodeAt(_position)

    if (ch === 0 || isWsOrEol(ch)) {
      return true
    }
  }

  return false
}

function writeFoldedLines (state, count) {
  if (count === 1) {
    state.result += ' '
  } else if (count > 1) {
    state.result += common.repeat('\n', count - 1)
  }
}

function readPlainScalar (state, nodeIndent, withinFlowCollection) {
  let captureStart
  let captureEnd
  let hasPendingContent
  let _line
  let _lineStart
  let _lineIndent
  const _kind = state.kind
  const _result = state.result

  let ch = state.input.charCodeAt(state.position)

  if (isWsOrEol(ch) ||
      isFlowIndicator(ch) ||
      ch === 0x23/* # */ ||
      ch === 0x26/* & */ ||
      ch === 0x2A/* * */ ||
      ch === 0x21/* ! */ ||
      ch === 0x7C/* | */ ||
      ch === 0x3E/* > */ ||
      ch === 0x27/* ' */ ||
      ch === 0x22/* " */ ||
      ch === 0x25/* % */ ||
      ch === 0x40/* @ */ ||
      ch === 0x60/* ` */) {
    return false
  }

  if (ch === 0x3F/* ? */ || ch === 0x2D/* - */) {
    const following = state.input.charCodeAt(state.position + 1)

    if (isWsOrEol(following) ||
        (withinFlowCollection && isFlowIndicator(following))) {
      return false
    }
  }

  state.kind = 'scalar'
  state.result = ''
  captureStart = captureEnd = state.position
  hasPendingContent = false

  while (ch !== 0) {
    if (ch === 0x3A/* : */) {
      const following = state.input.charCodeAt(state.position + 1)

      if (isWsOrEol(following) ||
          (withinFlowCollection && isFlowIndicator(following))) {
        break
      }
    } else if (ch === 0x23/* # */) {
      const preceding = state.input.charCodeAt(state.position - 1)

      if (isWsOrEol(preceding)) {
        break
      }
    } else if ((state.position === state.lineStart && testDocumentSeparator(state)) ||
               (withinFlowCollection && isFlowIndicator(ch))) {
      break
    } else if (isEol(ch)) {
      _line = state.line
      _lineStart = state.lineStart
      _lineIndent = state.lineIndent
      skipSeparationSpace(state, false, -1)

      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true
        ch = state.input.charCodeAt(state.position)
        continue
      } else {
        state.position = captureEnd
        state.line = _line
        state.lineStart = _lineStart
        state.lineIndent = _lineIndent
        break
      }
    }

    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false)
      writeFoldedLines(state, state.line - _line)
      captureStart = captureEnd = state.position
      hasPendingContent = false
    }

    if (!isWhiteSpace(ch)) {
      captureEnd = state.position + 1
    }

    ch = state.input.charCodeAt(++state.position)
  }

  captureSegment(state, captureStart, captureEnd, false)

  if (state.result) {
    return true
  }

  state.kind = _kind
  state.result = _result
  return false
}

function readSingleQuotedScalar (state, nodeIndent) {
  let captureStart
  let captureEnd

  let ch = state.input.charCodeAt(state.position)

  if (ch !== 0x27/* ' */) {
    return false
  }

  state.kind = 'scalar'
  state.result = ''
  state.position++
  captureStart = captureEnd = state.position

  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 0x27/* ' */) {
      captureSegment(state, captureStart, state.position, true)
      ch = state.input.charCodeAt(++state.position)

      if (ch === 0x27/* ' */) {
        captureStart = state.position
        state.position++
        captureEnd = state.position
      } else {
        return true
      }
    } else if (isEol(ch)) {
      captureSegment(state, captureStart, captureEnd, true)
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent))
      captureStart = captureEnd = state.position
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, 'unexpected end of the document within a single quoted scalar')
    } else {
      state.position++
      if (!isWhiteSpace(ch)) {
        captureEnd = state.position
      }
    }
  }

  throwError(state, 'unexpected end of the stream within a single quoted scalar')
}

function readDoubleQuotedScalar (state, nodeIndent) {
  let captureStart
  let captureEnd
  let tmp

  let ch = state.input.charCodeAt(state.position)

  if (ch !== 0x22/* " */) {
    return false
  }

  state.kind = 'scalar'
  state.result = ''
  state.position++
  captureStart = captureEnd = state.position

  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 0x22/* " */) {
      captureSegment(state, captureStart, state.position, true)
      state.position++
      return true
    } else if (ch === 0x5C/* \ */) {
      captureSegment(state, captureStart, state.position, true)
      ch = state.input.charCodeAt(++state.position)

      if (isEol(ch)) {
        skipSeparationSpace(state, false, nodeIndent)

        // TODO: rework to inline fn with no type cast?
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch]
        state.position++
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        let hexLength = tmp
        let hexResult = 0

        for (; hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position)

          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp
          } else {
            throwError(state, 'expected hexadecimal character')
          }
        }

        state.result += charFromCodepoint(hexResult)

        state.position++
      } else {
        throwError(state, 'unknown escape sequence')
      }

      captureStart = captureEnd = state.position
    } else if (isEol(ch)) {
      captureSegment(state, captureStart, captureEnd, true)
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent))
      captureStart = captureEnd = state.position
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, 'unexpected end of the document within a double quoted scalar')
    } else {
      state.position++
      if (!isWhiteSpace(ch)) {
        captureEnd = state.position
      }
    }
  }

  throwError(state, 'unexpected end of the stream within a double quoted scalar')
}

function readFlowCollection (state, nodeIndent) {
  let readNext = true
  let _line
  let _lineStart
  let _pos
  const _tag = state.tag
  let _result
  const _anchor = state.anchor
  let terminator
  let isPair
  let isExplicitPair
  let isMapping
  const overridableKeys = Object.create(null)
  let keyNode
  let keyTag
  let valueNode

  let ch = state.input.charCodeAt(state.position)

  if (ch === 0x5B/* [ */) {
    terminator = 0x5D/* ] */
    isMapping = false
    _result = []
  } else if (ch === 0x7B/* { */) {
    terminator = 0x7D/* } */
    isMapping = true
    _result = {}
  } else {
    return false
  }

  if (state.anchor !== null) {
    storeAnchor(state, state.anchor, _result)
  }

  ch = state.input.charCodeAt(++state.position)

  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent)

    ch = state.input.charCodeAt(state.position)

    if (ch === terminator) {
      state.position++
      state.tag = _tag
      state.anchor = _anchor
      state.kind = isMapping ? 'mapping' : 'sequence'
      state.result = _result
      return true
    } else if (!readNext) {
      throwError(state, 'missed comma between flow collection entries')
    } else if (ch === 0x2C/* , */) {
      // "flow collection entries can never be completely empty", as per YAML 1.2, section 7.4
      throwError(state, "expected the node content, but found ','")
    }

    keyTag = keyNode = valueNode = null
    isPair = isExplicitPair = false

    if (ch === 0x3F/* ? */) {
      const following = state.input.charCodeAt(state.position + 1)

      if (isWsOrEol(following)) {
        isPair = isExplicitPair = true
        state.position++
        skipSeparationSpace(state, true, nodeIndent)
      }
    }

    _line = state.line // Save the current line.
    _lineStart = state.lineStart
    _pos = state.position
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true)
    keyTag = state.tag
    keyNode = state.result
    skipSeparationSpace(state, true, nodeIndent)

    ch = state.input.charCodeAt(state.position)

    if ((isExplicitPair || state.line === _line) && ch === 0x3A/* : */) {
      isPair = true
      ch = state.input.charCodeAt(++state.position)
      skipSeparationSpace(state, true, nodeIndent)
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true)
      valueNode = state.result
    }

    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos)
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos))
    } else {
      _result.push(keyNode)
    }

    skipSeparationSpace(state, true, nodeIndent)

    ch = state.input.charCodeAt(state.position)

    if (ch === 0x2C/* , */) {
      readNext = true
      ch = state.input.charCodeAt(++state.position)
    } else {
      readNext = false
    }
  }

  throwError(state, 'unexpected end of the stream within a flow collection')
}

function readBlockScalar (state, nodeIndent) {
  let folding
  let chomping = CHOMPING_CLIP
  let didReadContent = false
  let detectedIndent = false
  let textIndent = nodeIndent
  let emptyLines = 0
  let atMoreIndented = false
  let tmp

  let ch = state.input.charCodeAt(state.position)

  if (ch === 0x7C/* | */) {
    folding = false
  } else if (ch === 0x3E/* > */) {
    folding = true
  } else {
    return false
  }

  state.kind = 'scalar'
  state.result = ''

  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position)

    if (ch === 0x2B/* + */ || ch === 0x2D/* - */) {
      if (CHOMPING_CLIP === chomping) {
        chomping = (ch === 0x2B/* + */) ? CHOMPING_KEEP : CHOMPING_STRIP
      } else {
        throwError(state, 'repeat of a chomping mode identifier')
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, 'bad explicit indentation width of a block scalar; it cannot be less than one')
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1
        detectedIndent = true
      } else {
        throwError(state, 'repeat of an indentation width identifier')
      }
    } else {
      break
    }
  }

  if (isWhiteSpace(ch)) {
    do { ch = state.input.charCodeAt(++state.position) }
    while (isWhiteSpace(ch))

    if (ch === 0x23/* # */) {
      do { ch = state.input.charCodeAt(++state.position) }
      while (!isEol(ch) && (ch !== 0))
    }
  }

  while (ch !== 0) {
    readLineBreak(state)
    state.lineIndent = 0

    ch = state.input.charCodeAt(state.position)

    // eslint-disable-next-line no-unmodified-loop-condition
    while ((!detectedIndent || state.lineIndent < textIndent) &&
           (ch === 0x20/* Space */)) {
      state.lineIndent++
      ch = state.input.charCodeAt(++state.position)
    }

    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent
    }

    if (isEol(ch)) {
      emptyLines++
      continue
    }

    if (!detectedIndent && textIndent === 0) {
      throwError(state, 'missing indentation for block scalar')
    }

    // End of the scalar.
    if (state.lineIndent < textIndent) {
      // Perform the chomping.
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat('\n', didReadContent ? 1 + emptyLines : emptyLines)
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) { // i.e. only if the scalar is not empty.
          state.result += '\n'
        }
      }

      // Break this `while` cycle and go to the funciton's epilogue.
      break
    }

    // Folded style: use fancy rules to handle line breaks.
    if (folding) {
      // Lines starting with white space characters (more-indented lines) are not folded.
      if (isWhiteSpace(ch)) {
        atMoreIndented = true
        // except for the first content line (cf. Example 8.1)
        state.result += common.repeat('\n', didReadContent ? 1 + emptyLines : emptyLines)

      // End of more-indented block.
      } else if (atMoreIndented) {
        atMoreIndented = false
        state.result += common.repeat('\n', emptyLines + 1)

      // Just one line break - perceive as the same line.
      } else if (emptyLines === 0) {
        if (didReadContent) { // i.e. only if we have already read some scalar content.
          state.result += ' '
        }

      // Several line breaks - perceive as different lines.
      } else {
        state.result += common.repeat('\n', emptyLines)
      }

    // Literal style: just add exact number of line breaks between content lines.
    } else {
      // Keep all line breaks except the header line break.
      state.result += common.repeat('\n', didReadContent ? 1 + emptyLines : emptyLines)
    }

    didReadContent = true
    detectedIndent = true
    emptyLines = 0
    const captureStart = state.position

    while (!isEol(ch) && (ch !== 0)) {
      ch = state.input.charCodeAt(++state.position)
    }

    captureSegment(state, captureStart, state.position, false)
  }

  return true
}

function readBlockSequence (state, nodeIndent) {
  const _tag = state.tag
  const _anchor = state.anchor
  const _result = []
  let detected = false

  // there is a leading tab before this token, so it can't be a block sequence/mapping;
  // it can still be flow sequence/mapping or a scalar
  if (state.firstTabInLine !== -1) return false

  if (state.anchor !== null) {
    storeAnchor(state, state.anchor, _result)
  }

  let ch = state.input.charCodeAt(state.position)

  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine
      throwError(state, 'tab characters must not be used in indentation')
    }

    if (ch !== 0x2D/* - */) {
      break
    }

    const following = state.input.charCodeAt(state.position + 1)

    if (!isWsOrEol(following)) {
      break
    }

    detected = true
    state.position++

    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null)
        ch = state.input.charCodeAt(state.position)
        continue
      }
    }

    const _line = state.line
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true)
    _result.push(state.result)
    skipSeparationSpace(state, true, -1)

    ch = state.input.charCodeAt(state.position)

    if ((state.line === _line || state.lineIndent > nodeIndent) && (ch !== 0)) {
      throwError(state, 'bad indentation of a sequence entry')
    } else if (state.lineIndent < nodeIndent) {
      break
    }
  }

  if (detected) {
    state.tag = _tag
    state.anchor = _anchor
    state.kind = 'sequence'
    state.result = _result
    return true
  }
  return false
}

function readBlockMapping (state, nodeIndent, flowIndent) {
  let allowCompact
  let _keyLine
  let _keyLineStart
  let _keyPos
  const _tag = state.tag
  const _anchor = state.anchor
  const _result = {}
  const overridableKeys = Object.create(null)
  let keyTag = null
  let keyNode = null
  let valueNode = null
  let atExplicitKey = false
  let detected = false

  // there is a leading tab before this token, so it can't be a block sequence/mapping;
  // it can still be flow sequence/mapping or a scalar
  if (state.firstTabInLine !== -1) return false

  if (state.anchor !== null) {
    storeAnchor(state, state.anchor, _result)
  }

  let ch = state.input.charCodeAt(state.position)

  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine
      throwError(state, 'tab characters must not be used in indentation')
    }

    const following = state.input.charCodeAt(state.position + 1)
    const _line = state.line // Save the current line.

    //
    // Explicit notation case. There are two separate blocks:
    // first for the key (denoted by "?") and second for the value (denoted by ":")
    //
    if ((ch === 0x3F/* ? */ || ch === 0x3A/* : */) && isWsOrEol(following)) {
      if (ch === 0x3F/* ? */) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos)
          keyTag = keyNode = valueNode = null
        }

        detected = true
        atExplicitKey = true
        allowCompact = true
      } else if (atExplicitKey) {
        // i.e. 0x3A/* : */ === character after the explicit key.
        atExplicitKey = false
        allowCompact = true
      } else {
        throwError(state, 'incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line')
      }

      state.position += 1
      ch = following

    //
    // Implicit notation case. Flow-style node as the key first, then ":", and the value.
    //
    } else {
      _keyLine = state.line
      _keyLineStart = state.lineStart
      _keyPos = state.position

      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        // Neither implicit nor explicit notation.
        // Reading is done. Go to the epilogue.
        break
      }

      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position)

        while (isWhiteSpace(ch)) {
          ch = state.input.charCodeAt(++state.position)
        }

        if (ch === 0x3A/* : */) {
          ch = state.input.charCodeAt(++state.position)

          if (!isWsOrEol(ch)) {
            throwError(state, 'a whitespace character is expected after the key-value separator within a block mapping')
          }

          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos)
            keyTag = keyNode = valueNode = null
          }

          detected = true
          atExplicitKey = false
          allowCompact = false
          keyTag = state.tag
          keyNode = state.result
        } else if (detected) {
          throwError(state, 'can not read an implicit mapping pair; a colon is missed')
        } else {
          state.tag = _tag
          state.anchor = _anchor
          return true // Keep the result of `composeNode`.
        }
      } else if (detected) {
        throwError(state, 'can not read a block mapping entry; a multiline key may not be an implicit key')
      } else {
        state.tag = _tag
        state.anchor = _anchor
        return true // Keep the result of `composeNode`.
      }
    }

    //
    // Common reading code for both explicit and implicit notations.
    //
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line
        _keyLineStart = state.lineStart
        _keyPos = state.position
      }

      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result
        } else {
          valueNode = state.result
        }
      }

      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos)
        keyTag = keyNode = valueNode = null
      }

      skipSeparationSpace(state, true, -1)
      ch = state.input.charCodeAt(state.position)
    }

    if ((state.line === _line || state.lineIndent > nodeIndent) && (ch !== 0)) {
      throwError(state, 'bad indentation of a mapping entry')
    } else if (state.lineIndent < nodeIndent) {
      break
    }
  }

  //
  // Epilogue.
  //

  // Special case: last mapping's node contains only the key in explicit notation.
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos)
  }

  // Expose the resulting mapping.
  if (detected) {
    state.tag = _tag
    state.anchor = _anchor
    state.kind = 'mapping'
    state.result = _result
  }

  return detected
}

function readTagProperty (state) {
  let isVerbatim = false
  let isNamed = false
  let tagHandle
  let tagName

  let ch = state.input.charCodeAt(state.position)

  if (ch !== 0x21/* ! */) return false

  if (state.tag !== null) {
    throwError(state, 'duplication of a tag property')
  }

  ch = state.input.charCodeAt(++state.position)

  if (ch === 0x3C/* < */) {
    isVerbatim = true
    ch = state.input.charCodeAt(++state.position)
  } else if (ch === 0x21/* ! */) {
    isNamed = true
    tagHandle = '!!'
    ch = state.input.charCodeAt(++state.position)
  } else {
    tagHandle = '!'
  }

  let _position = state.position

  if (isVerbatim) {
    do { ch = state.input.charCodeAt(++state.position) }
    while (ch !== 0 && ch !== 0x3E/* > */)

    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position)
      ch = state.input.charCodeAt(++state.position)
    } else {
      throwError(state, 'unexpected end of the stream within a verbatim tag')
    }
  } else {
    while (ch !== 0 && !isWsOrEol(ch)) {
      if (ch === 0x21/* ! */) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1)

          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, 'named tag handle cannot contain such characters')
          }

          isNamed = true
          _position = state.position + 1
        } else {
          throwError(state, 'tag suffix cannot contain exclamation marks')
        }
      }

      ch = state.input.charCodeAt(++state.position)
    }

    tagName = state.input.slice(_position, state.position)

    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, 'tag suffix cannot contain flow indicator characters')
    }
  }

  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, 'tag name cannot contain such characters: ' + tagName)
  }

  try {
    tagName = decodeURIComponent(tagName)
  } catch (err) {
    throwError(state, 'tag name is malformed: ' + tagName)
  }

  if (isVerbatim) {
    state.tag = tagName
  } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName
  } else if (tagHandle === '!') {
    state.tag = '!' + tagName
  } else if (tagHandle === '!!') {
    state.tag = 'tag:yaml.org,2002:' + tagName
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"')
  }

  return true
}

function readAnchorProperty (state) {
  let ch = state.input.charCodeAt(state.position)

  if (ch !== 0x26/* & */) return false

  if (state.anchor !== null) {
    throwError(state, 'duplication of an anchor property')
  }

  ch = state.input.charCodeAt(++state.position)
  const _position = state.position

  while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
    ch = state.input.charCodeAt(++state.position)
  }

  if (state.position === _position) {
    throwError(state, 'name of an anchor node must contain at least one character')
  }

  state.anchor = state.input.slice(_position, state.position)
  return true
}

function readAlias (state) {
  let ch = state.input.charCodeAt(state.position)

  if (ch !== 0x2A/* * */) return false

  ch = state.input.charCodeAt(++state.position)
  const _position = state.position

  while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
    ch = state.input.charCodeAt(++state.position)
  }

  if (state.position === _position) {
    throwError(state, 'name of an alias node must contain at least one character')
  }

  const alias = state.input.slice(_position, state.position)

  if (!_hasOwnProperty.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"')
  }

  state.result = state.anchorMap[alias]
  skipSeparationSpace(state, true, -1)
  return true
}

function tryReadBlockMappingFromProperty (state, propertyStart, nodeIndent, flowIndent) {
  const fallbackState = snapshotState(state)

  beginAnchorTransaction(state)
  restoreState(state, propertyStart)

  // Re-read the leading properties as part of the first implicit key, not as
  // properties of the current node.
  state.tag = null
  state.anchor = null
  state.kind = null
  state.result = null

  if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === 'mapping') {
    commitAnchorTransaction(state)
    return true
  }

  rollbackAnchorTransaction(state)
  restoreState(state, fallbackState)
  return false
}

function composeNode (state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  let allowBlockScalars
  let allowBlockCollections
  let indentStatus = 1 // 1: this>parent, 0: this=parent, -1: this<parent
  let atNewLine = false
  let hasContent = false
  let propertyStart = null
  let type
  let flowIndent
  let blockIndent

  if (state.depth >= state.maxDepth) {
    throwError(state, 'nesting exceeded maxDepth (' + state.maxDepth + ')')
  }

  state.depth += 1

  if (state.listener !== null) {
    state.listener('open', state)
  }

  state.tag = null
  state.anchor = null
  state.kind = null
  state.result = null

  const allowBlockStyles = allowBlockScalars = allowBlockCollections =
    CONTEXT_BLOCK_OUT === nodeContext ||
    CONTEXT_BLOCK_IN === nodeContext

  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true

      if (state.lineIndent > parentIndent) {
        indentStatus = 1
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1
      }
    }
  }

  if (indentStatus === 1) {
    while (true) {
      const ch = state.input.charCodeAt(state.position)
      const propertyState = snapshotState(state)

      // A duplicate property token after a line break can be the first key of
      // a nested block mapping, e.g. `!!map\n  !!str key: value`.
      if (atNewLine &&
          ((ch === 0x21/* ! */ && state.tag !== null) ||
           (ch === 0x26/* & */ && state.anchor !== null))) {
        break
      }

      if (!readTagProperty(state) && !readAnchorProperty(state)) {
        break
      }

      if (propertyStart === null) {
        propertyStart = propertyState
      }

      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true
        allowBlockCollections = allowBlockStyles

        if (state.lineIndent > parentIndent) {
          indentStatus = 1
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1
        }
      } else {
        allowBlockCollections = false
      }
    }
  }

  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact
  }

  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent
    } else {
      flowIndent = parentIndent + 1
    }

    blockIndent = state.position - state.lineStart

    if (indentStatus === 1) {
      if ((allowBlockCollections &&
          (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent))) ||
          readFlowCollection(state, flowIndent)) {
        hasContent = true
      } else {
        const ch = state.input.charCodeAt(state.position)

        if (propertyStart !== null && allowBlockStyles && !allowBlockCollections &&
            ch !== 0x7C/* | */ && ch !== 0x3E/* > */ &&
            tryReadBlockMappingFromProperty(
              state,
              propertyStart,
              propertyStart.position - propertyStart.lineStart,
              flowIndent
            )) {
          hasContent = true
        } else if ((allowBlockScalars && readBlockScalar(state, flowIndent)) ||
            readSingleQuotedScalar(state, flowIndent) ||
            readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true
        } else if (readAlias(state)) {
          hasContent = true

          if (state.tag !== null || state.anchor !== null) {
            throwError(state, 'alias node should not have any properties')
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true

          if (state.tag === null) {
            state.tag = '?'
          }
        }

        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result)
        }
      }
    } else if (indentStatus === 0) {
      // Special case: block sequences are allowed to have same indentation level as the parent.
      // http://www.yaml.org/spec/1.2/spec.html#id2799784
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent)
    }
  }

  if (state.tag === null) {
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, state.result)
    }
  } else if (state.tag === '?') {
    // Implicit resolving is not allowed for non-scalar types, and '?'
    // non-specific tag is only automatically assigned to plain scalars.
    //
    // We only need to check kind conformity in case user explicitly assigns '?'
    // tag, for example like this: "!<?> [0]"
    //
    if (state.result !== null && state.kind !== 'scalar') {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"')
    }

    for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
      type = state.implicitTypes[typeIndex]

      if (type.resolve(state.result)) { // `state.result` updated in resolver if matched
        state.result = type.construct(state.result)
        state.tag = type.tag
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result)
        }
        break
      }
    }
  } else if (state.tag !== '!') {
    if (_hasOwnProperty.call(state.typeMap[state.kind || 'fallback'], state.tag)) {
      type = state.typeMap[state.kind || 'fallback'][state.tag]
    } else {
      // looking for multi type
      type = null
      const typeList = state.typeMap.multi[state.kind || 'fallback']

      for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type = typeList[typeIndex]
          break
        }
      }
    }

    if (!type) {
      throwError(state, 'unknown tag !<' + state.tag + '>')
    }

    if (state.result !== null && type.kind !== state.kind) {
      throwError(state, 'unacceptable node kind for !<' + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"')
    }

    if (!type.resolve(state.result, state.tag)) { // `state.result` updated in resolver if matched
      throwError(state, 'cannot resolve a node with !<' + state.tag + '> explicit tag')
    } else {
      state.result = type.construct(state.result, state.tag)
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, state.result)
      }
    }
  }

  if (state.listener !== null) {
    state.listener('close', state)
  }

  state.depth -= 1
  return state.tag !== null || state.anchor !== null || hasContent
}

function readDocument (state) {
  const documentStart = state.position
  let hasDirectives = false
  let ch

  state.version = null
  state.checkLineBreaks = state.legacy
  state.tagMap = Object.create(null)
  state.anchorMap = Object.create(null)

  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1)

    ch = state.input.charCodeAt(state.position)

    if (state.lineIndent > 0 || ch !== 0x25/* % */) {
      break
    }

    hasDirectives = true
    ch = state.input.charCodeAt(++state.position)
    let _position = state.position

    while (ch !== 0 && !isWsOrEol(ch)) {
      ch = state.input.charCodeAt(++state.position)
    }

    const directiveName = state.input.slice(_position, state.position)
    const directiveArgs = []

    if (directiveName.length < 1) {
      throwError(state, 'directive name must not be less than one character in length')
    }

    while (ch !== 0) {
      while (isWhiteSpace(ch)) {
        ch = state.input.charCodeAt(++state.position)
      }

      if (ch === 0x23/* # */) {
        do { ch = state.input.charCodeAt(++state.position) }
        while (ch !== 0 && !isEol(ch))
        break
      }

      if (isEol(ch)) break

      _position = state.position

      while (ch !== 0 && !isWsOrEol(ch)) {
        ch = state.input.charCodeAt(++state.position)
      }

      directiveArgs.push(state.input.slice(_position, state.position))
    }

    if (ch !== 0) readLineBreak(state)

    if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs)
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"')
    }
  }

  skipSeparationSpace(state, true, -1)

  if (state.lineIndent === 0 &&
      state.input.charCodeAt(state.position) === 0x2D/* - */ &&
      state.input.charCodeAt(state.position + 1) === 0x2D/* - */ &&
      state.input.charCodeAt(state.position + 2) === 0x2D/* - */) {
    state.position += 3
    skipSeparationSpace(state, true, -1)
  } else if (hasDirectives) {
    throwError(state, 'directives end mark is expected')
  }

  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true)
  skipSeparationSpace(state, true, -1)

  if (state.checkLineBreaks &&
      PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, 'non-ASCII line breaks are interpreted as content')
  }

  state.documents.push(state.result)

  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 0x2E/* . */) {
      state.position += 3
      skipSeparationSpace(state, true, -1)
    }
    return
  }

  if (state.position < (state.length - 1)) {
    throwError(state, 'end of the stream or a document separator is expected')
  }
}

function loadDocuments (input, options) {
  input = String(input)
  options = options || {}

  if (input.length !== 0) {
    // Add tailing `\n` if not exists
    if (input.charCodeAt(input.length - 1) !== 0x0A/* LF */ &&
        input.charCodeAt(input.length - 1) !== 0x0D/* CR */) {
      input += '\n'
    }

    // Strip BOM
    if (input.charCodeAt(0) === 0xFEFF) {
      input = input.slice(1)
    }
  }

  const state = new State(input, options)

  const nullpos = input.indexOf('\0')

  if (nullpos !== -1) {
    state.position = nullpos
    throwError(state, 'null byte is not allowed in input')
  }

  // Use 0 as string terminator. That significantly simplifies bounds check.
  state.input += '\0'

  while (state.input.charCodeAt(state.position) === 0x20/* Space */) {
    state.lineIndent += 1
    state.position += 1
  }

  while (state.position < (state.length - 1)) {
    readDocument(state)
  }

  return state.documents
}

function loadAll (input, iterator, options) {
  if (iterator !== null && typeof iterator === 'object' && typeof options === 'undefined') {
    options = iterator
    iterator = null
  }

  const documents = loadDocuments(input, options)

  if (typeof iterator !== 'function') {
    return documents
  }

  for (let index = 0, length = documents.length; index < length; index += 1) {
    iterator(documents[index])
  }
}

function load (input, options) {
  const documents = loadDocuments(input, options)

  if (documents.length === 0) {
    return undefined
  } else if (documents.length === 1) {
    return documents[0]
  }
  throw new YAMLException('expected a single document in the stream, but found more')
}

module.exports.loadAll = loadAll
module.exports.load = load


/***/ }),

/***/ 46:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const YAMLException = __nccwpck_require__(248)
const Type = __nccwpck_require__(557)

function compileList (schema, name) {
  const result = []

  schema[name].forEach(function (currentType) {
    let newIndex = result.length

    result.forEach(function (previousType, previousIndex) {
      if (previousType.tag === currentType.tag &&
          previousType.kind === currentType.kind &&
          previousType.multi === currentType.multi) {
        newIndex = previousIndex
      }
    })

    result[newIndex] = currentType
  })

  return result
}

function compileMap (/* lists... */) {
  const result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }
  function collectType (type) {
    if (type.multi) {
      result.multi[type.kind].push(type)
      result.multi['fallback'].push(type)
    } else {
      result[type.kind][type.tag] = result['fallback'][type.tag] = type
    }
  }

  for (let index = 0, length = arguments.length; index < length; index += 1) {
    arguments[index].forEach(collectType)
  }
  return result
}

function Schema (definition) {
  return this.extend(definition)
}

Schema.prototype.extend = function extend (definition) {
  let implicit = []
  let explicit = []

  if (definition instanceof Type) {
    // Schema.extend(type)
    explicit.push(definition)
  } else if (Array.isArray(definition)) {
    // Schema.extend([ type1, type2, ... ])
    explicit = explicit.concat(definition)
  } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
    // Schema.extend({ explicit: [ type1, type2, ... ], implicit: [ type1, type2, ... ] })
    if (definition.implicit) implicit = implicit.concat(definition.implicit)
    if (definition.explicit) explicit = explicit.concat(definition.explicit)
  } else {
    throw new YAMLException('Schema.extend argument should be a Type, [ Type ], ' +
      'or a schema definition ({ implicit: [...], explicit: [...] })')
  }

  implicit.forEach(function (type) {
    if (!(type instanceof Type)) {
      throw new YAMLException('Specified list of YAML types (or a single Type object) contains a non-Type object.')
    }

    if (type.loadKind && type.loadKind !== 'scalar') {
      throw new YAMLException('There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.')
    }

    if (type.multi) {
      throw new YAMLException('There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.')
    }
  })

  explicit.forEach(function (type) {
    if (!(type instanceof Type)) {
      throw new YAMLException('Specified list of YAML types (or a single Type object) contains a non-Type object.')
    }
  })

  const result = Object.create(Schema.prototype)

  result.implicit = (this.implicit || []).concat(implicit)
  result.explicit = (this.explicit || []).concat(explicit)

  result.compiledImplicit = compileList(result, 'implicit')
  result.compiledExplicit = compileList(result, 'explicit')
  result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit)

  return result
}

module.exports = Schema


/***/ }),

/***/ 746:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// Standard YAML's Core schema.
// http://www.yaml.org/spec/1.2/spec.html#id2804923
//
// NOTE: JS-YAML does not support schema-specific tag resolution restrictions.
// So, Core schema has no distinctions from JSON schema is JS-YAML.



module.exports = __nccwpck_require__(927)


/***/ }),

/***/ 336:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// JS-YAML's default schema for `safeLoad` function.
// It is not described in the YAML specification.
//
// This schema is based on standard YAML's Core schema and includes most of
// extra types described at YAML tag repository. (http://yaml.org/type/)



module.exports = (__nccwpck_require__(746).extend)({
  implicit: [
    __nccwpck_require__(966),
    __nccwpck_require__(854)
  ],
  explicit: [
    __nccwpck_require__(149),
    __nccwpck_require__(649),
    __nccwpck_require__(267),
    __nccwpck_require__(758)
  ]
})


/***/ }),

/***/ 832:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// Standard YAML's Failsafe schema.
// http://www.yaml.org/spec/1.2/spec.html#id2802346



const Schema = __nccwpck_require__(46)

module.exports = new Schema({
  explicit: [
    __nccwpck_require__(929),
    __nccwpck_require__(161),
    __nccwpck_require__(316)
  ]
})


/***/ }),

/***/ 927:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// Standard YAML's JSON schema.
// http://www.yaml.org/spec/1.2/spec.html#id2803231
//
// NOTE: JS-YAML does not support schema-specific tag resolution restrictions.
// So, this schema is not such strict as defined in the YAML specification.
// It allows numbers in binary notaion, use `Null` and `NULL` as `null`, etc.



module.exports = (__nccwpck_require__(832).extend)({
  implicit: [
    __nccwpck_require__(333),
    __nccwpck_require__(296),
    __nccwpck_require__(271),
    __nccwpck_require__(584)
  ]
})


/***/ }),

/***/ 440:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const common = __nccwpck_require__(816)

// get snippet for a single line, respecting maxLength
function getLine (buffer, lineStart, lineEnd, position, maxLineLength) {
  let head = ''
  let tail = ''
  const maxHalfLength = Math.floor(maxLineLength / 2) - 1

  if (position - lineStart > maxHalfLength) {
    head = ' ... '
    lineStart = position - maxHalfLength + head.length
  }

  if (lineEnd - position > maxHalfLength) {
    tail = ' ...'
    lineEnd = position + maxHalfLength - tail.length
  }

  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, '→') + tail,
    pos: position - lineStart + head.length // relative position
  }
}

function padStart (string, max) {
  return common.repeat(' ', max - string.length) + string
}

function makeSnippet (mark, options) {
  options = Object.create(options || null)

  if (!mark.buffer) return null

  if (!options.maxLength) options.maxLength = 79
  if (typeof options.indent !== 'number') options.indent = 1
  if (typeof options.linesBefore !== 'number') options.linesBefore = 3
  if (typeof options.linesAfter !== 'number') options.linesAfter = 2

  const re = /\r?\n|\r|\0/g
  const lineStarts = [0]
  const lineEnds = []
  let match
  let foundLineNo = -1

  while ((match = re.exec(mark.buffer))) {
    lineEnds.push(match.index)
    lineStarts.push(match.index + match[0].length)

    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2
    }
  }

  if (foundLineNo < 0) foundLineNo = lineStarts.length - 1

  let result = ''
  const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length
  const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3)

  for (let i = 1; i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0) break
    const line = getLine(
      mark.buffer,
      lineStarts[foundLineNo - i],
      lineEnds[foundLineNo - i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
      maxLineLength
    )
    result = common.repeat(' ', options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) +
      ' | ' + line.str + '\n' + result
  }

  const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength)
  result += common.repeat(' ', options.indent) + padStart((mark.line + 1).toString(), lineNoLength) +
    ' | ' + line.str + '\n'
  result += common.repeat('-', options.indent + lineNoLength + 3 + line.pos) + '^' + '\n'

  for (let i = 1; i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length) break
    const line = getLine(
      mark.buffer,
      lineStarts[foundLineNo + i],
      lineEnds[foundLineNo + i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
      maxLineLength
    )
    result += common.repeat(' ', options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) +
      ' | ' + line.str + '\n'
  }

  return result.replace(/\n$/, '')
}

module.exports = makeSnippet


/***/ }),

/***/ 557:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const YAMLException = __nccwpck_require__(248)

const TYPE_CONSTRUCTOR_OPTIONS = [
  'kind',
  'multi',
  'resolve',
  'construct',
  'instanceOf',
  'predicate',
  'represent',
  'representName',
  'defaultStyle',
  'styleAliases'
]

const YAML_NODE_KINDS = [
  'scalar',
  'sequence',
  'mapping'
]

function compileStyleAliases (map) {
  const result = {}

  if (map !== null) {
    Object.keys(map).forEach(function (style) {
      map[style].forEach(function (alias) {
        result[String(alias)] = style
      })
    })
  }

  return result
}

function Type (tag, options) {
  options = options || {}

  Object.keys(options).forEach(function (name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new YAMLException('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.')
    }
  })

  // TODO: Add tag format check.
  this.options = options // keep original options in case user wants to extend this type later
  this.tag = tag
  this.kind = options['kind'] || null
  this.resolve = options['resolve'] || function () { return true }
  this.construct = options['construct'] || function (data) { return data }
  this.instanceOf = options['instanceOf'] || null
  this.predicate = options['predicate'] || null
  this.represent = options['represent'] || null
  this.representName = options['representName'] || null
  this.defaultStyle = options['defaultStyle'] || null
  this.multi = options['multi'] || false
  this.styleAliases = compileStyleAliases(options['styleAliases'] || null)

  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new YAMLException('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.')
  }
}

module.exports = Type


/***/ }),

/***/ 149:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

// [ 64, 65, 66 ] -> [ padding, CR, LF ]
const BASE64_MAP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r'

function resolveYamlBinary (data) {
  if (data === null) return false

  let bitlen = 0
  const max = data.length
  const map = BASE64_MAP

  // Convert one by one.
  for (let idx = 0; idx < max; idx++) {
    const code = map.indexOf(data.charAt(idx))

    // Skip CR/LF
    if (code > 64) continue

    // Fail on illegal characters
    if (code < 0) return false

    bitlen += 6
  }

  // If there are any bits left, source was corrupted
  return (bitlen % 8) === 0
}

function constructYamlBinary (data) {
  const input = data.replace(/[\r\n=]/g, '') // remove CR/LF & padding to simplify scan
  const max = input.length
  const map = BASE64_MAP
  let bits = 0
  const result = []

  // Collect by 6*4 bits (3 bytes)

  for (let idx = 0; idx < max; idx++) {
    if ((idx % 4 === 0) && idx) {
      result.push((bits >> 16) & 0xFF)
      result.push((bits >> 8) & 0xFF)
      result.push(bits & 0xFF)
    }

    bits = (bits << 6) | map.indexOf(input.charAt(idx))
  }

  // Dump tail

  const tailbits = (max % 4) * 6

  if (tailbits === 0) {
    result.push((bits >> 16) & 0xFF)
    result.push((bits >> 8) & 0xFF)
    result.push(bits & 0xFF)
  } else if (tailbits === 18) {
    result.push((bits >> 10) & 0xFF)
    result.push((bits >> 2) & 0xFF)
  } else if (tailbits === 12) {
    result.push((bits >> 4) & 0xFF)
  }

  return new Uint8Array(result)
}

function representYamlBinary (object /*, style */) {
  let result = ''
  let bits = 0
  const max = object.length
  const map = BASE64_MAP

  // Convert every three bytes to 4 ASCII characters.

  for (let idx = 0; idx < max; idx++) {
    if ((idx % 3 === 0) && idx) {
      result += map[(bits >> 18) & 0x3F]
      result += map[(bits >> 12) & 0x3F]
      result += map[(bits >> 6) & 0x3F]
      result += map[bits & 0x3F]
    }

    bits = (bits << 8) + object[idx]
  }

  // Dump tail

  const tail = max % 3

  if (tail === 0) {
    result += map[(bits >> 18) & 0x3F]
    result += map[(bits >> 12) & 0x3F]
    result += map[(bits >> 6) & 0x3F]
    result += map[bits & 0x3F]
  } else if (tail === 2) {
    result += map[(bits >> 10) & 0x3F]
    result += map[(bits >> 4) & 0x3F]
    result += map[(bits << 2) & 0x3F]
    result += map[64]
  } else if (tail === 1) {
    result += map[(bits >> 2) & 0x3F]
    result += map[(bits << 4) & 0x3F]
    result += map[64]
    result += map[64]
  }

  return result
}

function isBinary (obj) {
  return Object.prototype.toString.call(obj) === '[object Uint8Array]'
}

module.exports = new Type('tag:yaml.org,2002:binary', {
  kind: 'scalar',
  resolve: resolveYamlBinary,
  construct: constructYamlBinary,
  predicate: isBinary,
  represent: representYamlBinary
})


/***/ }),

/***/ 296:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

function resolveYamlBoolean (data) {
  if (data === null) return false

  const max = data.length

  return (max === 4 && (data === 'true' || data === 'True' || data === 'TRUE')) ||
         (max === 5 && (data === 'false' || data === 'False' || data === 'FALSE'))
}

function constructYamlBoolean (data) {
  return data === 'true' ||
         data === 'True' ||
         data === 'TRUE'
}

function isBoolean (object) {
  return Object.prototype.toString.call(object) === '[object Boolean]'
}

module.exports = new Type('tag:yaml.org,2002:bool', {
  kind: 'scalar',
  resolve: resolveYamlBoolean,
  construct: constructYamlBoolean,
  predicate: isBoolean,
  represent: {
    lowercase: function (object) { return object ? 'true' : 'false' },
    uppercase: function (object) { return object ? 'TRUE' : 'FALSE' },
    camelcase: function (object) { return object ? 'True' : 'False' }
  },
  defaultStyle: 'lowercase'
})


/***/ }),

/***/ 584:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const common = __nccwpck_require__(816)
const Type = __nccwpck_require__(557)

const YAML_FLOAT_PATTERN = new RegExp(
  // 2.5e4, 2.5 and integers
  '^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?' +
  // .2e4, .2
  // special case, seems not from spec
  '|\\.[0-9]+(?:[eE][-+]?[0-9]+)?' +
  // .inf
  '|[-+]?\\.(?:inf|Inf|INF)' +
  // .nan
  '|\\.(?:nan|NaN|NAN))$')

const YAML_FLOAT_SPECIAL_PATTERN = new RegExp(
  '^(?:' +
  // .inf
  '[-+]?\\.(?:inf|Inf|INF)' +
  // .nan
  '|\\.(?:nan|NaN|NAN))$')

function resolveYamlFloat (data) {
  if (data === null) return false

  if (!YAML_FLOAT_PATTERN.test(data)) {
    return false
  }

  if (isFinite(parseFloat(data, 10))) {
    return true
  }

  return YAML_FLOAT_SPECIAL_PATTERN.test(data)
}

function constructYamlFloat (data) {
  let value = data.toLowerCase()
  const sign = value[0] === '-' ? -1 : 1

  if ('+-'.indexOf(value[0]) >= 0) {
    value = value.slice(1)
  }

  if (value === '.inf') {
    return (sign === 1) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  } else if (value === '.nan') {
    return NaN
  }
  return sign * parseFloat(value, 10)
}

const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/

function representYamlFloat (object, style) {
  if (isNaN(object)) {
    switch (style) {
      case 'lowercase': return '.nan'
      case 'uppercase': return '.NAN'
      case 'camelcase': return '.NaN'
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case 'lowercase': return '.inf'
      case 'uppercase': return '.INF'
      case 'camelcase': return '.Inf'
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case 'lowercase': return '-.inf'
      case 'uppercase': return '-.INF'
      case 'camelcase': return '-.Inf'
    }
  } else if (common.isNegativeZero(object)) {
    return '-0.0'
  }

  const res = object.toString(10)

  // JS stringifier can build scientific format without dots: 5e-100,
  // while YAML requres dot: 5.e-100. Fix it with simple hack

  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace('e', '.e') : res
}

function isFloat (object) {
  return (Object.prototype.toString.call(object) === '[object Number]') &&
         (object % 1 !== 0 || common.isNegativeZero(object))
}

module.exports = new Type('tag:yaml.org,2002:float', {
  kind: 'scalar',
  resolve: resolveYamlFloat,
  construct: constructYamlFloat,
  predicate: isFloat,
  represent: representYamlFloat,
  defaultStyle: 'lowercase'
})


/***/ }),

/***/ 271:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const common = __nccwpck_require__(816)
const Type = __nccwpck_require__(557)

function isHexCode (c) {
  return ((c >= 0x30/* 0 */) && (c <= 0x39/* 9 */)) ||
         ((c >= 0x41/* A */) && (c <= 0x46/* F */)) ||
         ((c >= 0x61/* a */) && (c <= 0x66/* f */))
}

function isOctCode (c) {
  return ((c >= 0x30/* 0 */) && (c <= 0x37/* 7 */))
}

function isDecCode (c) {
  return ((c >= 0x30/* 0 */) && (c <= 0x39/* 9 */))
}

function resolveYamlInteger (data) {
  if (data === null) return false

  const max = data.length
  let index = 0
  let hasDigits = false

  if (!max) return false

  let ch = data[index]

  // sign
  if (ch === '-' || ch === '+') {
    ch = data[++index]
  }

  if (ch === '0') {
    // 0
    if (index + 1 === max) return true
    ch = data[++index]

    // base 2, base 8, base 16

    if (ch === 'b') {
      // base 2
      index++

      for (; index < max; index++) {
        ch = data[index]
        if (ch !== '0' && ch !== '1') return false
        hasDigits = true
      }
      return hasDigits && isFinite(parseYamlInteger(data))
    }

    if (ch === 'x') {
      // base 16
      index++

      for (; index < max; index++) {
        if (!isHexCode(data.charCodeAt(index))) return false
        hasDigits = true
      }
      return hasDigits && isFinite(parseYamlInteger(data))
    }

    if (ch === 'o') {
      // base 8
      index++

      for (; index < max; index++) {
        if (!isOctCode(data.charCodeAt(index))) return false
        hasDigits = true
      }
      return hasDigits && isFinite(parseYamlInteger(data))
    }
  }

  // base 10 (except 0)

  for (; index < max; index++) {
    if (!isDecCode(data.charCodeAt(index))) {
      return false
    }
    hasDigits = true
  }

  if (!hasDigits) return false

  return isFinite(parseYamlInteger(data))
}

function parseYamlInteger (data) {
  let value = data
  let sign = 1

  let ch = value[0]

  if (ch === '-' || ch === '+') {
    if (ch === '-') sign = -1
    value = value.slice(1)
    ch = value[0]
  }

  if (value === '0') return 0

  if (ch === '0') {
    if (value[1] === 'b') return sign * parseInt(value.slice(2), 2)
    if (value[1] === 'x') return sign * parseInt(value.slice(2), 16)
    if (value[1] === 'o') return sign * parseInt(value.slice(2), 8)
  }

  return sign * parseInt(value, 10)
}

function constructYamlInteger (data) {
  return parseYamlInteger(data)
}

function isInteger (object) {
  return (Object.prototype.toString.call(object)) === '[object Number]' &&
         (object % 1 === 0 && !common.isNegativeZero(object))
}

module.exports = new Type('tag:yaml.org,2002:int', {
  kind: 'scalar',
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  represent: {
    binary: function (obj) { return obj >= 0 ? '0b' + obj.toString(2) : '-0b' + obj.toString(2).slice(1) },
    octal: function (obj) { return obj >= 0 ? '0o' + obj.toString(8) : '-0o' + obj.toString(8).slice(1) },
    decimal: function (obj) { return obj.toString(10) },
    hexadecimal: function (obj) { return obj >= 0 ? '0x' + obj.toString(16).toUpperCase() : '-0x' + obj.toString(16).toUpperCase().slice(1) }
  },
  defaultStyle: 'decimal',
  styleAliases: {
    binary: [2, 'bin'],
    octal: [8, 'oct'],
    decimal: [10, 'dec'],
    hexadecimal: [16, 'hex']
  }
})


/***/ }),

/***/ 316:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

module.exports = new Type('tag:yaml.org,2002:map', {
  kind: 'mapping',
  construct: function (data) { return data !== null ? data : {} }
})


/***/ }),

/***/ 854:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

function resolveYamlMerge (data) {
  return data === '<<' || data === null
}

module.exports = new Type('tag:yaml.org,2002:merge', {
  kind: 'scalar',
  resolve: resolveYamlMerge
})


/***/ }),

/***/ 333:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

function resolveYamlNull (data) {
  if (data === null) return true

  const max = data.length

  return (max === 1 && data === '~') ||
         (max === 4 && (data === 'null' || data === 'Null' || data === 'NULL'))
}

function constructYamlNull () {
  return null
}

function isNull (object) {
  return object === null
}

module.exports = new Type('tag:yaml.org,2002:null', {
  kind: 'scalar',
  resolve: resolveYamlNull,
  construct: constructYamlNull,
  predicate: isNull,
  represent: {
    canonical: function () { return '~' },
    lowercase: function () { return 'null' },
    uppercase: function () { return 'NULL' },
    camelcase: function () { return 'Null' },
    empty: function () { return '' }
  },
  defaultStyle: 'lowercase'
})


/***/ }),

/***/ 649:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

const _hasOwnProperty = Object.prototype.hasOwnProperty
const _toString = Object.prototype.toString

function resolveYamlOmap (data) {
  if (data === null) return true

  const objectKeys = {}
  const object = data

  for (let index = 0, length = object.length; index < length; index += 1) {
    const pair = object[index]
    let pairHasKey = false

    if (_toString.call(pair) !== '[object Object]') return false

    let pairKey
    for (pairKey in pair) {
      if (_hasOwnProperty.call(pair, pairKey)) {
        if (!pairHasKey) pairHasKey = true
        else return false
      }
    }

    if (!pairHasKey) return false

    if (_hasOwnProperty.call(objectKeys, pairKey)) return false
    Object.defineProperty(objectKeys, pairKey, { value: true })
  }

  return true
}

function constructYamlOmap (data) {
  return data !== null ? data : []
}

module.exports = new Type('tag:yaml.org,2002:omap', {
  kind: 'sequence',
  resolve: resolveYamlOmap,
  construct: constructYamlOmap
})


/***/ }),

/***/ 267:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

const _toString = Object.prototype.toString

function resolveYamlPairs (data) {
  if (data === null) return true

  const object = data

  const result = new Array(object.length)

  for (let index = 0, length = object.length; index < length; index += 1) {
    const pair = object[index]

    if (_toString.call(pair) !== '[object Object]') return false

    const keys = Object.keys(pair)

    if (keys.length !== 1) return false

    result[index] = [keys[0], pair[keys[0]]]
  }

  return true
}

function constructYamlPairs (data) {
  if (data === null) return []

  const object = data
  const result = new Array(object.length)

  for (let index = 0, length = object.length; index < length; index += 1) {
    const pair = object[index]

    const keys = Object.keys(pair)

    result[index] = [keys[0], pair[keys[0]]]
  }

  return result
}

module.exports = new Type('tag:yaml.org,2002:pairs', {
  kind: 'sequence',
  resolve: resolveYamlPairs,
  construct: constructYamlPairs
})


/***/ }),

/***/ 161:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

module.exports = new Type('tag:yaml.org,2002:seq', {
  kind: 'sequence',
  construct: function (data) { return data !== null ? data : [] }
})


/***/ }),

/***/ 758:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

const _hasOwnProperty = Object.prototype.hasOwnProperty

function resolveYamlSet (data) {
  if (data === null) return true

  const object = data

  for (const key in object) {
    if (_hasOwnProperty.call(object, key)) {
      if (object[key] !== null) return false
    }
  }

  return true
}

function constructYamlSet (data) {
  return data !== null ? data : {}
}

module.exports = new Type('tag:yaml.org,2002:set', {
  kind: 'mapping',
  resolve: resolveYamlSet,
  construct: constructYamlSet
})


/***/ }),

/***/ 929:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

module.exports = new Type('tag:yaml.org,2002:str', {
  kind: 'scalar',
  construct: function (data) { return data !== null ? data : '' }
})


/***/ }),

/***/ 966:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



const Type = __nccwpck_require__(557)

const YAML_DATE_REGEXP = new RegExp(
  '^([0-9][0-9][0-9][0-9])' + // [1] year
  '-([0-9][0-9])' + // [2] month
  '-([0-9][0-9])$')                   // [3] day

const YAML_TIMESTAMP_REGEXP = new RegExp(
  '^([0-9][0-9][0-9][0-9])' + // [1] year
  '-([0-9][0-9]?)' + // [2] month
  '-([0-9][0-9]?)' + // [3] day
  '(?:[Tt]|[ \\t]+)' + // ...
  '([0-9][0-9]?)' + // [4] hour
  ':([0-9][0-9])' + // [5] minute
  ':([0-9][0-9])' + // [6] second
  '(?:\\.([0-9]*))?' + // [7] fraction
  '(?:[ \\t]*(Z|([-+])([0-9][0-9]?)' + // [8] tz [9] tz_sign [10] tzHour
  '(?::([0-9][0-9]))?))?$')           // [11] tzMinute

function resolveYamlTimestamp (data) {
  if (data === null) return false
  if (YAML_DATE_REGEXP.exec(data) !== null) return true
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true
  return false
}

function constructYamlTimestamp (data) {
  let fraction = 0
  let delta = null

  let match = YAML_DATE_REGEXP.exec(data)
  if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data)

  if (match === null) throw new Error('Date resolve error')

  // match: [1] year [2] month [3] day

  const year = +(match[1])
  const month = +(match[2]) - 1 // JS month starts with 0
  const day = +(match[3])

  if (!match[4]) { // no hour
    return new Date(Date.UTC(year, month, day))
  }

  // match: [4] hour [5] minute [6] second [7] fraction

  const hour = +(match[4])
  const minute = +(match[5])
  const second = +(match[6])

  if (match[7]) {
    fraction = match[7].slice(0, 3)
    while (fraction.length < 3) { // milli-seconds
      fraction += '0'
    }
    fraction = +fraction
  }

  // match: [8] tz [9] tz_sign [10] tzHour [11] tzMinute

  if (match[9]) {
    const tzHour = +(match[10])
    const tzMinute = +(match[11] || 0)
    delta = (tzHour * 60 + tzMinute) * 60000 // delta in mili-seconds
    if (match[9] === '-') delta = -delta
  }

  const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction))

  if (delta) date.setTime(date.getTime() - delta)

  return date
}

function representYamlTimestamp (object /*, style */) {
  return object.toISOString()
}

module.exports = new Type('tag:yaml.org,2002:timestamp', {
  kind: 'scalar',
  resolve: resolveYamlTimestamp,
  construct: constructYamlTimestamp,
  instanceOf: Date,
  represent: representYamlTimestamp
})


/***/ }),

/***/ 868:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Findings a watchtower has already judged acceptable.
//
// Without this, every scan re-reports the same false positives — a public
// reCAPTCHA site key read as a secret, a CVE in a package that is only ever
// loaded in development — with no way to say so. Re-reporting a judgement that
// has already been made erodes trust in the whole report.
//
// An allowance REMOVES the finding from the score and keeps it visible in the
// report, marked, with the reason it was allowed. Nothing disappears: a page can
// always say "3 findings, 1 allowed". That is deliberate — a mechanism that
// deleted findings would be indistinguishable from a scan that never ran, which
// is the failure this engine guards against everywhere else.
//
// WHERE THE LIST LIVES is the caller's business, exactly like the list of systems
// to scan (see engine-config.js). Two shapes, one file format:
//
//   local   the engine repo is also the runner, so the file sits beside the
//           config in that same repo
//   remote  a private watchtower repo holds the file; the engine is pulled in as
//           a pinned action and holds nobody's allowances
//
// FILE FORMAT
//
//   { "allowances": [
//       { "criterion": "security", "sub": "secrets",
//         "system": "billing-api",
//         "file": "config/dev.exs", "rule": "generic-api-key",
//         "reason": "Public reCAPTCHA site key, not a secret",
//         "allowed_by": "a.engineer@example.com", "allowed_on": "2026-01-31T09:32:00.000Z" }
//   ] }
//
// An entry matches a finding when EVERY field it names is equal. Leave a field
// out and it broadens: drop `file` and the rule is allowed anywhere. That is the
// intended way to write a general allowance, and it is also the danger, so the
// run reports how many findings each entry absorbed and which absorbed none.
//
// Deliberately NOT supported, each for a reason:
//
//   globs          an allowance is an audit record; listing the files you mean
//                  is tedious and honest, where a pattern quietly widens over
//                  time. Add on evidence, not in advance.
//   duplication    C8's percentage comes from jscpd's own totals, not from the
//                  list of duplicated blocks, so filtering that list would not
//                  move the score — and subtracting each pair's lines
//                  double-counts a block cloned three times. Out until it can be
//                  done correctly.
//   absences       "no rollback configured" is not a false positive. Allowing it
//                  would be accepting a risk, which is a different feature.

const { relativize } = __nccwpck_require__(754);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches the output of new Date().toISOString(): YYYY-MM-DDTHH:mm:ss.sssZ
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// What may be matched on, per criterion and sub-metric. Keyed to the item shapes
// the parsers in parse-reports.js actually emit.
//
// This table exists so a typo fails loudly. Without it, `{ "fle": "x.ex" }`
// would simply never match, and an allowance that does nothing looks identical
// to a feature that is broken. If a parser gains a field and this table goes
// stale, the failure is a refused allowance — a finding stays counted, which is
// the safe direction.
const MATCHABLE = {
  'security:secrets': ['file', 'rule', 'line'],
  'security:deps': ['package', 'id', 'severity', 'installed', 'bucket', 'target'],
  'security:sast': ['id', 'path', 'severity'],
  'simplicity:complexity': ['file', 'scope', 'language'],
};

// Fields that describe the allowance rather than the finding it matches.
const META = new Set(['criterion', 'sub', 'system', 'reason', 'allowed_by', 'allowed_on', 'note']);

// Fields holding a path, which arrives from a scanner prefixed with the throwaway
// clone directory and has to be shortened on both sides before comparing.
const PATH_FIELDS = new Set(['file', 'path', 'target']);

// A Vue single-file component's script block is extracted to `<name>.vue.ts`
// before the complexity linter can read it, so that is the path the linter
// reports. Nobody writing an allowance knows or should care about the extraction
// tree — and the two places this matters would otherwise disagree, because the
// findings report maps the location back to the .vue file while the scorer does
// not. Collapsing the extension on both sides makes one allowance cover both.
const VUE_EXTRACTED = /\.vue\.(ts|js)$/;

function subjectKey(criterion, sub) {
  return `${criterion}:${sub}`;
}

function normalisePath(value) {
  return relativize(String(value)).replace(VUE_EXTRACTED, '.vue');
}

function normaliseValue(field, value) {
  return PATH_FIELDS.has(field) ? normalisePath(value) : String(value);
}

function describe(entry, index) {
  const where = entry && entry.criterion && entry.sub
    ? `${entry.criterion}/${entry.sub}`
    : 'unknown subject';
  return `allowance ${index + 1} (${where})`;
}

function normaliseEntry(entry, index, source) {
  const at = `${source}: ${describe(entry, index)}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${at} is not an object.`);
  }

  const key = subjectKey(entry.criterion, entry.sub);
  const matchable = MATCHABLE[key];
  if (!matchable) {
    throw new Error(
      `${at} names a criterion and sub-metric that cannot carry allowances. ` +
      `Allowances apply to: ${Object.keys(MATCHABLE).sort().join(', ')}.`,
    );
  }

  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    throw new Error(`${at} has no reason. An allowance without a reason is not an audit record.`);
  }

  const match = {};
  for (const [field, value] of Object.entries(entry)) {
    if (META.has(field)) continue;
    if (!matchable.includes(field)) {
      throw new Error(
        `${at} matches on '${field}', which is not part of a ${key} finding. ` +
        `Available: ${matchable.join(', ')}.`,
      );
    }
    if (value == null || value === '') {
      throw new Error(`${at} leaves '${field}' empty. Remove the field to broaden the allowance deliberately.`);
    }
    if (typeof value === 'object') {
      throw new Error(`${at} gives '${field}' an object. Allowance fields are single values.`);
    }
    match[field] = normaliseValue(field, value);
  }

  // An entry naming nothing matches every finding in its sub-metric. That is
  // never what someone means to write, and it would zero a whole facet behind
  // one line of JSON.
  if (Object.keys(match).length === 0) {
    throw new Error(
      `${at} names no fields, so it would allow every ${key} finding. ` +
      `Name at least one of: ${matchable.join(', ')}.`,
    );
  }

  if (entry.system != null && (typeof entry.system !== 'string' || entry.system === '')) {
    throw new Error(`${at} has an empty system. Remove it to apply the allowance to every system.`);
  }

  if (entry.allowed_by != null && !EMAIL_RE.test(entry.allowed_by)) {
    throw new Error(`${at} has 'allowed_by' "${entry.allowed_by}" which is not an email address.`);
  }

  if (entry.allowed_on != null && !ISO_TIMESTAMP_RE.test(entry.allowed_on)) {
    throw new Error(`${at} has 'allowed_on' "${entry.allowed_on}" which is not a JavaScript timestamp (expected YYYY-MM-DDTHH:mm:ss.sssZ).`);
  }

  return {
    key,
    criterion: entry.criterion,
    sub: entry.sub,
    system: entry.system == null ? null : entry.system,
    match,
    reason: entry.reason,
    allowed_by: entry.allowed_by == null ? null : entry.allowed_by,
    allowed_on: entry.allowed_on == null ? null : entry.allowed_on,
  };
}

// Accepts either { allowances: [...] } or a bare list. Missing is normal — most
// watchtowers allow nothing, and an empty list must behave exactly as no file at
// all so that shipping this mechanism cannot move a single score.
function parseAllowances(raw, { source = 'allowances' } = {}) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : raw.allowances;
  if (list == null) return [];
  if (!Array.isArray(list)) {
    throw new Error(`${source}: "allowances" must be a list.`);
  }
  return list.map((entry, i) => normaliseEntry(entry, i, source));
}

function itemMatches(allowance, item) {
  for (const [field, want] of Object.entries(allowance.match)) {
    const got = item ? item[field] : undefined;
    if (got == null) return false;
    if (normaliseValue(field, got) !== want) return false;
  }
  return true;
}

// One of these per system, because the tallies are per system and because an
// allowance may be scoped to a single system.
//
// `matcherFor` returns null when nothing is allowed for that sub-metric. Callers
// treat null as "no allowances", which keeps the untouched path free of any
// wrapper — the reason an empty list is provably identical to today.
function createAllowanceSet(allowances, systemKey) {
  const scoped = allowances.filter((a) => a.system == null || a.system === systemKey);
  const matched = new Map(scoped.map((a) => [a, 0]));

  function matcherFor(criterion, sub) {
    const key = subjectKey(criterion, sub);
    const relevant = scoped.filter((a) => a.key === key);
    if (relevant.length === 0) return null;
    return (item) => {
      for (const a of relevant) {
        if (itemMatches(a, item)) {
          matched.set(a, matched.get(a) + 1);
          return a;
        }
      }
      return null;
    };
  }

  // Every allowance in scope with the number of findings it absorbed on this
  // run. Two readings matter and both need the whole list, not just the hits:
  // an entry whose count climbs is quietly swallowing new problems, and an entry
  // at zero is either fixed — delete it — or never matched anything and was
  // wrong when it was written.
  function summary() {
    return [...matched.entries()].map(([a, count]) => ({
      criterion: a.criterion,
      sub: a.sub,
      system: a.system,
      match: a.match,
      reason: a.reason,
      allowed_by: a.allowed_by,
      allowed_on: a.allowed_on,
      matched: count,
    }));
  }

  function unmatched() {
    return summary().filter((a) => a.matched === 0);
  }

  return { matcherFor, summary, unmatched };
}

module.exports = {
  MATCHABLE, parseAllowances, createAllowanceSet, subjectKey,
};


/***/ }),

/***/ 528:
/***/ ((module) => {



// Which stacks each stack-bound criterion can honestly measure. A stack not
// handled here makes its scanner skip (emit no report), so the composition layer
// records Pending rather than a false green. C4 (observability) and C6 (test
// coverage) are now stack-agnostic and are NOT gated here — they scan every
// stack and let absent evidence score an honest low. Only C2 remains gated.

// C2 documented APIs dispositions:
//   'elixir-ast' — score in-code Elixir schemas (Absinthe + phoenix_swagger, AST
//                  parse via the elixir binary). The existing pilot path.
//   'na'         — ruby: declared N/A (the Ruby pilot's existing state; kept unchanged
//                  for parity — an apipie-emitted artifact re-score is a separate,
//                  deliberate step, not this agnostic slice).
//   'artifact'   — every other stack: recognize a committed API-description
//                  artifact (OpenAPI JSON/YAML or GraphQL SDL) and measure it. If
//                  no artifact is present, emit no report -> honest Pending (an
//                  in-code-only API is "not measured", never a false green).
function documentedApisDisposition(stack) {
  if (stack === 'elixir') return 'elixir-ast';
  if (stack === 'ruby') return 'na';
  return 'artifact';
}

// C1 domain boundaries: whether the tree-sitter code graph is trustworthy enough
// on this stack to grade cycles and module fan-out.
//
//   'ok'         — grade the graph-derived metrics.
//   'unreliable' — measure and report them, but do NOT grade them. The scorer
//                  drops these sub-metrics; if nothing else is scoreable the
//                  criterion is INDETERMINATE (not Pending — we are not promising
//                  to fix the extractor, and not a score we cannot defend).
//
// Measured against ground truth on 2026-07-29, not assumed:
//   elixir — graphify 0.9.28/0.9.29 resolves an `alias` only when the module name
//            is exactly two segments AND the file path is its literal lowercase
//            (Foo.Bar -> foo/bar.ex). Three-plus segments (Foo.Bar.Baz) and
//            snake_case (Foo.TwoWord -> two_word.ex) both silently fail, and
//            real Elixir is overwhelmingly one of those. In one umbrella that
//            produced 4 of 8 real cross-app dependencies, plus one edge pointing
//            the wrong way — a pair reported with zero references while the real
//            dependency in the opposite direction was missed. A cycle needs only
//            one missing edge to disappear, so "zero cycles" is uninformative.
//   js/ts  — 5 of 6 real code dependencies in a TypeScript monorepo; the misses
//            eslint-config/typescript-config, consumed via tsconfig `extends`
//            rather than imports, which a code graph is right to omit.
// Ruby and Python are not separately measured; they keep the default until they
// are, because withholding a grade needs evidence just as much as publishing one.
function boundaryGraphDisposition(stack) {
  return stack === 'elixir' ? 'unreliable' : 'ok';
}

module.exports = { documentedApisDisposition, boundaryGraphDisposition };


/***/ }),

/***/ 61:
/***/ ((module) => {



// Pure helpers for C2 (Documented APIs). No I/O.
//  1. isAbsintheModule: decide which .ex files are Absinthe schema modules, so
//     the scan feeds ONLY those to the AST parser. Ecto schemas use the
//     identical `field` macro and must never be counted (denominator poison).
//  2. aggregateRecords/buildReport: fold the Elixir helper's per-field records
//     into the report the scorer consumes.

const ABSINTHE_USE = /\buse\s+Absinthe\.Schema(?:\.Notation)?\b/;

function isAbsintheModule(source) {
  return ABSINTHE_USE.test(source || '');
}

// A system may expose a documented REST/OpenAPI API instead of (or beside) its
// GraphQL schema. C2 measures only GraphQL description coverage, so scoring the
// GraphQL surface of a REST-primary system misrepresents it. Detect OpenAPI/
// Swagger tooling in a mix.exs so the scorer can defer C2 (Pending) rather than
// publish a misleading GraphQL-only score. (A Swagger-primary Phoenix app is
// the case this exists for.)
const REST_API_MARKER = /\b(phoenix_swagger|open_api_spex)\b/;

function isRestApiDoc(source) {
  return REST_API_MARKER.test(source || '');
}

// A phoenix_swagger source declares swagger operations or schemas. Feed ONLY
// these files to the AST helper (never the whole app). Mirrors isAbsintheModule.
const PHOENIX_SWAGGER = /\b(use|import)\s+PhoenixSwagger\b|\bswagger_path\b|\bswagger_schema\b/;

function isPhoenixSwaggerModule(source) {
  return PHOENIX_SWAGGER.test(source || '');
}

function aggregateRecords(records, filesParsed) {
  const list = Array.isArray(records) ? records : [];
  const byType = new Map();
  let total = 0;
  let described = 0;
  for (const r of list) {
    total += 1;
    const d = r && r.has_description ? 1 : 0;
    described += d;
    const key = (r && r.type) || '(anonymous)';
    const cur = byType.get(key) || { type: key, total: 0, described: 0 };
    cur.total += 1;
    cur.described += d;
    byType.set(key, cur);
  }
  const by_type = [...byType.values()]
    .sort((a, b) => (b.total - a.total) || a.type.localeCompare(b.type));
  return { files_parsed: filesParsed || 0, total, described, by_type };
}

const REST_KINDS = ['operation', 'parameter', 'property'];

function aggregateRest(records, filesParsed) {
  const list = Array.isArray(records) ? records : [];
  const by_kind = { operation: { total: 0, described: 0 }, parameter: { total: 0, described: 0 }, property: { total: 0, described: 0 } };
  let total = 0;
  let described = 0;
  for (const r of list) {
    const kind = r && REST_KINDS.includes(r.kind) ? r.kind : null;
    if (!kind) continue;
    const d = r.has_description ? 1 : 0;
    total += 1;
    described += d;
    by_kind[kind].total += 1;
    by_kind[kind].described += d;
  }
  return { files_parsed: filesParsed || 0, total, described, by_kind };
}

function buildReport({ applicable, records, filesParsed, restApiDetected, restRecords, restFilesParsed }) {
  const rest = !!restApiDetected;
  if (!applicable) return { applicable: false, rest_api_detected: rest };
  const out = { applicable: true, rest_api_detected: rest, ...aggregateRecords(records, filesParsed) };
  if (Array.isArray(restRecords)) out.rest = aggregateRest(restRecords, restFilesParsed);
  return out;
}

module.exports = {
  isAbsintheModule, isRestApiDoc, isPhoenixSwaggerModule, aggregateRecords, buildReport, aggregateRest, ABSINTHE_USE, REST_API_MARKER, PHOENIX_SWAGGER, REST_KINDS,
};


/***/ }),

/***/ 880:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// scripts/benchmark/engine-config.js
//
// The engine's only link to whoever is running it.
//
// Before this file existed, every scan program worked out two locations by
// counting directories upwards from itself — the list of systems to scan, and
// the folder to write results into. That silently tied the engine to one repo's
// layout: move the directory and nothing starts. Two programs did the read at
// import time, so even loading them failed.
//
// Both locations are now passed in. Nothing is discovered by walking upwards.
//
//   WATCHTOWER_CONFIG   path to the file listing the systems to scan
//                       (default: ./watchtower.config.json, so a standalone
//                       copy works from a project root with no setup)
//   WATCHTOWER_REPORTS  folder to write raw scan output into
//                       (default: ./reports)
//   WATCHTOWER_DATA     folder holding the assembled scores, which the publish
//                       step reads back to send to a dashboard
//                       (default: ./data)
//   WATCHTOWER_ALLOWANCES
//                       path to the file listing findings already judged
//                       acceptable (default: ./watchtower.allowances.json).
//                       Unlike the others, ABSENCE IS NORMAL — most watchtowers
//                       allow nothing, and no file behaves exactly like an empty
//                       list. See allowances.js.
//
// The list itself stays private and is never part of the engine: it names real
// repositories, which is the caller's business, not the tool's. The same is true
// of the allowances: the engine carries the mechanism, never anyone's judgements.
//
// Everything here fails loudly. A scan that cannot find its list must stop, not
// carry on with nothing to scan — an empty run reports no problems, which reads
// exactly like a clean result.



const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const { parseAllowances } = __nccwpck_require__(868);

const DEFAULT_CONFIG = 'watchtower.config.json';
const DEFAULT_REPORTS = 'reports';
const DEFAULT_DATA = 'data';
const DEFAULT_ALLOWANCES = 'watchtower.allowances.json';

function configPath() {
  return path.resolve(process.env.WATCHTOWER_CONFIG || DEFAULT_CONFIG);
}

function allowancesPath() {
  return path.resolve(process.env.WATCHTOWER_ALLOWANCES || DEFAULT_ALLOWANCES);
}

function reportsRoot() {
  return path.resolve(process.env.WATCHTOWER_REPORTS || DEFAULT_REPORTS);
}

function dataDir() {
  return path.resolve(process.env.WATCHTOWER_DATA || DEFAULT_DATA);
}

// Read lazily, never at import time. Importing a scan program should not
// require the caller's configuration to exist — that is what made three test
// files fail to load rather than fail an assertion.
function loadConfig() {
  const file = configPath();

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read the watchtower config at ${file}. ` +
      `Set WATCHTOWER_CONFIG to the file listing the systems to scan. (${err.code})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The watchtower config at ${file} is not valid JSON: ${err.message}`);
  }

  const systems = parsed && parsed.systems;
  if (!systems || typeof systems !== 'object' || Array.isArray(systems)) {
    throw new Error(`The watchtower config at ${file} has no "systems" object.`);
  }
  // An empty list is refused rather than treated as "nothing to do". A caller
  // who meant to scan nothing does not run a scanner.
  if (Object.keys(systems).length === 0) {
    throw new Error(`The watchtower config at ${file} lists no systems.`);
  }

  return parsed;
}

// The allowances file, parsed and validated. Read lazily for the same reason as
// the config.
//
// Absence is handled asymmetrically on purpose:
//
//   no WATCHTOWER_ALLOWANCES set, default file not there
//       -> [] . Allowing nothing is the ordinary state of a watchtower, and this
//          is the case that makes shipping the mechanism provably score-neutral.
//   WATCHTOWER_ALLOWANCES set, file not there
//       -> throw. The caller said where the list is; if it is not there, a typo
//          in the path would otherwise swallow every allowance in silence and
//          look exactly like a list that legitimately matches nothing.
function loadAllowances() {
  const file = allowancesPath();
  const explicit = Boolean(process.env.WATCHTOWER_ALLOWANCES);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && !explicit) return [];
    throw new Error(
      `Cannot read the allowances file at ${file}. ` +
      `WATCHTOWER_ALLOWANCES points here, so an unreadable file is an error, not an empty list. (${err.code})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The allowances file at ${file} is not valid JSON: ${err.message}`);
  }

  return parseAllowances(parsed, { source: file });
}

// Credentials are supplied through the environment, never through this file.
// The config is the one thing that gets committed to a repository.
const CREDENTIAL_LOOKING = /^(token|password|secret|key|private_key|credential)$/i;

function systemConfig(systemKey) {
  if (!systemKey) {
    throw new Error('No system named. Set SYSTEM to a key from the watchtower config.');
  }

  const { systems } = loadConfig();
  const cfg = systems[systemKey];
  if (!cfg) {
    const known = Object.keys(systems).sort().join(', ');
    throw new Error(`Unknown system '${systemKey}'. The config lists: ${known}`);
  }

  const leaked = Object.keys(cfg).filter((k) => CREDENTIAL_LOOKING.test(k));
  if (leaked.length > 0) {
    throw new Error(
      `System '${systemKey}' has ${leaked.join(', ')} in the watchtower config. ` +
      'Credentials belong in the environment, not in a committed file.',
    );
  }

  return cfg;
}

// Results for one system. Created on demand so a caller does not have to
// prepare the tree.
function reportsDir(systemKey) {
  const dir = path.join(reportsRoot(), systemKey);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// What one system's code IS: a GitHub repository, or a folder on this machine.
//
// Here rather than in each scan program because a relative path is resolved
// against the directory holding the config, and this is the only file that
// knows where that is. Every scan program asking the same question has to get
// the same answer — the alternative is seven of them each deciding for
// themselves what a relative path is relative to.
function systemTarget(systemKey) {
  const { targetOf } = __nccwpck_require__(639);
  return targetOf(systemConfig(systemKey), systemKey, path.dirname(configPath()));
}

module.exports = {
  configPath, reportsRoot, dataDir, allowancesPath,
  loadConfig, loadAllowances, systemConfig, reportsDir, systemTarget,
};


/***/ }),

/***/ 988:
/***/ ((module) => {



// Pure GraphQL SDL reader for C2 (Documented APIs). Turns a `.graphql`/`.gql`
// schema-definition-language file into GraphQL field-style records
// { type, has_description } — the same shape aggregateRecords consumes — so an SDL
// schema pools with OpenAPI/REST and Absinthe under one coverage measure.
//
// Describable surface = fields (of object/interface types), input fields, and enum
// values; each is "described" when an SDL description string (""" block """ or
// "single line") immediately precedes it. This is a coverage heuristic on the text,
// not a full GraphQL parser (no external dependency); it is approximate by design
// and only runs on committed SDL artifacts. No I/O.

// Type opener — also `extend type/interface/input/enum` (federated/modular schemas
// add fields via `extend`, which must be counted too).
const DEF_OPEN = /^(?:extend\s+)?(type|interface|input|enum)\s+([A-Za-z_][\w]*)/;
// A field/input-field line: `name: Type`, `name(args): Type`, with optional
// directives/defaults after. Excludes lines that are just braces or descriptions.
const FIELD = /^([A-Za-z_][\w]*)\s*(\([^)]*\))?\s*:/;
// A field whose argument list OPENS on this line (may close on a later line):
// `name(` — used to count the field once and skip its multi-line argument body.
const FIELD_MULTILINE_OPEN = /^([A-Za-z_][\w]*)\s*\(/;
// An enum value line: a bare identifier (no colon), inside an enum body.
const ENUM_VALUE = /^([A-Za-z_][\w]*)\s*(@[\w]|$)/;

function parseGraphqlSdl(text) {
  const records = [];
  if (typeof text !== 'string' || !text.trim()) return records;
  const lines = text.split(/\r?\n/);

  let currentType = null; // { name, kind } when inside a type body
  let braceDepth = 0;
  let descPending = false;

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue; // blank — keep any pending description
    if (trimmed.startsWith('#')) continue; // comment

    // Block description """ ... """ (possibly single-line or multi-line).
    if (trimmed.startsWith('"""')) {
      if (trimmed.slice(3).includes('"""')) {
        // single-line """desc"""
        descPending = true;
        continue;
      }
      // consume until closing """
      i += 1;
      while (i < lines.length && !lines[i].includes('"""')) i += 1;
      descPending = true;
      continue;
    }
    // Single-line string description "desc" alone on its line.
    if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) {
      descPending = true;
      continue;
    }

    // Definition opener.
    const open = trimmed.match(DEF_OPEN);
    if (open && !currentType) {
      currentType = { name: open[2], kind: open[1] };
      // type-level description is not counted (we count fields/values); consume it.
      descPending = false;
      if (trimmed.includes('{')) braceDepth = 1;
      // `extend`/single-line `{}` edge cases fall through to brace tracking below.
      continue;
    }

    // Track braces to know when a type body opens/closes.
    if (currentType) {
      if (trimmed === '{' || (trimmed.endsWith('{') && braceDepth === 0)) { braceDepth += 1; descPending = false; continue; }
      if (trimmed.startsWith('}')) { braceDepth -= 1; if (braceDepth <= 0) { currentType = null; braceDepth = 0; } descPending = false; continue; }

      if (braceDepth >= 1) {
        if (currentType.kind === 'enum') {
          const ev = trimmed.match(ENUM_VALUE);
          if (ev) {
            records.push({ type: currentType.name, has_description: descPending });
            descPending = false;
            continue;
          }
        } else {
          // A field whose argument list opens here but does not close (`): ` absent)
          // spans multiple lines — count the field once, then skip its argument
          // lines so `term: String` inside the parens is not miscounted as a field.
          if (FIELD_MULTILINE_OPEN.test(trimmed) && !/\)\s*:/.test(trimmed)) {
            records.push({ type: currentType.name, has_description: descPending });
            descPending = false;
            while (i < lines.length && !lines[i].includes(')')) i += 1;
            continue;
          }
          const fld = trimmed.match(FIELD);
          if (fld) {
            records.push({ type: currentType.name, has_description: descPending });
            descPending = false;
            continue;
          }
        }
      }
    }

    // Any other non-blank, non-description line clears a dangling description.
    descPending = false;
  }

  return records;
}

module.exports = { parseGraphqlSdl };


/***/ }),

/***/ 147:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Pure, format-neutral OpenAPI/Swagger reader for C2 (Documented APIs). Turns a
// parsed spec object (from JSON or YAML — same data model) into the same
// {kind, has_description} REST records the scorer already pools via aggregateRest,
// so an OpenAPI spec is measured apples-to-apples with the five's phoenix_swagger
// surface: operations + parameters + schema properties (a deliberate granularity choice).
//
// No I/O and no network — the caller reads/parses the file. `parseOpenApiText`
// dispatches by serialization (JSON vs YAML); `parseOpenApi` does the counting.

const yaml = __nccwpck_require__(281);

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);
const MAX_DEPTH = 12;

const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Walk a schema object counting each describable `properties.<p>` as one record.
// Recurses into nested inline objects (properties/items/allOf/anyOf/oneOf) but
// never follows `$ref` — a ref resolves to a named component counted once on its
// own. `depth` guards against pathological nesting.
function collectSchemaProps(schema, records, depth) {
  if (!isObj(schema) || depth > MAX_DEPTH) return;
  if (isObj(schema.properties)) {
    for (const name of Object.keys(schema.properties)) {
      const prop = schema.properties[name];
      records.push({ kind: 'property', name, has_description: isObj(prop) && nonEmpty(prop.description) });
      if (isObj(prop) && !prop.$ref) collectSchemaProps(prop, records, depth + 1);
    }
  }
  if (isObj(schema.items) && !schema.items.$ref) collectSchemaProps(schema.items, records, depth + 1);
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[key])) {
      for (const sub of schema[key]) if (isObj(sub) && !sub.$ref) collectSchemaProps(sub, records, depth + 1);
    }
  }
}

// Collect inline (non-$ref) object schemas from an operation's requestBody and
// responses content. $ref'd schemas are skipped — counted via components.schemas.
function collectInlineOperationSchemas(op, records) {
  const bodies = [];
  if (isObj(op.requestBody) && isObj(op.requestBody.content)) bodies.push(op.requestBody.content);
  if (isObj(op.responses)) {
    for (const code of Object.keys(op.responses)) {
      const resp = op.responses[code];
      if (isObj(resp) && isObj(resp.content)) bodies.push(resp.content);
    }
  }
  for (const content of bodies) {
    for (const mediaType of Object.keys(content)) {
      const media = content[mediaType];
      if (isObj(media) && isObj(media.schema) && !media.schema.$ref) {
        collectSchemaProps(media.schema, records, 0);
      }
    }
  }
}

// Count parameters on an operation (and shared path-item level). $ref parameters
// resolve to components.parameters for their description.
function collectParams(paramList, componentsParams, records) {
  if (!Array.isArray(paramList)) return;
  for (const p of paramList) {
    let param = p;
    if (isObj(p) && typeof p.$ref === 'string') {
      const m = p.$ref.match(/#\/components\/parameters\/(.+)$/);
      param = (m && componentsParams[m[1]]) || {};
    }
    records.push({ kind: 'parameter', name: isObj(param) ? param.name : undefined, has_description: isObj(param) && nonEmpty(param.description) });
  }
}

// parseOpenApi(specObject) -> records[] of { kind: 'operation'|'parameter'|'property', has_description }.
// Returns [] for a non-spec object (no paths and no components) so the caller can
// treat "recognized file but empty surface" as Pending, never a false green.
function parseOpenApi(spec) {
  if (!isObj(spec)) return [];
  const records = [];
  const components = isObj(spec.components) ? spec.components : {};
  const componentsParams = isObj(components.parameters) ? components.parameters : {};

  const paths = isObj(spec.paths) ? spec.paths : {};
  for (const p of Object.keys(paths)) {
    const item = paths[p];
    if (!isObj(item)) continue;
    // path-item level shared parameters
    collectParams(item.parameters, componentsParams, records);
    for (const method of Object.keys(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const op = item[method];
      if (!isObj(op)) continue;
      records.push({ kind: 'operation', name: `${method.toUpperCase()} ${p}`, has_description: nonEmpty(op.description) || nonEmpty(op.summary) });
      collectParams(op.parameters, componentsParams, records);
      collectInlineOperationSchemas(op, records);
    }
  }

  // Named component schemas — each counted once.
  const schemas = isObj(components.schemas) ? components.schemas : (isObj(spec.definitions) ? spec.definitions : {});
  for (const name of Object.keys(schemas)) {
    collectSchemaProps(schemas[name], records, 0);
  }

  return records;
}

// Does a parsed object look like an OpenAPI/Swagger spec? Accept the version key
// as a string OR a number — unquoted YAML (`openapi: 3.0`, `swagger: 2.0`) loads
// as a JS number, and rejecting it would silently skip the whole spec.
function isOpenApiSpec(obj) {
  if (!isObj(obj)) return false;
  const v = obj.openapi !== undefined ? obj.openapi : obj.swagger;
  return typeof v === 'string' || typeof v === 'number';
}

// Parse spec text by serialization. Returns null if it doesn't parse or isn't a spec.
function parseOpenApiText(text, filename) {
  let obj;
  try {
    obj = /\.ya?ml$/i.test(filename || '') ? yaml.load(text) : JSON.parse(text);
  } catch {
    return null;
  }
  return isOpenApiSpec(obj) ? obj : null;
}

module.exports = { parseOpenApi, parseOpenApiText, isOpenApiSpec };


/***/ }),

/***/ 754:
/***/ ((module) => {



// Turning a scanner's path back into a repo-relative one.
//
// Third-party scanners (gitleaks/trivy/semgrep/credo/rubocop/jscpd) report paths
// absolute to the per-run clone dir — <tmp>/scan-<sys>-<rand>/repo/ or
// <tmp>/scan-c8-<sys>-<rand>/repo/. That random suffix would render as garbage in
// the UI and, worse, make findings-*.json churn on every scan (defeating the
// data-PR change gate). Our own walkers (C4/C6/C7) already emit relative paths,
// which don't match and pass through untouched.
//
// This lives in its own file because two callers need the SAME definition: the
// findings report, which shortens paths on the way out, and the allowances
// matcher, which has to shorten them on the way IN — a person writing an
// allowance knows `config/dev.exs`, never `/tmp/scan-billing-api-a1b2c3/repo/
// config/dev.exs`. Two copies of this rule drifting apart would make allowances
// silently match nothing, which reads exactly like a feature that was never
// wired up.

const CLONE_ROOT = /^.*?\/scan-[^/]*\/repo\//;

function relativize(s) {
  if (typeof s !== 'string') return s;
  return s.replace(CLONE_ROOT, '');
}

function relativizePaths(node) {
  if (Array.isArray(node)) return node.map(relativizePaths);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = relativizePaths(v);
    return out;
  }
  return relativize(node);
}

module.exports = { relativize, relativizePaths };


/***/ }),

/***/ 181:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// scripts/benchmark/scan-documented-apis.js


/*
 * C2 (Documented APIs) scan — I/O entrypoint (black-box edge). NOT unit-tested;
 * testable logic is the readers (openapi-reader / graphql-sdl-reader) +
 * documented-apis-signals.js + score-documented-apis.js. Clones ONE repo (shallow,
 * by SYSTEM env) and writes reports/<system>/documented-apis.json.
 *
 * Agnostic-first: C2 measures description coverage of a system's public API
 * surface, whatever serialization carries it. Dispositions (criterion-stacks.js):
 *   elixir-ast — in-code Elixir schemas via the no-compile Absinthe + phoenix_swagger
 *                AST helpers (unchanged pilot path).
 *   na         — ruby: declared N/A (unchanged for parity).
 *   artifact   — any other stack: recognize a committed API artifact (OpenAPI
 *                JSON/YAML or GraphQL SDL) and measure it with the same pooled
 *                coverage. No artifact -> no report -> honest Pending (never false green).
 *
 * Reads files only, no compile — same private-dep sidestep as C4/C7/C8/C9.
 * Env: SYSTEM (key in benchmark.overrides.json), GH_TOKEN (clone auth).
 */

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const os = __nccwpck_require__(857);
const { execFileSync } = __nccwpck_require__(317);
const { isAbsintheModule, isRestApiDoc, isPhoenixSwaggerModule, buildReport } = __nccwpck_require__(61);
const { documentedApisDisposition } = __nccwpck_require__(528);
const { parseOpenApi, parseOpenApiText } = __nccwpck_require__(147);
const { parseGraphqlSdl } = __nccwpck_require__(988);

const { systemConfig, reportsDir, systemTarget } = __nccwpck_require__(880);
const { materialise } = __nccwpck_require__(639);
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;
const HELPER = __nccwpck_require__.ab + "absinthe_desc_parse.exs";
const SWAGGER_HELPER = __nccwpck_require__.ab + "phoenix_swagger_desc_parse.exs";

// Also skip non-API-surface trees: `.agents` (Claude skill example schemas),
// `test`/`spec` (test-support schemas). These are not the system's public API —
// counting them poisons the coverage denominator.
const SKIP_DIRS = new Set([
  'node_modules', 'deps', '_build', '.git', '.elixir_ls', 'tmp', 'vendor',
  '.agents', 'test', 'spec',
]);

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

function collect(rootDir, matchFn) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (matchFn(e.name, full)) {
        out.push(full);
      }
    }
  };
  walk(rootDir, 0);
  return out;
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// --- Elixir AST path (unchanged pilot behavior) ---
function scanElixirAst(repoDir, work) {
  const mixFiles = collect(repoDir, (n) => n === 'mix.exs');
  const restApiDetected = mixFiles.some((f) => isRestApiDoc(readText(f)));

  const exFiles = collect(repoDir, (n) => n.endsWith('.ex'));
  const absintheFiles = exFiles.filter((f) => isAbsintheModule(readText(f)));

  let records = [];
  if (absintheFiles.length > 0) {
    const listFile = path.join(work, 'files.txt');
    fs.writeFileSync(listFile, `${absintheFiles.join('\n')}\n`);
    records = JSON.parse(sh('elixir', [__nccwpck_require__.ab + "absinthe_desc_parse.exs", listFile], { encoding: 'utf8' }));
  }

  let restRecords;
  let restFilesParsed = 0;
  if (restApiDetected) {
    const swaggerFiles = exFiles.filter((f) => isPhoenixSwaggerModule(readText(f)));
    restFilesParsed = swaggerFiles.length;
    if (swaggerFiles.length > 0) {
      const restList = path.join(work, 'swagger-files.txt');
      fs.writeFileSync(restList, `${swaggerFiles.join('\n')}\n`);
      restRecords = JSON.parse(sh('elixir', [__nccwpck_require__.ab + "phoenix_swagger_desc_parse.exs", restList], { encoding: 'utf8' }));
    } else {
      restRecords = [];
    }
  }

  return buildReport({
    applicable: true, records, filesParsed: absintheFiles.length, restApiDetected, restRecords, restFilesParsed,
  });
}

// --- Agnostic artifact path (OpenAPI JSON/YAML + GraphQL SDL) ---
// Returns a report, or null when no artifact is present (-> Pending, no report written).
function scanArtifacts(repoDir) {
  // OpenAPI/Swagger: json/yaml files whose path or name signals a spec, confirmed
  // by content (parseOpenApiText returns null unless it parses to a real spec).
  const specCandidates = collect(repoDir, (n, full) => (
    /\.(json|ya?ml)$/i.test(n) && /(openapi|swagger)/i.test(full)
  ));
  const openapiRecords = [];
  let openapiFiles = 0;
  for (const f of specCandidates) {
    const spec = parseOpenApiText(readText(f), f);
    if (!spec) continue;
    openapiFiles += 1;
    openapiRecords.push(...parseOpenApi(spec));
  }

  // GraphQL SDL.
  const sdlFiles = collect(repoDir, (n) => /\.(graphql|gql)$/i.test(n));
  const sdlRecords = [];
  for (const f of sdlFiles) sdlRecords.push(...parseGraphqlSdl(readText(f)));

  if (openapiFiles === 0 && sdlFiles.length === 0) return null; // no artifact -> Pending

  // Gate rest_api_detected on ACTUAL REST records, not merely a spec file being
  // present: an empty/stub OpenAPI (valid header, no operations) must not trip the
  // scorer's `rest_api_detected && restTotal===0 -> null` guard and discard a valid
  // co-present GraphQL score. An empty OpenAPI with no SDL still falls to Pending
  // via the scorer's total===0 guard.
  const hasRest = openapiRecords.length > 0;
  return buildReport({
    applicable: true,
    records: sdlRecords,
    filesParsed: sdlFiles.length,
    restApiDetected: hasRest,
    restRecords: hasRest ? openapiRecords : undefined,
    restFilesParsed: openapiFiles,
  });
}

function main() {
  const cfg = systemConfig(SYSTEM);
  const outDir = reportsDir(SYSTEM);
  const disposition = documentedApisDisposition(cfg.stack);

  if (disposition === 'na') {
    writeJson(outDir, 'documented-apis', buildReport({ applicable: false }));
    return;
  }

  const tree = materialise(systemTarget(SYSTEM), { prefix: `c2-${SYSTEM}`, token: GH_TOKEN });
  try {
    for (const note of tree.notes) console.log(`  ${note}`);
    scanTree(tree, outDir, cfg, disposition);
  } finally {
    // Previously never removed. The Elixir path also writes its AST extraction
    // into this same directory, so it was the larger of the two leaks.
    tree.cleanup();
  }
}

function scanTree(tree, outDir, cfg, disposition) {
  const repoDir = tree.dir;
  const work = path.dirname(repoDir);

  let report;
  if (disposition === 'elixir-ast') {
    report = scanElixirAst(repoDir, work);
  } else { // 'artifact'
    report = scanArtifacts(repoDir);
    if (!report) {
      // No committed API artifact to read. That is a real answer — the scan ran
      // and there was nothing to measure — and it used to be recorded by writing
      // nothing at all, which made it indistinguishable from the scan dying
      // before it wrote anything. Downstream, both look like an absent report.
      //
      // A report with no records scores exactly as an absent one did (zero total
      // is Pending, never a full-marks zero-over-zero), so nothing about the
      // score changes. What changes is that a missing file now means failure
      // again, which is the only thing that lets anything upstream check.
      report = buildReport({ applicable: true, records: [], filesParsed: 0 });
      console.log(`C2 ${SYSTEM} (${tree.label}, stack=${cfg.stack}) — no committed API artifact (-> Pending)`);
    }
  }

  writeJson(outDir, 'documented-apis', report);
  console.log(`Scanned C2 ${SYSTEM} (${tree.label}, stack=${cfg.stack}, disposition=${disposition}) -> ${outDir}`);
}

if (require.main === require.cache[eval('__filename')]) main();

module.exports = { main, scanElixirAst, scanArtifacts, collect };


/***/ }),

/***/ 639:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



/*
 * Where a scan's working tree comes from.
 *
 * Every scan program used to do the same two lines: make a temp directory,
 * shallow-clone `cfg.repo` into `<tmp>/repo`. That is the only thing a target
 * could be, so running the scanner on a laptop scored whatever was on the
 * remote's default branch rather than the code in front of you — the check you
 * wanted to run before opening the pull request measured the branch you were
 * about to change.
 *
 * A system now declares `repo` OR `path`. Exactly one.
 *
 *   "billing": { "repo": "org/billing",   "stack": "elixir" }
 *   "billing": { "path": "code/billing",  "stack": "elixir" }
 *
 * A relative `path` is resolved against the DIRECTORY HOLDING THE CONFIG, not
 * the working directory. The config sits beside the projects it describes, and
 * resolving against the shell's cwd would make the same config mean different
 * things depending on where you happened to run it from. Nothing in this engine
 * is discovered by walking upwards, and this keeps it that way.
 *
 * A LOCAL TARGET IS COPIED, NOT SCANNED IN PLACE, and there are three separate
 * reasons — any one of them enough:
 *
 *   1. The scan writes into the tree it is reading. graphify drops a
 *      `graphify-out/` directory into the repo root. Scanning in place would
 *      leave build output inside somebody's working copy.
 *   2. Third-party scanners report absolute paths, and repo-paths.js turns them
 *      back into repo-relative ones by matching a `scan-<something>/repo/`
 *      prefix under the temp directory. That rule
 *      is shared with the allowances matcher, so a target outside that shape
 *      would make every allowance silently match nothing — which reads exactly
 *      like a feature nobody wired up. Materialising into the SAME shape means
 *      neither of those files has to learn about local targets at all.
 *   3. A working copy is not a clone. It holds `node_modules`, `_build`,
 *      coverage output and whatever else is gitignored, and gitleaks, jscpd and
 *      the LOC walk would all read them. The copy carries what git carries:
 *      tracked files plus untracked ones that are not ignored — which is to say
 *      the code you are about to push, uncommitted edits included. That is the
 *      thing you wanted measured.
 *
 * HISTORY IS READ FROM THE ORIGINAL. The copy has no `.git`, and C1's change
 * coupling needs a commit log. Rather than copy the object store, the scan is
 * handed a separate `historyDir` pointing at the source. It is only ever read
 * from — `git log`, nothing else. When the source is not a git repository at
 * all, `historyDir` is null and coupling reports itself unmeasured, which it
 * already knew how to do.
 *
 * NOTHING HERE EVER DELETES A DIRECTORY IT DID NOT CREATE. `cleanup()` removes
 * the temp directory and only the temp directory. The clone path relies on that
 * to shred a `.git/config` holding a plaintext token; the local path must never
 * be able to do the same thing to somebody's project.
 */

const fs = __nccwpck_require__(896);
const os = __nccwpck_require__(857);
const path = __nccwpck_require__(928);
const { execFileSync } = __nccwpck_require__(317);

// Only consulted when the source is not a git repository, and it is a guess by
// construction — without git there is no ignore file to obey. Kept deliberately
// short: these are directories that are build output or a package cache in
// every ecosystem that has them, and a wrong entry silently removes real source
// from a measurement. Anything doubtful is left in, because too much is a
// visible score and too little is an invisible one.
const NON_SOURCE_DIRS = new Set([
  '.git', 'node_modules', '_build', 'deps', '.venv', 'venv',
  '__pycache__', '.tox', '.gradle', '.terraform', 'graphify-out',
  '.next', '.nuxt', '.turbo', 'coverage', '.elixir_ls',
]);

/*
 * What a system config says its target is. Pure; no filesystem.
 *
 * configDir is where a relative path is resolved from — see the note above.
 */
function targetOf(cfg, systemKey, configDir) {
  const hasRepo = typeof cfg.repo === 'string' && cfg.repo !== '';
  const hasPath = typeof cfg.path === 'string' && cfg.path !== '';

  // Both is not a preference to resolve, it is two different answers to one
  // question. Silently choosing either would make a stale entry score the wrong
  // code, and the report would name the system, not the source.
  if (hasRepo && hasPath) {
    throw new Error(
      `System '${systemKey}' declares both repo and path. A target is one or the other — `
      + 'remove whichever is not the code you mean to measure.',
    );
  }
  if (!hasRepo && !hasPath) {
    throw new Error(
      `System '${systemKey}' declares neither repo nor path. `
      + 'Set repo to "owner/name" for a GitHub repository, or path to a folder on this machine.',
    );
  }

  if (hasRepo) return { kind: 'repo', repo: cfg.repo, label: cfg.repo };

  const resolved = path.resolve(configDir || process.cwd(), cfg.path);
  return { kind: 'path', path: resolved, label: resolved };
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
});

// The files git would carry: tracked, plus untracked ones no ignore rule
// covers. Returns null when the directory is not a git repository — the caller
// falls back to a walk and says that it did.
//
// `run` is injected so the listing can be tested without a git repository.
function gitFiles(srcDir, run = sh) {
  let out;
  try {
    out = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: srcDir });
  } catch {
    return null;
  }
  return out.split('\0').filter(Boolean);
}

function walkFiles(srcDir) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (NON_SOURCE_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        found.push(path.relative(srcDir, path.join(dir, e.name)));
      }
    }
  };
  walk(srcDir, 0);
  return found;
}

/*
 * Copy a list of repo-relative paths from src into dest.
 *
 * Only regular files travel. A symlink is skipped and counted rather than
 * followed: following one would read a file outside the tree being measured and
 * attribute whatever it found to this system, and `git ls-files` lists symlinks
 * like anything else. The count is reported so a repository that leans on them
 * does not look like one that simply has fewer files.
 */
function copyFiles(src, dest, files) {
  let copied = 0;
  let symlinks = 0;
  let unreadable = 0;
  for (const rel of files) {
    // A path escaping the source is not something git or the walk produces, so
    // reaching this means the input is not what it claims to be.
    const from = path.resolve(src, rel);
    if (from !== src && !from.startsWith(src + path.sep)) continue;

    let st;
    try { st = fs.lstatSync(from); } catch { unreadable += 1; continue; }
    if (st.isSymbolicLink()) { symlinks += 1; continue; }
    if (!st.isFile()) continue;

    const to = path.join(dest, rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    } catch { unreadable += 1; }
  }
  return { copied, symlinks, unreadable };
}

/*
 * Produce a working tree for one system and say where it is.
 *
 * Returns { dir, historyDir, label, kind, cleanup, notes }.
 *
 *   dir         the tree to scan, always <tmp>/scan-<prefix>-<rand>/repo
 *   historyDir  where to run `git log` for change coupling, or null
 *   cleanup()   removes the temp directory and nothing else
 *   notes       lines worth printing; how the tree was assembled
 */
function materialise(target, {
  prefix, token, tmpRoot = os.tmpdir(), run = sh,
} = {}) {
  const work = fs.mkdtempSync(path.join(tmpRoot, `scan-${prefix}-`));
  const dir = path.join(work, 'repo');
  const cleanup = () => fs.rmSync(work, { recursive: true, force: true });
  const notes = [];

  try {
    if (target.kind === 'repo') {
      const url = token
        ? `https://x-access-token:${token}@github.com/${target.repo}.git`
        : `https://github.com/${target.repo}.git`;
      // Caught, because the URL carries the token and git writes it to its own
      // stderr on failure. Only the repo name is safe to put in the message.
      try {
        run('git', ['clone', '--depth', '1', url, dir]);
      } catch (err) {
        throw new Error(`git clone failed for ${target.repo} — check network and credentials (exit ${err.status})`);
      }
      return {
        dir, historyDir: dir, label: target.repo, kind: 'repo', cleanup, notes,
      };
    }

    let stat;
    try { stat = fs.statSync(target.path); } catch (err) {
      throw new Error(`target path for this system does not exist: ${target.path} (${err.code})`);
    }
    if (!stat.isDirectory()) throw new Error(`target path is not a directory: ${target.path}`);

    fs.mkdirSync(dir, { recursive: true });

    const tracked = gitFiles(target.path, run);
    const files = tracked || walkFiles(target.path);
    const historyDir = tracked ? target.path : null;
    if (!tracked) {
      notes.push(
        `${target.path} is not a git repository: copying everything outside a fixed list of `
        + 'build directories, and change coupling will be unmeasured',
      );
    }

    const { copied, symlinks, unreadable } = copyFiles(target.path, dir, files);

    // An empty tree measures clean on every criterion. That is the one outcome
    // a scanner must never produce quietly.
    if (copied === 0) {
      throw new Error(
        `no files to scan under ${target.path} — refusing to run, because an empty tree `
        + 'scores clean on every criterion',
      );
    }

    notes.push(
      `${copied} files copied from ${target.path}`
      + (tracked ? ' (tracked and untracked, ignore rules applied)' : '')
      + (symlinks ? `; ${symlinks} symlinks skipped` : '')
      + (unreadable ? `; ${unreadable} unreadable` : ''),
    );

    return {
      dir, historyDir, label: target.path, kind: 'path', cleanup, notes,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

module.exports = {
  targetOf, materialise, gitFiles, walkFiles, copyFiles, NON_SOURCE_DIRS,
};


/***/ }),

/***/ 317:
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ 857:
/***/ ((module) => {

module.exports = require("os");

/***/ }),

/***/ 928:
/***/ ((module) => {

module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/asset-relocator-loader */
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __nccwpck_require__(181);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;