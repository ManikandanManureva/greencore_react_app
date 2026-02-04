import AsyncStorage from '@react-native-async-storage/async-storage';
import idTranslations from '../locales/id.json';
import enTranslations from '../locales/en.json';

export type Language = 'id' | 'en';

type Translations = typeof idTranslations;

const LANGUAGE_STORAGE_KEY = 'app_language';

class I18n {
  private currentLanguage: Language = 'id'; // Default to Indonesian
  private translations: Record<Language, Translations> = {
    id: idTranslations,
    en: enTranslations,
  };
  private listeners: Array<(language: Language) => void> = [];

  async init(): Promise<void> {
    try {
      const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (savedLanguage === 'id' || savedLanguage === 'en') {
        this.currentLanguage = savedLanguage;
      }
    } catch (error) {
      console.warn('Failed to load saved language preference:', error);
    }
  }

  async setLanguage(language: Language): Promise<void> {
    this.currentLanguage = language;
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (error) {
      console.warn('Failed to save language preference:', error);
    }
    // Notify all listeners
    this.listeners.forEach(listener => listener(language));
  }

  getLanguage(): Language {
    return this.currentLanguage;
  }

  // Subscribe to language changes
  onLanguageChange(listener: (language: Language) => void): () => void {
    this.listeners.push(listener);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  t(key: string, params?: Record<string, string>): string {
    const keys = key.split('.');
    let value: any = this.translations[this.currentLanguage];

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        console.warn(`Translation key "${key}" not found for language "${this.currentLanguage}"`);
        return key;
      }
    }

    if (typeof value !== 'string') {
      console.warn(`Translation value for "${key}" is not a string`);
      return key;
    }

    // Replace parameters in the translation string
    if (params) {
      return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
        return params[paramKey] || match;
      });
    }

    return value;
  }
}

export const i18n = new I18n();

// Initialize i18n on module load
i18n.init();

// Helper function for easy access
export const t = (key: string, params?: Record<string, string>): string => {
  return i18n.t(key, params);
};
