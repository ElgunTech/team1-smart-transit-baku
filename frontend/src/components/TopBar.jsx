import { useEffect, useState } from "react";
import { LayoutDashboard, LogOut, MapPinned } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";
import Logo from "./Logo.jsx";

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="clock">{now.toLocaleTimeString("az-AZ")}</span>;
}

export default function TopBar() {
  const { user, signOut } = useAuth();
  const isOperator = user.role === "operator";
  const initials = user.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span className="module-tag">
          {isOperator ? <LayoutDashboard size={14} /> : <MapPinned size={14} />}
          {isOperator ? "Operator paneli" : "Sərnişin"}
        </span>
      </div>
      <div className="topbar-right">
        <span className="live">
          <span className="live-dot" /> Canlı
        </span>
        <Clock />
        <div className="user-chip" title={user.email}>
          <span className="avatar">{initials}</span>
          <span className="user-name">{user.name}</span>
        </div>
        <button className="icon-btn" onClick={signOut} title="Çıxış" aria-label="Çıxış">
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}
