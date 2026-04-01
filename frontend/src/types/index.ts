export type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface OrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  customerId: string;
  restaurantId: string;
  items: OrderItem[];
  status: OrderStatus;
  totalAmount: number;
  stripePaymentIntentId?: string;
  deliveryAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderRequest {
  restaurantId: string;
  items: Array<{ menuItemId: string; quantity: number }>;
  deliveryAddress: string;
  paymentMethodId: string;
}

export interface Restaurant {
  id: number;
  name: string;
  address: string;
  cuisineType: string;
  rating: number;
  isAvailable: boolean;
}

export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price: number;
  stockQuantity: number;
  isAvailable: boolean;
  restaurantId: number;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  vehicleType: string;
  available: boolean;
  location?: { latitude: number; longitude: number };
}
