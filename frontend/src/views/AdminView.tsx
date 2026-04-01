import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAllOrders } from '../api/orders';
import { getRestaurants } from '../api/inventory';
import { getDrivers } from '../api/drivers';
import OrderStatusBadge from '../components/OrderStatusBadge';
import type { OrderStatus } from '../types';
import { ShoppingBag, Store, Truck, LayoutDashboard } from 'lucide-react';

const ALL_STATUSES: OrderStatus[] = [
  'PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP',
  'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'REFUNDED',
];

export default function AdminView() {
  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['allOrders'],
    queryFn: getAllOrders,
  });

  const { data: restaurants = [], isLoading: loadingRestaurants } = useQuery({
    queryKey: ['restaurants'],
    queryFn: getRestaurants,
  });

  const { data: drivers = [], isLoading: loadingDrivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: getDrivers,
  });

  const statusCounts = ALL_STATUSES.reduce<Record<OrderStatus, number>>((acc, s) => {
    acc[s] = orders.filter((o) => o.status === s).length;
    return acc;
  }, {} as Record<OrderStatus, number>);

  const availableDrivers = drivers.filter((d) => d.available).length;
  const sortedOrders = [...orders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          icon={<ShoppingBag className="text-orange-500" />}
          label="Total Orders"
          value={loadingOrders ? '…' : String(orders.length)}
        />
        <StatCard
          icon={<Truck className="text-green-500" />}
          label="Available Drivers"
          value={loadingDrivers ? '…' : `${availableDrivers} / ${drivers.length}`}
        />
        <StatCard
          icon={<Store className="text-blue-500" />}
          label="Restaurants"
          value={loadingRestaurants ? '…' : String(restaurants.length)}
        />
        <StatCard
          icon={<LayoutDashboard className="text-purple-500" />}
          label="Delivered Today"
          value={loadingOrders ? '…' : String(statusCounts['DELIVERED'])}
        />
      </div>

      {/* Orders by Status */}
      <div>
        <h2 className="font-semibold text-gray-700 mb-2">Orders by Status</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ALL_STATUSES.map((s) => (
            <div key={s} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between">
              <OrderStatusBadge status={s} />
              <span className="font-bold text-gray-700">{statusCounts[s]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="font-semibold text-gray-700 mb-2">Quick Links</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/customer" className="px-4 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200">
            Customer View
          </Link>
          <Link to="/restaurant" className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200">
            Restaurant View
          </Link>
          <Link to="/driver" className="px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200">
            Driver View
          </Link>
        </div>
      </div>

      {/* Orders Table */}
      <div>
        <h2 className="font-semibold text-gray-700 mb-2">All Orders</h2>
        {loadingOrders ? (
          <p className="text-gray-400 text-sm">Loading…</p>
        ) : sortedOrders.length === 0 ? (
          <p className="text-gray-400 text-sm">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {sortedOrders.map((o, i) => (
                  <tr key={o.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{o.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{o.customerId.slice(0, 8)}…</td>
                    <td className="px-3 py-2"><OrderStatusBadge status={o.status} /></td>
                    <td className="px-3 py-2 text-right font-medium">${o.totalAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{new Date(o.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drivers Table */}
      <div>
        <h2 className="font-semibold text-gray-700 mb-2">Drivers</h2>
        {loadingDrivers ? (
          <p className="text-gray-400 text-sm">Loading…</p>
        ) : drivers.length === 0 ? (
          <p className="text-gray-400 text-sm">No drivers registered.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Phone</th>
                  <th className="px-3 py-2 text-left">Vehicle</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Location</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d, i) => (
                  <tr key={d.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 font-medium">{d.name}</td>
                    <td className="px-3 py-2 text-gray-500">{d.phone}</td>
                    <td className="px-3 py-2 text-gray-500">{d.vehicleType}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${d.available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {d.available ? 'Available' : 'Unavailable'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {d.location ? `${d.location.latitude.toFixed(3)}, ${d.location.longitude.toFixed(3)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
      <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}
