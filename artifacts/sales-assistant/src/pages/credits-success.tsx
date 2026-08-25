import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/auth";

type VerifyResult =
  | { ok: true; credited?: boolean; alreadyProcessed?: boolean; creditsAdded?: number; credits: number }
  | { ok: false; paymentStatus?: string; message?: string };

export default function CreditsSuccessPage() {
  const [, navigate] = useLocation();
  const { refreshAppUser } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "pending" | "error">("loading");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setError("Sem session_id. Volta pra comprar de novo.");
      setState("error");
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(
          `${base}/api/checkout/verify?session_id=${encodeURIComponent(sessionId)}`,
          { credentials: "include" },
        );
        const data = await res.json() as VerifyResult & { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Erro ao verificar pagamento.");
          setState("error");
          return;
        }
        setResult(data);
        if (data.ok) {
          await refreshAppUser();
          setState("ok");
        } else {
          setState("pending");
        }
      } catch {
        setError("Erro de conexão. Tente recarregar.");
        setState("error");
      }
    };
    void verify();
  }, [refreshAppUser]);

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden" style={{ background: "hsl(240 20% 15%)" }}>
      <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-400 via-emerald-400 to-violet-500" />
      <div className="absolute bottom-0 left-0 right-0 h-2 bg-gradient-to-r from-violet-500 via-emerald-400 via-yellow-400 via-pink-500 to-cyan-400" />

      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="h-3 rounded-t-2xl bg-gradient-to-r from-cyan-400 via-pink-500 via-yellow-300 via-emerald-400 to-violet-500" />
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-b-2xl px-8 py-10 text-center">
          {state === "loading" && (
            <>
              <Loader2 className="mx-auto h-12 w-12 text-cyan-300 animate-spin mb-4" />
              <p className="text-white">Confirmando pagamento...</p>
            </>
          )}

          {state === "ok" && result && "ok" in result && result.ok && (
            <>
              <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-400 mb-4" />
              <h1 className="text-2xl font-black uppercase text-white mb-2">Pagamento confirmado!</h1>
              {result.alreadyProcessed ? (
                <p className="text-white/70 text-sm mb-4">Esse pagamento já tinha sido creditado antes.</p>
              ) : (
                <p className="text-emerald-200 mb-4">
                  +{result.creditsAdded} prompts adicionados
                </p>
              )}
              <p className="text-white text-lg font-bold mb-6">
                Saldo: {result.credits} prompts
              </p>
              <button
                onClick={() => navigate("/app")}
                className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest text-white shadow-lg"
                style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
              >
                Ir pro RODAR
              </button>
            </>
          )}

          {state === "pending" && result && !("ok" in result && result.ok) && (
            <>
              <Loader2 className="mx-auto h-12 w-12 text-yellow-300 mb-4" />
              <h1 className="text-xl font-black uppercase text-white mb-2">Pagamento em andamento</h1>
              <p className="text-white/70 text-sm mb-4">
                {"message" in result && result.message
                  ? result.message
                  : "PIX/boleto pode levar alguns minutos. Recibo por email quando confirmar."}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 rounded-xl font-bold text-sm uppercase text-white bg-white/20 hover:bg-white/30"
              >
                Verificar de novo
              </button>
            </>
          )}

          {state === "error" && (
            <>
              <AlertCircle className="mx-auto h-12 w-12 text-red-400 mb-4" />
              <h1 className="text-xl font-black uppercase text-white mb-2">Erro</h1>
              <p className="text-red-200 text-sm mb-4">{error}</p>
              <button
                onClick={() => navigate("/buy-credits")}
                className="w-full py-3 rounded-xl font-bold text-sm uppercase text-white bg-white/20 hover:bg-white/30"
              >
                Voltar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
