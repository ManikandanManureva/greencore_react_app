import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye, EyeOff } from 'lucide-react-native';
import { useAuth } from '../navigation/AuthContext';
import { t, i18n, Language } from '../utils/i18n';
import LanguageSwitcher from '../components/LanguageSwitcher';

const LoginScreen = () => {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState<Language>(i18n.getLanguage());
  const { login } = useAuth();

  // Subscribe to language changes to force re-render
  useEffect(() => {
    const unsubscribe = i18n.onLanguageChange((language) => {
      setCurrentLanguage(language);
    });
    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    if (!employeeId || !password) {
      Alert.alert(t('common.error'), t('login.errorEmpty'));
      return;
    }

    setLoading(true);
    try {
      await login(employeeId, password);
    } catch (error: any) {
      Alert.alert(t('login.errorFailed'), error.message || t('login.errorMessage'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.loginCard}>
          {/* Language Switcher */}
          <View style={styles.languageSwitcher}>
            <Text style={styles.languageLabel}>{t('login.selectLanguage')}</Text>
            <LanguageSwitcher />
          </View>

          <View style={styles.logoContainer}>
            <View style={styles.logoIcon}>
              <Image
                source={require('../../assets/icon/logo.jpg')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
          </View>

          <Text style={styles.appTitle}>{t('login.title')}</Text>
          <Text style={styles.appSubtitle}>{t('login.subtitle')}</Text>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('login.employeeId')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('login.employeeIdPlaceholder')}
                value={employeeId}
                onChangeText={setEmployeeId}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('login.password')}</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  style={[styles.input, { paddingRight: 45 }]}
                  placeholder={t('login.passwordPlaceholder')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  style={styles.eyeIcon}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff size={20} color="#666" />
                  ) : (
                    <Eye size={20} color="#666" />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.loginButton}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.loginButtonText}>{t('login.loginButton')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#232938',
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  loginCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 5,
  },
  languageSwitcher: {
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    alignItems: 'center',
  },
  languageLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    textAlign: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoIcon: {
    width: 72,
    height: 72,
    backgroundColor: '#17a34a',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#17a34a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
    marginBottom: 6,
  },
  appSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  form: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#FFF',
  },
  eyeIcon: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  loginButton: {
    backgroundColor: '#17a34a',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#17a34a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default LoginScreen;
