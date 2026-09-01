const decodePdfLiteral = (value: string): string => {
  return value
    .replace(/\\([nrtbf()\\])/g, (_match, escaped: string) => {
      const map: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        '(': '(',
        ')': ')',
        '\\': '\\',
      };
      return map[escaped] ?? escaped;
    })
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
};

const decodePdfHex = (value: string): string => {
  const clean = value.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 2) {
    bytes.push(parseInt(clean.slice(index, index + 2).padEnd(2, '0'), 16));
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const codes: number[] = [];
    for (let index = 2; index < bytes.length; index += 2) {
      codes.push((bytes[index] << 8) | (bytes[index + 1] ?? 0));
    }
    return String.fromCharCode(...codes);
  }

  return new TextDecoder('latin1').decode(new Uint8Array(bytes));
};

const normalizeExtractedText = (value: string): string => {
  return value
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

const extractTextOperators = (source: string): string[] => {
  const text: string[] = [];
  const literalPattern = /\((?:\\.|[^\\()])*\)\s*Tj/g;
  const arrayPattern = /\[(.*?)\]\s*TJ/gs;
  const hexPattern = /<([0-9a-fA-F\s]+)>\s*Tj/g;

  for (const match of source.matchAll(literalPattern)) {
    text.push(decodePdfLiteral(match[0].replace(/\s*Tj$/, '').slice(1, -1)));
  }

  for (const match of source.matchAll(hexPattern)) {
    text.push(decodePdfHex(match[1]));
  }

  for (const match of source.matchAll(arrayPattern)) {
    const parts = match[1];
    for (const literal of parts.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
      text.push(decodePdfLiteral(literal[0].slice(1, -1)));
    }
    for (const hex of parts.matchAll(/<([0-9a-fA-F\s]+)>/g)) {
      text.push(decodePdfHex(hex[1]));
    }
  }

  return text;
};

const inflateStream = async (data: Uint8Array): Promise<string> => {
  if (typeof DecompressionStream === 'undefined') {
    return '';
  }

  try {
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return await new Response(stream).text();
  } catch {
    return '';
  }
};

export const extractPdfText = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const latinText = new TextDecoder('latin1').decode(bytes);
  const chunks = [latinText];
  const streamPattern = /<<(?:.|\n|\r)*?\/Filter\s*\/FlateDecode(?:.|\n|\r)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;

  for (const match of latinText.matchAll(streamPattern)) {
    const offset = latinText.indexOf(match[1]);
    if (offset < 0) {
      continue;
    }
    const streamBytes = bytes.slice(offset, offset + match[1].length);
    const inflated = await inflateStream(streamBytes);
    if (inflated) {
      chunks.push(inflated);
    }
  }

  const extracted = chunks.flatMap(extractTextOperators).join('\n');
  return normalizeExtractedText(extracted);
};
