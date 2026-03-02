import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Clock, AlertCircle, Check, Lock, ShieldCheck, BarChart2 } from 'lucide-react-native';
import { useAuth } from '../navigation/AuthContext';
import { masterDataApi, productionApi } from '../api/production';
import { Shift } from '../types';

/** Return total minutes from midnight for a "HH:MM" string. */
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Return true if the given shift covers the current time. */
function isShiftNow(shift: Shift): boolean {
  const now   = new Date();
  const cur   = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(shift.start_time);
  const end   = toMinutes(shift.end_time);
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end; // overnight
}

const ShiftSelectionScreen = ({ navigation }: any) => {
  const { user, setSelectedShift } = useAuth();
  const isPpic = user?.role?.toLowerCase() === 'ppic';

  const [isLoading, setIsLoading]     = useState(true);
  const [shifts, setShifts]           = useState<Shift[]>([]);
  const [timeShift, setTimeShift]     = useState<Shift | null>(null); // shift matching clock
  const [selectedShiftLocal, setSelectedShiftLocal] = useState<Shift | null>(null);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => { initSelection(); }, []);

  const initSelection = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [shiftsRes, activeRes] = await Promise.all([
        masterDataApi.getShifts(),
        productionApi.getActiveShift(),
      ]);

      const fetchedShifts: Shift[] = shiftsRes.data.data ?? [];
      setShifts(fetchedShifts);

      // Determine the shift matching the current clock (used for both roles)
      const current = fetchedShifts.find(isShiftNow) ?? null;
      setTimeShift(current);

      if (isPpic) {
        // PPIC: default to the current-time shift but allow manual selection
        const defaultPick = current ?? fetchedShifts[0] ?? null;
        setSelectedShiftLocal(defaultPick);
        if (defaultPick) await setSelectedShift(defaultPick);
        return;
      }

      // Operator: if already has an open session → skip to Dashboard
      if (activeRes.data.success && activeRes.data.data) {
        const session   = activeRes.data.data;
        const shiftType = fetchedShifts.find((s) => s.id === session.shift_type_id);
        if (shiftType) {
          await setSelectedShift(shiftType);
          navigation.replace('Dashboard');
          return;
        }
      }

      // Operator: auto-detect shift from current clock
      setSelectedShiftLocal(current);
      if (current) await setSelectedShift(current);
    } catch (err) {
      console.error('Error initializing shift selection:', err);
      setError('Failed to load shifts. Check your connection and retry.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePpicSelectShift = async (shift: Shift) => {
    setSelectedShiftLocal(shift);
    await setSelectedShift(shift);
  };

  const now     = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // PPIC can proceed as soon as shifts load (always has a selection); operators need a time-matched shift
  const canProceed = isPpic ? (!isLoading && !!selectedShiftLocal) : (!!selectedShiftLocal && !isLoading);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={[styles.headerIcon, isPpic && styles.headerIconPpic]}>
            {isPpic ? <BarChart2 color="#FFF" size={34} /> : <Clock color="#FFF" size={34} />}
          </View>
          <Text style={styles.title}>{isPpic ? 'Dashboard Access' : 'Shift Selection'}</Text>
          <Text style={styles.subtitle}>Welcome, {user?.name}</Text>
          {isPpic && (
            <View style={styles.ppicBadge}>
              <ShieldCheck color="#17a34a" size={12} />
              <Text style={styles.ppicBadgeText}>PPIC — View &amp; Edit</Text>
            </View>
          )}
          <Text style={styles.dateText}>{dateStr}</Text>
          <Text style={styles.timeText}>{timeStr}</Text>
        </View>

        {/* ── Body ── */}
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#17a34a" />
            <Text style={styles.loadingText}>
              {isPpic ? 'Loading…' : 'Detecting your shift…'}
            </Text>
          </View>

        ) : error ? (
          <View style={styles.center}>
            <AlertCircle color="#dc2626" size={40} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={initSelection}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>

        ) : (
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>

            {/* PPIC info banner */}
            {isPpic && (
              <View style={styles.ppicHint}>
                <ShieldCheck color="#17a34a" size={14} />
                <Text style={styles.ppicHintText}>
                  You can view and edit data for any shift. You cannot start or end a shift.
                </Text>
              </View>
            )}

            {/* Operator: warn if no shift matches current time */}
            {!isPpic && !timeShift && (
              <View style={styles.noShiftBanner}>
                <AlertCircle color="#d97706" size={16} />
                <Text style={styles.noShiftText}>
                  No shift is scheduled for the current time.
                </Text>
              </View>
            )}

            {shifts.map((shift) => {
              const isNow      = shift.id === timeShift?.id;
              const isSelected = shift.id === selectedShiftLocal?.id;
              // Operators: only the current-time shift is enabled
              const isDisabled = !isPpic && !isNow;

              const CardWrapper = isPpic ? TouchableOpacity : View;
              const cardProps   = isPpic
                ? { onPress: () => handlePpicSelectShift(shift), activeOpacity: 0.75 }
                : {};

              return (
                <CardWrapper
                  key={shift.id}
                  {...cardProps}
                  style={[
                    styles.card,
                    isSelected && styles.cardSelected,
                    !isSelected && isNow && isPpic && styles.cardNowPpic,
                    isDisabled && styles.cardDisabled,
                  ]}
                >
                  {/* Left icon */}
                  <View style={[
                    styles.iconBox,
                    isSelected        ? styles.iconBoxSelected :
                    (isNow && isPpic) ? styles.iconBoxNow      :
                    isDisabled        ? styles.iconBoxDisabled :
                                        styles.iconBoxDefault,
                  ]}>
                    {isDisabled
                      ? <Lock  color="#9ca3af" size={14} />
                      : isSelected
                        ? <Check color="#FFF"    size={16} />
                        : <Clock color={isNow ? '#FFF' : '#6b7280'} size={14} />
                    }
                  </View>

                  {/* Info */}
                  <View style={styles.cardBody}>
                    <View style={styles.cardRow}>
                      <Text style={[styles.shiftName, isDisabled && styles.textDisabled]}>
                        {shift.name}
                      </Text>
                      {isNow && (
                        <View style={styles.nowBadge}>
                          <Text style={styles.nowBadgeText}>NOW</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.shiftTime, isDisabled && styles.textDisabled]}>
                      {shift.start_time} – {shift.end_time}
                    </Text>
                  </View>
                </CardWrapper>
              );
            })}
          </ScrollView>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.continueBtn,
              !canProceed && styles.continueBtnDisabled,
              isPpic && styles.continueBtnPpic,
            ]}
            disabled={!canProceed}
            onPress={() => navigation.navigate('Dashboard')}
          >
            <View style={styles.continueBtnInner}>
              {isPpic && <BarChart2 color="#FFF" size={18} style={{ marginRight: 8 }} />}
              <Text style={styles.continueBtnText}>
                {isPpic ? 'View Shift Data' : 'Start Shift'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#232938', justifyContent: 'center', alignItems: 'center' },
  content:     { backgroundColor: '#FFF', borderRadius: 20, padding: 24, width: '90%', maxWidth: 400, maxHeight: '88%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },

  /* header */
  header:         { alignItems: 'center', marginBottom: 20 },
  headerIcon:     { width: 62, height: 62, backgroundColor: '#17a34a', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  headerIconPpic: { backgroundColor: '#0ea5e9' },
  title:          { fontSize: 20, fontWeight: '700', color: '#111' },
  subtitle:       { fontSize: 13, color: '#555', marginTop: 4 },
  dateText:       { fontSize: 11, color: '#17a34a', fontWeight: '600', marginTop: 4 },
  timeText:       { fontSize: 30, fontWeight: '800', color: '#111', marginTop: 4, letterSpacing: 1 },

  /* PPIC badge in header */
  ppicBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  ppicBadgeText: { fontSize: 11, fontWeight: '700', color: '#1d4ed8', letterSpacing: 0.3 },

  /* center states */
  center:      { alignItems: 'center', paddingVertical: 28 },
  loadingText: { marginTop: 12, color: '#666', fontSize: 14 },
  errorText:   { marginTop: 10, color: '#dc2626', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryBtn:    { marginTop: 14, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#f3f4f6', borderRadius: 8 },
  retryText:   { color: '#374151', fontWeight: '600' },

  /* banners */
  noShiftBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 8, padding: 10, marginBottom: 12 },
  noShiftText:   { flex: 1, fontSize: 12, color: '#92400e', lineHeight: 16 },
  ppicHint:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 8, padding: 10, marginBottom: 12 },
  ppicHintText:  { flex: 1, fontSize: 12, color: '#1e40af', lineHeight: 16 },

  /* shift cards */
  list:          { marginBottom: 4 },
  card:          { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardSelected:  { borderColor: '#22c55e', borderWidth: 2, backgroundColor: '#f0fdf4' },
  cardNowPpic:   { borderColor: '#bfdbfe', borderWidth: 1, backgroundColor: '#eff6ff' },
  cardDisabled:  { backgroundColor: '#f9fafb', opacity: 0.55 },

  iconBox:         { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  iconBoxSelected: { backgroundColor: '#17a34a' },
  iconBoxNow:      { backgroundColor: '#0ea5e9' },
  iconBoxDefault:  { backgroundColor: '#f3f4f6' },
  iconBoxDisabled: { backgroundColor: '#e5e7eb' },

  cardBody:    { flex: 1 },
  cardRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shiftName:   { fontSize: 16, fontWeight: '700', color: '#111' },
  textDisabled:{ color: '#9ca3af' },
  shiftTime:   { fontSize: 13, color: '#555', marginTop: 2 },

  nowBadge:     { backgroundColor: '#17a34a', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  nowBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  /* footer */
  footer:             { marginTop: 16 },
  continueBtn:        { backgroundColor: '#17a34a', borderRadius: 12, padding: 16, alignItems: 'center' },
  continueBtnPpic:    { backgroundColor: '#0ea5e9' },
  continueBtnDisabled:{ backgroundColor: '#d1d5db' },
  continueBtnInner:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  continueBtnText:    { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

export default ShiftSelectionScreen;
