// Stored claim-citation offsets are zero-based UTF-16 code units, end-exclusive.
// PostgreSQL text indexing counts Unicode scalar values instead. Never relabel
// existing offsets or normalize the text to bridge that difference.

/** Exact JS reference for the SQL expression; invalid scalar boundaries refuse. */
export function sliceUtf16Citation(text, start, end) {
  if (typeof text !== 'string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 0 || end <= start || end > text.length
      || /[\u0000]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) return null;
  const splitsPair = offset => offset > 0 && offset < text.length
    && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]);
  if (splitsPair(start) || splitsPair(end)) return null;
  return text.slice(start, end);
}

/**
 * Trusted source-code SQL expressions only, never request input. Returns one
 * PostgreSQL scalar expression: the exact quote, or NULL when either UTF-16
 * boundary is absent (including an offset inside a surrogate pair).
 *
 * Each PostgreSQL character uses one UTF-16 unit except a four-byte UTF-8
 * character, which uses two. Combining marks and ZWJ remain separate scalars;
 * this deliberately does not introduce grapheme or normalization semantics.
 * Callers should bind this once with LATERAL when using both quote and hash.
 * Input text remains subject to the caller's existing bounded-evidence limit.
 */
export function utf16CitationQuoteSql(textSql, startSql, endSql) {
  for (const expression of [textSql, startSql, endSql]) {
    if (typeof expression !== 'string' || !expression.trim()) throw Error('citation_sql_expression_required');
  }
  return `(select case
    when (${startSql}) >= 0 and (${endSql}) > (${startSql})
      and bool_or(citation_units.start_unit = (${startSql}))
      and bool_or(citation_units.end_unit = (${endSql}))
    then string_agg(citation_units.piece, '' order by citation_units.ordinal)
      filter (where citation_units.start_unit >= (${startSql})
        and citation_units.end_unit <= (${endSql}))
    else null end
  from (
    select citation_chars.piece, citation_chars.ordinal,
      coalesce(sum(case when octet_length(convert_to(citation_chars.piece, 'UTF8')) = 4 then 2 else 1 end)
        over (order by citation_chars.ordinal rows between unbounded preceding and 1 preceding), 0) as start_unit,
      sum(case when octet_length(convert_to(citation_chars.piece, 'UTF8')) = 4 then 2 else 1 end)
        over (order by citation_chars.ordinal rows between unbounded preceding and current row) as end_unit
    from regexp_split_to_table((${textSql}), '') with ordinality as citation_chars(piece, ordinal)
    where citation_chars.piece <> ''
  ) citation_units)`;
}
