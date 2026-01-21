import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Get the host machine IP dynamically for physical devices during development
const getBaseUrl = () => {
  // Use your computer's local IP address so physical mobile devices can connect
  const LOCAL_IP = '172.16.0.52'; 

  if (Platform.OS === 'web') {
    return 'http://localhost:3000/api';
  }
  
  // Try to get dynamic host from Expo, fallback to LOCAL_IP
  const host = Constants.expoConfig?.hostUri?.split(':').shift() || LOCAL_IP;
  
  if (host) {
    return `http://${host}:3000/api`;
  }
  
  // Fallback for Android emulator
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000/api';
  }
  
  return `http://${LOCAL_IP}:3000/api`;
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
