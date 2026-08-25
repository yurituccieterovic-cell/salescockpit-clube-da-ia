// Extração tolerante de UM objeto JSON de um texto gerado por LLM.
// Motivo: as vozes/Árvore emitem comandos (publicar página no eco, guardar nota no
// playground) como um objeto JSON no fim da resposta. Modelos grátis quase sempre
// escrevem o campo "content" (markdown longo) com quebras de linha LITERAIS dentro
// da string — o que torna o JSON inválido e fazia o JSON.parse falhar silenciosamente,
// então nada era salvo. Aqui tentamos, em ordem: (1) parse estrito; (2) parse depois
// de escapar caracteres de controle crus dentro de strings; (3) o anterior + remoção
// de vírgula sobrando antes de } ou ].

// Escapa quebras de linha/tabs/outros caracteres de controle que apareçam DENTRO de
// uma string JSON (entre aspas), sem tocar na estrutura. Respeita escapes (\") já
// presentes pra não bagunçar aspas escapadas.
function escapeControlCharsInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      out += c;
      continue;
    }
    if (inStr) {
      if (c === "\n") {
        out += "\\n";
        continue;
      }
      if (c === "\r") {
        out += "\\r";
        continue;
      }
      if (c === "\t") {
        out += "\\t";
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        out += "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
    }
    out += c;
  }
  return out;
}

function stripTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1");
}

export function extractLenientJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const text = raw.trim().replace(/```(?:json)?/gi, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const slice = text.slice(first, last + 1);

  const attempts = [
    slice,
    escapeControlCharsInStrings(slice),
    stripTrailingCommas(escapeControlCharsInStrings(slice)),
  ];
  for (const attempt of attempts) {
    try {
      const obj = JSON.parse(attempt);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {
      // tenta o próximo reparo
    }
  }
  return null;
}

// Desfaz os escapes JSON mais comuns numa string já recortada do texto bruto.
function unescapeJsonString(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (m, g: string) => {
    switch (g[0]) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "b": return "\b";
      case "f": return "\f";
      case '"': return '"';
      case "\\": return "\\";
      case "/": return "/";
      case "u": return String.fromCharCode(parseInt(g.slice(1), 16));
      default: return m;
    }
  });
}

// Último recurso quando o JSON do comando é inválido porque o campo longo (content)
// guarda código/markdown com aspas duplas ou chaves não escapadas — caso em que o
// JSON.parse sempre falha. Extrai os campos curtos por regex e o campo longo de forma
// gananciosa: do início do valor até a última aspas antes do `}` final. Pressupõe que
// o campo longo é o ÚLTIMO do objeto (é como os templates de comando são montados).
export function extractFieldsByKey(
  raw: string,
  opts: { shortKeys: string[]; longKey: string },
): Record<string, string> | null {
  if (!raw) return null;
  const text = raw.trim().replace(/```(?:json)?/gi, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const body = text.slice(first, last + 1);

  const out: Record<string, string> = {};
  for (const k of opts.shortKeys) {
    const m = body.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (m) out[k] = unescapeJsonString(m[1]!);
  }

  const lk = opts.longKey;
  const startMatch = body.match(new RegExp(`"${lk}"\\s*:\\s*"`));
  if (startMatch && startMatch.index !== undefined) {
    const valStart = startMatch.index + startMatch[0].length;
    const closeBrace = body.lastIndexOf("}");
    const closeQuote = body.lastIndexOf('"', closeBrace);
    if (closeQuote > valStart) {
      out[lk] = unescapeJsonString(body.slice(valStart, closeQuote));
    }
  }

  return Object.keys(out).length ? out : null;
}
