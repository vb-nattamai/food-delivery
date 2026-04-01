import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllOrders, updateStatus } from '../api/orders';
import { getRestaurants, getMenuItems, createMenuItem, updateMenuItemStock } from '../api/inventory';
import OrderStatusBadge from '../components/OrderStatusBadge';
import type { OrderStatus, MenuItem } from '../types';

type Tab = 'orders' | 'menu';

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY_FOR_PICKUP',
  READY_FOR_PICKUP: 'IN_TRANSIT',
  IN_TRANSIT: 'DELIVERED',
};

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  PENDING: 'Accept',
  ACCEPTED: 'Start Preparing',
  PREPARING: 'Mark Ready',
  READY_FOR_PICKUP: 'Picked Up',
  IN_TRANSIT: 'Mark Delivered',
};

export default function RestaurantView() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('orders');
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<number | null>(null);
  const [stockUpdates, setStockUpdates] = useState<Record<number, string>>({});
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({
    name: '', description: '', price: 0, stockQuantity: 0, isAvailable: true,
  });
  const [menuError, setMenuError] = useState('');

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['allOrders'],
    queryFn: getAllOrders,
    refetchInterval: 15000,
  });

  const { data: restaurants = [], isLoading: loadingRestaurants } = useQuery({
    queryKey: ['restaurants'],
    queryFn: getRestaurants,
  });

  const { data: menuItems = [], isLoading: loadingMenu } = useQuery({
    queryKey: ['menuItems', selectedRestaurantId],
    queryFn: () => getMenuItems(selectedRestaurantId!),
    enabled: !!selectedRestaurantId,
  });

  const advanceStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => updateStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['allOrders'] }),
  });

  const createMenuItemMutation = useMutation({
    mutationFn: createMenuItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems', selectedRestaurantId] });
      setNewItem({ name: '', description: '', price: 0, stockQuantity: 0, isAvailable: true });
    },
    onError: () => setMenuError('Failed to create menu item.'),
  });

  const updateStockMutation = useMutation({
    mutationFn: ({ id, qty }: { id: number; qty: number }) => updateMenuItemStock(id, qty),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menuItems', selectedRestaurantId] }),
  });

  const grouped = orders.reduce<Partial<Record<OrderStatus, typeof orders>>>((acc, o) => {
    if (!acc[o.status]) acc[o.status] = [];
    acc[o.status]!.push(o);
    return acc;
  }, {});

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      tab === t ? 'bg-white text-orange-600 border-b-2 border-orange-500' : 'text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Restaurant Portal</h1>
      <div className="flex gap-1 mb-0 border-b border-gray-200">
        <button className={tabClass('orders')} onClick={() => setTab('orders')}>Orders</button>
        <button className={tabClass('menu')} onClick={() => setTab('menu')}>Menu Management</button>
      </div>

      <div className="bg-white rounded-b-xl rounded-tr-xl shadow p-5">
        {/* Orders Tab */}
        {tab === 'orders' && (
          <div className="space-y-6">
            {loadingOrders ? (
              <p className="text-gray-400 text-sm">Loading orders…</p>
            ) : orders.length === 0 ? (
              <p className="text-gray-400 text-sm">No orders yet.</p>
            ) : (
              (Object.keys(NEXT_STATUS) as OrderStatus[]).concat(['DELIVERED', 'CANCELLED', 'REFUNDED'] as OrderStatus[]).map((status) => {
                const group = grouped[status];
                if (!group || group.length === 0) return null;
                return (
                  <div key={status}>
                    <h2 className="text-sm font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                      <OrderStatusBadge status={status} />
                      <span>({group.length})</span>
                    </h2>
                    <div className="space-y-2">
                      {group.map((order) => (
                        <div key={order.id} className="border border-gray-200 rounded-lg p-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="space-y-0.5">
                              <p className="text-xs font-mono text-gray-500">#{order.id.slice(0, 8)}</p>
                              <p className="text-xs text-gray-500">Customer: {order.customerId.slice(0, 8)}…</p>
                              <p className="text-xs text-gray-400">
                                {order.items.map((i) => `${i.name}×${i.quantity}`).join(', ')}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">${order.totalAmount.toFixed(2)}</span>
                              {NEXT_STATUS[order.status] && (
                                <button
                                  onClick={() =>
                                    advanceStatusMutation.mutate({
                                      id: order.id,
                                      status: NEXT_STATUS[order.status]!,
                                    })
                                  }
                                  disabled={advanceStatusMutation.isPending}
                                  className="px-3 py-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-xs rounded-lg transition-colors"
                                >
                                  {NEXT_LABEL[order.status]}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Menu Management Tab */}
        {tab === 'menu' && (
          <div className="space-y-5">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Select Restaurant</label>
              {loadingRestaurants ? (
                <p className="text-gray-400 text-sm">Loading…</p>
              ) : (
                <select
                  value={selectedRestaurantId ?? ''}
                  onChange={(e) => setSelectedRestaurantId(Number(e.target.value) || null)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">— choose —</option>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              )}
            </div>

            {selectedRestaurantId && (
              <>
                {/* Menu Items List */}
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">Menu Items</h3>
                  {loadingMenu ? (
                    <p className="text-gray-400 text-sm">Loading…</p>
                  ) : menuItems.length === 0 ? (
                    <p className="text-gray-400 text-sm">No items yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {menuItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between border border-gray-100 rounded-lg p-3">
                          <div>
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="text-xs text-gray-500">
                              ${item.price.toFixed(2)} · Stock:{' '}
                              {item.stockQuantity === -1 ? '∞' : item.stockQuantity}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              placeholder="qty"
                              value={stockUpdates[item.id] ?? ''}
                              onChange={(e) =>
                                setStockUpdates((p) => ({ ...p, [item.id]: e.target.value }))
                              }
                              className="w-20 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                            />
                            <button
                              onClick={() => {
                                const qty = parseInt(stockUpdates[item.id] ?? '');
                                if (!isNaN(qty)) updateStockMutation.mutate({ id: item.id, qty });
                              }}
                              className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded"
                            >
                              Update
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add New Item Form */}
                <div className="border border-dashed border-gray-300 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-700 mb-3">Add New Menu Item</h3>
                  {menuError && <p className="text-red-600 text-sm mb-2">{menuError}</p>}
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Name"
                      value={newItem.name}
                      onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm col-span-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                    <input
                      type="text"
                      placeholder="Description"
                      value={newItem.description}
                      onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm col-span-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                    <input
                      type="number"
                      placeholder="Price"
                      value={newItem.price}
                      onChange={(e) => setNewItem((p) => ({ ...p, price: parseFloat(e.target.value) || 0 }))}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none"
                    />
                    <input
                      type="number"
                      placeholder="Stock (-1 = unlimited)"
                      value={newItem.stockQuantity}
                      onChange={(e) => setNewItem((p) => ({ ...p, stockQuantity: parseInt(e.target.value) || 0 }))}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() =>
                      createMenuItemMutation.mutate({
                        ...newItem,
                        restaurantId: selectedRestaurantId,
                      })
                    }
                    disabled={createMenuItemMutation.isPending}
                    className="mt-3 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm rounded-lg"
                  >
                    {createMenuItemMutation.isPending ? 'Adding…' : 'Add Item'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
