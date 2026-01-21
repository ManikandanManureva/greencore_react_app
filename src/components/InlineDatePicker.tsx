import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';

// Define consistent font family
const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: 'System',
});

interface InlineDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  maximumDate?: Date;
  minimumDate?: Date;
}

const InlineDatePicker: React.FC<InlineDatePickerProps> = ({
  value,
  onChange,
  maximumDate,
  minimumDate
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

  // Use a ref to track if we're updating from user interaction
  const isUserInteractionRef = React.useRef(false);
  
  useEffect(() => {
    // Only update local state if the change came from external source (not user interaction)
    if (!isUserInteractionRef.current) {
      const newYear = value.getFullYear();
      const newMonth = value.getMonth();
      const newDay = value.getDate();
      
      setSelectedYear(newYear);
      setSelectedMonth(newMonth);
      setSelectedDay(newDay);
    } else {
      // Reset the flag after processing
      isUserInteractionRef.current = false;
    }
  }, [value]);

  const handleYearChange = (year: number) => {
    isUserInteractionRef.current = true;
    // Calculate using current state values, then update state
    const daysInMonth = getDaysInMonth(year, selectedMonth);
    const finalDay = selectedDay > daysInMonth ? daysInMonth : selectedDay;
    
    // Create the new date immediately with the new year
    const newDate = new Date(year, selectedMonth, finalDay);
    
    // Update state
    setSelectedYear(year);
    if (selectedDay > daysInMonth) {
      setSelectedDay(finalDay);
    }
    
    // Call onChange with the new date
    if (newDate <= maxDate && newDate >= minDate) {
      onChange(newDate);
    }
  };

  const handleMonthChange = (month: number) => {
    isUserInteractionRef.current = true;
    // Calculate using current state values, then update state
    const daysInMonth = getDaysInMonth(selectedYear, month);
    const finalDay = selectedDay > daysInMonth ? daysInMonth : selectedDay;
    
    // Create the new date immediately with the new month
    const newDate = new Date(selectedYear, month, finalDay);
    
    // Update state
    setSelectedMonth(month);
    if (selectedDay > daysInMonth) {
      setSelectedDay(finalDay);
    }
    
    // Call onChange with the new date
    if (newDate <= maxDate && newDate >= minDate) {
      onChange(newDate);
    }
  };

  const handleDayChange = (day: number) => {
    isUserInteractionRef.current = true;
    // Create the new date immediately with the new day
    const newDate = new Date(selectedYear, selectedMonth, day);
    
    // Update state
    setSelectedDay(day);
    
    // Call onChange with the new date
    if (newDate <= maxDate && newDate >= minDate) {
      onChange(newDate);
    }
  };

  const renderPickerColumn = (
    items: number[],
    selectedValue: number,
    onSelect: (value: number) => void,
    displayMapper?: (value: number) => string
  ) => {
    const itemHeight = 44;

    return (
      <ScrollView
        style={styles.pickerColumn}
        contentContainerStyle={styles.pickerContent}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate="fast"
        nestedScrollEnabled={true}
        scrollEnabled={true}
        onMomentumScrollEnd={(e) => {
          const offsetY = e.nativeEvent.contentOffset.y;
          const index = Math.round(offsetY / itemHeight);
          const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
          const selectedItem = items[clampedIndex];
          if (selectedItem !== undefined && selectedItem !== selectedValue) {
            onSelect(selectedItem);
          }
        }}
        onScrollEndDrag={(e) => {
          const offsetY = e.nativeEvent.contentOffset.y;
          const index = Math.round(offsetY / itemHeight);
          const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
          const selectedItem = items[clampedIndex];
          if (selectedItem !== undefined && selectedItem !== selectedValue) {
            onSelect(selectedItem);
          }
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
    // Web: Use HTML5 date input inline
    return (
      <View style={styles.webContainer}>
        <input
          type="date"
          value={value.toISOString().split('T')[0]}
          max={maxDate.toISOString().split('T')[0]}
          min={minDate.toISOString().split('T')[0]}
          onChange={(e) => {
            if (e.target.value) {
              isUserInteractionRef.current = true;
              // Parse the date string properly
              const dateStr = e.target.value;
              const dateValue = new Date(dateStr + 'T00:00:00');
              // Verify the date is valid
              if (!isNaN(dateValue.getTime())) {
                onChange(dateValue);
              }
            }
          }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '15px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  outline: 'none',
                  backgroundColor: '#ffffff',
                  cursor: 'pointer',
                  fontFamily: Platform.OS === 'web' ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' : 'inherit',
                  color: '#1e293b',
                  fontWeight: '500',
                  minHeight: '44px',
                  height: '44px',
                  boxSizing: 'border-box',
                  lineHeight: '1.4'
                }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#17a34a';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#e2e8f0';
          }}
        />
      </View>
    );
  }

  // Mobile: Inline wheel picker
  return (
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
        {renderPickerColumn(days, selectedDay, handleDayChange)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  pickerWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    height: 200,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingVertical: 10,
    marginVertical: 10,
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
    fontFamily,
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
    fontFamily,
  },
  pickerItemTextSelected: {
    fontSize: 18,
    color: '#2563eb',
    fontWeight: '700',
    fontFamily,
  },
  webContainer: {
    width: '100%',
    paddingVertical: 0,
  },
});

export default InlineDatePicker;
