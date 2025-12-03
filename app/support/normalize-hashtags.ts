const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Hashtag-specific text normalization
 *
 * During normalization, only letters and numbers characters are left for each
 * grapheme. If a grapheme does not contain any such characters, it is skipped.
 *
 * Example:
 * ```
 * "ﬁn (lánd)" (á has two codepoints) -> "finland":
 * f -> ﬁ
 * i -> ﬁ // two output codepoints correspond to the same input grapheme
 * n -> n
 * l -> l
 * a -> á // input grapheme consists of 2 codepoints
 * n -> n
 * d -> d
 * ```
 */
export function normalizeHashtag(input: string): string {
  let output = '';

  for (const { segment } of graphemeSegmenter.segment(input)) {
    const letters = segment
      .normalize('NFKD')
      // Preserve cyrillic 'short i' (convert it back to NFC)
      .replace(/\u0418\u0306/g, '\u0419')
      .replace(/\u0438\u0306/g, '\u0439')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .normalize('NFC')
      .toLowerCase();

    if (!letters) {
      continue;
    }

    for (const letter of letters) {
      output += letter;
    }
  }

  return output;
}
