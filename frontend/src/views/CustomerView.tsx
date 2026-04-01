import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, UtensilsCrossed, ClipboardList, Plus, Minus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getRestaurants, getMenuItems } from '../api/inventory';
import { getCustomerOrders, createOrder, updateStatus } from '../api/orders';
import MenuItemCard from '../components/MenuItemCard';
import OrderCard from '../components/OrderCard';
import type { MenuItem, Restaurant } from '../types';

interface CartItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface Cart {
  restaurantId: string;
  items: CartItem[];
}

type Tab = 'browse' | 'cart' | 'orders';

export default function CustomerView() {
  const { customerId } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('browse');
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [cart, setCart] = useState<Cart>({ restaurantId: '', items: [] });
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [orderError, setOrderError] = useState('');

  const { data: restaurants = [], isLoading: loadingRestaurants } = useQuery({
    queryKey: ['restaurants'],
    queryFn: getRestaurants,
  });

  const { data: menuItems = [], isLoading: loadingMenu } = useQuery({
    queryKey: ['menuItems', selectedRestaurant?.id],
    queryFn: () => getMenuItems(selectedRestaurant!.id),
    enabled: !!selectedRestaurant,
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['customerOrders', customerId],
    queryFn: () => getCustomerOrders(customerId!),
    enabled: !!customerId,
    refetchInterval: 10000,
  });

  const createOrderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      setCart({ restaurantId: '', items: [] });
      setDeliveryAddress('');
      setPaymentMethodId('');
      setTab('orders');
    },
    onError: () => setOrderError('Failed to place order. Please try again.'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => updateStatus(id, 'CANCELLED'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customerOrders'] }),
  });

  const addToCart = (item: MenuItem) => {
    if (cart.restaurantId && cart.restaurantId !== String(item.restaurantId)) {
      if (!confirm('Adding items from a different restaurant will clear your cart. Continue?')) return;
      setCart({ restaurantId: String(item.restaurantId), items: [] });
    }
    setCart((prev) => {
      const existing = prev.items.find((c) => c.menuItemId === String(item.id));
      if (existing) {
        return {
          ...prev,
          restaurantId: String(item.restaurantId),
          items: prev.items.map((c) =>
            c.menuItemId === String(item.id) ? { ...c, quantity: c.quantity + 1 } : c,
          ),
        };
      }
      return {
        restaurantId: String(item.restaurantId),
        items: [
          ...prev.items,
          { menuItemId: String(item.id), name: item.name, quantity: 1, unitPrice: item.price },
        ],
      };
    });
  };

  const changeQty = (menuItemId: string, delta: number) => {
    setCart((prev) => ({
      ...prev,
      items: prev.items
        .map((c) => (c.menuItemId === menuItemId ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0),
    }));
  };

  const cartTotal = cart.items.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0);

  const placeOrder = () => {
    setOrderError('');
    if (!deliveryAddress.trim()) { setOrderError('Delivery address is required.'); return; }
    if (!paymentMethodId.trim()) { setOrderError('Payment method ID is required.'); return; }
    if (cart.items.length === 0) { setOrderError('Cart is empty.'); return; }
    createOrderMutation.mutate({
      restaurantId: cart.restaurantId,
      items: cart.items.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
      deliveryAddress,
      paymentMethodId,
    });
  };

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      tab === t ? 'bg-white text-orange-600 border-b-2 border-orange-500' : 'text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Customer Portal</h1>
      <div className="flex gap-1 mb-0 border-b border-gray-200">
        <button className={tabClass('browse')} onClick={() => setTab('browse')}>
          <span className="flex items-center gap-1"><UtensilsCrossed size={15} /> Browse</span>
        </button>
        <button className={tabClass('cart')} onClick={() => setTab('cart')}>
          <span className="flex items-center gap-1">
            <ShoppingCart size={15} /> Cart {cart.items.length > 0 && `(${cart.items.length})`}
          </span>
        </button>
        <button className={tabClass('orders')} onClick={() => setTab('orders')}>
          <span className="flex items-center gap-1"><ClipboardList size={15} /> My Orders</span>
        </button>
      </div>

      <div className="bg-white rounded-b-xl rounded-tr-xl shadow p-5">
        {/* Browse Tab */}
        {tab === 'browse' && (
          <div className="space-y-4">
            {loadingRestaurants ? (
              <p className="text-gray-400 text-sm">Loading restaurants…</p>
            ) : restaurants.length === 0 ? (
              <p className="text-gray-400 text-sm">No restaurants available.</p>
            ) : (
              restaurants.map((r) => (
                <div key={r.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 text-left"
                    onClick={() => setSelectedRestaurant(selectedRestaurant?.id === r.id ? null : r)}
                  >
                    <div>
                      <p className="font-semibold text-gray-800">{r.name}</p>
                      <p className="text-xs text-gray-500">{r.cuisineType} · ⭐ {r.rating}</p>
                    </div>
                    <span className="text-gray-400">{selectedRestaurant?.id === r.id ? '▲' : '▼'}</span>
                  </button>
                  {selectedRestaurant?.id === r.id && (
                    <div className="p-3 space-y-2">
                      {loadingMenu ? (
                        <p className="text-gray-400 text-sm">Loading menu…</p>
                      ) : menuItems.length === 0 ? (
                        <p className="text-gray-400 text-sm">No menu items.</p>
                      ) : (
                        menuItems.map((item) => (
                          <MenuItemCard key={item.id} item={item} onAdd={addToCart} />
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Cart Tab */}
        {tab === 'cart' && (
          <div className="space-y-4">
            {cart.items.length === 0 ? (
              <p className="text-gray-400 text-sm">Your cart is empty. Browse restaurants to add items.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {cart.items.map((c) => (
                    <div key={c.menuItemId} className="flex items-center justify-between border border-gray-100 rounded-lg p-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{c.name}</p>
                        <p className="text-xs text-gray-500">${c.unitPrice.toFixed(2)} each</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => changeQty(c.menuItemId, -1)} className="p-1 bg-gray-100 hover:bg-gray-200 rounded">
                          <Minus size={12} />
                        </button>
                        <span className="text-sm font-semibold w-4 text-center">{c.quantity}</span>
                        <button onClick={() => changeQty(c.menuItemId, 1)} className="p-1 bg-gray-100 hover:bg-gray-200 rounded">
                          <Plus size={12} />
                        </button>
                        <button onClick={() => setCart((p) => ({ ...p, items: p.items.filter((i) => i.menuItemId !== c.menuItemId) }))} className="p-1 text-red-400 hover:text-red-600">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 text-right font-semibold text-gray-800">
                  Total: ${cartTotal.toFixed(2)}
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Delivery address"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <input
                    type="text"
                    placeholder="Payment Method ID (e.g. pm_card_visa)"
                    value={paymentMethodId}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  {orderError && <p className="text-red-600 text-sm">{orderError}</p>}
                  <button
                    onClick={placeOrder}
                    disabled={createOrderMutation.isPending}
                    className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-medium py-2 rounded-lg transition-colors"
                  >
                    {createOrderMutation.isPending ? 'Placing order…' : 'Place Order'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Orders Tab */}
        {tab === 'orders' && (
          <div className="space-y-3">
            {loadingOrders ? (
              <p className="text-gray-400 text-sm">Loading orders…</p>
            ) : orders.length === 0 ? (
              <p className="text-gray-400 text-sm">No orders yet. Place your first order!</p>
            ) : (
              orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onCancel={(id) => cancelMutation.mutate(id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
