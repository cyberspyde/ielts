import axios from 'axios';
import type { AxiosInstance, AxiosResponse } from 'axios';
import { toast } from 'react-toastify';

// Types
import type { ApiResponse } from '../types';

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:7000/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error) => {
    const { response } = error;
    
    if (response) {
      const { status, data } = response;
      
      switch (status) {
        case 401:
          // Unauthorized - clear token and redirect to login
          // Attempt one-time refresh
          const tried = (error.config as any)._retry;
          if (!tried) {
            (error.config as any)._retry = true;
            const refreshToken = localStorage.getItem('refreshToken');
            if (refreshToken) {
              return api.post('/auth/refresh', { refreshToken })
                .then((res) => {
                  const tokens = (res.data?.data?.tokens) || (res.data?.data) || res.data;
                  const newAccess = tokens?.accessToken || tokens?.access || tokens?.token;
                  const newRefresh = tokens?.refreshToken || tokens?.refresh;
                  if (newAccess) {
                    localStorage.setItem('token', newAccess);
                    if (newRefresh) localStorage.setItem('refreshToken', newRefresh);
                    error.config.headers.Authorization = `Bearer ${newAccess}`;
                    return api.request(error.config);
                  }
                  throw new Error('Refresh failed');
                })
                .catch(() => {
                  localStorage.removeItem('token');
                  localStorage.removeItem('refreshToken');
                  localStorage.removeItem('user');
                  window.location.href = '/login';
                  toast.error('Session expired. Please login again.');
                });
            }
          }
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/login';
          toast.error('Session expired. Please login again.');
          break;
          
        case 403:
          toast.error('Access denied. You do not have permission to perform this action.');
          break;
          
        case 404:
          toast.error('Resource not found.');
          break;
          
        case 422:
          // Validation errors
          const details = (data?.details || data?.errors);
          if (details) {
            const values = Array.isArray(details) ? details : Object.values(details);
            values.forEach((err: any) => toast.error(String(err)));
          } else toast.error(data?.message || 'Validation failed.');
          break;
        case 409:
          toast.error(data?.message || 'Conflict: resource already exists or overlaps.');
          break;
          
        case 500:
          toast.error('Server error. Please try again later.');
          break;
          
        default:
          toast.error(data?.message || 'An error occurred.');
      }
    } else {
      // Network error
      toast.error('Network error. Please check your connection.');
    }
    
    return Promise.reject(error);
  }
);

// Generic API methods
export const apiService = {
  // GET request
  get: async <T>(url: string, params?: any): Promise<ApiResponse<T>> => {
    const response = await api.get(url, { params });
    return response.data;
  },

  // POST request
  post: async <T>(url: string, data?: any): Promise<ApiResponse<T>> => {
    const response = await api.post(url, data);
    return response.data;
  },

  // PUT request
  put: async <T>(url: string, data?: any): Promise<ApiResponse<T>> => {
    const response = await api.put(url, data);
    return response.data;
  },

  // PATCH request
  patch: async <T>(url: string, data?: any): Promise<ApiResponse<T>> => {
    const response = await api.patch(url, data);
    return response.data;
  },

  // DELETE request
  delete: async <T>(url: string): Promise<ApiResponse<T>> => {
    const response = await api.delete(url);
    return response.data;
  },

  // Upload file
  upload: async <T>(url: string, file: File, onProgress?: (progress: number) => void): Promise<ApiResponse<T>> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await api.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
    
    return response.data;
  },
};

export default api;
