/**
 * RFC 5322/2047/2045 message construction for the generic SMTP provider. Pure functions only:
 * no I/O, everything testable without socket mocks.
 *
 * QQ Mail and friends deliver Chinese subjects and bodies correctly only when the message is
 * proper MIME — RFC 2047 B-encoding for headers, base64 bodies, and a multipart/alternative
 * container. All of that lives here, so nothing else in the SMTP layer formats text.
 */

const LINE_LENGTH = 76;
const ENCODED_WORD_PREFIX = "=?UTF-8?B?";
const ENCODED_WORD_SUFFIX = "?=";

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

/**
 * RFC 2047 B-encoding with a 76-column fold. Multibyte characters may not be split across two
 * encoded-words, so each chunk is back-tracked to a character boundary before encoding.
 */
export function encodeHeader(text: string): string {
  // Pure ASCII (subject lines like "SaaS Template") goes out unencoded, like mainstream MUAs.
  if (!/[^\x20-\x7e]/.test(text)) {
    return text;
  }

  // An encoded-word line is `=?UTF-8?B?<base64>?=`; the base64 payload gets whatever the
  // 76-column budget leaves after the fixed wrapper.
  const maxPayload = LINE_LENGTH - ENCODED_WORD_PREFIX.length - ENCODED_WORD_SUFFIX.length;
  const encoded: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + Math.floor(maxPayload / 4));
    // Never cut a surrogate pair or a multibyte sequence in half: shrink until the chunk is
    // a whole number of UTF-16 code points that round-trips through UTF-8.
    while (
      end < text.length
      && (text.charCodeAt(end) >= 0xd800 && text.charCodeAt(end) < 0xdc00
        || new TextEncoder().encode(text.slice(start, end + 1)).length > maxPayload)
    ) {
      end -= 1;
    }

    if (end <= start) {
      throw new Error("RFC 2047 encoding chunk collapsed to zero length.");
    }

    encoded.push(`${ENCODED_WORD_PREFIX}${toBase64(text.slice(start, end))}${ENCODED_WORD_SUFFIX}`);
    start = end;
  }

  return encoded.join(`\r\n `);
}

/** RFC 5322 display name. Quoted-string when the name has specials, encoded-word when non-ASCII. */
export function formatFromHeader(from: { email: string; name?: string }): string {
  if (!from.name) {
    return from.email;
  }

  if (!/[^\x20-\x7e]/.test(from.name)) {
    return needsQuoting(from.name) ? `"${from.name.replaceAll('"', String.raw`\"`)}" <${from.email}>` : `${from.name} <${from.email}>`;
  }

  return `${encodeHeader(from.name)} <${from.email}>`;
}

function needsQuoting(text: string): boolean {
  // RFC 5322 atext covers most characters; anything else (dots at edges, spaces, specials)
  // requires the quoted-string form.
  return !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/.test(text);
}

/** Base64 body text folded at 76 columns, per RFC 2045. */
export function encodeBody(text: string): string {
  const base64 = toBase64(text);

  return (base64.match(new RegExp(`.{1,${LINE_LENGTH}}`, "g")) ?? []).join("\r\n");
}

export { fromBase64, toBase64 };
