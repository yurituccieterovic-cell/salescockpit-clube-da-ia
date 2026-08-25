import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { synthesizePerfeitoAudio } from "./narracao-audio";
import type { VideoComentario } from "./video-curadoria";

// O servidor publicado não tem ffmpeg/ffprobe no sistema (só o ambiente de dev via
// Nix). Por isso resolvemos os binários empacotados como dependência (vão junto na
// publicação), com fallback pro binário do sistema caso o pacote falhe.
const requireFromHere = createRequire(import.meta.url);
function resolveBinary(loader: () => string | undefined, systemName: string): string {
  try {
    const p = loader();
    if (p && existsSync(p)) return p;
  } catch {
    // pacote ausente — cai no binário do sistema
  }
  return systemName;
}
const FFMPEG_BIN = resolveBinary(
  () => (requireFromHere("@ffmpeg-installer/ffmpeg") as { path?: string }).path,
  "ffmpeg",
);
const FFPROBE_BIN = resolveBinary(
  () => (requireFromHere("ffprobe-static") as { path?: string }).path,
  "ffprobe",
);

// O PERFEITO vai por email pra cá (mesmo destino do áudio e do PERFEITO em texto).
const RECIPIENT_EMAIL = "luddlocke@gmail.com";

// Imagens-símbolo da Árvore (núcleo orbital). Ficam em artifacts/api-server/assets.
// Em runtime o CWD é o diretório do pacote (artifacts/api-server), então resolvemos
// a partir do process.cwd(). Se uma faltar, o vídeo usa só as que existirem.
const IMAGE_FILES = ["concept-a.png", "concept-b.png", "concept-c.png"];

// 24 fps (cinematográfico) é mais leve que 30 na CPU fraca do servidor publicado e
// gera arquivo menor, sem perda visível pro vídeo simbólico.
const FPS = 24;
// Acima de ~3 min o anexo fica grande; baixamos a resolução pra caber no email.
const LONG_VIDEO_SECONDS = 180;
// Gmail rejeita anexos acima de 25 MB; deixamos folga.
const MAX_ATTACH_BYTES = 23_000_000;
// O job roda em background (não bloqueia requisição), então o teto é generoso: a CPU
// do servidor publicado é bem mais fraca que a de dev e a render de um PERFEITO longo
// pode levar vários minutos. 240s estourava em produção; 15 min dá folga larga.
const FFMPEG_TIMEOUT_MS = 900_000;

function imagePaths(): string[] {
  // O CWD difere entre dev (pasta do pacote) e produção (raiz do repo, pois o
  // deploy roda `node artifacts/api-server/dist/index.mjs` da raiz). Por isso
  // resolvemos primeiro pela posição do próprio bundle (dist/ -> pacote), com
  // fallbacks pros dois CWDs possíveis.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "assets", "arvore-nucleo"),
    path.join(process.cwd(), "assets", "arvore-nucleo"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "arvore-nucleo"),
  ];
  for (const dir of candidates) {
    const found = IMAGE_FILES.map((f) => path.join(dir, f)).filter((p) => existsSync(p));
    if (found.length > 0) return found;
  }
  return [];
}

// Roda um binário e resolve com stdout; rejeita em código != 0 (com stderr no erro).
function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} estourou o timeout (${timeoutMs}ms)`));
    }, timeoutMs);
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} saiu com código ${code}: ${err.slice(-500)}`));
    });
  });
}

async function audioDurationSeconds(audioPath: string): Promise<number> {
  const out = await run(
    FFPROBE_BIN,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", audioPath],
    30_000,
  );
  const dur = parseFloat(out.trim());
  if (!Number.isFinite(dur) || dur <= 0) throw new Error(`ffprobe não leu a duração do áudio (got "${out.trim()}")`);
  return dur;
}

// Monta o filtergraph: cada imagem vira um clipe com leve zoom (Ken Burns) e fade
// in/out. Os clipes são CONCATENADOS (não usa `xfade`, que não existe em ffmpeg
// antigo): o fade-out de um clipe seguido do fade-in do próximo cria a transição
// dissolvendo pelo preto. Os clipes somam `dur` pra terminar junto com o áudio.
function buildFilterGraph(images: string[], dur: number, w: number, h: number): string {
  const n = images.length;
  const seg = dur / n; // duração de cada clipe (sem sobreposição)
  // Math.ceil: cada clipe fica >= seg, então o total >= duração do áudio e o
  // `-shortest` corta no fim da voz sem perder a última fração da fala.
  const frames = Math.max(2, Math.ceil(seg * FPS));
  const fadeD = Math.min(0.6, seg / 3); // duração do fade de transição
  const fadeOutSt = Math.max(0, seg - fadeD).toFixed(3);

  const parts: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < n; i++) {
    // Sobe a imagem pra 2x o tamanho final (zoompan fica suave), aplica zoom lento
    // e fade in/out em cada clipe (transição pelo preto entre eles).
    parts.push(
      `[${i}:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,` +
        `crop=${w * 2}:${h * 2},` +
        `zoompan=z='min(zoom+0.0005,1.12)':d=${frames}:s=${w}x${h}:fps=${FPS},` +
        `setsar=1,` +
        `fade=t=in:st=0:d=${fadeD.toFixed(3)},` +
        `fade=t=out:st=${fadeOutSt}:d=${fadeD.toFixed(3)}[v${i}]`,
    );
    labels.push(`[v${i}]`);
  }

  if (n === 1) {
    parts.push(`[v0]format=yuv420p[v]`);
    return parts.join(";");
  }

  parts.push(`${labels.join("")}concat=n=${n}:v=1:a=0,format=yuv420p[v]`);
  return parts.join(";");
}

async function renderVideo(opts: {
  images: string[];
  audioPath: string;
  dur: number;
  outPath: string;
  w: number;
  h: number;
}): Promise<void> {
  const { images, audioPath, dur, outPath, w, h } = opts;
  const seg = dur / images.length;
  const inputArgs: string[] = [];
  for (const img of images) {
    // -t um pouco maior que o clipe garante frames suficientes pro zoompan.
    inputArgs.push("-loop", "1", "-t", (seg + 1).toFixed(2), "-i", img);
  }
  inputArgs.push("-i", audioPath);

  const filter = buildFilterGraph(images, dur, w, h);
  const audioIdx = images.length; // o áudio é o último input

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    `${audioIdx}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-shortest",
    "-r",
    String(FPS),
    outPath,
  ];

  await run(FFMPEG_BIN, args, FFMPEG_TIMEOUT_MS);
}

async function sendVideoEmail(opts: {
  topic: string;
  sessionId: number;
  video: Buffer;
  textPreview: string;
  charsSpoken: number;
  voiceName: string;
  comentarios?: VideoComentario[];
  gmailUser: string;
  gmailPass: string;
}): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: opts.gmailUser, pass: opts.gmailPass },
  });
  const comentariosBlock =
    opts.comentarios && opts.comentarios.length > 0
      ? `Comentários das vozes (por que escolheram este trecho):\n` +
        opts.comentarios.map((c) => `• ${c.voice}: ${c.comment}`).join("\n") +
        `\n\n${"─".repeat(60)}\n\n`
      : "";
  const body =
    `Vídeo simbólico do PERFEITO — Sessão #${opts.sessionId}\n\n` +
    `Tema (primeiras 500 chars):\n"${opts.topic.slice(0, 500)}${opts.topic.length > 500 ? "…" : ""}"\n\n` +
    `${"─".repeat(60)}\n\n` +
    `O vídeo (MP4) está anexado a este email.\n\n` +
    `Caracteres falados: ${opts.charsSpoken.toLocaleString("pt-BR")}\n` +
    `Voz: ElevenLabs (${opts.voiceName})\n` +
    `Imagens: símbolo da Árvore (núcleo orbital). Sem D-ID, sem rosto — custo só da voz.\n\n` +
    comentariosBlock +
    `Trecho escolhido pelas vozes (o que está no vídeo):\n${opts.textPreview}\n\n` +
    `— SalesCockpit / Vídeo`;
  await transporter.sendMail({
    from: opts.gmailUser,
    to: RECIPIENT_EMAIL,
    subject: `VÍDEO PERFEITO — Sessão #${opts.sessionId}: ${opts.topic.slice(0, 120).replace(/\s+/g, " ")}${opts.topic.length > 120 ? "…" : ""}`,
    text: body,
    attachments: [
      {
        filename: `perfeito-sessao-${opts.sessionId}.mp4`,
        content: opts.video,
        contentType: "video/mp4",
      },
    ],
  });
}

// Aviso (não-fatal) quando o vídeo não pôde ser entregue. Mandado pro próprio GMAIL_USER
// pra Yuri não ficar com o toggle "ligado sem efeito" achando que é bug silencioso.
async function sendNoticeEmail(opts: {
  topic: string;
  sessionId: number;
  motivo: string;
  gmailUser: string;
  gmailPass: string;
}): Promise<void> {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: opts.gmailUser, pass: opts.gmailPass },
    });
    await transporter.sendMail({
      from: opts.gmailUser,
      to: opts.gmailUser,
      subject: `[Vídeo simbólico] não entregue — Sessão #${opts.sessionId}`,
      text:
        `O vídeo simbólico de "${opts.topic.slice(0, 500)}${opts.topic.length > 500 ? "…" : ""}" não foi entregue.\n\n` +
        `Motivo:\n${opts.motivo}\n\n` +
        `Lembrando: a narração em áudio (toggle de áudio) é a alternativa e não tem limite de tamanho de anexo.`,
    });
  } catch {
    // se nem o email de aviso vai, só log mesmo
  }
}

// Gera o vídeo simbólico do PERFEITO: voz (ElevenLabs) sobre as imagens da Árvore,
// montado localmente com ffmpeg (sem D-ID, sem rosto). Roda em background (opt-in),
// não bloqueia o pipeline. Falha é não-fatal: manda email de aviso.
export async function gerarVideoSimbolico(opts: {
  topic: string;
  sessionId: number;
  perfeitoText: string;
  comentarios?: VideoComentario[];
}): Promise<void> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!process.env.ELEVENLABS_API_KEY || !gmailUser || !gmailPass) {
    console.error("[VídeoSimbólico] Faltando env vars (ELEVENLABS_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD)");
    return;
  }

  const images = imagePaths();
  if (images.length === 0) {
    console.error("[VídeoSimbólico] Nenhuma imagem-símbolo encontrada em assets/arvore-nucleo");
    await sendNoticeEmail({
      topic: opts.topic,
      sessionId: opts.sessionId,
      motivo: "Nenhuma imagem-símbolo encontrada em artifacts/api-server/assets/arvore-nucleo.",
      gmailUser,
      gmailPass,
    });
    return;
  }

  let workdir: string | null = null;
  try {
    console.log(`[VídeoSimbólico] Sessão #${opts.sessionId} — sintetizando voz (ElevenLabs)`);
    const synth = await synthesizePerfeitoAudio(opts.perfeitoText, opts.sessionId);
    if (!synth) {
      console.error("[VídeoSimbólico] Síntese de voz indisponível, abortando");
      await sendNoticeEmail({
        topic: opts.topic,
        sessionId: opts.sessionId,
        motivo: "A síntese de voz (ElevenLabs) não retornou áudio — verifique a chave/cota ou se o texto era curto demais.",
        gmailUser,
        gmailPass,
      });
      return;
    }

    workdir = await mkdtemp(path.join(tmpdir(), `video-sim-${opts.sessionId}-`));
    const audioPath = path.join(workdir, "voz.mp3");
    const outPath = path.join(workdir, "perfeito.mp4");
    await writeFile(audioPath, synth.audio);

    const dur = await audioDurationSeconds(audioPath);
    // Vídeos longos vão pra 480p pra não estourar o limite de anexo do Gmail.
    const [w, h] = dur > LONG_VIDEO_SECONDS ? [854, 480] : [1280, 720];
    console.log(`[VídeoSimbólico] Sessão #${opts.sessionId} — voz ${dur.toFixed(1)}s, montando vídeo ${w}x${h} (${images.length} imagens)`);
    await renderVideo({ images, audioPath, dur, outPath, w, h });

    const video = await readFile(outPath);
    if (video.length > MAX_ATTACH_BYTES) {
      console.error(`[VídeoSimbólico] Vídeo grande demais pro email (${(video.length / 1_000_000).toFixed(1)} MB) — sessão #${opts.sessionId}`);
      await sendNoticeEmail({
        topic: opts.topic,
        sessionId: opts.sessionId,
        motivo: `O vídeo ficou com ${(video.length / 1_000_000).toFixed(1)} MB (acima do limite de anexo do email) porque o PERFEITO é longo. Use a narração em áudio pra esse caso.`,
        gmailUser,
        gmailPass,
      });
      return;
    }

    console.log(`[VídeoSimbólico] Vídeo pronto sessão #${opts.sessionId} (${(video.length / 1_000_000).toFixed(1)} MB)`);
    await sendVideoEmail({
      topic: opts.topic,
      sessionId: opts.sessionId,
      video,
      textPreview: synth.text,
      charsSpoken: synth.text.length,
      voiceName: synth.voiceName,
      comentarios: opts.comentarios,
      gmailUser,
      gmailPass,
    });
    console.log(`[VídeoSimbólico] Email enviado pra ${RECIPIENT_EMAIL} — sessão #${opts.sessionId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[VídeoSimbólico] Falha na sessão #${opts.sessionId}:`, msg);
    await sendNoticeEmail({ topic: opts.topic, sessionId: opts.sessionId, motivo: msg, gmailUser, gmailPass });
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
