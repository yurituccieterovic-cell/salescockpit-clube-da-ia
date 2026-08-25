import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Loader2, Copy, Check } from "lucide-react";

export default function ContaSenhaPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setHash(null);
    if (password !== confirm) {
      setError("As duas senhas não batem.");
      return;
    }
    if (password.length < 8) {
      setError("Senha precisa ter no mínimo 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const base = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${base}api/auth/hash-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Erro ao gerar hash.");
      } else {
        setHash(data.hash);
        setPassword("");
        setConfirm("");
      }
    } catch (err) {
      setError("Falha de rede.");
    } finally {
      setLoading(false);
    }
  }

  async function copyHash() {
    if (!hash) return;
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <MainLayout>
      <div className="max-w-xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-serif mb-2">Trocar senha AO</h1>
        <p className="text-sm text-stone-600 mb-6">
          Digite a nova senha. O servidor vai gerar um hash bcrypt que você cola
          em <strong>Secrets → AO_PASSWORD_HASH</strong>. A senha em texto puro nunca é salva.
        </p>

        {!hash && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm mb-1">Nova senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className="w-full border rounded px-3 py-2"
                placeholder="mínimo 8 caracteres"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Confirmar senha</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className="w-full border rounded px-3 py-2"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || !password || !confirm}
              className="bg-stone-900 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Gerar hash
            </button>
          </form>
        )}

        {hash && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
              Hash gerado. Agora siga os passos abaixo.
            </div>
            <div>
              <label className="block text-sm mb-1 font-medium">Hash bcrypt:</label>
              <div className="relative">
                <textarea
                  readOnly
                  value={hash}
                  className="w-full border rounded px-3 py-2 font-mono text-xs bg-stone-50 break-all"
                  rows={3}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={copyHash}
                  className="absolute top-2 right-2 bg-white border rounded px-2 py-1 text-xs inline-flex items-center gap-1 hover:bg-stone-50"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
            <ol className="text-sm space-y-2 list-decimal list-inside text-stone-700">
              <li>Copia o hash acima (botão Copiar).</li>
              <li>Abre <strong>Secrets</strong> (cadeado na barra lateral do Replit).</li>
              <li>Procura <code className="bg-stone-100 px-1 rounded">AO_PASSWORD_HASH</code>, toca em Edit.</li>
              <li>Apaga o valor atual, cola o hash novo, salva.</li>
              <li>Me avisa no chat — eu reinicio o servidor pra carregar.</li>
            </ol>
            <button
              onClick={() => { setHash(null); setCopied(false); }}
              className="text-sm underline text-stone-600"
            >
              Gerar outra
            </button>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
