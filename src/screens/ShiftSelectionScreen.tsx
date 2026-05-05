import React, { useState, useCallback } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../navigation/AuthContext';
import { masterDataApi, productionApi } from '../api/production';
import { Shift } from '../types';
import { t } from '../utils/i18n';
import { productionLineTitleKeyFromRole } from '../utils/productionLine';

/** Return total minutes from midnight. Handles "HH:MM" and "HH:MM:SS" (e.g. 07:00:00). Uses device local time. */
function toMinutes(time: string): number {
  const parts = String(time || '').trim().split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

/** Current time in minutes from midnight (device local time — e.g. Indonesia WIB). */
function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Return true if the given shift covers the current time (device local; shift times assumed same timezone). */
function isShiftNow(shift: Shift): boolean {
  const cur   = nowMinutes();
  const start = toMinutes(shift.start_time);
  const end   = toMinutes(shift.end_time);
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end; // overnight
}

/** Return true if the shift has already ended (previous/closed). Normal shifts only; overnight in [end,start) is not "previous". */
function isShiftPrevious(shift: Shift): boolean {
  if (isShiftNow(shift)) return false;
  const cur   = nowMinutes();
  const start = toMinutes(shift.start_time);
  const end   = toMinutes(shift.end_time);
  if (start < end) return cur >= end; // normal: ended when current >= end
  return false; // overnight: in [end,start) the next start is in the future, so treat as upcoming, not previous
}

/** Return true if the shift has not started yet (upcoming) — based on shift start time. Disable these. */
function isShiftUpcoming(shift: Shift): boolean {
  if (isShiftNow(shift)) return false;
  if (isShiftPrevious(shift)) return false;
  const cur   = nowMinutes();
  const start = toMinutes(shift.start_time);
  const end   = toMinutes(shift.end_time);
  if (start < end) return cur < start; // normal: upcoming when current < start
  return cur >= end && cur < start;    // overnight: upcoming when we're in [end, start) (next start is at 23:00)
}

const ShiftSelectionScreen = ({ navigation }: any) => {
  const { user, selectedShift: selectedShiftFromContext, setSelectedShift } = useAuth();
  const isPpic = user?.role?.toLowerCase() === 'ppic';

  const [isLoading, setIsLoading]     = useState(true);
  const [shifts, setShifts]           = useState<Shift[]>([]);
  const [timeShift, setTimeShift]     = useState<Shift | null>(null); // shift matching clock
  const [selectedShiftLocal, setSelectedShiftLocal] = useState<Shift | null>(null);
  const [error, setError]             = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      initSelection();
    }, [user?.role, selectedShiftFromContext?.id])
  );

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

      // Operator: preserve existing selection when opening from Dashboard (change shift), else default to current or first previous
      const existingInList = selectedShiftFromContext && fetchedShifts.find((s) => s.id === selectedShiftFromContext.id);
      const keepExisting = existingInList && !isShiftUpcoming(existingInList);
      const previousOrCurrent = keepExisting ? existingInList : (current ?? fetchedShifts.find((s) => !isShiftUpcoming(s)) ?? null);
      setSelectedShiftLocal(previousOrCurrent);
      if (previousOrCurrent) await setSelectedShift(previousOrCurrent);
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

  const handleOperatorSelectShift = async (shift: Shift) => {
    if (isShiftUpcoming(shift)) return;
    setSelectedShiftLocal(shift);
    await setSelectedShift(shift);
  };

  const now     = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // PPIC can proceed as soon as shifts load; operators need a selected shift (current or previous)
  const canProceed = isPpic ? (!isLoading && !!selectedShiftLocal) : (!!selectedShiftLocal && !isLoading);
  // When selected shift is already started (current) or closed (previous), show "View Shift" instead of "Start Shift"
  const isSelectedShiftStartedOrClosed = selectedShiftLocal && (isShiftNow(selectedShiftLocal) || isShiftPrevious(selectedShiftLocal));
  const continueButtonText = isPpic ? 'View Shift Data' : (isSelectedShiftStartedOrClosed ? 'View Shift' : 'Start Shift');

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
          {!isPpic ? (
            <Text style={styles.productionLineTag}>{t(productionLineTitleKeyFromRole(user?.role))}</Text>
          ) : null}
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

            {/* Operator: hint that current and previous (closed) are selectable; only upcoming is disabled */}
            {!isPpic && (
              <View style={styles.operatorHint}>
                <Clock color="#17a34a" size={14} />
                <Text style={styles.operatorHintText}>
                  Select the current shift or a previous (closed) shift. Upcoming shifts are locked.
                </Text>
              </View>
            )}
            {/* Operator: warn if no shift matches current time */}
            {!isPpic && !timeShift && (
              <View style={styles.noShiftBanner}>
                <AlertCircle color="#d97706" size={16} />
                <Text style={styles.noShiftText}>
                  No shift is scheduled for the current time. You can select a previous shift below.
                </Text>
              </View>
            )}

            {shifts.map((shift) => {
              const isNow      = shift.id === timeShift?.id;
              const isSelected = shift.id === selectedShiftLocal?.id;
              // Operators: disable only upcoming shifts; enable current and previous
              const isDisabled = !isPpic && isShiftUpcoming(shift);

              const CardWrapper = TouchableOpacity;
              const cardProps   = {
                onPress: () => isPpic ? handlePpicSelectShift(shift) : handleOperatorSelectShift(shift),
                activeOpacity: 0.75,
                disabled: isDisabled,
              };

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
            onPress={() => {
              // Always go to a fresh Dashboard render after shift selection.
              navigation.replace('Dashboard');
            }}
          >
            <View style={styles.continueBtnInner}>
              {isPpic && <BarChart2 color="#FFF" size={18} style={{ marginRight: 8 }} />}
              <Text style={styles.continueBtnText}>
                {continueButtonText}
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
  productionLineTag: { fontSize: 12, fontWeight: '800', color: '#17a34a', marginTop: 8, letterSpacing: 0.8, textTransform: 'uppercase' },
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
  noShiftBanner:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 8, padding: 10, marginBottom: 12 },
  noShiftText:    { flex: 1, fontSize: 12, color: '#92400e', lineHeight: 16 },
  operatorHint:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac', borderRadius: 8, padding: 10, marginBottom: 12 },
  operatorHintText: { flex: 1, fontSize: 12, color: '#166534', lineHeight: 16 },
  ppicHint:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 8, padding: 10, marginBottom: 12 },
  ppicHintText:   { flex: 1, fontSize: 12, color: '#1e40af', lineHeight: 16 },

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
