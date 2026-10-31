import { motion } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { AuthProvider, homeFor, useAuth } from "./lib/auth.jsx";
import { NetworkProvider } from "./lib/network.jsx";
import Login from "./pages/Login.jsx";
import Passenger from "./pages/Passenger.jsx";
import Operator from "./pages/Operator.jsx";

/** Signed-in users only, and only the module that matches their role. */
function Protected({ role, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return (
    <NetworkProvider>
      <TopBar />
      {children}
    </NetworkProvider>
  );
}

function AppRoutes() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-spinner" />
      </div>
    );
  }
  return (
    <motion.div
      key={location.pathname}
      className="page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Routes>
        <Route path="/login" element={user ? <Navigate to={homeFor(user)} replace /> : <Login />} />
        <Route path="/" element={<Protected role="passenger"><Passenger /></Protected>} />
        <Route path="/operator" element={<Protected role="operator"><Operator /></Protected>} />
        <Route path="*" element={<Navigate to={user ? homeFor(user) : "/login"} replace />} />
      </Routes>
    </motion.div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  );
}
