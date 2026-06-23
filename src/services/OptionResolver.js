const OPTION_LETTER_PATTERN = /^选项\s*([A-D](?:\s*和\s*[A-D])*)/i;

function parseOptionLetters(text) {
  const match = text.match(OPTION_LETTER_PATTERN);
  if (!match) return null;
  const lettersPart = match[1].replace(/\s/g, '');
  const letters = [];
  for (const char of lettersPart) {
    if (/[A-D]/i.test(char)) {
      letters.push(char.toUpperCase());
    }
  }
  return letters.length > 0 ? letters : null;
}

function parseOptionBuffer(optionBuffer) {
  if (!optionBuffer) return {};
  const options = {};
  const lines = optionBuffer.split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-D])\.\s*(.+)$/i);
    if (m) {
      options[m[1].toUpperCase()] = m[2].trim();
    }
  }
  return options;
}

export class OptionResolver {
  resolve(userText, optionBuffer) {
    const trimmed = userText.trim();
    const letters = parseOptionLetters(trimmed);
    if (!letters) return trimmed;

    const options = parseOptionBuffer(optionBuffer);
    const resolvedParts = letters
      .map((letter) => options[letter])
      .filter(Boolean);

    if (resolvedParts.length === 0) return trimmed;

    const optionText = resolvedParts.join('；');
    const remainder = trimmed.replace(OPTION_LETTER_PATTERN, '').trim();

    if (remainder) {
      return `${optionText}。${remainder}`;
    }
    return optionText;
  }
}

export const optionResolver = new OptionResolver();
