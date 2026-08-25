import bcrypt from "bcryptjs";
import readline from "node:readline";
import { Writable } from "node:stream";

const muted = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: muted,
  terminal: true,
});

process.stdout.write("Nova senha AO (não vai aparecer na tela): ");

rl.question("", (password) => {
  process.stdout.write("\n");
  rl.close();
  const trimmed = (password ?? "").trim();
  if (trimmed.length < 8) {
    console.error("Senha curta demais (mínimo 8 caracteres).");
    process.exit(1);
  }
  const hash = bcrypt.hashSync(trimmed, 12);
  console.log("\nHash gerado — cole isso em Secrets → AO_PASSWORD_HASH (substituindo o valor atual):\n");
  console.log(hash);
  console.log("\nDepois de salvar o secret, restart do API server pra carregar.");
});
