import { runHeartbeat } from "../../artifacts/api-server/src/lib/arvore-heartbeat";

const r = await runHeartbeat({ force: true });
console.log(JSON.stringify(r, null, 2).slice(0, 2000));
process.exit(0);
