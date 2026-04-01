import { apiClient } from './client';
import type { Order, CreateOrderRequest, OrderStatus } from '../types';

export const getOrder = async (id: string): Promise<Order> => {
  const { data } = await apiClient.get<Order>(`/orders/${id}`);
  return data;
};

export const getCustomerOrders = async (customerId: string): Promise<Order[]> => {
  const { data } = await apiClient.get<Order[]>(`/orders/customer/${customerId}`);
  return data;
};

export const getAllOrders = async (): Promise<Order[]> => {
  const { data } = await apiClient.get<Order[]>('/orders');
  return data;
};

export const createOrder = async (req: CreateOrderRequest): Promise<Order> => {
  const { data } = await apiClient.post<Order>('/orders', req);
  return data;
};

export const updateStatus = async (id: string, status: OrderStatus): Promise<Order> => {
  const { data } = await apiClient.patch<Order>(`/orders/${id}/status`, { status });
  return data;
};
