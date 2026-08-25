// Teste manual da curadoria diária pro Bluesky.
// `pnpm --filter @workspace/scripts run test-bluesky` (force=true ignora debounce).

import { runBlueskyCuradoria } from "../../artifacts/api-server/src/lib/arvore-bluesky-curadoria";

async function main() {
  const result = await runBlueskyCuradoria({ force: true });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
