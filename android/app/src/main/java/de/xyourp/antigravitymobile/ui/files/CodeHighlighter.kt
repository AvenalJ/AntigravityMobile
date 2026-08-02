package de.xyourp.antigravitymobile.ui.files

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle

/** Colours used by [highlightCode]; supplied from the Material theme. */
data class CodePalette(
    val base: Color,
    val keyword: Color,
    val string: Color,
    val comment: Color,
    val number: Color,
)

private val KEYWORDS = setOf(
    // cross-language common keywords (kept generic on purpose)
    "abstract", "as", "async", "await", "boolean", "break", "case", "catch", "class",
    "const", "continue", "data", "def", "default", "do", "double", "elif", "else",
    "enum", "export", "extends", "false", "final", "finally", "float", "fn", "for",
    "from", "fun", "function", "if", "implements", "import", "in", "int", "interface",
    "is", "let", "new", "null", "object", "override", "package", "private", "protected",
    "public", "return", "self", "static", "string", "super", "suspend", "switch", "then",
    "this", "throw", "true", "try", "typeof", "val", "var", "void", "when", "while",
    "with", "yield",
)

private val IDENT = Regex("[A-Za-z_][A-Za-z0-9_]*")

/**
 * Compact, allocation-light highlighter. Single forward pass: strings, comments
 * (// , # , /* */), numbers and a generic keyword set. Not language-perfect, but
 * dependency-free and good enough for a read-only mobile viewer.
 */
fun highlightCode(code: String, palette: CodePalette): AnnotatedString = buildAnnotatedString {
    var i = 0
    val n = code.length
    while (i < n) {
        val c = code[i]
        when {
            // line comment // or #
            c == '/' && i + 1 < n && code[i + 1] == '/' -> {
                val end = code.indexOf('\n', i).let { if (it == -1) n else it }
                pushPlain(code, i, end, palette.comment); i = end
            }
            c == '#' -> {
                val end = code.indexOf('\n', i).let { if (it == -1) n else it }
                pushPlain(code, i, end, palette.comment); i = end
            }
            // block comment /* */
            c == '/' && i + 1 < n && code[i + 1] == '*' -> {
                val close = code.indexOf("*/", i + 2)
                val end = if (close == -1) n else close + 2
                pushPlain(code, i, end, palette.comment); i = end
            }
            // strings
            c == '"' || c == '\'' || c == '`' -> {
                val end = endOfString(code, i, c)
                pushPlain(code, i, end, palette.string); i = end
            }
            // numbers
            c.isDigit() -> {
                var j = i + 1
                while (j < n && (code[j].isLetterOrDigit() || code[j] == '.' || code[j] == 'x')) j++
                pushPlain(code, i, j, palette.number); i = j
            }
            // identifiers / keywords
            c.isLetter() || c == '_' -> {
                val m = IDENT.matchAt(code, i)!!
                val word = m.value
                if (word in KEYWORDS) pushPlain(code, i, m.range.last + 1, palette.keyword)
                else withStyle(SpanStyle(color = palette.base)) { append(word) }
                i = m.range.last + 1
            }
            else -> {
                withStyle(SpanStyle(color = palette.base)) { append(c) }
                i++
            }
        }
    }
}

private fun AnnotatedString.Builder.pushPlain(code: String, start: Int, end: Int, color: Color) {
    withStyle(SpanStyle(color = color)) { append(code.substring(start, end)) }
}

private fun endOfString(code: String, start: Int, quote: Char): Int {
    var j = start + 1
    val n = code.length
    while (j < n) {
        val ch = code[j]
        if (ch == '\\') { j += 2; continue }
        if (ch == quote) return j + 1
        if (quote != '`' && ch == '\n') return j // unterminated single-line string
        j++
    }
    return n
}
