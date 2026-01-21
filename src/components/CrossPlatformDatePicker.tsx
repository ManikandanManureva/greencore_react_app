import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform, ScrollView } from 'react-native';

interface CrossPlatformDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  maximumDate?: Date;
  minimumDate?: Date;
  visible: boolean;
  onClose: () => void;
}

const CrossPlatformDatePicker: React.FC<CrossPlatformDatePickerProps> = ({
  value,
  onChange,
  maximumDate,
  minimumDate,
  visible,
  onClose
}) => {
  const [selectedYear, setSelectedYear] = useState(value.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(value.getMonth());
  const [selectedDay, setSelectedDay] = useState(value.getDate());

  const maxDate = maximumDate || new Date();
  const minDate = minimumDate || new Date(2000, 0, 1);

  const currentYear = maxDate.getFullYear();
  const years = Array.from({ length: currentYear - minDate.getFullYear() + 1 }, (_, i) => currentYear - i);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const days = Array.from({ length: getDaysInMonth(selectedYear, selectedMonth) }, (_, i) => i + 1);

  useEffect(() => {
    if (visible) {
      setSelectedYear(value.getFullYear());
      setSelectedMonth(value.getMonth());
      setSelectedDay(value.getDate());
    }
  }, [visible, value]);

  useEffect(() => {
    const newDate = new Date(selectedYear, selectedMonth, selectedDay);
    if (newDate <= maxDate && newDate >= minDate) {
      // Don't auto-update, wait for user confirmation
    }
  }, [selectedYear, selectedMonth, selectedDay]);

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    const daysInMonth = getDaysInMonth(year, selectedMonth);
    if (selectedDay > daysInMonth) {
      setSelectedDay(daysInMonth);
    }
  };

  const handleMonthChange = (month: number) => {
    setSelectedMonth(month);
    const daysInMonth = getDaysInMonth(selectedYear, month);
    if (selectedDay > daysInMonth) {
      setSelectedDay(daysInMonth);
    }
  };

  const handleApply = () => {
    const newDate = new Date(selectedYear, selectedMonth, selectedDay);
    if (newDate <= maxDate && newDate >= minDate) {
      onChange(newDate);
      onClose();
    }
  };

  const renderPickerColumn = (
    items: number[],
    selectedValue: number,
    onSelect: (value: number) => void,
    displayMapper?: (value: number) => string
  ) => {
    const itemHeight = 44;
    const selectedIndex = items.findIndex(item => item === selectedValue);

    return (
      <ScrollView
        style={styles.pickerColumn}
        contentContainerStyle={styles.pickerContent}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => {
          const offsetY = e.nativeEvent.contentOffset.y;
          const index = Math.round(offsetY / itemHeight);
          const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
          onSelect(items[clampedIndex]);
        }}
      >
        <View style={{ height: itemHeight * 2 }} />
        {items.map((item, index) => {
          const isSelected = item === selectedValue;
          const displayText = displayMapper ? displayMapper(item) : String(item);
          
          return (
            <TouchableOpacity
              key={index}
              style={[
                styles.pickerItem,
                { height: itemHeight },
                isSelected && styles.pickerItemSelected
              ]}
              onPress={() => onSelect(item)}
            >
              <Text style={[styles.pickerItemText, isSelected && styles.pickerItemTextSelected]}>
                {displayText}
              </Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ height: itemHeight * 2 }} />
      </ScrollView>
    );
  };

  if (Platform.OS === 'web') {
    // Web: Use HTML5 date input with proper styling
    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Date</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.webDateInputContainer}>
              <input
                type="date"
                value={value.toISOString().split('T')[0]}
                max={maxDate.toISOString().split('T')[0]}
                min={minDate.toISOString().split('T')[0]}
                onChange={(e) => {
                  if (e.target.value) {
                    const dateValue = new Date(e.target.value + 'T00:00:00');
                    onChange(dateValue);
                    onClose();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value) {
                    const dateValue = new Date(e.currentTarget.value + 'T00:00:00');
                    onChange(dateValue);
                    onClose();
                  }
                }}
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: '16px',
                  border: '2px solid #e2e8f0',
                  borderRadius: '12px',
                  outline: 'none',
                  backgroundColor: '#ffffff',
                  cursor: 'pointer',
                  fontFamily: 'inherit'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#17a34a';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e2e8f0';
                }}
              />
            </View>
            <TouchableOpacity style={styles.applyButton} onPress={onClose}>
              <Text style={styles.applyButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // Mobile: Custom wheel picker
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Date</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.pickerWrapper}>
            {/* Year Picker */}
            <View style={styles.column}>
              <Text style={styles.columnLabel}>Year</Text>
              {renderPickerColumn(years, selectedYear, handleYearChange)}
            </View>

            {/* Month Picker */}
            <View style={styles.column}>
              <Text style={styles.columnLabel}>Month</Text>
              {renderPickerColumn(
                months.map((_, i) => i),
                selectedMonth,
                handleMonthChange,
                (monthIndex) => months[monthIndex].substring(0, 3)
              )}
            </View>

            {/* Day Picker */}
            <View style={styles.column}>
              <Text style={styles.columnLabel}>Day</Text>
              {renderPickerColumn(days, selectedDay, setSelectedDay)}
            </View>
          </View>
          <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
            <Text style={styles.applyButtonText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
  },
  closeButton: {
    fontSize: 24,
    color: '#64748b',
    fontWeight: '300',
  },
  pickerWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    height: 250,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingVertical: 10,
    marginBottom: 20,
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  columnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  pickerColumn: {
    flex: 1,
    width: '100%',
  },
  pickerContent: {
    alignItems: 'center',
  },
  pickerItem: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  pickerItemSelected: {
    backgroundColor: '#EBF5FF',
    borderRadius: 8,
  },
  pickerItemText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '500',
  },
  pickerItemTextSelected: {
    fontSize: 18,
    color: '#2563eb',
    fontWeight: '700',
  },
  applyButton: {
    backgroundColor: '#17a34a',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  webDateInputContainer: {
    padding: 20,
    alignItems: 'center',
  },
});

export default CrossPlatformDatePicker;
