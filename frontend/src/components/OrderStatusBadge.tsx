import type { OrderStatus } from '../types';

const statusConfig: Record<OrderStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'bg-gray-100 text-gray-700' },
  ACCEPTED: { label: 'Accepted', className: 'bg-blue-100 text-blue-700' },
  PREPARING: { label: 'Preparing', className: 'bg-yellow-100 text-yellow-700' },
  READY_FOR_PICKUP: { label: 'Ready for Pickup', className: 'bg-orange-100 text-orange-700' },
  IN_TRANSIT: { label: 'In Transit', className: 'bg-purple-100 text-purple-700' },
  DELIVERED: { label: 'Delivered', className: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700' },
  REFUNDED: { label: 'Refunded', className: 'bg-pink-100 text-pink-700' },
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const config = statusConfig[status];
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
