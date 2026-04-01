import type { Order } from '../types';
import OrderStatusBadge from './OrderStatusBadge';

interface OrderCardProps {
  order: Order;
  onCancel?: (id: string) => void;
}

export default function OrderCard({ order, onCancel }: OrderCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-gray-500">#{order.id.slice(0, 8)}</span>
        <OrderStatusBadge status={order.status} />
      </div>
      <div className="space-y-1 mb-3">
        {order.items.map((item, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-gray-700">
              {item.name} × {item.quantity}
            </span>
            <span className="text-gray-500">${(item.unitPrice * item.quantity).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-sm font-semibold text-gray-800">
          Total: ${order.totalAmount.toFixed(2)}
        </span>
        {onCancel && order.status === 'PENDING' && (
          <button
            onClick={() => onCancel(order.id)}
            className="text-xs text-red-600 hover:text-red-800 font-medium"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-1">
        {new Date(order.createdAt).toLocaleString()}
      </p>
    </div>
  );
}
