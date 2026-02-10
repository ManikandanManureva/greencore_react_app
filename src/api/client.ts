import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Switch to '54.169.140.182:3000' for EC2 production API.
const API_HOST = '54.169.140.182:3000';
const API_URL = `http://${API_HOST}`;
// Local server (this repo) uses /api/auth, /api/production; EC2 uses /auth, /production.
const API_PREFIX = (API_HOST.startsWith('localhost') || API_HOST.startsWith('127.0.0.1')) ? '/api' : '';

console.log('Connecting to API at:', API_URL, 'prefix:', API_PREFIX || '(none)');

const client = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use(async (config) => {
  if (API_PREFIX && config.url?.startsWith('/')) {
    config.url = API_PREFIX + config.url;
  }
  const token = await AsyncStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default client;
