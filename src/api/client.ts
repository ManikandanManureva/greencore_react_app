import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// On device/emulator, "localhost" is the phone — use your Mac's IP so the app hits your local API.
// Set EXPO_PUBLIC_API_HOST in .env to override. Web always uses localhost.
const getApiHost = (): string => {
  const envHost = (process.env.EXPO_PUBLIC_API_HOST as string | undefined)?.trim();
  if (envHost) return envHost.replace(/^https?:\/\//, '');

  if (Platform.OS === 'web') return 'localhost:3000';
  return '54.169.140.182:3000';
};
//const API_HOST = getApiHost();
const API_HOST = '54.169.140.182:3000';
const API_URL = `http://${API_HOST}`;
// Local server (localhost or LAN IP) uses /api/auth, /api/production; EC2 uses /auth, /production.
const isLocalServer = /^(localhost|127\.0\.0\.1|192\.168\.|172\.16\.|10\.0\.)/.test(API_HOST);
const API_PREFIX = isLocalServer ? '/api' : '';

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
