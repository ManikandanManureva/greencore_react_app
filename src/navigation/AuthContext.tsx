import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../api/client';

interface User {
  id: number;
  employeeId: string;
  name: string;
  email: string;
  role: string;
  materialTypeId?: number;
  lastLoginAt?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (employeeId: string, password: string) => Promise<any>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  selectedShift: any;
  setSelectedShift: (shift: any) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedShift, setSelectedShiftState] = useState<any>(null);

  useEffect(() => {
    loadStoredData();
  }, []);

  const loadStoredData = async () => {
    try {
      const storedUser = await AsyncStorage.getItem('current_user');
      const token = await AsyncStorage.getItem('auth_token');
      const storedShift = await AsyncStorage.getItem('selected_shift');
      
      if (storedUser && token) {
        setUser(JSON.parse(storedUser));
        if (storedShift) setSelectedShiftState(JSON.parse(storedShift));
        // Verify token with API
        try {
          const response = await client.get('/auth/verify');
          if (response.data.success && response.data.user) {
            setUser(response.data.user);
            await AsyncStorage.setItem('current_user', JSON.stringify(response.data.user));
          } else {
            await logout();
          }
        } catch (error) {
          console.error('Token verification failed:', error);
        }
      }
    } catch (e) {
      console.error('Failed to load auth data:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const setSelectedShift = async (shift: any) => {
    setSelectedShiftState(shift);
    if (shift) {
      await AsyncStorage.setItem('selected_shift', JSON.stringify(shift));
    } else {
      await AsyncStorage.removeItem('selected_shift');
    }
  };

  const login = async (employeeId: string, password: string) => {
    try {
      console.log('Attempting login for employeeId:', employeeId);
      const response = await client.post('/auth/login', { employeeId, password });
      const { success, token, user: userData, refreshToken } = response.data;

      if (success && token && userData) {
        await AsyncStorage.setItem('auth_token', token);
        await AsyncStorage.setItem('current_user', JSON.stringify(userData));
        if (refreshToken) {
          await AsyncStorage.setItem('refresh_token', refreshToken);
        }
        
        setUser(userData);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Login failed');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      // Extract error message from response if available
      const errorMessage = error.response?.data?.message || error.message || 'Login failed. Please check your credentials.';
      throw new Error(errorMessage);
    }
  };

  const logout = async () => {
    try {
      const refreshToken = await AsyncStorage.getItem('refresh_token');
      if (refreshToken) {
        await client.post('/auth/logout', { refreshToken }).catch(() => {});
      }
    } finally {
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('refresh_token');
      await AsyncStorage.removeItem('current_user');
      await AsyncStorage.removeItem('selected_shift');
      setUser(null);
      setSelectedShiftState(null);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isLoading, 
      login, 
      logout, 
      isAuthenticated: !!user,
      selectedShift,
      setSelectedShift
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
