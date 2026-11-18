package tv.tui.core

import java.text.Normalizer

/** Conjunto de espaços em branco do JavaScript (String.prototype.trim e \s). */
private fun isJsSpace(c: Char): Boolean = when (c) {
    ' ', '\t', '\n', '\r', '\u000b', '\u000c', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
    else -> c in ' '..' '
}

/** Equivalente a String.prototype.trim() do JavaScript. */
fun String.jsTrim(): String {
    var start = 0
    var end = length
    while (start < end && isJsSpace(this[start])) start++
    while (end > start && isJsSpace(this[end - 1])) end--
    return substring(start, end)
}

private val COMBINING = Regex("[\\u0300-\\u036f]")
private val SPACES = Regex("[ \\t\\u00a0]+")
private val CONTROL = Regex("[\\u0000-\\u001f\\u007f]")
private val JS_WHITESPACE = Regex("[\\s\\u000b\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+")

/** Normalização usada em buscas e chaves: sem acentos, minúsculas, espaços simples. */
fun normalizeText(input: String): String =
    SPACES.replace(COMBINING.replace(Normalizer.normalize(input, Normalizer.Form.NFD), "").lowercase(), " ").jsTrim()

private fun fnv1a(text: String, seed: Int): Int {
    var h = seed
    for (c in text) {
        h = h xor c.code
        h *= 16777619
    }
    return h
}

/** Hash estável de 64 bits (dois FNV-1a de 32 bits sobre unidades UTF-16), em hexadecimal. */
fun stableHash(text: String): String =
    "%08x%08x".format(fnv1a(text, 0x811c9dc5.toInt()), fnv1a(text, 0x9747b28c.toInt()))

const val MAX_NAME_LENGTH = 80

fun cleanName(input: String, fallback: String = ""): String {
    val value = JS_WHITESPACE.replace(CONTROL.replace(input, " "), " ").jsTrim()
    return value.ifEmpty { fallback }.take(MAX_NAME_LENGTH)
}
