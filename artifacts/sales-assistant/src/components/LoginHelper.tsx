import logoUrl from "@assets/favicon2_1779764259369.png";

interface Props {
  /** "login" mostra 3 passos pra entrar; "signup" mostra 3 passos pra criar conta. */
  mode: "login" | "signup";
}

const STEPS_LOGIN = [
  { n: 1, title: "Usuário e senha", desc: "Digite os mesmos dados do seu cadastro." },
  { n: 2, title: "Entre no painel", desc: "Você cai direto na área principal da plataforma." },
  { n: 3, title: "Esqueceu algo?", desc: "Use o botão Suporte aqui em baixo, no canto direito." },
];

const STEPS_SIGNUP = [
  { n: 1, title: "Email + senha de 8 dígitos", desc: "Use um email que você lê. A senha precisa de no mínimo 8 caracteres." },
  { n: 2, title: "Compra de créditos", desc: "R$ 50 te dão 5 sessões RODAR. Saldo não expira." },
  { n: 3, title: "Comece a usar", desc: "Faça login e mande seu primeiro prompt." },
];

export default function LoginHelper({ mode }: Props) {
  const steps = mode === "login" ? STEPS_LOGIN : STEPS_SIGNUP;
  const title = mode === "login" ? "Como entrar" : "Como criar sua conta";

  return (
    <div className="hidden lg:block w-full max-w-xs">
      <div className="bg-white/5 backdrop-blur-md border border-white/15 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <img
            src={logoUrl}
            alt="PulseHeadway"
            className="w-10 h-10 rounded-lg"
            style={{ filter: "drop-shadow(0 0 12px rgba(236, 72, 153, 0.4))" }}
          />
          <div>
            <div className="text-white font-bold text-sm tracking-wide">PulseHeadway</div>
            <div className="text-white/50 text-xs">{title}</div>
          </div>
        </div>

        <ol className="space-y-4">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-3">
              <div
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white font-black text-xs"
                style={{ background: "linear-gradient(135deg, #06b6d4, #ec4899)" }}
              >
                {s.n}
              </div>
              <div>
                <div className="text-white text-sm font-semibold">{s.title}</div>
                <div className="text-white/60 text-xs mt-0.5 leading-relaxed">{s.desc}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 pt-4 border-t border-white/10">
          <div className="text-white/50 text-xs leading-relaxed">
            Problema persistente? Clique no botão <span className="text-cyan-300 font-semibold">Suporte</span> no
            canto inferior direito e mande sua mensagem direto pra equipe.
          </div>
        </div>
      </div>
    </div>
  );
}
