function outsideFences(text: string, convert: (line: string) => string): string {
  let inCode = false;
  return text.split("\n").map(line => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCode = !inCode;
      return line;
    }
    return inCode ? line : convert(line);
  }).join("\n");
}

function convertHeadings(text: string): string {
  return outsideFences(text, line => line.replace(/^(\s*)(#{1,6})\s+(.*)$/, (_all, indent, hashes, content) => `${indent}${"=".repeat(hashes.length)} ${content}`));
}

function convertLists(text: string): string {
  return outsideFences(text, line => {
    const match = line.match(/^(\s*)- (.+)$/);
    if (!match || /^-[\s-]*$/.test(line.trimStart())) return line;
    return `${"*".repeat(Math.floor(match[1].length / 2) + 1)} ${match[2]}`;
  });
}

function convertLinks(text: string): string {
  return outsideFences(text, line => {
    let result = line;
    if (/!\[([^\]]*)\]\(/.test(result)) {
      const only = result.match(/^\s*!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\s*$/);
      const caption = result.match(/^\s*!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\s*(.+)$/);
      if (only) result = `image::${only[2]}[${only[1]}]`;
      else if (caption && !/!\[/.test(caption[3])) result = `.${caption[3].trim()}\nimage::${caption[2]}[${caption[1]}]`;
      else result = result.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, "image:$2[$1]");
    }
    return result.replace(/(.?)\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_all, before, label, url) =>
      `${before}${before && !/\s/.test(before) ? " " : ""}link:${url}[${label}]`);
  });
}

function convertInlineFormatting(text: string): string {
  return outsideFences(text, line => line.split(/(`[^`]+`)/).map(segment => {
    if (segment.startsWith("`")) return segment;
    return segment
      .replace(/\*\*\*(.+?)\*\*\*/g, "*_$1_*")
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      .replace(/~~(.+?)~~/g, "[.line-through]#$1#");
  }).join(""));
}

function convertCodeBlocks(text: string): string {
  let inCode = false;
  const result: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (!inCode) {
      const opening = trimmed.match(/^(`{3,}|~{3,})\s*(\S*)\s*$/);
      if (opening) {
        inCode = true;
        if (opening[2]) result.push(`[source,${opening[2]}]`);
        result.push("----");
        continue;
      }
    } else if (/^(`{3,}|~{3,})\s*$/.test(trimmed)) {
      inCode = false;
      result.push("----");
      continue;
    }
    result.push(line);
  }
  return result.join("\n");
}

function convertEscapes(text: string): string {
  return outsideFences(text, line => line.split(/(`[^`]+`)/).map(segment =>
    segment.startsWith("`") ? segment : segment.replace(/\\([*$\[\]\\_.!#\-+`~{}>])/g, "$1")
  ).join(""));
}

function convertLinkedImages(text: string): string {
  return outsideFences(text, line => {
    const pattern = /\[!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
    const only = line.match(/^\s*\[!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\s*$/);
    if (only) return `image::${only[2]}[${only[1]}, link=${only[3]}]`;
    return line.replace(pattern, (_all, alt, imageUrl, linkUrl) => `image:${imageUrl}[${alt}${linkUrl ? `, link=${linkUrl}` : ""}]`);
  });
}

/** Shared production/lab Markdown paste conversion behavior. */
export function convertMarkdownToAsciiDoc(text: string): string {
  let result = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:a|span|div|p|em|strong|b|i|u|s|del|ins|sup|sub|small|big|center|font|mark|abbr)(?:\s[^>]*)?>/gi, "");
  result = convertEscapes(result);
  result = convertHeadings(result);
  result = convertLists(result);
  result = outsideFences(result, line => /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trimStart()) ? "'''" : line);
  result = convertInlineFormatting(result);
  result = convertLinkedImages(result);
  result = convertLinks(result);
  return convertCodeBlocks(result);
}
