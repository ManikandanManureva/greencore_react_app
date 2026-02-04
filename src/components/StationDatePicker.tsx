import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal } from 'react-native';
import { Calendar } from 'lucide-react-native';
import DatePicker from 'react-native-date-picker';
import InlineDatePicker from './InlineDatePicker';

interface StationDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  maximumDate?: Date;
  minimumDate?: Date;
}

const StationDatePicker: React.FC<StationDatePickerProps> = ({
  value,
  onChange,
  maximumDate,
  minimumDate
}) => {
  const [open, setOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(() => new Date(value.getTime()));

  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const toDateOnly = (d: Date): Date => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
  };

  const openPicker = () => {
    setPickerDate(toDateOnly(value));
    setOpen(true);
  };

  const handleConfirm = (date: Date) => {
    const dateOnly = toDateOnly(date);
    onChange(dateOnly);
    setOpen(false);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.webInputWrapper}>
          <Calendar size={18} color="#64748b" />
          <input
            type="date"
            value={formatDate(value)}
            max={maximumDate ? formatDate(maximumDate) : undefined}
            min={minimumDate ? formatDate(minimumDate) : undefined}
            onChange={(e) => {
              if (e.target.value) {
                const dateValue = new Date(e.target.value + 'T00:00:00');
                onChange(dateValue);
              }
            }}
            style={{
              flex: 1,
              padding: '10px 12px',
              fontSize: '15px',
              border: 'none',
              outline: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
              color: '#1e293b',
              fontWeight: '500',
              minHeight: '44px',
              height: '44px',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              const wrapper = e.currentTarget.parentElement;
              if (wrapper) (wrapper as HTMLElement).style.borderColor = '#17a34a';
            }}
            onBlur={(e) => {
              const wrapper = e.currentTarget.parentElement;
              if (wrapper) (wrapper as HTMLElement).style.borderColor = '#e2e8f0';
            }}
          />
        </View>
      </View>
    );
  }

  if (Platform.OS === 'android') {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.dateButton} onPress={openPicker} activeOpacity={0.7}>
          <Calendar size={18} color="#64748b" />
          <Text style={styles.dateButtonText}>{formatDate(value)}</Text>
        </TouchableOpacity>
        <DatePicker
          modal
          open={open}
          date={pickerDate}
          mode="date"
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      </View>
    );
  }

  // iOS: Modal + InlineDatePicker (no react-native-date-picker)
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.dateButton} onPress={openPicker} activeOpacity={0.7}>
        <Calendar size={18} color="#64748b" />
        <Text style={styles.dateButtonText}>{formatDate(value)}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={handleCancel}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={handleCancel}>
                <Text style={styles.cancelButton}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Select Date</Text>
              <TouchableOpacity onPress={() => handleConfirm(pickerDate)}>
                <Text style={styles.doneButton}>Done</Text>
              </TouchableOpacity>
            </View>
            <InlineDatePicker
              value={pickerDate}
              onChange={setPickerDate}
              maximumDate={maximumDate}
              minimumDate={minimumDate}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%' },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    gap: 8,
  },
  dateButtonText: {
    fontSize: 15,
    color: '#1e293b',
    fontWeight: '500',
    flex: 1,
  },
  webInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 0,
    minHeight: 44,
    ...(Platform.OS === 'web' && { display: 'flex', gap: '8px' }),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  cancelButton: { fontSize: 16, color: '#64748b', fontWeight: '500' },
  doneButton: { fontSize: 16, color: '#17a34a', fontWeight: '700' },
});

export default StationDatePicker;
