import PDFDocument from "pdfkit";

// PDF da assembleia. pdfkit usa as fontes padrão (Helvetica), cujo encoding
// WinAnsi cobre acentos do PT-BR. Caracteres fora do cp1252 (box-drawing,
// emojis, setas) quebram a renderização — então sanitizamos antes de escrever.

// Caracteres > U+00FF que o WinAnsi suporta (mapeados pelo pdfkit).
const WINANSI_EXTRA = new Set<number>([
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020,
  0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122, 0x0152,
  0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e, 0x0192, 0x02c6, 0x02dc,
]);

export function sanitizeForPdf(input: string): string {
  if (!input) return "";
  let s = input.replace(/\r\n/g, "\n");
  // Box-drawing (─ ═ │ etc.) → travessão (vira linha separadora legível).
  s = s.replace(/[\u2500-\u257F]/g, "\u2014");
  // Bullets variados → •
  s = s.replace(/[\u25CF\u25AA\u25A0\u2043\u2219\u2023\u2027\u00B7\u25E6]/g, "\u2022");
  // Variation selectors / zero-width / BOM
  s = s.replace(/[\uFE00-\uFE0F\u200B\u200C\u200D\uFEFF]/g, "");
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a) { out += ch; continue; }
    if (cp >= 0x20 && cp <= 0x7e) { out += ch; continue; }
    if (cp >= 0xa0 && cp <= 0xff) { out += ch; continue; }
    if (WINANSI_EXTRA.has(cp)) { out += ch; continue; }
    // resto (emoji, CJK, símbolos) descartado
  }
  return out;
}

function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

interface PdfSection {
  heading: string;
  body: string;
}

const PAGE_WIDTH = 595.28; // A4
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function drawRule(doc: PDFKit.PDFDocument): void {
  doc.moveDown(0.4);
  const y = doc.y;
  doc
    .save()
    .strokeColor("#d4d4d8")
    .lineWidth(0.75)
    .moveTo(MARGIN, y)
    .lineTo(PAGE_WIDTH - MARGIN, y)
    .stroke()
    .restore();
  doc.moveDown(0.6);
}

function renderBody(doc: PDFKit.PDFDocument, body: string): void {
  const lines = sanitizeForPdf(body).split("\n");
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === "") {
      doc.moveDown(0.5);
      continue;
    }
    // Separadores (--- *** === ou travessões repetidos viram régua)
    if (/^([-*=_\u2014\u2013]\s*){3,}$/.test(trimmed)) {
      drawRule(doc);
      continue;
    }
    // Headings markdown
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      doc.moveDown(0.3);
      doc
        .font("Helvetica-Bold")
        .fontSize(h[1].length <= 2 ? 12.5 : 11)
        .fillColor("#1f2937")
        .text(stripInline(h[2]), { width: CONTENT_WIDTH });
      doc.moveDown(0.15);
      continue;
    }
    // Listas
    const bullet = trimmed.match(/^[-*\u2022]\s+(.*)$/);
    if (bullet) {
      doc
        .font("Helvetica")
        .fontSize(10.5)
        .fillColor("#27272a")
        .text(`\u2022 ${stripInline(bullet[1])}`, MARGIN + 12, doc.y, {
          width: CONTENT_WIDTH - 12,
        });
      continue;
    }
    const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numbered) {
      doc
        .font("Helvetica")
        .fontSize(10.5)
        .fillColor("#27272a")
        .text(`${numbered[1]}. ${stripInline(numbered[2])}`, MARGIN + 12, doc.y, {
          width: CONTENT_WIDTH - 12,
        });
      continue;
    }
    // Parágrafo
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#27272a")
      .text(stripInline(trimmed), MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        align: "left",
      });
  }
}

function renderPdf(opts: {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      bufferPages: true,
      info: { Title: sanitizeForPdf(opts.title).slice(0, 200) },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Cabeçalho
    doc
      .font("Helvetica-Bold")
      .fontSize(19)
      .fillColor("#111827")
      .text(sanitizeForPdf(opts.title), { width: CONTENT_WIDTH });
    if (opts.subtitle) {
      doc
        .moveDown(0.25)
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor("#6b7280")
        .text(sanitizeForPdf(opts.subtitle), { width: CONTENT_WIDTH });
    }
    drawRule(doc);

    opts.sections.forEach((sec, i) => {
      if (i > 0) doc.moveDown(0.8);
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#b91c1c")
        .text(sanitizeForPdf(sec.heading), MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.4);
      renderBody(doc, sec.body);
    });

    // Rodapé com número de página
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.height - 40;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#9ca3af")
        .text(
          `SalesCockpit \u00b7 p\u00e1gina ${i - range.start + 1} de ${range.count}`,
          MARGIN,
          bottom,
          { width: CONTENT_WIDTH, align: "center", lineBreak: false },
        );
    }

    doc.end();
  });
}

export function buildFullAssembleiaPdf(d: {
  sessionId: number;
  topic: string;
  dateLabel: string;
  ataPublica?: string | null;
  metaAnalysis?: string | null;
  resultado?: string | null;
  perfeito?: string | null;
}): Promise<Buffer> {
  const sections: PdfSection[] = [
    {
      heading: "Ata p\u00fablica",
      body: d.ataPublica?.trim() || "(nada foi publicado nesta sess\u00e3o.)",
    },
  ];
  if (d.resultado?.trim()) {
    sections.push({ heading: "Resultado da \u00c1gora", body: d.resultado });
  }
  if (d.metaAnalysis?.trim()) {
    sections.push({ heading: "An\u00e1lise metassemi\u00f3tica", body: d.metaAnalysis });
  }
  if (d.perfeito?.trim()) {
    sections.push({
      heading: "PERFEITO \u2014 s\u00edntese do Secret\u00e1rio",
      body: d.perfeito,
    });
  }
  return renderPdf({
    title: d.topic,
    subtitle: `Assembleia #${d.sessionId} \u00b7 ${d.dateLabel}`,
    sections,
  });
}

export function buildPublicAssembleiaPdf(d: {
  sessionId: number | null;
  topic: string;
  dateLabel: string;
  perfeito: string;
}): Promise<Buffer> {
  const ref = d.sessionId ? `Sess\u00e3o #${d.sessionId} \u00b7 ` : "";
  return renderPdf({
    title: d.topic,
    subtitle: `Mostra p\u00fablica \u00b7 SalesCockpit \u00b7 ${ref}${d.dateLabel}`,
    sections: [
      {
        heading: "S\u00edntese publicada (PERFEITO)",
        body: d.perfeito?.trim() || "(sem conte\u00fado)",
      },
    ],
  });
}
