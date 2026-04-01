import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignJWT } from 'jose';
import { useAuth } from '../contexts/AuthContext';

const DEV_SECRET = 'dev-secret-change-in-production-must-be-32-chars';

type Role = 'customer' | 'restaurant' | 'driver' | 'admin';

const roleRoutes: Record<Role, string> = {
  customer: '/customer',
  restaurant: '/restaurant',
  driver: '/driver',
  admin: '/admin',
};

export default function LoginView() {
  const { setToken } = useAuth();
  const navigate = useNavigate();

  const [pastedToken, setPastedToken] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [role, setRole] = useState<Role>('customer');
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  const handlePasteLogin = () => {
    if (!pastedToken.trim()) {
      setError('Please paste a JWT token.');
      return;
    }
    setToken(pastedToken.trim());
    navigate('/customer');
  };

  const handleGenerate = async () => {
    if (!customerId.trim()) {
      setError('Please enter a Customer ID (UUID).');
      return;
    }
    setError('');
    setGenerating(true);
    try {
      const token = await new SignJWT({ sub: customerId.trim(), role })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(new TextEncoder().encode(DEV_SECRET));
      setToken(token);
      navigate(roleRoutes[role]);
    } catch (e) {
      setError('Failed to generate token.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-orange-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-orange-600">🍔 FoodDash</h1>
          <p className="text-gray-500 mt-1">Food Delivery Platform — Dev Login</p>
        </div>

        {error && (
          <div className="bg-red-100 text-red-700 px-4 py-2 rounded text-sm">{error}</div>
        )}

        {/* Section 1: Paste JWT */}
        <div className="bg-white rounded-xl shadow p-5">
          <h2 className="font-semibold text-gray-700 mb-3">Paste Existing JWT</h2>
          <textarea
            value={pastedToken}
            onChange={(e) => setPastedToken(e.target.value)}
            rows={4}
            placeholder="eyJhbGciOiJIUzI1NiJ9..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            onClick={handlePasteLogin}
            className="mt-2 w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg transition-colors"
          >
            Use this token
          </button>
        </div>

        {/* Section 2: Generate dev token */}
        <div className="bg-white rounded-xl shadow p-5">
          <h2 className="font-semibold text-gray-700 mb-3">Generate Dev Test Token</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Customer ID (UUID)</label>
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="550e8400-e29b-41d4-a716-446655440000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="customer">Customer</option>
                <option value="restaurant">Restaurant</option>
                <option value="driver">Driver</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full bg-gray-800 hover:bg-gray-900 disabled:bg-gray-400 text-white font-medium py-2 rounded-lg transition-colors"
            >
              {generating ? 'Generating…' : 'Generate & Login'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
