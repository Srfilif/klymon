import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { InventoryPage } from './pages/InventoryPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProfilePage } from './pages/ProfilePage';
import { SecurityPage } from './pages/SecurityPage';
import { WalletPage } from './pages/WalletPage';
import { DevicesPage } from './pages/DevicesPage';
import { MinecraftPage } from './pages/MinecraftPage';
import { AddonsPage } from './pages/AddonsPage';
import { SyncPage } from './pages/SyncPage';

function RequireAuth(): React.JSX.Element {
  const { user, loading } = useSession();
  if (loading) return <p className="muted">Cargando sesión…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Shell(): React.JSX.Element {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const signOut = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };
  return (
    <div className="page">
      <header className="nav">
        <span className="brand">Klymon · cuenta</span>
        <nav className="links">
          <NavLink to="/">Resumen</NavLink>
          <NavLink to="/profile">Perfil</NavLink>
          <NavLink to="/security">Seguridad</NavLink>
          <NavLink to="/wallet">Monedero</NavLink>
          <NavLink to="/devices">Dispositivos</NavLink>
          <NavLink to="/minecraft">Minecraft</NavLink>
          <NavLink to="/inventory">Inventario</NavLink>
          <NavLink to="/addons">Addons</NavLink>
          <NavLink to="/sync">Nube</NavLink>
        </nav>
        <span className="muted">{user?.username}</span>
        <button type="button" className="button small" onClick={() => void signOut()}>
          Salir
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route index element={<OverviewPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="wallet" element={<WalletPage />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="minecraft" element={<MinecraftPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="addons" element={<AddonsPage />} />
            <Route path="sync" element={<SyncPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
