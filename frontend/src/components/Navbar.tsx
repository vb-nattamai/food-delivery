import { Link, useNavigate } from 'react-router-dom';
import { LogOut, ShoppingBag, Store, Truck, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Navbar() {
  const { customerId, clearToken } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  return (
    <nav className="bg-orange-600 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-lg">
          <ShoppingBag size={22} />
          <span>FoodDash</span>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <Link to="/customer" className="flex items-center gap-1 hover:text-orange-200 transition-colors">
            <ShoppingBag size={16} /> Customer
          </Link>
          <Link to="/restaurant" className="flex items-center gap-1 hover:text-orange-200 transition-colors">
            <Store size={16} /> Restaurant
          </Link>
          <Link to="/driver" className="flex items-center gap-1 hover:text-orange-200 transition-colors">
            <Truck size={16} /> Driver
          </Link>
          <Link to="/admin" className="flex items-center gap-1 hover:text-orange-200 transition-colors">
            <LayoutDashboard size={16} /> Admin
          </Link>
          {customerId && (
            <span className="text-orange-200 text-xs font-mono">
              {customerId.slice(0, 8)}…
            </span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 hover:text-orange-200 transition-colors"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>
    </nav>
  );
}
