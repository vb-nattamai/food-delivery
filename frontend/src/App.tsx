import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LoginView from './views/LoginView';
import CustomerView from './views/CustomerView';
import RestaurantView from './views/RestaurantView';
import DriverView from './views/DriverView';
import AdminView from './views/AdminView';

function ProtectedLayout() {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="py-6">
        <Outlet />
      </main>
    </div>
  );
}

function RootRedirect() {
  const { token } = useAuth();
  return <Navigate to={token ? '/customer' : '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/customer" element={<CustomerView />} />
          <Route path="/restaurant" element={<RestaurantView />} />
          <Route path="/driver" element={<DriverView />} />
          <Route path="/admin" element={<AdminView />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
