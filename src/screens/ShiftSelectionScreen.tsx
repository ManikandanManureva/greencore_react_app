import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Clock } from 'lucide-react-native';
import { useAuth } from '../navigation/AuthContext';
import { masterDataApi, productionApi } from '../api/production';
import { Shift } from '../types';

const ShiftSelectionScreen = ({ navigation }: any) => {
  const { user, selectedShift, setSelectedShift } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initSelection();
  }, []);

  const initSelection = async () => {
    try {
      setIsLoading(true);
      const response = await masterDataApi.getShifts();
      if (response.data.success) {
        const fetchedShifts = response.data.data;
        setShifts(fetchedShifts);

        // CHECK DATABASE FOR ACTIVE SHIFT
        const activeResponse = await productionApi.getActiveShift();
        if (activeResponse.data.success && activeResponse.data.data) {
          const activeShiftSession = activeResponse.data.data;
          console.log('Active shift session found in database:', activeShiftSession);
          
          const shiftType = fetchedShifts.find((s: any) => s.id === activeShiftSession.shift_type_id);
          if (shiftType) {
            console.log('Auto-selecting shift type and redirecting to dashboard');
            setSelectedShift(shiftType);
            navigation.replace('Dashboard');
            return;
          }
        }
      }
    } catch (error) {
      console.error('Error initializing shift selection:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchShifts = async () => {
    // Replaced by initSelection
  };

  const handleContinue = () => {
    navigation.navigate('Dashboard');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Clock color="#FFF" size={36} />
          </View>
          <Text style={styles.title}>Select Your Shift</Text>
          <Text style={styles.subtitle}>Welcome, {user?.name}</Text>
          <Text style={styles.dateText}>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
        </View>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#17a34a" />
            <Text style={styles.loadingText}>Loading shifts...</Text>
          </View>
        ) : (
          <ScrollView style={styles.list}>
            {shifts.map((shift) => {
              const isSelected = selectedShift?.id === shift.id;
              const activeColor = '#22c55e';
              return (
                <TouchableOpacity
                  key={shift.id}
                  style={[
                    styles.card,
                    isSelected && { borderColor: activeColor, borderWidth: 2, backgroundColor: `${activeColor}10` }
                  ]}
                  onPress={() => setSelectedShift(shift)}
                >
                  <View style={styles.cardContent}>
                    <Text style={[styles.shiftName, isSelected && { color: '#17a34a' }]}>{shift.name}</Text>
                    <Text style={styles.shiftTime}>{shift.start_time} - {shift.end_time}</Text>
                  </View>
                  <View style={[
                    styles.checkbox,
                    { borderColor: isSelected ? activeColor : '#D1D5DB', backgroundColor: isSelected ? activeColor : '#FFF' }
                  ]}>
                    {isSelected && <Check color="#FFF" size={14} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.continueButton, !selectedShift && styles.disabledButton]}
            disabled={!selectedShift || isLoading}
            onPress={handleContinue}
          >
            <Text style={styles.continueText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#232938',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  headerIcon: {
    width: 60,
    height: 60,
    backgroundColor: '#17a34a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  dateText: {
    fontSize: 12,
    color: '#17a34a',
    fontWeight: '600',
    marginTop: 4,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
  },
  list: {
    flexShrink: 1,
    marginBottom: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  cardContent: {
    flex: 1,
  },
  shiftName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  shiftTime: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    marginTop: 16,
  },
  continueButton: {
    flex: 1,
    backgroundColor: '#17a34a',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#CCC',
  },
  continueText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ShiftSelectionScreen;
