import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Get the host machine IP dynamically for physical devices during development
const getBaseUrl = () => {
  // Production API server
  const API_HOST = '13.214.29.7';
  //const API_PORT = '5000';

  // For all platforms, use the production API
  // The server expects /api/api as the base path (e.g., /api/api/auth/login)
  return `http://${API_HOST}/api/api`;
};

const API_URL = getBaseUrl();

console.log('Connecting to API at:', API_URL);

const client = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default client;
