import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bus, Clock3, Lock, Mail, User, Users } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";
import Logo from "../components/Logo.jsx";

const FEATURES = [
  { icon: Bus, title: "Canlı xəritə", text: "Avtobusların real vaxtda harada olduğunu izləyin" },
  { icon: Clock3, title: "Dəqiq gəliş vaxtı", text: "Dayanacağa nə vaxt çatacağını əvvəlcədən bilin" },
  { icon: Users, title: "Sıxlıq bildirişi", text: "Avtobusun dolu olub-olmadığını paylaşın" },
];

function Field({ icon: Icon, ...props }) {
  return (
    <label className="field">
      <Icon size={17} />
      <input {...props} />
    </label>
  );
}

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // On success the auth state changes and the /login route redirects by role.
      if (mode === "login") await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <section className="auth-hero">
        <div className="auth-hero-inner">
          <Logo size={40} />
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            Şəhər nəqliyyatı,<br />sərnişinlə birlikdə.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
            Sərnişinlərin bildirişləri və GPS məlumatları əsasında xətlərdəki sıxlığı görür, ehtiyac olan xəttə vaxtında əlavə avtobus yönləndiririk.
          </motion.p>
          <ul className="auth-features">
            {FEATURES.map(({ icon: Icon, title, text }, i) => (
              <motion.li key={title} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.08 }}>
                <span className="feature-icon"><Icon size={18} /></span>
                <div>
                  <b>{title}</b>
                  <span>{text}</span>
                </div>
              </motion.li>
            ))}
          </ul>
        </div>
        <svg className="auth-lines" viewBox="0 0 600 400" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-20 320 C 120 300, 180 180, 320 200 S 520 120, 640 60" />
          <path d="M-20 380 C 160 360, 260 280, 380 300 S 560 260, 640 200" />
          <path d="M-20 240 C 100 250, 200 120, 300 110 S 480 40, 640 -10" />
        </svg>
      </section>

      <section className="auth-panel">
        <motion.div className="auth-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
          <div className="segmented">
            {[["login", "Daxil ol"], ["register", "Qeydiyyat"]].map(([id, label]) => (
              <button key={id} type="button" className={mode === id ? "active" : ""} onClick={() => { setMode(id); setError(""); }}>
                {mode === id && <motion.span layoutId="seg" className="segmented-bg" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <span>{label}</span>
              </button>
            ))}
          </div>

          <h2>{mode === "login" ? "Xoş gəlmisiniz" : "Hesab yaradın"}</h2>
          <p className="muted">
            {mode === "login" ? "Hesabınıza daxil olun." : "Bir dəqiqəyə qeydiyyatdan keçin və sıxlıq bildirişləri göndərin."}
          </p>

          <form onSubmit={submit} className="auth-form">
            <AnimatePresence initial={false}>
              {mode === "register" && (
                <motion.div key="name" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <Field icon={User} placeholder="Ad Soyad" value={form.name} onChange={set("name")} required minLength={2} autoComplete="name" />
                </motion.div>
              )}
            </AnimatePresence>
            <Field icon={Mail} type="email" placeholder="E-poçt" value={form.email} onChange={set("email")} required autoComplete="email" />
            <Field
              icon={Lock}
              type="password"
              placeholder={mode === "register" ? "Şifrə (ən azı 6 simvol)" : "Şifrə"}
              value={form.password}
              onChange={set("password")}
              required
              minLength={mode === "register" ? 6 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            <AnimatePresence>
              {error && (
                <motion.div className="form-error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, x: [0, -6, 6, -3, 0] }} exit={{ opacity: 0 }}>
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
            <motion.button className="btn primary block" disabled={busy} whileTap={{ scale: 0.98 }}>
              {busy ? <span className="spinner" /> : <>{mode === "login" ? "Daxil ol" : "Qeydiyyatdan keç"} <ArrowRight size={17} /></>}
            </motion.button>
          </form>
          <p className="auth-note">Operator hesabları sistem administratoru tərəfindən yaradılır.</p>
        </motion.div>
      </section>
    </main>
  );
}
