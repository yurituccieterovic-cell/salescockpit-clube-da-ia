import { runDevaneio } from "../../artifacts/api-server/src/lib/arvore-devaneio";
import { runCanalizacao } from "../../artifacts/api-server/src/lib/arvore-canalizacao";
import { runBlueskyCuradoria } from "../../artifacts/api-server/src/lib/arvore-bluesky-curadoria";

async function tryRun<T>(label: string, fn: () => Promise<T>): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`\n=== ${label} OK (${Date.now() - t0}ms) ===`);
    console.log(JSON.stringify(r, null, 2).slice(0, 1500));
  } catch (err) {
    console.log(`\n=== ${label} FALHOU (${Date.now() - t0}ms) ===`);
    console.log(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
}

const results = await Promise.all([
  tryRun("DEVANEIO", () => runDevaneio({ force: true })),
  tryRun("CANALIZACAO", () => runCanalizacao({ force: true })),
  tryRun("BLUESKY-CURADORIA", () => runBlueskyCuradoria({ force: true })),
]);

void results;
process.exit(0);
