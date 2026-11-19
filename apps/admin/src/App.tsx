import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { LoginPage } from './pages/LoginPage';
import { CosmeticsPage } from './pages/CosmeticsPage';
import { OverviewPage } from './pages/OverviewPage';
import { UsersPage } from './pages/UsersPage';
import { AdjustPage } from './pages/AdjustPage';
import { AddonsPage } from './pages/AddonsPage';

function RequireAdmin(): React.JSX.Element {
  const { user, isAdmin, loading } = useSession();
  if (loading) return <p className="muted">Cargando sesión…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) {
    return (
      <div className="page narrow">
        <h1>Sin acceso</h1>
        <p className="muted">Esta cuenta no es administradora. Promociónala por SQL: UPDATE users SET role='admin'.</p>
      </div>
    );
  }
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
        <span className="brand">Klymon · admin</span>
        <nav className="links">
          <NavLink to="/">Resumen</NavLink>
          <NavLink to="/users">Usuarios</NavLink>
          <NavLink to="/adjust">Ajustar monedero</NavLink>
          <NavLink to="/cosmetics">Cosméticos</NavLink>
          <NavLink to="/addons">Addons</NavLink>
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
        <Route element={<RequireAdmin />}>
          <Route element={<Shell />}>
            <Route index element={<OverviewPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="adjust" element={<AdjustPage />} />
            <Route path="cosmetics" element={<CosmeticsPage />} />
            <Route path="addons" element={<AddonsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
