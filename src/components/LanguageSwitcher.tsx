import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Platform,
} from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';
import { i18n, Language, t } from '../utils/i18n';

interface LanguageOption {
  code: Language;
  label: string;
}

const languages: LanguageOption[] = [
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'en', label: 'English' },
];

const LanguageSwitcher: React.FC = () => {
  const [currentLanguage, setCurrentLanguage] = useState<Language>(i18n.getLanguage());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = i18n.onLanguageChange((language) => {
      setCurrentLanguage(language);
    });
    return unsubscribe;
  }, []);

  const handleLanguageSelect = async (language: Language) => {
    await i18n.setLanguage(language);
    setIsDropdownOpen(false);
  };

  const currentLanguageLabel = languages.find(lang => lang.code === currentLanguage)?.label || 'Bahasa Indonesia';

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.dropdownButton}
        onPress={() => setIsDropdownOpen(true)}
      >
        <Text style={styles.dropdownButtonText}>{currentLanguageLabel}</Text>
        <ChevronDown size={16} color="#666" />
      </TouchableOpacity>

      <Modal
        visible={isDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsDropdownOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsDropdownOpen(false)}
        >
          <View style={styles.dropdownMenu}>
            {languages.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.dropdownItem,
                  currentLanguage === lang.code && styles.dropdownItemActive
                ]}
                onPress={() => handleLanguageSelect(lang.code)}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    currentLanguage === lang.code && styles.dropdownItemTextActive
                  ]}
                >
                  {lang.label}
                </Text>
                {currentLanguage === lang.code && (
                  <Check size={16} color="#17a34a" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFF',
    minWidth: 150,
  },
  dropdownButtonText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
    marginRight: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownMenu: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  dropdownItemActive: {
    backgroundColor: '#F0FDF4',
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  dropdownItemTextActive: {
    color: '#17a34a',
    fontWeight: '600',
  },
});

export default LanguageSwitcher;
