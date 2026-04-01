import axios from 'axios';

export const apiClient = axios.create({ baseURL: 'http://localhost:8080' });

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('fd_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
