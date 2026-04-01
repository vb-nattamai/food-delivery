import { apiClient } from './client';
import type { Restaurant, MenuItem } from '../types';

export const getRestaurants = async (): Promise<Restaurant[]> => {
  const { data } = await apiClient.get<Restaurant[]>('/restaurants');
  return data;
};

export const getRestaurant = async (id: number): Promise<Restaurant> => {
  const { data } = await apiClient.get<Restaurant>(`/restaurants/${id}`);
  return data;
};

export const getMenuItems = async (restaurantId: number): Promise<MenuItem[]> => {
  const { data } = await apiClient.get<MenuItem[]>(`/restaurants/${restaurantId}/menu-items`);
  return data;
};

export const createMenuItem = async (item: Partial<MenuItem>): Promise<MenuItem> => {
  const { data } = await apiClient.post<MenuItem>('/menu-items', item);
  return data;
};

export const updateMenuItemStock = async (id: number, stockQuantity: number): Promise<MenuItem> => {
  const { data } = await apiClient.patch<MenuItem>(`/menu-items/${id}`, { stockQuantity });
  return data;
};
