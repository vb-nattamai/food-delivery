import { apiClient } from './client';
import type { Driver } from '../types';

export const getDrivers = async (): Promise<Driver[]> => {
  const { data } = await apiClient.get<Driver[]>('/drivers');
  return data;
};

export const getDriver = async (id: string): Promise<Driver> => {
  const { data } = await apiClient.get<Driver>(`/drivers/${id}`);
  return data;
};

export const createDriver = async (d: Partial<Driver>): Promise<Driver> => {
  const { data } = await apiClient.post<Driver>('/drivers', d);
  return data;
};

export const updateLocation = async (id: string, lat: number, lng: number): Promise<Driver> => {
  const { data } = await apiClient.patch<Driver>(`/drivers/${id}/location`, {
    latitude: lat,
    longitude: lng,
  });
  return data;
};

export const updateAvailability = async (id: string, available: boolean): Promise<Driver> => {
  const { data } = await apiClient.patch<Driver>(`/drivers/${id}/availability`, { available });
  return data;
};
