import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  LogOut, 
  Play, 
  ChevronRight, 
  ChevronLeft,
  Package, 
  Box, 
  Droplets, 
  Zap, 
  ArrowLeft,
  Square,
  Printer,
  Search,
  X,
  Plus,
  Minus,
  Info,
  Camera as CameraIcon,
  Trash2,
  Scale,
  Printer as PrinterIcon,
  FileText,
  Pencil,
} from 'lucide-react-native';
import { useAuth } from '../navigation/AuthContext';
import { productionApi, masterDataApi } from '../api/production';
import { Station, ProductionLog, Shift } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import QRCode from 'react-native-qrcode-svg';
import StationDatePicker from '../components/StationDatePicker';

import { printService } from '../utils/print';
import { t } from '../utils/i18n';

/** Format date as YYYY-MM-DD in local timezone (avoids toISOString UTC shift). */
function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD to Date at local noon (avoids timezone edge cases). */
function parseDateLocal(s: string): Date {
  return new Date(s + 'T12:00:00');
}

const DashboardScreen = ({ navigation }: any) => {
  const { user, logout, selectedShift } = useAuth();
  
  // App State
  const [stations, setStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Shift State
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [shiftStartTime, setShiftStartTime] = useState<number | null>(null);
  const [shiftDuration, setShiftDuration] = useState('0h 00m 00s');
  const [backendShiftId, setBackendShiftId] = useState<number | null>(null);
  const [shiftLogs, setShiftLogs] = useState<ProductionLog[]>([]);
  
  // Selection State
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [selectedSection, setSelectedSection] = useState<'input' | 'output' | null>(null);
  const [showStationModal, setShowStationModal] = useState(false);
  const [pendingStation, setPendingStation] = useState<Station | null>(null);
  const [pendingWashingLine, setPendingWashingLine] = useState<'Washing 1' | 'Washing 2' | 'Washing 3' | null>(null);
  const [showWashingModal, setShowWashingModal] = useState(false);
  const [pendingExtrusionLine, setPendingExtrusionLine] = useState<'Extrusion 1' | 'Extrusion 2' | 'Extrusion 3' | 'Mixture' | null>(null);
  const [showExtrusionModal, setShowExtrusionModal] = useState(false);
  
  // Input/Output State
  const [weightInput, setWeightInput] = useState('');
  const [bagSearchQuery, setBagSearchQuery] = useState('');
  const [suggestedBags, setSuggestedBags] = useState<any[]>([]);
  const [selectedInputBag, setSelectedInputBag] = useState<any>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isCurrentLogSaved, setIsCurrentLogSaved] = useState(false);
  const [selectedSubLine, setSelectedSubLine] = useState<'3E' | 'Rapid' | 'Betty' | 'Washing 1' | 'Washing 2' | 'Washing 3' | 'Extrusion 1' | 'Extrusion 2' | 'Extrusion 3' | 'Mixture' | null>(null);
  const [currentViewBags, setCurrentViewBags] = useState(0);
  const [currentViewWeight, setCurrentViewWeight] = useState(0);
  
  // Crusher logs list state
  const [crusherLogs, setCrusherLogs] = useState<any[]>([]);
  const [crusherLogsLoading, setCrusherLogsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(formatDateLocal(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>('all'); // 'all', '3E', 'Rapid', 'Betty'
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all'); // 'all', 'pending', 'Completed'
  const [showListPrintPreview, setShowListPrintPreview] = useState(false);
  const [selectedLogForPrint, setSelectedLogForPrint] = useState<any>(null);
  const [editingLogWeight, setEditingLogWeight] = useState<any>(null);
  const [editWeightValue, setEditWeightValue] = useState('');

  // Washing logs list state
  const [washingLogs, setWashingLogs] = useState<any[]>([]);
  const [washingLogsLoading, setWashingLogsLoading] = useState(false);
  const [washingSelectedDate, setWashingSelectedDate] = useState(formatDateLocal(new Date()));
  const [washingSearchQuery, setWashingSearchQuery] = useState('');
  const [washingCurrentPage, setWashingCurrentPage] = useState(1);
  const [washingTotalPages, setWashingTotalPages] = useState(1);
  const [washingTotalLogs, setWashingTotalLogs] = useState(0);
  const [washingSelectedLineFilter, setWashingSelectedLineFilter] = useState<string>('all'); // 'all', 'Washing 1', 'Washing 2', 'Washing 3'
  const [washingSelectedStatusFilter, setWashingSelectedStatusFilter] = useState<string>('all'); // 'all', 'pending', 'Completed'
  
  // Extrusion logs list state
  const [extrusionLogs, setExtrusionLogs] = useState<any[]>([]);
  const [extrusionLogsLoading, setExtrusionLogsLoading] = useState(false);
  const [extrusionSelectedDate, setExtrusionSelectedDate] = useState(formatDateLocal(new Date()));
  const [extrusionSearchQuery, setExtrusionSearchQuery] = useState('');
  const [extrusionCurrentPage, setExtrusionCurrentPage] = useState(1);
  const [extrusionTotalPages, setExtrusionTotalPages] = useState(1);
  const [extrusionTotalLogs, setExtrusionTotalLogs] = useState(0);
  const [extrusionSelectedLineFilter, setExtrusionSelectedLineFilter] = useState<string>('all'); // 'all', 'Extrusion 1', 'Extrusion 2', 'Extrusion 3', 'Mixture'
  const [extrusionSelectedStatusFilter, setExtrusionSelectedStatusFilter] = useState<string>('all'); // 'all', 'pending', 'Completed'
  
  // Scanner State
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Photo State
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [showCameraPreview, setShowCameraPreview] = useState(false);
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);
  const [tempCapturedImage, setTempCapturedImage] = useState<string | null>(null);
  const cameraRef = React.useRef<any>(null);

  // Summary State
  const [showEndShiftSummary, setShowEndShiftSummary] = useState(false);
  const [byProductsInputs, setByProductsInputs] = useState<any[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Shift-closed view (editable by-products, regenerate PDF)
  const [showShiftClosedView, setShowShiftClosedView] = useState(false);
  const [closedShiftId, setClosedShiftId] = useState<number | null>(null);
  const [closedShiftByProducts, setClosedShiftByProducts] = useState<any[]>([]);
  const [closedShiftMeta, setClosedShiftMeta] = useState<{ shift: string; operator: string; date: string; totalOutputs: number; totalWeight: string; remark?: string; byStation?: { crusher: { outputs: number; weight: string }; washing: { outputs: number; weight: string }; extrusion: { outputs: number; weight: string } } } | null>(null);
  const [closedByProductsLoading, setClosedByProductsLoading] = useState(false);
  const [editingByProductIndex, setEditingByProductIndex] = useState<number | null>(null);
  const [editByProductWeight, setEditByProductWeight] = useState('');
  const [closedShiftRemarkEdit, setClosedShiftRemarkEdit] = useState('');
  const [closedShiftLogs, setClosedShiftLogs] = useState<any[]>([]);
  const [closedShiftLogsLoading, setClosedShiftLogsLoading] = useState(false);
  // PPIC shift detail: search + per-category pagination (10 rows/page)
  const [shiftLogsSearch, setShiftLogsSearch] = useState('');
  const [shiftLogsPageCrusher, setShiftLogsPageCrusher] = useState(1);
  const [shiftLogsPageWashing, setShiftLogsPageWashing] = useState(1);
  const [shiftLogsPageExtrusion, setShiftLogsPageExtrusion] = useState(1);
  const SHIFT_LOGS_PAGE_SIZE = 10;

  // PPIC: list and open saved end-shift reports
  const [showClosedReportsModal, setShowClosedReportsModal] = useState(false);
  const [closedShiftsList, setClosedShiftsList] = useState<any[]>([]);
  const [closedShiftsLoading, setClosedShiftsLoading] = useState(false);
  // PPIC home: date and shift selection (different homepage from PC production)
  const [ppicSelectedDate, setPpicSelectedDate] = useState(() => formatDateLocal(new Date()));
  const [ppicSelectedShiftId, setPpicSelectedShiftId] = useState<number | null>(null); // null = All
  const [ppicShifts, setPpicShifts] = useState<Shift[]>([]);
  // PPIC home: live active shifts
  const [ppicActiveShifts, setPpicActiveShifts] = useState<any[]>([]);
  const [ppicActiveShiftsLoading, setPpicActiveShiftsLoading] = useState(false);
  // Track whether the currently viewed closed/active shift is still live
  const [viewingActiveShift, setViewingActiveShift] = useState(false);

  // Saved by-products on start shift page (editable after save)
  const [savedByProductsOnStartPage, setSavedByProductsOnStartPage] = useState<any[]>([]);
  const [savedByProductsMeta, setSavedByProductsMeta] = useState<{ shift: string; operator: string; date: string; totalOutputs: number; totalWeight: string; remark?: string; byStation?: { crusher: { outputs: number; weight: string }; washing: { outputs: number; weight: string }; extrusion: { outputs: number; weight: string } } } | null>(null);
  const [endShiftRemark, setEndShiftRemark] = useState('');

  // Auto-close shift tracking
  const [autoCloseWarningShown, setAutoCloseWarningShown] = useState(false);

  // Printer & Preview State
  const [selectedPrinter, setSelectedPrinter] = useState<any>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [remarkInput, setRemarkInput] = useState('');
  const [previewBagStatus, setPreviewBagStatus] = useState<'pending' | 'Completed'>('pending');
  const [isPrinting, setIsPrinting] = useState(false);
  const qrRef = React.useRef<any>(null);
  const listQrRef = React.useRef<any>(null);

  /** Stable "today" for date picker max – avoids picker resetting when prop reference changes. */
  const maxDate = useMemo(() => new Date(), []);

  // Initial Load
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
      
      const savedPrinter = await printService.getSavedPrinter();
      if (savedPrinter) setSelectedPrinter(savedPrinter);
    })();
  }, []);

  const handleSelectPrinter = async () => {
    const result: any = await printService.selectPrinter();
    if (result) {
        setSelectedPrinter(result);
      await AsyncStorage.setItem('selected_printer', JSON.stringify(result));
    }
  };

  useFocusEffect(
    useCallback(() => {
    loadShiftState();
    loadStations();
    }, [selectedShift])
  );

  // PPIC: load shift types for date/shift selector on home
  useEffect(() => {
    if (user?.role?.toLowerCase() !== 'ppic') return;
    (async () => {
      try {
        const res = await masterDataApi.getShifts();
        if (res.data?.success && Array.isArray(res.data.data)) setPpicShifts(res.data.data);
      } catch (e) {
        setPpicShifts([]);
      }
    })();
  }, [user?.role]);

  // PPIC: load currently running (active) shifts on focus
  const loadPpicActiveShifts = async () => {
    if (user?.role?.toLowerCase() !== 'ppic') return;
    setPpicActiveShiftsLoading(true);
    try {
      const res = await productionApi.getAllActiveShifts();
      if (res.data?.success && Array.isArray(res.data.data)) {
        setPpicActiveShifts(res.data.data);
      } else {
        setPpicActiveShifts([]);
      }
    } catch (e) {
      setPpicActiveShifts([]);
    } finally {
      setPpicActiveShiftsLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { loadPpicActiveShifts(); }, [user?.role]));

  /** Open any shift (active or closed) into the shift-detail view */
  const handleSelectAnyShift = async (shiftId: number, isActive: boolean) => {
    try {
      const res = await productionApi.getShiftSummary(shiftId);
      if (!res.data?.success || !res.data.data) return;
      const d = res.data.data;
      setClosedShiftId(shiftId);
      setViewingActiveShift(isActive);
      setClosedShiftMeta({
        shift: d.shift,
        operator: d.operator,
        date: d.date,
        totalOutputs: d.totalOutputs ?? 0,
        totalWeight: d.totalWeight ?? '0.0',
        byStation: d.byStation ?? undefined,
        remark: d.remark,
      });
      setClosedShiftRemarkEdit(d.remark ?? '');
      const saved = (d.byProducts || []).map((p: any) => ({
        name: p.name,
        stationName: p.stationName ?? '',
        category: p.category ?? '',
        weight: p.weight,
        stationId: p.stationId,
        processLabel: getProcessLabel(p.stationName ?? ''),
      }));
      const fullTemplate = getFullWasteTemplate();
      const merged = fullTemplate.length > 0 ? mergeSavedByProductsIntoFullTemplate(fullTemplate, saved) : saved;
      setClosedShiftByProducts(merged);
      setShowClosedReportsModal(false);
      setShowShiftClosedView(true);
      setShiftLogsSearch('');
      setShiftLogsPageCrusher(1);
      setShiftLogsPageWashing(1);
      setShiftLogsPageExtrusion(1);
      setClosedShiftLogsLoading(true);
      try {
        const logsRes = await productionApi.getShiftLogs(shiftId);
        if (logsRes.data?.success && Array.isArray(logsRes.data.data)) {
          setClosedShiftLogs(logsRes.data.data);
        } else {
          setClosedShiftLogs([]);
        }
      } catch (_e) {
        setClosedShiftLogs([]);
      } finally {
        setClosedShiftLogsLoading(false);
      }
    } catch (e) {
      Alert.alert(t('common.error'), t('messages.failedToLoadShiftSummary'));
    }
  };

  const loadShiftState = async () => {
    if (!selectedShift) return;
    try {
      setIsLoading(true);
      const response = await productionApi.getActiveShift(undefined, selectedShift.id);
      if (response.data.success && response.data.data) {
        const shift = response.data.data;
        setIsShiftActive(true);
        setShiftStartTime(new Date(shift.start_time).getTime());
        setBackendShiftId(shift.id);
        const logsRes = await productionApi.getShiftLogs(shift.id);
        if (logsRes.data.success) setShiftLogs(logsRes.data.data);
      } else {
        setIsShiftActive(false);
        setBackendShiftId(null);
        setShiftLogs([]);
      }
    } catch (e) {
      console.error('Failed to load shift state', e);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Given the actual shift start timestamp and the shift type, return two timestamps:
   *   - scheduledEnd : the clock time when the shift type ends (today or next day for overnight)
   *   - graceEnd     : scheduledEnd + 15 minutes (when the shift is force-closed)
   *
   * We anchor to the scheduled clock time (e.g. 16:00) rather than start+duration so
   * that a late start does not push the auto-close past the scheduled end time.
   */
  const getShiftAutoCloseTimes = (
    shiftStartTimestamp: number,
    shiftType: Shift | null,
  ): { scheduledEnd: number; graceEnd: number } | null => {
    if (!shiftType?.end_time) return null;
    try {
      const [endH, endM] = shiftType.end_time.split(':').map(Number);
      const base = new Date(shiftStartTimestamp);
      base.setHours(endH ?? 0, endM ?? 0, 0, 0);
      let scheduledEnd = base.getTime();
      // Overnight shift: end_time is earlier than start_time, so add one day
      if (scheduledEnd <= shiftStartTimestamp) {
        scheduledEnd += 24 * 60 * 60 * 1000;
      }
      return { scheduledEnd, graceEnd: scheduledEnd + 15 * 60 * 1000 };
    } catch {
      return null;
    }
  };

  // Auto-close shift: warn at scheduled end time, force-close 15 min after
  useEffect(() => {
    if (!isShiftActive || !backendShiftId || !selectedShift || !shiftStartTime) return;

    let closing = false; // guard against double-close

    const tick = async () => {
      const times = getShiftAutoCloseTimes(shiftStartTime, selectedShift);
      if (!times) return;

      const now = Date.now();

      // ── Grace period expired → auto-close ──────────────────────────────────
      if (now >= times.graceEnd) {
        if (closing) return;
        closing = true;
        try {
          const response = await productionApi.endShift(backendShiftId);
          if (response.data.success) {
            Alert.alert(
              'Shift Auto-Closed',
              `Your ${selectedShift.name} shift has been automatically closed.\n\nThe shift ended at ${selectedShift.end_time} and the 15-minute grace period has elapsed.`,
              [{
                text: 'OK',
                onPress: () => {
                  setIsShiftActive(false);
                  setBackendShiftId(null);
                  setShiftLogs([]);
                  setShiftStartTime(null);
                  setSelectedStation(null);
                  setSelectedSection(null);
                  setSelectedSubLine(null);
                  setAutoCloseWarningShown(false);
                },
              }],
            );
          }
        } catch (err) {
          console.error('Error auto-closing shift:', err);
          closing = false;
        }
        return;
      }

      // ── Scheduled end time reached → show one-time warning ─────────────────
      if (now >= times.scheduledEnd && !autoCloseWarningShown) {
        setAutoCloseWarningShown(true);
        Alert.alert(
          'Shift Ended',
          `Your ${selectedShift.name} shift has reached its scheduled end time (${selectedShift.end_time}).\n\nThe shift will be automatically closed in 15 minutes if not closed manually.`,
          [{ text: 'OK' }],
        );
      }
    };

    tick(); // check immediately on mount / state change
    const interval = setInterval(tick, 30 * 1000); // check every 30 seconds
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShiftActive, backendShiftId, selectedShift, shiftStartTime, autoCloseWarningShown]);

  const loadStations = async () => {
    try {
      const response = await productionApi.getStations();
      if (response.data.success) {
        const uiColors: any = {
          'Label Removal': '#3b82f6', 'Crusher': '#a855f7', 'Washing': '#06b6d4',
          'Extrusion': '#f97316', 'Final Packaging': '#22c55e'
        };
        const mappedStations = response.data.data.map((s: any) => ({
          ...s, color: uiColors[s.name] || '#64748b',
          }));
        setStations(mappedStations);
      }
    } catch (error) {
      console.error('Error loading stations:', error);
    }
  };

  useEffect(() => {
    let interval: any;
    if (isShiftActive && shiftStartTime !== null) {
      interval = setInterval(() => {
        const diff = Date.now() - shiftStartTime;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setShiftDuration(`${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isShiftActive, shiftStartTime]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const tid = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(tid);
  }, [toastMessage]);

  const handleStartShift = async () => {
    if (!selectedShift) return;
    try {
      setIsLoading(true);
      // Clear saved by-products when starting new shift
      setSavedByProductsOnStartPage([]);
      setSavedByProductsMeta(null);
      setClosedShiftId(null);
      setEditingByProductIndex(null);
      setEditByProductWeight('');
      
      const response = await productionApi.startShift(selectedShift.id);
      if (response.data.success) {
        setBackendShiftId(response.data.data.id);
        setIsShiftActive(true);
        setShiftStartTime(Date.now());
        setAutoCloseWarningShown(false);
      }
    } catch (error: any) {
      const message = error.response?.data?.message || t('messages.failedToStartShift');
      showToast(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndShift = async () => {
    if (!backendShiftId) return;
    initByProducts();
    setShowEndShiftSummary(true);
  };

  const getProcessLabel = useCallback((stationName: string): string => {
    const n = (stationName || '').toLowerCase();
    if (n.includes('label removal') || n.includes('crusher')) return 'removeLabelCrushing';
    if (n.includes('washing')) return 'washing';
    if (n.includes('extrusion')) return 'extrusion';
    return 'other';
  }, []);

  const getProcessTitle = useCallback((key: string) => {
    switch (key) {
      case 'removeLabelCrushing': return t('dashboard.processRemoveLabelCrushing');
      case 'washing': return t('dashboard.processWashing');
      case 'extrusion': return t('dashboard.processExtrusion');
      default: return key;
    }
  }, [t]);

  // Full list of all waste labels (all processes) with 0 weight - for showing "all labels" in closed/saved view
  const getFullWasteTemplate = useCallback((): any[] => {
    const labelRemovalStation = stations.find(s => s.name?.toLowerCase().includes('label removal') || (s as any).code === 'LR');
    const crusherStation = stations.find(s => s.name?.toLowerCase().includes('crusher') || (s as any).code === 'CRS');
    const washingStation = stations.find(s => s.name?.toLowerCase().includes('washing') || (s as any).code === 'WSH');
    const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4 || (s as any).code === 'EXT');
    const stationForRemoveLabelCrushing = labelRemovalStation || crusherStation;
    const list: any[] = [];
    if (stationForRemoveLabelCrushing) {
      ['Dust Remove Label', 'Sweep Floor'].forEach(name => {
        list.push({ name, category: 'Waste', weight: 0, stationId: stationForRemoveLabelCrushing.id, stationName: stationForRemoveLabelCrushing.name, processLabel: 'removeLabelCrushing' });
      });
    }
    if (washingStation) {
      ['Dust wet'].forEach(name => {
        list.push({ name, category: 'Waste', weight: 0, stationId: washingStation.id, stationName: washingStation.name, processLabel: 'washing' });
      });
    }
    if (extrusionStation) {
      ['Lumps', 'Sweep Floor'].forEach(name => {
        list.push({ name, category: 'Waste', weight: 0, stationId: extrusionStation.id, stationName: extrusionStation.name, processLabel: 'extrusion' });
      });
    }
    return list;
  }, [stations]);

  const mergeSavedByProductsIntoFullTemplate = useCallback((fullTemplate: any[], savedList: any[]): any[] => {
    return fullTemplate.map(t => {
      const matchStation = (s: any) =>
        s.stationId === t.stationId ||
        (s.stationName && t.stationName && String(s.stationName).trim() === String(t.stationName).trim());
      const saved = savedList.find((s: any) => s.name === t.name && matchStation(s));
      return saved ? { ...t, weight: saved.weight, category: saved.category ?? t.category } : t;
    });
  }, []);

  const initByProducts = () => {
    setByProductsInputs(getFullWasteTemplate());
  };

  const handleCloseShift = async () => {
    if (!backendShiftId) return;
    try {
      setIsLoading(true);
      const toSave = byProductsInputs.filter(p => Number(p.weight) > 0);
      const crusherStation = stations.find(s => s.name?.toLowerCase().includes('crusher') || (s as any).code === 'CRS');
      const washingStation = stations.find(s => s.name?.toLowerCase().includes('washing') || (s as any).code === 'WSH');
      const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4 || (s as any).code === 'EXT');
      const byStation = {
        crusher: { outputs: 0, weight: '0.0' },
        washing: { outputs: 0, weight: '0.0' },
        extrusion: { outputs: 0, weight: '0.0' },
      };
      if (crusherStation) {
        const logs = shiftLogs.filter((l: any) => l.station_id === crusherStation.id);
        byStation.crusher.outputs = logs.length;
        byStation.crusher.weight = logs.reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0).toFixed(1);
      }
      if (washingStation) {
        const logs = shiftLogs.filter((l: any) => l.station_id === washingStation.id);
        byStation.washing.outputs = logs.length;
        byStation.washing.weight = logs.reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0).toFixed(1);
      }
      if (extrusionStation) {
        const logs = shiftLogs.filter((l: any) => l.station_id === extrusionStation.id);
        byStation.extrusion.outputs = logs.length;
        byStation.extrusion.weight = logs.reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0).toFixed(1);
      }
      const totalOutputs = byStation.crusher.outputs + byStation.washing.outputs + byStation.extrusion.outputs;
      const totalWeight = (Number(byStation.crusher.weight) + Number(byStation.washing.weight) + Number(byStation.extrusion.weight)).toFixed(1);
      const byProductsForPdf = toSave.map(p => ({
        name: p.name,
        stationName: p.stationName ?? '',
        category: p.category ?? '',
        weight: Number(p.weight),
      }));
      await printService.printShiftSummary({
        shift: selectedShift?.name ?? 'N/A',
        operator: user?.name ?? 'N/A',
        date: new Date().toLocaleDateString(),
        totalOutputs,
        totalWeight,
        byStation,
        byProducts: byProductsForPdf,
        remark: endShiftRemark.trim() || undefined,
      });
      // Use PUT (delete + reinsert) so retrying shift close never creates duplicate by-product rows
      await productionApi.updateByProducts(backendShiftId, toSave.map(p => ({
        stationId: p.stationId,
        name: p.name,
        weight: typeof p.weight === 'number' ? p.weight : Number(p.weight) || 0,
        category: p.category ?? '',
      })));
      const response = await productionApi.endShift(backendShiftId, endShiftRemark.trim() || undefined);
      if (response.data.success) {
        const savedShiftId = backendShiftId;
        const savedMeta = {
          shift: selectedShift?.name ?? 'N/A',
          operator: user?.name ?? 'N/A',
          date: new Date().toLocaleDateString(),
          totalOutputs,
          totalWeight,
          byStation,
          remark: endShiftRemark.trim() || undefined,
        };
        const savedByProducts = byProductsForPdf.map((p, i) => ({ ...p, stationId: toSave[i].stationId, processLabel: toSave[i].processLabel }));
        const fullTemplate = getFullWasteTemplate();
        const mergedForStartPage = fullTemplate.length > 0 ? mergeSavedByProductsIntoFullTemplate(fullTemplate, savedByProducts) : savedByProducts;

        // Store for start shift page display (all labels so user can edit/add)
        setClosedShiftId(savedShiftId);
        setSavedByProductsMeta(savedMeta);
        setSavedByProductsOnStartPage(mergedForStartPage);
        
        setShowEndShiftSummary(false);
        setEndShiftRemark('');
        setIsShiftActive(false);
        setBackendShiftId(null);
        setShiftLogs([]);
        setAutoCloseWarningShown(false);
        // Don't show shift closed view, redirect to start shift page instead
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('messages.failedToCloseShift'));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchClosedShiftByProducts = useCallback(async () => {
    if (!closedShiftId) return;
    setClosedByProductsLoading(true);
    try {
      const res = await productionApi.getByProducts(closedShiftId);
      if (res.data?.success && Array.isArray(res.data.data)) {
        const saved = res.data.data.map((r: any) => ({
          name: r.name,
          stationName: r.stationName ?? '',
          category: r.category ?? '',
          weight: r.weight,
          stationId: r.stationId,
          processLabel: getProcessLabel(r.stationName ?? ''),
        }));
        const fullTemplate = getFullWasteTemplate();
        const merged = fullTemplate.length > 0 ? mergeSavedByProductsIntoFullTemplate(fullTemplate, saved) : saved;
        setClosedShiftByProducts(merged);
      }
    } catch (e) {
      console.warn('Fetch closed by-products failed', e);
    } finally {
      setClosedByProductsLoading(false);
    }
  }, [closedShiftId, getFullWasteTemplate, mergeSavedByProductsIntoFullTemplate, getProcessLabel]);

  const handleGeneratePdfAgain = async () => {
    // Support both closed shift view and start page saved by-products
    const meta = showShiftClosedView ? closedShiftMeta : savedByProductsMeta;
    const byProducts = showShiftClosedView ? closedShiftByProducts : savedByProductsOnStartPage;
    
    if (!meta) return;
    await printService.printShiftSummary({
      shift: meta.shift,
      operator: meta.operator,
      date: meta.date,
      totalOutputs: meta.totalOutputs,
      totalWeight: meta.totalWeight,
      byStation: meta.byStation,
      remark: meta.remark,
      byProducts: byProducts.map(p => ({
        name: p.name,
        stationName: p.stationName ?? '',
        category: p.category ?? '',
        weight: typeof p.weight === 'number' ? p.weight : Number(p.weight) || 0,
        processLabel: p.processLabel || getProcessLabel(p.stationName ?? ''),
      })),
    });
  };

  const handleBackToShifts = () => {
    setShowShiftClosedView(false);
    setClosedShiftId(null);
    setClosedShiftByProducts([]);
    setClosedShiftMeta(null);
    setClosedShiftRemarkEdit('');
    setClosedShiftLogs([]);
    setEditingByProductIndex(null);
    setViewingActiveShift(false);
    // Clear saved by-products on start page
    setSavedByProductsOnStartPage([]);
    setSavedByProductsMeta(null);
    navigation.navigate('ShiftSelection');
  };

  const handleOpenClosedReports = async (useDate?: string, useShiftId?: number | null) => {
    setShowClosedReportsModal(true);
    setClosedShiftsLoading(true);
    try {
      const limit = 100;
      const date = user?.role?.toLowerCase() === 'ppic' ? (useDate ?? ppicSelectedDate) : undefined;
      const shiftTypeIdRaw = user?.role?.toLowerCase() === 'ppic' ? (useShiftId ?? ppicSelectedShiftId) : null;
      const shiftTypeId = shiftTypeIdRaw != null && shiftTypeIdRaw >= 1 && shiftTypeIdRaw <= 3 ? Number(shiftTypeIdRaw) : undefined;
      const res = await productionApi.getClosedShifts(limit, date, shiftTypeId);
      if (res.data?.success && Array.isArray(res.data.data)) {
        setClosedShiftsList(res.data.data);
      } else {
        setClosedShiftsList([]);
      }
    } catch (e) {
      setClosedShiftsList([]);
    } finally {
      setClosedShiftsLoading(false);
    }
  };

  const handleSelectClosedShift = async (shiftId: number) => {
    try {
      const res = await productionApi.getClosedShiftSummary(shiftId);
      if (!res.data?.success || !res.data.data) return;
      const d = res.data.data;
      setClosedShiftId(shiftId);
      setClosedShiftMeta({
        shift: d.shift,
        operator: d.operator,
        date: d.date,
        totalOutputs: d.totalOutputs ?? 0,
        totalWeight: d.totalWeight ?? '0.0',
        byStation: d.byStation ?? undefined,
        remark: d.remark,
      });
      setClosedShiftRemarkEdit(d.remark ?? '');
      const saved = (d.byProducts || []).map((p: any) => ({
        name: p.name,
        stationName: p.stationName ?? '',
        category: p.category ?? '',
        weight: p.weight,
        stationId: p.stationId,
        processLabel: getProcessLabel(p.stationName ?? ''),
      }));
      const fullTemplate = getFullWasteTemplate();
      const merged = fullTemplate.length > 0 ? mergeSavedByProductsIntoFullTemplate(fullTemplate, saved) : saved;
      setClosedShiftByProducts(merged);
      setShowClosedReportsModal(false);
      setShowShiftClosedView(true);
      setShiftLogsSearch('');
      setShiftLogsPageCrusher(1);
      setShiftLogsPageWashing(1);
      setShiftLogsPageExtrusion(1);
      setClosedShiftLogsLoading(true);
      try {
        const logsRes = await productionApi.getShiftLogs(shiftId);
        if (logsRes.data?.success && Array.isArray(logsRes.data.data)) {
          setClosedShiftLogs(logsRes.data.data);
        } else {
          setClosedShiftLogs([]);
        }
      } catch (_e) {
        setClosedShiftLogs([]);
      } finally {
        setClosedShiftLogsLoading(false);
      }
    } catch (e) {
      Alert.alert(t('common.error'), t('messages.failedToLoadShiftSummary'));
    }
  };

  const openEditByProduct = (index: number) => {
    // Support both closed shift view and start page saved by-products
    const byProductsList = showShiftClosedView ? closedShiftByProducts : savedByProductsOnStartPage;
    const p = byProductsList[index];
    setEditingByProductIndex(index);
    setEditByProductWeight(String(p?.weight ?? ''));
  };

  const saveEditedByProduct = async () => {
    if (editingByProductIndex == null) return;
    const w = Number(editByProductWeight);
    if (Number.isNaN(w) || w < 0) {
      Alert.alert(t('common.error'), t('messages.invalidWeight'));
      return;
    }
    
    if (!closedShiftId) return;
    
    // Get the current list and update it
    const byProductsToUpdate = showShiftClosedView ? closedShiftByProducts : savedByProductsOnStartPage;
    const updated = byProductsToUpdate.map((p, i) =>
      i === editingByProductIndex ? { ...p, weight: w } : p
    );
    
    // Update the appropriate list based on current view
    if (showShiftClosedView) {
      setClosedShiftByProducts(updated);
    } else {
      setSavedByProductsOnStartPage(updated);
    }
    
    setEditingByProductIndex(null);
    setEditByProductWeight('');
    
    try {
      await productionApi.updateByProducts(
        closedShiftId,
        updated.map(p => ({ stationId: p.stationId, name: p.name, weight: p.weight, category: p.category ?? '' }))
      );
    } catch (e) {
      Alert.alert(t('common.error'), t('messages.failedToSaveByProduct'));
    }
  };

  const saveClosedShiftRemark = async () => {
    if (closedShiftId == null) return;
    try {
      await productionApi.updateClosedShiftRemark(closedShiftId, closedShiftRemarkEdit);
      setClosedShiftMeta(prev => prev ? { ...prev, remark: closedShiftRemarkEdit } : null);
    } catch (e) {
      Alert.alert(t('common.error'), t('messages.failedToSaveByProduct'));
    }
  };

  const openEditLogWeight = (log: any) => {
    setEditingLogWeight(log);
    setEditWeightValue(String(log.weight || ''));
  };

  const saveEditedLogWeight = async () => {
    if (!editingLogWeight) return;
    const w = Number(editWeightValue);
    if (Number.isNaN(w) || w < 0) {
      Alert.alert(t('common.error'), t('messages.invalidWeight'));
      return;
    }

    setIsLoading(true);
    try {
      await productionApi.updateLogWeight(editingLogWeight.id, w);
      if (showShiftClosedView && closedShiftId) {
        setClosedShiftLogs(prev => prev.map(log => log.id === editingLogWeight.id ? { ...log, weight: w } : log));
        const sumRes = await productionApi.getClosedShiftSummary(closedShiftId);
        if (sumRes.data?.success && sumRes.data.data) {
          const d = sumRes.data.data;
          setClosedShiftMeta(prev => prev ? { ...prev, totalOutputs: d.totalOutputs ?? 0, totalWeight: d.totalWeight ?? '0.0', byStation: d.byStation ?? prev.byStation } : null);
        }
        setEditingLogWeight(null);
        setEditWeightValue('');
      } else {
      // Update the log in the appropriate list
      if (selectedStation?.name === 'Crusher') {
        setCrusherLogs(prev => prev.map(log => 
          log.id === editingLogWeight.id ? { ...log, weight: w } : log
        ));
      } else if (selectedStation?.name === 'Washing') {
        setWashingLogs(prev => prev.map(log => 
          log.id === editingLogWeight.id ? { ...log, weight: w } : log
        ));
      } else if (selectedStation?.name === 'Extrusion') {
        setExtrusionLogs(prev => prev.map(log => 
          log.id === editingLogWeight.id ? { ...log, weight: w } : log
        ));
      }
      
      // Also update in shiftLogs if present
      setShiftLogs(prev => prev.map(log => 
        log.id === editingLogWeight.id ? { ...log, weight: w } : log
      ));

      Alert.alert(t('common.success'), t('messages.weightUpdatedSuccessfully'));
      setEditingLogWeight(null);
      setEditWeightValue('');
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.response?.data?.message || t('messages.failedToUpdateWeight'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadCrusherLogs = async () => {
    // Load all entries (both 3E and Rapid) when no sub-line is selected
    // Load filtered entries when a sub-line is selected
    try {
      setCrusherLogsLoading(true);
      // Use line filter if set, otherwise use selectedSubLine for backward compatibility
      const lineFilter = selectedLineFilter !== 'all' ? selectedLineFilter : (selectedSubLine || undefined);
      const statusFilter = selectedStatusFilter !== 'all' ? selectedStatusFilter : undefined;
      
      const response = await productionApi.getCrusherLogs(
        lineFilter,
        selectedDate,
        searchQuery || undefined,
        statusFilter,
        currentPage,
        10,
        backendShiftId   // scope to current shift — prevents mixing logs from other shifts of the same day
      );
      if (response.data.success) {
        setCrusherLogs(response.data.data);
        setTotalPages(response.data.pagination.totalPages);
        setTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error loading crusher logs:', error);
    } finally {
      setCrusherLogsLoading(false);
    }
  };

  const loadWashingLogs = async () => {
    // Load all entries (Washing 1, 2, 3) when no sub-line is selected
    // Load filtered entries when a sub-line is selected
    try {
      setWashingLogsLoading(true);
      // Use line filter if set, otherwise use selectedSubLine for backward compatibility
      const lineFilter = washingSelectedLineFilter !== 'all' ? washingSelectedLineFilter : (selectedSubLine || undefined);
      const statusFilter = washingSelectedStatusFilter !== 'all' ? washingSelectedStatusFilter : undefined;
      
      const response = await productionApi.getWashingLogs(
        lineFilter,
        washingSelectedDate,
        washingSearchQuery || undefined,
        statusFilter,
        washingCurrentPage,
        10,
        backendShiftId   // scope to current shift
      );
      if (response.data.success) {
        setWashingLogs(response.data.data);
        setWashingTotalPages(response.data.pagination.totalPages);
        setWashingTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error loading washing logs:', error);
    } finally {
      setWashingLogsLoading(false);
    }
  };

  const loadExtrusionLogs = async () => {
    // Load all entries (Extrusion 1, 2, 3) when no sub-line is selected
    // Load filtered entries when a sub-line is selected
    try {
      setExtrusionLogsLoading(true);
      // Use line filter if set, otherwise use selectedSubLine for backward compatibility
      const lineFilter = extrusionSelectedLineFilter !== 'all' ? extrusionSelectedLineFilter : (selectedSubLine || undefined);
      const statusFilter = extrusionSelectedStatusFilter !== 'all' ? extrusionSelectedStatusFilter : undefined;
      
      const response = await productionApi.getExtrusionLogs(
        lineFilter,
        extrusionSelectedDate,
        extrusionSearchQuery || undefined,
        statusFilter,
        extrusionCurrentPage,
        10,
        backendShiftId   // scope to current shift
      );
      if (response.data.success) {
        setExtrusionLogs(response.data.data);
        setExtrusionTotalPages(response.data.pagination.totalPages);
        setExtrusionTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error loading extrusion logs:', error);
    } finally {
      setExtrusionLogsLoading(false);
    }
  };

  useEffect(() => {
    // Clear selected input bag when station or section changes
    setSelectedInputBag(null);
    setBagSearchQuery('');
    setSuggestedBags([]);
    setShowSuggestions(false);
  }, [selectedStation, selectedSection, selectedSubLine]);

  // Calculate extrusion totals based on material type and shift
  useEffect(() => {
    // Check if current station is Extrusion (by name, id, or code)
    const isExtrusionStation = selectedStation?.name?.toLowerCase().includes('extrusion') || 
                               selectedStation?.id === 4 ||
                               selectedStation?.code === 'EXT' ||
                               selectedStation?.code === 'EXTR';
    
    if (isExtrusionStation && backendShiftId && user?.materialTypeId) {
      // Filter shiftLogs for extrusion outputs matching:
      // - station_id = 4 (Extrusion) or matches selectedStation.id
      // - material_type_id = user's material type
      // - shift_id = current shift
      // - sub_line = selectedSubLine (if selected)
      const extrusionLogs = shiftLogs.filter((log: any) => {
        const matchesStation = log.station_id === 4 || log.station_id === selectedStation?.id;
        const matchesMaterial = log.material_type_id === user.materialTypeId;
        const matchesShift = log.shift_id === backendShiftId;
        const matchesSubLine = !selectedSubLine || log.sub_line === selectedSubLine;
        
        return matchesStation && matchesMaterial && matchesShift && matchesSubLine;
      });

      const totalBags = extrusionLogs.length;
      const totalWeight = extrusionLogs.reduce((acc: number, log: any) => {
        return acc + (Number(log.weight) || 0);
      }, 0);

      setCurrentViewBags(totalBags);
      setCurrentViewWeight(totalWeight);
    } else if (isExtrusionStation) {
      // Reset if no shift or material type
      setCurrentViewBags(0);
      setCurrentViewWeight(0);
    }
  }, [shiftLogs, selectedStation, selectedSubLine, backendShiftId, user?.materialTypeId]);

  useEffect(() => {
    // Load logs when in Crusher station view (whether sub-line is selected or not)
    if (selectedStation?.name === 'Crusher') {
      loadCrusherLogs();
    }
    // Load logs when in Washing station view (whether sub-line is selected or not)
    if (selectedStation?.name === 'Washing') {
      loadWashingLogs();
    }
    // Load logs when in Extrusion station view (whether sub-line is selected or not)
    if (selectedStation?.name === 'Extrusion') {
      loadExtrusionLogs();
    }
  }, [selectedSubLine, selectedDate, searchQuery, currentPage, selectedStation, selectedLineFilter, selectedStatusFilter, washingSelectedDate, washingSearchQuery, washingCurrentPage, washingSelectedLineFilter, washingSelectedStatusFilter, extrusionSelectedDate, extrusionSearchQuery, extrusionCurrentPage, extrusionSelectedLineFilter, extrusionSelectedStatusFilter]);

  useEffect(() => {
    if (showShiftClosedView && closedShiftId) {
      fetchClosedShiftByProducts();
    }
  }, [showShiftClosedView, closedShiftId, fetchClosedShiftByProducts]);

  const handleStationSelect = (station: Station) => {
    setCurrentViewBags(0);
    setCurrentViewWeight(0);
    if (station.name === 'Label Removal' || station.name === 'Crusher' || station.name === 'Washing' || station.name === 'Extrusion') {
      setSelectedStation(station); setSelectedSection(null);
    } else {
      setPendingStation(station); setShowStationModal(true);
    }
  };

  const handleTakePhoto = async () => {
    if (hasPermission === false) {
      Alert.alert(t('common.error'), t('messages.cameraPermissionRequired'));
      return;
    }
    setShowCameraPreview(true);
  };

  const handleCapturePhoto = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.7,
          base64: false,
        });
        if (photo) {
          setTempCapturedImage(photo.uri);
          setShowCameraPreview(false);
          setShowPhotoPreview(true);
        }
      } catch (error) {
        console.error('Error capturing photo:', error);
        Alert.alert(t('common.error'), t('messages.failedToCapturePhoto'));
      }
    }
  };

  const handleAcceptPhoto = () => {
    if (tempCapturedImage) {
      setCapturedImages(prev => [...prev, tempCapturedImage]);
      setShowPhotoPreview(false);
      setTempCapturedImage(null);
    }
  };

  const handleRetakePhoto = () => {
    setTempCapturedImage(null);
    setShowPhotoPreview(false);
    setShowCameraPreview(true);
  };

  const handleCancelPhoto = () => {
    setTempCapturedImage(null);
    setShowPhotoPreview(false);
    setShowCameraPreview(false);
  };

  const handleBarCodeScanned = async ({ data }: any) => {
    if (scanned) return; // Prevent multiple scans
    setScanned(true);
    try {
      let qrCode: string;
      let weight: number = 0;
      
      // Parse QR code data
      try {
        const parsed = JSON.parse(data);
        qrCode = parsed.id || data;
        weight = parsed.weight || 0;
      } catch (e) {
        qrCode = data;
      }

      // Validate the scanned QR code matches the expected batch type (same flow as search)
      // Washing input: Crusher batches only. Extrusion input: Washing batches only.
      let targetStationId: number | undefined;
      let statusFilter: string | undefined;
      let expectedStationName: string = '';

      // Betty crusher input: search for 3E/Rapid crusher bags
      const isBettyCrusherInput =
        selectedSection === 'input' &&
        selectedStation?.name?.toLowerCase().includes('crusher') &&
        selectedSubLine === 'Betty';

      if (isBettyCrusherInput) {
        const response = await productionApi.searchLogs(
          qrCode,
          selectedStation!.id,
          selectedStation!.id,
          'pending',
          ['3E', 'Rapid'],
        );
        if (response.data.success && response.data.data.length > 0) {
          const matchedBatch = response.data.data[0];
          setSelectedInputBag({ output_bag_qr: matchedBatch.output_bag_qr, weight: matchedBatch.weight || weight });
          setShowScanner(false);
        } else {
          Alert.alert('Invalid Batch', 'This QR is not a valid 3E or Rapid crusher bag with pending status.');
          setScanned(false);
        }
        return;
      }

      if (selectedSection === 'input' && (selectedStation?.id === 3 || selectedStation?.name?.toLowerCase().includes('washing'))) {
        // Washing input: Crusher batches (station_id = 2) with status pending only
        targetStationId = 2;
        statusFilter = 'pending';
        expectedStationName = 'crusher';
      } else if (selectedSection === 'input' && (selectedStation?.id === 4 || selectedStation?.name?.toLowerCase().includes('extrusion'))) {
        // Extrusion input: Washing batches (station_id = 3) with status pending only – same flow as Crusher→Washing
        targetStationId = 3;
        statusFilter = 'pending';
        expectedStationName = 'washing';
      } else if (selectedSection === 'input' && (selectedStation?.id === 5 || selectedStation?.name?.toLowerCase().includes('final') || selectedStation?.name?.toLowerCase().includes('packing'))) {
        // Final Packaging input: Extrusion batches for PC/PET flow, Washing batches for PE flow (no Extrusion station)
        const extStation = stations.find((s: Station) => s.name?.toLowerCase().includes('extrusion') || (s as any).code === 'EXT');
        const washStation = stations.find((s: Station) => s.name?.toLowerCase().includes('washing') || (s as any).code === 'WSH');
        if (extStation) {
          targetStationId = extStation.id;
          expectedStationName = 'extrusion';
        } else if (washStation) {
          targetStationId = washStation.id;
          expectedStationName = 'washing';
        }
        statusFilter = 'pending';
      }

      // If we have a target station, validate the QR code
      if (targetStationId && statusFilter) {
        const response = await productionApi.searchLogs(qrCode, targetStationId, selectedStation?.id, statusFilter);
        if (response.data.success && response.data.data.length > 0) {
          // Found matching batch - show batch no., user taps Save to process (same as manual search)
          const matchedBatch = response.data.data[0];
          setSelectedInputBag({ 
            output_bag_qr: matchedBatch.output_bag_qr, 
            weight: matchedBatch.weight || weight 
          });
          setShowScanner(false); // Close scanner only on success
        } else {
          // QR code doesn't match expected batch type (e.g. not a Crusher batch for Washing)
          Alert.alert(
            'Invalid Batch', 
            `This QR code is not a valid ${expectedStationName} batch with pending status. Please scan a ${expectedStationName} batch QR code.`
          );
          setScanned(false); // Allow scanning again
        }
      } else {
        // For other stations, just set the scanned data
        setSelectedInputBag({ output_bag_qr: qrCode, weight });
        setShowScanner(false); // Close scanner
      }
    } catch (error) {
      console.error('Scan validation error:', error);
      Alert.alert(t('common.error'), t('messages.failedToValidate'));
      setScanned(false); // Allow scanning again
    }
  };

  const handleLogProduction = async () => {
    if (!weightInput || !backendShiftId || !selectedStation) return;
    try {
      setIsLoading(true);
      setIsCurrentLogSaved(false); // Reset save state
      const response = await productionApi.getNextQr(selectedStation.id, backendShiftId, selectedSubLine || undefined, selectedShift?.id);
      if (response.data.success) {
        const qrCode = response.data.data?.qrCode;
        if (!qrCode || String(qrCode).trim() === '') {
          Alert.alert(t('common.error'), t('messages.failedToGenerateQR'));
          return;
        }
        // Use stationName from backend response (e.g., "Crusher-3E", "Washing-W1", "Extrusion-E1")
        const stationDisplay = response.data.data.details?.stationName || selectedStation.name;
        const lineDisplay = selectedSubLine || selectedStation.name;
        setPreviewData({
          qrCode: String(qrCode).trim(),
          weight: weightInput,
          station: stationDisplay || selectedStation.name,
          line: lineDisplay,
          date: new Date().toLocaleDateString()
        });
        setPreviewBagStatus((selectedStation.id === 2 || selectedStation.id === 3 || selectedStation.id === 4) ? 'pending' : 'Completed');
        setShowPrintPreview(true);
      } else {
        Alert.alert(t('common.error'), response.data?.message || t('messages.failedToGenerateQR'));
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('messages.failedToGenerateQR'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProduction = async () => {
    if (!previewData || !backendShiftId || !selectedStation) return;
    try {
      setIsLoading(true);
      // Worker-selected status: pending = temporary jumbo bag, Completed = final jumbo bag
      const status = previewBagStatus;
      // Send photos as comma-separated string (or first photo if only one)
      const photoUrl = capturedImages.length > 0 ? capturedImages.join(',') : null;
      
      // Use the weight captured at QR generation time (previewData.weight),
      // not the live input field which may already be cleared.
      const savedWeight = parseFloat(previewData.weight ?? weightInput);
      const response = await productionApi.logProduction({
        shiftId: backendShiftId,
        stationId: selectedStation.id,
        inputBagQr: selectedInputBag?.output_bag_qr || null,
        outputBagQr: previewData.qrCode,
        weight: isNaN(savedWeight) ? 0 : savedWeight,
        status: status,
        subLine: selectedSubLine || undefined,
        photoUrl: photoUrl,
        remark: remarkInput.trim() || undefined,
        shiftTypeId: selectedShift?.id
      });
      if (response.data.success) {
        const savedLog = response.data.data;
        const updatedLogs = [...shiftLogs, savedLog];
        setShiftLogs(updatedLogs);
        
        // Reload shift logs to get updated data (especially for extrusion totals calculation)
        if (backendShiftId) {
          try {
            const logsRes = await productionApi.getShiftLogs(backendShiftId);
            if (logsRes.data.success) {
              setShiftLogs(logsRes.data.data);
            }
          } catch (error) {
            console.error('Error reloading shift logs:', error);
          }
        }
        
        // For other stations (not extrusion), reset counters
        if (selectedStation?.name !== 'Extrusion') {
          setCurrentViewBags(0);
          setCurrentViewWeight(0);
        }
        // For extrusion, the useEffect will automatically recalculate totals

        setIsCurrentLogSaved(true); // Mark as saved
        setWeightInput(''); // Clear input field immediately after save
        setRemarkInput('');
        setCapturedImages([]); // Clear photos after saving
        Alert.alert(t('common.success'), t('messages.productionLogSaved'));
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('messages.failedToSaveProductionLog'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClosePreview = () => {
    setShowPrintPreview(false);
    setIsCurrentLogSaved(false);
    setWeightInput('');
    setRemarkInput('');
    setPreviewBagStatus('pending');
    setSelectedInputBag(null);
    setCapturedImages([]);
    // Keep user on station
  };

  const handleBack = () => {
    if (showShiftClosedView) {
      handleBackToShifts();
      return;
    }
    if (selectedStation?.name === 'Extrusion' && selectedSubLine) {
      if (selectedSection) {
        // Back from input/output → go to the inline section picker (keep subLine)
        setSelectedSection(null);
      } else {
        // Back from inline section picker → go back to sub-line list
        setSelectedSubLine(null);
      }
    } else if ((selectedStation?.name === 'Crusher' || selectedStation?.name === 'Washing') && selectedSubLine) {
      if (selectedSection) {
        // Betty: pressing back from input/output goes back to Betty's section picker
        // Other crusher lines don't have a section picker, so also clear subLine
        setSelectedSection(null);
        if (selectedSubLine !== 'Betty') setSelectedSubLine(null);
      } else {
        setSelectedSubLine(null);
      }
    } else {
      if (showEndShiftSummary) setShowEndShiftSummary(false);
      else setSelectedStation(null);
      setSelectedSubLine(null);
      setSelectedSection(null);
    }
  };

  const executePrint = async () => {
    if (!previewData) return;
    try {
      setIsPrinting(true);
      let qrBase64 = '';
      if (qrRef.current) {
        qrBase64 = await new Promise((resolve) => { qrRef.current.toDataURL((data: string) => { resolve(data); }); });
      }
      const printData = { ...previewData, qrImage: qrBase64 };
      const success = await printService.printQRLabel(printData);
      if (success) {
        setShowPrintPreview(false);
        setSelectedStation(null);
        setSelectedSubLine(null);
        setSelectedSection(null);
        setIsCurrentLogSaved(false);
        setPreviewData(null);
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('messages.printError'));
    } finally {
          setIsPrinting(false);
    }
  };

  const executeListPrint = async () => {
    if (!selectedLogForPrint) return;
    try {
      setIsPrinting(true);
      let qrBase64 = '';
      if (listQrRef.current) {
        qrBase64 = await new Promise((resolve) => { listQrRef.current.toDataURL((data: string) => { resolve(data); }); });
      }
      // Combine station with sub-line for crusher and washing (e.g., "Crusher-3E", "Washing-L1")
      let stationDisplay = 'Crusher';
      if (selectedLogForPrint.sub_line) {
        if (selectedLogForPrint.sub_line.includes('Washing')) {
          // Washing: "Washing-W1", "Washing-W2", or "Washing-W3"
          const lineNumber = selectedLogForPrint.sub_line.replace('Washing ', '');
          stationDisplay = `Washing-W${lineNumber}`;
        } else if (selectedLogForPrint.sub_line.includes('Extrusion')) {
          // Extrusion: "Extrusion-E1", "Extrusion-E2", or "Extrusion-E3"
          const lineNumber = selectedLogForPrint.sub_line.replace('Extrusion ', '');
          stationDisplay = `Extrusion-E${lineNumber}`;
        } else if (selectedLogForPrint.sub_line === 'Mixture') {
          // Mixture: "Extrusion-MIX"
          stationDisplay = 'Extrusion-MIX';
        } else {
          // Crusher: "Crusher-3E" or "Crusher-Rapid"
          stationDisplay = `Crusher-${selectedLogForPrint.sub_line}`;
        }
      } else if (selectedLogForPrint.station_id === 4) {
        // Fallback for extrusion without sub_line
        stationDisplay = 'Extrusion';
      }
      
      const printData = {
        qrCode: selectedLogForPrint.output_bag_qr,
        weight: selectedLogForPrint.weight,
        station: stationDisplay,
        line: selectedLogForPrint.sub_line || selectedStation?.name || 'N/A',
        date: new Date(selectedLogForPrint.created_at).toLocaleDateString(),
        qrImage: qrBase64
      };
      const success = await printService.printQRLabel(printData);
      if (success) { setShowListPrintPreview(false); setSelectedLogForPrint(null); }
    } catch (error) {
      Alert.alert(t('common.error'), t('messages.printError'));
    } finally {
      setIsPrinting(false);
    }
  };

  const onBagSearch = async (text: string) => {
    setBagSearchQuery(text);
    try {
      let targetStationId: number | undefined;
      let statusFilter: string | undefined;

      // Betty crusher: input comes from 3E/Rapid crusher outputs only
      const isBettyCrusherInput =
        selectedStation?.name?.toLowerCase().includes('crusher') &&
        selectedSubLine === 'Betty' &&
        selectedSection === 'input';

      if (isBettyCrusherInput) {
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        const response = await productionApi.searchLogs(
          text,
          selectedStation!.id, // same Crusher station
          selectedStation!.id,  // current station = Crusher (to exclude already-in-use bags)
          'pending',
          ['3E', 'Rapid'],      // only 3E and Rapid sub-lines
        );
        if (response.data.success) {
          setSuggestedBags(response.data.data);
          setShowSuggestions(response.data.data.length > 0);
        } else {
          setSuggestedBags([]);
          setShowSuggestions(false);
        }
        return;
      }

      if (selectedStation?.id === 3) {
        // For washing, only search if user has typed something
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        targetStationId = 2; // Washing searches from Crusher
        statusFilter = 'pending'; // Only show pending crusher batches
        const response = await productionApi.searchLogs(text, targetStationId, selectedStation.id, statusFilter);
        if (response.data.success) { 
          setSuggestedBags(response.data.data); 
          setShowSuggestions(response.data.data.length > 0); 
        } else {
          setSuggestedBags([]);
          setShowSuggestions(false);
        }
        return;
      }
      // Check for Extrusion station - be more explicit
      const isExtrusionStation = selectedStation?.id === 4 || 
                                 selectedStation?.name?.toLowerCase() === 'extrusion' ||
                                 selectedStation?.name?.toLowerCase().includes('extrusion') ||
                                 selectedStation?.code === 'EXT';
      
      if (isExtrusionStation) {
        // For extrusion, only search if user has typed something
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        // Extrusion searches from Washing (station_id = 3) with status pending
        targetStationId = 3; // Washing station ID
        statusFilter = 'pending'; // Only show pending washing batches
        const response = await productionApi.searchLogs(text, targetStationId, selectedStation.id, statusFilter);
        if (response.data.success) { 
          setSuggestedBags(response.data.data); 
          setShowSuggestions(response.data.data.length > 0); 
        } else {
          setSuggestedBags([]);
          setShowSuggestions(false);
        }
        return;
      }
      // Final Packaging: Extrusion batches for PC/PET flow, Washing batches for PE flow (no Extrusion station)
      const isFinalPackaging = selectedStation?.id === 5 ||
        selectedStation?.name?.toLowerCase().includes('final') ||
        selectedStation?.name?.toLowerCase().includes('packing');
      if (isFinalPackaging) {
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        const extStation = stations.find((s: Station) => s.name?.toLowerCase().includes('extrusion') || (s as any).code === 'EXT');
        const washStation = stations.find((s: Station) => s.name?.toLowerCase().includes('washing') || (s as any).code === 'WSH');
        targetStationId = extStation ? extStation.id : (washStation?.id ?? 3);
        statusFilter = 'pending';
        const response = await productionApi.searchLogs(text, targetStationId, selectedStation?.id, statusFilter);
        if (response.data.success) {
          setSuggestedBags(response.data.data);
          setShowSuggestions(response.data.data.length > 0);
        } else {
          setSuggestedBags([]);
          setShowSuggestions(false);
        }
        return;
      }
      // For other stations, require at least 2 characters
      if (text.length < 2) {
        setSuggestedBags([]);
        setShowSuggestions(false);
        return;
      }
      const response = await productionApi.searchLogs(text, targetStationId, selectedStation?.id);
      if (response.data.success) {
        setSuggestedBags(response.data.data);
        setShowSuggestions(response.data.data.length > 0);
      } else {
        setSuggestedBags([]);
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error('Search error', error);
      setSuggestedBags([]);
      setShowSuggestions(false);
    }
  };

  const handleBagSearchFocus = async () => {
    // Don't auto-load suggestions on focus - only show if user has typed something
    setShowSuggestions(suggestedBags.length > 0);
  };

  const renderStationIcon = (name: string, color: string) => {
    const props = { color: '#FFF', size: 24 };
    switch (name) {
      case 'Label Removal': return <Box {...props} />;
      case 'Crusher': return <Package {...props} />;
      case 'Washing': return <Droplets {...props} />;
      case 'Extrusion': return <Zap {...props} />;
      case 'Final Packaging': return <Box {...props} />;
      default: return <Package {...props} />;
    }
  };

  if (isLoading && !isShiftActive) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#17a34a" /></View>;

  return (
    <SafeAreaView style={styles.container} edges={Platform.OS === 'web' ? [] : ['top', 'bottom']}>
      {toastMessage ? (
        <View style={styles.toast}>
          <Text style={styles.toastText} numberOfLines={3}>{toastMessage}</Text>
          <TouchableOpacity onPress={() => setToastMessage(null)} style={styles.toastClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <X color="#FFF" size={20} />
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!selectedStation && !showEndShiftSummary && !showShiftClosedView ? (
              <TouchableOpacity onPress={() => {
                // Clear saved by-products when navigating to shift selection
                setSavedByProductsOnStartPage([]);
                setSavedByProductsMeta(null);
                setClosedShiftId(null);
                navigation.navigate('ShiftSelection');
              }} style={styles.headerPill}>
                <Text style={styles.pillLabel}>Shift</Text>
                <Text style={styles.pillValue}>{selectedShift?.name || 'Shift 1'}</Text>
              </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <ArrowLeft color="#333" size={24} />
              <View style={{ marginLeft: 10 }}>
                <Text style={styles.stationTitle}>
                  {showShiftClosedView ? (viewingActiveShift ? 'Active Shift' : 'Shift closed') : showEndShiftSummary ? 'End Shift' : (selectedStation?.name === 'Washing' ? selectedStation?.name : (selectedSubLine ? `${selectedStation?.name} (${selectedSubLine})` : selectedStation?.name))}
                </Text>
                {!showEndShiftSummary && !showShiftClosedView && <View style={styles.contextPills}><Text style={styles.smallPill}>{selectedShift?.name}</Text></View>}
              </View>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={handleSelectPrinter} style={[styles.printerHeaderButton, selectedPrinter && styles.printerActive]}><PrinterIcon color={selectedPrinter ? "#17a34a" : "#666"} size={20} /></TouchableOpacity>
              <Text style={styles.userName}>{user?.name}</Text>
          <TouchableOpacity onPress={logout} style={styles.logoutButton}><LogOut color="#EB445A" size={24} /></TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={true}
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled={true}
        scrollEnabled={true}
        bounces={Platform.OS !== 'web'}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
        removeClippedSubviews={false}
        scrollEventThrottle={16}
        persistentScrollbar={Platform.OS === 'web'}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustContentInsets={false}
        directionalLockEnabled={true}
        canCancelContentTouches={true}
        decelerationRate="normal"
        pagingEnabled={false}
        scrollsToTop={true}>
        {showShiftClosedView ? (
          <View style={styles.summaryContainer}>
            {/* LIVE banner — shown when PPIC is viewing an ongoing shift */}
            {viewingActiveShift && (
              <View style={styles.ppicLiveBanner}>
                <View style={styles.ppicLiveDotBanner} />
                <Text style={styles.ppicLiveBannerText}>
                  Live data — this shift is still running. Refresh to see latest outputs.
                </Text>
                <TouchableOpacity onPress={() => closedShiftId && handleSelectAnyShift(closedShiftId, true)}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#15803D' }}>Refresh</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.summaryStatsCard}>
              <Text style={styles.cardTitle}>
                {viewingActiveShift ? 'Active Shift — Live Data' : t('dashboard.shiftClosedSuccessfully')}
              </Text>
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{t('dashboard.remark')}</Text>
                <TextInput
                  style={[styles.input, { minHeight: 44, backgroundColor: '#f8fafc', borderRadius: 8 }]}
                  placeholder={t('dashboard.remarkPlaceholder')}
                  placeholderTextColor="#94a3b8"
                  value={closedShiftRemarkEdit}
                  onChangeText={setClosedShiftRemarkEdit}
                  multiline
                  numberOfLines={2}
                />
                <TouchableOpacity onPress={saveClosedShiftRemark} style={[styles.editByProductBtn, { alignSelf: 'flex-start', marginTop: 6 }]}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#0ea5e9' }}>{t('common.save')} {t('dashboard.remark')}</Text>
                </TouchableOpacity>
              </View>
              {/* ── Production Outputs: categorised + search + pagination ── */}
              {closedShiftLogsLoading ? (
                <View style={{ marginVertical: 12, alignItems: 'center' }}><ActivityIndicator color="#333" /></View>
              ) : closedShiftLogs.length > 0 ? (() => {
                // Classify each log into a category
                const categorise = (log: any) => {
                  const st = stations.find(s => s.id === log.station_id);
                  const name = (st?.name ?? '').toLowerCase();
                  const code = ((st as any)?.code ?? '').toUpperCase();
                  if (code === 'CRS' || name.includes('crusher')) return 'crusher';
                  if (code === 'WSH' || name.includes('washing')) return 'washing';
                  if (code === 'EXT' || code === 'EXTR' || name.includes('extrusion')) return 'extrusion';
                  return 'other';
                };
                const q = shiftLogsSearch.trim().toLowerCase();
                const filtered = closedShiftLogs.filter((log: any) => {
                  if (!q) return true;
                  const qr = (log.output_bag_qr || log.outputBagQr || '').toLowerCase();
                  const st = stations.find(s => s.id === log.station_id);
                  const sn = (st?.name ?? '').toLowerCase();
                  const sl = (log.sub_line ?? '').toLowerCase();
                  return qr.includes(q) || sn.includes(q) || sl.includes(q);
                });
                const cats: { key: string; label: string; color: string; accent: string; page: number; setPage: (p: number) => void }[] = [
                  { key: 'crusher',   label: 'Crusher',   color: '#FFF7ED', accent: '#EA580C', page: shiftLogsPageCrusher,   setPage: setShiftLogsPageCrusher },
                  { key: 'washing',   label: 'Washing',   color: '#EFF6FF', accent: '#2563EB', page: shiftLogsPageWashing,   setPage: setShiftLogsPageWashing },
                  { key: 'extrusion', label: 'Extrusion', color: '#F0FDF4', accent: '#16A34A', page: shiftLogsPageExtrusion, setPage: setShiftLogsPageExtrusion },
                  { key: 'other',     label: 'Other',     color: '#F8FAFC', accent: '#64748B', page: 1,                      setPage: () => {} },
                ];
                return (
                  <View style={{ marginTop: 16 }}>
                    <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>{t('dashboard.productionOutputs')}</Text>
                    <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>{t('dashboard.editAnyDataHint')}</Text>
                    {/* Search bar */}
                    <View style={styles.shiftLogsSearchBar}>
                      <Search size={16} color="#94a3b8" />
                      <TextInput
                        style={styles.shiftLogsSearchInput}
                        placeholder="Search QR code, station, sub-line…"
                        placeholderTextColor="#94a3b8"
                        value={shiftLogsSearch}
                        onChangeText={(t) => { setShiftLogsSearch(t); setShiftLogsPageCrusher(1); setShiftLogsPageWashing(1); setShiftLogsPageExtrusion(1); }}
                        returnKeyType="search"
                      />
                      {shiftLogsSearch !== '' && (
                        <TouchableOpacity onPress={() => setShiftLogsSearch('')}>
                          <X size={16} color="#94a3b8" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
                      {filtered.length} of {closedShiftLogs.length} entries
                    </Text>
                    {cats.map(cat => {
                      const rows = filtered.filter((l: any) => categorise(l) === cat.key);
                      if (rows.length === 0) return null;
                      const totalPages = Math.ceil(rows.length / SHIFT_LOGS_PAGE_SIZE);
                      const page = Math.min(cat.page, totalPages);
                      const pageRows = rows.slice((page - 1) * SHIFT_LOGS_PAGE_SIZE, page * SHIFT_LOGS_PAGE_SIZE);
                      const catWeight = rows.reduce((s: number, l: any) => s + Number(l.weight || 0), 0).toFixed(1);
                      return (
                        <View key={cat.key} style={[styles.shiftLogCategory, { backgroundColor: cat.color, borderColor: cat.accent + '55' }]}>
                          {/* Category header */}
                          <View style={styles.shiftLogCategoryHeader}>
                            <View style={[styles.shiftLogCatDot, { backgroundColor: cat.accent }]} />
                            <Text style={[styles.shiftLogCatLabel, { color: cat.accent }]}>{cat.label}</Text>
                            <View style={styles.shiftLogCatBadge}>
                              <Text style={[styles.shiftLogCatBadgeText, { color: cat.accent }]}>{rows.length} bags</Text>
                            </View>
                            <Text style={[styles.shiftLogCatWeight, { color: cat.accent }]}>{catWeight} kg</Text>
                          </View>
                          {/* Rows */}
                          {pageRows.map((log: any) => {
                            const st = stations.find(s => s.id === log.station_id);
                            const stationName = st?.name ?? String(log.station_id);
                            const qr = log.output_bag_qr || log.outputBagQr || '—';
                            const sl = log.sub_line ? ` · ${log.sub_line}` : '';
                            const statusColor = log.status === 'Cancelled' ? '#ef4444' : log.status === 'pending' ? '#f59e0b' : '#22c55e';
                            return (
                              <View key={log.id} style={styles.shiftLogRow}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={styles.shiftLogQr} numberOfLines={1}>{qr}</Text>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <Text style={styles.shiftLogMeta}>{stationName}{sl}</Text>
                                    <View style={[styles.shiftLogStatusDot, { backgroundColor: statusColor }]} />
                                    <Text style={[styles.shiftLogMeta, { color: statusColor }]}>{log.status}</Text>
                                  </View>
                                </View>
                                <Text style={styles.shiftLogWeight}>{Number(log.weight) || 0} kg</Text>
                                {/* Print button */}
                                <TouchableOpacity
                                  onPress={() => { setSelectedLogForPrint(log); setShowListPrintPreview(true); }}
                                  style={styles.shiftLogPrintBtn}
                                >
                                  <PrinterIcon color="#475569" size={14} />
                                </TouchableOpacity>
                                {/* Edit button */}
                                <TouchableOpacity onPress={() => openEditLogWeight(log)} style={styles.shiftLogEditBtn}>
                                  <Pencil color="#0ea5e9" size={14} />
                                  <Text style={styles.shiftLogEditText}>Edit</Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                          {/* Pagination */}
                          {totalPages > 1 && (
                            <View style={styles.shiftLogPager}>
                              <TouchableOpacity
                                style={[styles.shiftLogPagerBtn, page === 1 && styles.shiftLogPagerBtnDisabled]}
                                onPress={() => cat.setPage(Math.max(1, page - 1))}
                                disabled={page === 1}
                              >
                                <ChevronLeft size={16} color={page === 1 ? '#cbd5e1' : cat.accent} />
                              </TouchableOpacity>
                              <Text style={[styles.shiftLogPagerText, { color: cat.accent }]}>
                                {page} / {totalPages}
                              </Text>
                              <TouchableOpacity
                                style={[styles.shiftLogPagerBtn, page === totalPages && styles.shiftLogPagerBtnDisabled]}
                                onPress={() => cat.setPage(Math.min(totalPages, page + 1))}
                                disabled={page === totalPages}
                              >
                                <ChevronRight size={16} color={page === totalPages ? '#cbd5e1' : cat.accent} />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                );
              })() : null}
              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t('dashboard.wasteFromProcess')}</Text>
              <Text style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{t('dashboard.tapEditToChangeAgain')}</Text>
              {closedByProductsLoading ? (
                <View style={{ marginVertical: 24, alignItems: 'center' }}><ActivityIndicator color="#333" /></View>
              ) : closedShiftByProducts.length === 0 ? (
                <Text style={{ fontSize: 14, color: '#666', marginVertical: 16 }}>{t('dashboard.noByProducts')}</Text>
              ) : (
                (() => {
                  let lastProcess = '';
                  return closedShiftByProducts.map((item, index) => {
                    const pl = item.processLabel || getProcessLabel(item.stationName);
                    const showHeader = pl !== lastProcess;
                    if (showHeader) lastProcess = pl;
                    return (
                      <View key={index}>
                        {showHeader ? <Text style={[styles.processSectionHeader, { marginTop: index > 0 ? 16 : 0 }]}>{getProcessTitle(pl)} :</Text> : null}
                        <View style={[styles.byProductRow, { marginBottom: 8 }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.byProductName}>{item.name}</Text>
                            <Text style={styles.byProductStation}>{item.stationName} — {item.category}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={[styles.byProductName, { marginRight: 12 }]}>{Number(item.weight) || 0} kg</Text>
                            <TouchableOpacity onPress={() => openEditByProduct(index)} style={styles.editByProductBtn} accessibilityLabel="Edit weight">
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Pencil color="#0ea5e9" size={16} />
                                <Text style={{ fontSize: 14, fontWeight: '600', color: '#0ea5e9', marginLeft: 4 }}>{t('common.edit')}</Text>
                              </View>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  });
                })()
              )}
            </View>
            <View style={{ marginTop: 20, marginBottom: 24 }}>
              {/* Print / PDF row */}
              <TouchableOpacity style={[styles.closeShiftBtn, { marginBottom: 10, backgroundColor: '#16A34A' }]} onPress={handleGeneratePdfAgain}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <FileText color="#FFF" size={20} />
                  <Text style={[styles.closeShiftText, { marginLeft: 8 }]}>
                    {viewingActiveShift ? 'Print Live Report (PDF)' : 'Generate PDF Report'}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.closeShiftBtn, { backgroundColor: '#0ea5e9' }]} onPress={handleBackToShifts}>
                <Text style={styles.closeShiftText}>{t('dashboard.backToShifts')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : showEndShiftSummary ? (
          <View style={styles.summaryContainer}>
            <View style={styles.summaryStatsCard}>
              <Text style={styles.cardTitle}>{t('dashboard.shiftSummary')}</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}><Text style={styles.summaryValue}>{shiftDuration}</Text><Text style={styles.summaryLabel}>{t('dashboard.duration')}</Text></View>
                {(() => {
                  const crusherSt = stations.find(s => s.name?.toLowerCase().includes('crusher') || (s as any).code === 'CRS');
                  const washingSt = stations.find(s => s.name?.toLowerCase().includes('washing') || (s as any).code === 'WSH');
                  const extrusionSt = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4 || (s as any).code === 'EXT');
                  const co = crusherSt ? shiftLogs.filter((l: any) => l.station_id === crusherSt.id).length : 0;
                  const wo = washingSt ? shiftLogs.filter((l: any) => l.station_id === washingSt.id).length : 0;
                  const eo = extrusionSt ? shiftLogs.filter((l: any) => l.station_id === extrusionSt.id).length : 0;
                  const cw = crusherSt ? shiftLogs.filter((l: any) => l.station_id === crusherSt.id).reduce((a: number, l: any) => a + Number(l.weight || 0), 0).toFixed(1) : '0.0';
                  const ww = washingSt ? shiftLogs.filter((l: any) => l.station_id === washingSt.id).reduce((a: number, l: any) => a + Number(l.weight || 0), 0).toFixed(1) : '0.0';
                  const ew = extrusionSt ? shiftLogs.filter((l: any) => l.station_id === extrusionSt.id).reduce((a: number, l: any) => a + Number(l.weight || 0), 0).toFixed(1) : '0.0';
                  const totalO = co + wo + eo;
                  const totalW = (Number(cw) + Number(ww) + Number(ew)).toFixed(1);
                  return (
                    <>
                      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{co}</Text><Text style={styles.summaryLabel}>{t('print.crusher')} {t('dashboard.totalOutputs')}</Text></View>
                      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{wo}</Text><Text style={styles.summaryLabel}>{t('print.washing')} {t('dashboard.totalOutputs')}</Text></View>
                      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{eo}</Text><Text style={styles.summaryLabel}>{t('print.extrusion')} {t('dashboard.totalOutputs')}</Text></View>
                      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{totalO}</Text><Text style={styles.summaryLabel}>{t('print.total')} {t('dashboard.totalOutputs')}</Text></View>
                      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{cw} kg</Text><Text style={styles.summaryLabel}>{t('print.crusher')} {t('dashboard.totalKg')}</Text></View>
                      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{ww} kg</Text><Text style={styles.summaryLabel}>{t('print.washing')} {t('dashboard.totalKg')}</Text></View>
                      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{ew} kg</Text><Text style={styles.summaryLabel}>{t('print.extrusion')} {t('dashboard.totalKg')}</Text></View>
                      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{totalW} kg</Text><Text style={styles.summaryLabel}>{t('print.total')} {t('dashboard.totalKg')}</Text></View>
                    </>
                  );
                })()}
              </View>
            </View>
            <Text style={styles.sectionTitle}>{t('dashboard.wasteFromProcess')}</Text>
            <Text style={[styles.sectionTitle, { fontSize: 11, color: '#64748b', marginTop: -8, marginBottom: 12 }]}>{t('dashboard.wasteOptional')}</Text>
            {(() => {
              let lastProcess = '';
              return byProductsInputs.map((item, index) => {
                const pl = item.processLabel || getProcessLabel(item.stationName);
                const showHeader = pl !== lastProcess;
                if (showHeader) lastProcess = pl;
                return (
                  <View key={index}>
                    {showHeader ? <Text style={[styles.processSectionHeader, { marginTop: index > 0 ? 16 : 0 }]}>{getProcessTitle(pl)} :</Text> : null}
                    <View style={styles.byProductRow}>
                      <View style={{ flex: 1 }}><Text style={styles.byProductName}>{item.name}</Text></View>
                      <View style={styles.byProductInputWrapper}>
                        <TextInput
                          style={styles.byProductInput}
                          keyboardType="decimal-pad"
                          value={typeof item.weight === 'number' ? (item.weight === 0 ? '' : String(item.weight)) : String(item.weight ?? '')}
                          onChangeText={(val) => {
                            const next = byProductsInputs.map((p, i) =>
                              i === index ? { ...p, weight: val } : p
                            );
                            setByProductsInputs(next);
                          }}
                        />
                        <Text style={styles.unitLabel}>kg</Text>
                      </View>
                    </View>
                  </View>
                );
              });
            })()}
            <View style={[styles.inputGroup, { marginTop: 12 }]}>
              <Text style={styles.label}>{t('dashboard.remark')}</Text>
              <TextInput
                style={[styles.input, { minHeight: 44 }]}
                placeholder={t('dashboard.remarkPlaceholder')}
                placeholderTextColor="#94a3b8"
                value={endShiftRemark}
                onChangeText={setEndShiftRemark}
                multiline
                numberOfLines={2}
              />
            </View>
            <Text style={styles.afterCloseHint}>{t('dashboard.afterCloseHint')}</Text>
            <TouchableOpacity style={styles.closeShiftBtn} onPress={handleCloseShift} disabled={isLoading}>{isLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.closeShiftText}>{t('dashboard.closeShift')}</Text>}</TouchableOpacity>
          </View>
        ) : !isShiftActive ? (
          <View style={styles.startShiftContainer}>
            {user?.role?.toLowerCase() === 'ppic' ? (
              <View style={styles.ppicHomeContainer}>

                {/* ── Active / Ongoing Shifts ── */}
                <View style={styles.ppicSectionHeader}>
                  <View style={styles.ppicLiveDot} />
                  <Text style={styles.ppicSectionTitle}>Active Shifts</Text>
                  <TouchableOpacity onPress={loadPpicActiveShifts} style={{ marginLeft: 'auto' }}>
                    <Text style={{ fontSize: 12, color: '#0ea5e9', fontWeight: '600' }}>Refresh</Text>
                  </TouchableOpacity>
                </View>

                {ppicActiveShiftsLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 14 }}>
                    <ActivityIndicator size="small" color="#17a34a" />
                    <Text style={{ fontSize: 12, color: '#666', marginTop: 6 }}>Loading active shifts…</Text>
                  </View>
                ) : ppicActiveShifts.length === 0 ? (
                  <View style={styles.ppicEmptyActive}>
                    <Text style={styles.ppicEmptyActiveText}>No shifts are currently running.</Text>
                  </View>
                ) : (
                  ppicActiveShifts.map((s: any) => (
                    <TouchableOpacity
                      key={s.shiftId}
                      style={styles.ppicActiveShiftCard}
                      activeOpacity={0.8}
                      onPress={() => handleSelectAnyShift(s.shiftId, true)}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                          <View style={styles.ppicLivePill}>
                            <View style={styles.ppicLiveDotSmall} />
                            <Text style={styles.ppicLivePillText}>LIVE</Text>
                          </View>
                          <Text style={styles.ppicActiveShiftName} numberOfLines={1}>{s.shiftType}</Text>
                        </View>
                        <Text style={styles.ppicActiveShiftOperator}>Operator: {s.operatorName}</Text>
                        <Text style={styles.ppicActiveShiftMeta}>
                          {s.outputsSoFar} outputs · {s.weightSoFar} kg
                        </Text>
                      </View>
                      <ChevronRight color="#17a34a" size={20} />
                    </TouchableOpacity>
                  ))
                )}

                {/* ── Closed Reports ── */}
                <View style={[styles.ppicSectionHeader, { marginTop: 20 }]}>
                  <FileText color="#0ea5e9" size={14} />
                  <Text style={[styles.ppicSectionTitle, { marginLeft: 6, color: '#0ea5e9' }]}>Closed Reports</Text>
                </View>

                <Text style={styles.ppicHomeSubtitle}>{t('dashboard.ppicHomeSubtitle')}</Text>
                <View style={styles.ppicHomeCard}>
                  <Text style={styles.ppicHomeLabel}>{t('dashboard.ppicSelectDate')}</Text>
                  <StationDatePicker
                    value={parseDateLocal(ppicSelectedDate)}
                    onChange={(date) => setPpicSelectedDate(formatDateLocal(date))}
                    maximumDate={maxDate}
                  />
                </View>
                <View style={styles.ppicHomeCard}>
                  <Text style={styles.ppicHomeLabel}>{t('dashboard.ppicSelectShift')}</Text>
                  <View style={styles.ppicShiftRow}>
                    <TouchableOpacity
                      style={[styles.ppicShiftBtn, ppicSelectedShiftId === null && styles.ppicShiftBtnActive]}
                      onPress={() => setPpicSelectedShiftId(null)}
                    >
                      <Text style={[styles.ppicShiftBtnText, ppicSelectedShiftId === null && styles.ppicShiftBtnTextActive]}>{t('dashboard.all')}</Text>
                    </TouchableOpacity>
                    {ppicShifts.map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.ppicShiftBtn, ppicSelectedShiftId === s.id && styles.ppicShiftBtnActive]}
                        onPress={() => setPpicSelectedShiftId(s.id)}
                      >
                        <Text style={[styles.ppicShiftBtnText, ppicSelectedShiftId === s.id && styles.ppicShiftBtnTextActive]}>{s.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <TouchableOpacity style={[styles.closeShiftBtn, { marginTop: 16, backgroundColor: '#0ea5e9' }]} onPress={() => handleOpenClosedReports(ppicSelectedDate, ppicSelectedShiftId)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <FileText color="#FFF" size={20} />
                    <Text style={[styles.closeShiftText, { marginLeft: 8 }]}>{t('dashboard.viewEditClosedReports')}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ width: '100%' }}>
            <TouchableOpacity style={styles.startShiftCard} onPress={handleStartShift}>
              <View style={styles.playIconCircle}><Play fill="#FFF" color="#FFF" size={24} /></View>
              <View style={styles.startShiftText}><Text style={styles.startShiftTitle}>{t('dashboard.startShift')}</Text><Text style={styles.startShiftSubtitle}>{t('dashboard.tapToBegin')}</Text></View>
              <ChevronRight color="#FFF" size={24} />
            </TouchableOpacity>
            {savedByProductsOnStartPage.length > 0 && (
              <View style={styles.summaryStatsCard}>
                <Text style={styles.cardTitle}>{t('dashboard.wasteFromProcess')}</Text>
                <Text style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{t('dashboard.tapEditToChange')}</Text>
                {(() => {
                  let lastProcess = '';
                  return savedByProductsOnStartPage.map((item, index) => {
                    const pl = item.processLabel || getProcessLabel(item.stationName);
                    const showHeader = pl !== lastProcess;
                    if (showHeader) lastProcess = pl;
                    return (
                      <View key={index}>
                        {showHeader ? <Text style={[styles.processSectionHeader, { marginTop: index > 0 ? 16 : 0 }]}>{getProcessTitle(pl)} :</Text> : null}
                        <View style={[styles.byProductRow, { marginBottom: 8 }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.byProductName}>{item.name}</Text>
                            <Text style={styles.byProductStation}>{item.stationName} — {item.category}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={[styles.byProductName, { marginRight: 12 }]}>{Number(item.weight) || 0} kg</Text>
                            <TouchableOpacity onPress={() => openEditByProduct(index)} style={styles.editByProductBtn} accessibilityLabel="Edit weight">
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Pencil color="#0ea5e9" size={16} />
                                <Text style={{ fontSize: 14, fontWeight: '600', color: '#0ea5e9', marginLeft: 4 }}>{t('common.edit')}</Text>
                              </View>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  });
                })()}
                <TouchableOpacity style={[styles.closeShiftBtn, { marginTop: 16 }]} onPress={handleGeneratePdfAgain}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <FileText color="#FFF" size={20} />
                    <Text style={[styles.closeShiftText, { marginLeft: 8 }]}>{t('dashboard.generatePDF')}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
              </View>
            )}
          </View>
        ) : !selectedStation ? (
          <View style={styles.dashboardGrid}>
            <View style={styles.statusRow}>
              <View style={styles.activeStatus}><View style={styles.statusDot} /><Text style={styles.statusText}>{t('dashboard.shiftActive')}</Text></View>
                <Text style={styles.durationText}>{shiftDuration}</Text>
              </View>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {(() => {
                    const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4);
                    if (!extrusionStation) return 0;
                    const extrusionLogs = shiftLogs.filter((l: any) => l.station_id === extrusionStation.id);
                    return extrusionLogs.length;
                  })()}
                </Text>
                <Text style={styles.statLabel}>Outputs</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {(() => {
                    const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4);
                    if (!extrusionStation) return '0.0';
                    const extrusionLogs = shiftLogs.filter((l: any) => l.station_id === extrusionStation.id);
                    return extrusionLogs.reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0).toFixed(1);
                  })()}
                </Text>
                <Text style={styles.statLabel}>Total kg</Text>
              </View>
              </View>
            <Text style={styles.sectionTitle}>{t('dashboard.selectStation')}</Text>
            {stations.map((s) => (
              <TouchableOpacity key={s.id} style={styles.stationCard} onPress={() => handleStationSelect(s)}>
                <View style={[styles.stationIconBox, { backgroundColor: s.color }]}>{renderStationIcon(s.name, s.color)}</View>
                <View style={styles.stationInfo}><Text style={styles.stationName}>{s.name}</Text><Text style={styles.stationDesc} numberOfLines={1}>{s.description}</Text></View>
                <View style={styles.stationMiniStats}><Text style={styles.miniStat}>{shiftLogs.filter(l => l.station_id === s.id).length} bags</Text></View>
                <ChevronRight color="#CCC" size={20} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.endShiftButton} onPress={handleEndShift}><Square color="#FFF" size={20} /><Text style={styles.endShiftText}>{t('dashboard.closeShift')}</Text></TouchableOpacity>
          </View>
        ) : (
          <View style={styles.detailContainer}>
            {selectedStation.name === 'Label Removal' ? (
              <View>
                <View style={[styles.stationHero, { backgroundColor: selectedStation.color }]}>
                  <View style={styles.heroHeader}>
                    <View style={styles.heroIconCircle}>
                    {renderStationIcon(selectedStation.name, selectedStation.color)}
                    </View>
                    <View style={{ marginLeft: 15, flex: 1 }}>
                      <Text style={styles.heroTitle}>{selectedStation.name}</Text>
                      <Text style={styles.heroDesc}>Shift tracking only</Text>
                    </View>
                  </View>
                  <View style={styles.statusBox}>
                    <Text style={styles.statusLabel}>Status</Text>
                    <Text style={styles.statusValue}>Continuous Operation</Text>
                    <Text style={styles.statusDesc}>No individual output tracking at this station. Material flows continuously to Crusher.</Text>
                  </View>
                </View>

                <View style={styles.byProductsCard}>
                  <View style={styles.byProductsHeader}>
                    <Trash2 size={24} color="#b45309" />
                    <View style={{ marginLeft: 12 }}>
                    <Text style={styles.byProductsTitle}>By-Products</Text>
                  <Text style={styles.byProductsSubtitle}>Will be recorded at end of shift</Text>
                  </View>
                </View>
                  <View style={styles.bulletList}>
                    <Text style={styles.bulletItem}>• PP Cords (Sellable)</Text>
                    <Text style={styles.bulletItem}>• Dust (Landfill)</Text>
                    <Text style={styles.bulletItem}>• Floor Sweep (Landfill)</Text>
                  </View>
                </View>
              </View>
            ) : selectedStation.name === 'Crusher' ? (
              <View style={styles.crusherContainer}>
                {!selectedSubLine ? (
                  <View style={styles.selectionContainer}>
                    <Text style={styles.selectionTitle}>Select Crusher Line</Text>
                    <TouchableOpacity style={styles.selectionCard} onPress={() => setSelectedSubLine('3E')}>
                      <View style={[styles.selectionIconBox, { backgroundColor: '#3b82f6' }]}><Package color="#FFF" size={28} /></View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>3E</Text>
                        <Text style={styles.selectionCardSub}>{t('dashboard.primaryCrusherLine')}</Text>
                    </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.selectionCard} onPress={() => setSelectedSubLine('Rapid')}>
                      <View style={[styles.selectionIconBox, { backgroundColor: '#a855f7' }]}><Zap color="#FFF" size={28} /></View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>Rapid</Text>
                        <Text style={styles.selectionCardSub}>{t('dashboard.fastProcessingLine')}</Text>
                  </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.selectionCard} onPress={() => setSelectedSubLine('Betty')}>
                      <View style={[styles.selectionIconBox, { backgroundColor: '#10b981' }]}><Box color="#FFF" size={28} /></View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>Betty</Text>
                        <Text style={styles.selectionCardSub}>{t('dashboard.bettyMachineLine')}</Text>
                  </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>

                    {/* Logs List Section */}
                    <View style={styles.crusherLogsSection}>
                      <View style={styles.logsHeader}>
                        <Text style={styles.logsTitle}>Recent Entries</Text>
                </View>

                      {/* Date Picker */}
                      <View style={styles.datePickerContainer}>
                        <Text style={styles.datePickerLabel}>Select Date:</Text>
                        <StationDatePicker
                          value={parseDateLocal(selectedDate)}
                          onChange={(date) => {
                            setSelectedDate(formatDateLocal(date));
                            setCurrentPage(1);
                          }}
                          maximumDate={maxDate}
                        />
                  </View>
                  
                      <View style={styles.searchBox}>
                        <Search size={18} color="#64748b" />
                      <TextInput
                          style={styles.searchInput}
                          placeholder="Search by QR code..."
                          value={searchQuery}
                          onChangeText={(text) => { setSearchQuery(text); setCurrentPage(1); }}
                          placeholderTextColor="#94a3b8"
                          clearButtonMode="while-editing"
                          returnKeyType="search"
                          autoCorrect={false}
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        {searchQuery.length > 0 && (
                          <TouchableOpacity 
                            onPress={() => { setSearchQuery(''); setCurrentPage(1); }}
                            style={styles.clearButton}
                          >
                            <X size={16} color="#64748b" />
                      </TouchableOpacity>
                        )}
                  </View>

                      {/* Filters */}
                      <View style={styles.filtersContainer}>
                        {/* Line Filter */}
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Line:</Text>
                          <View style={styles.filterButtons}>
                  <TouchableOpacity 
                              style={[styles.filterButton, selectedLineFilter === 'all' && styles.filterButtonActive]}
                              onPress={() => { setSelectedLineFilter('all'); setCurrentPage(1); }}
                  >
                              <Text style={[styles.filterButtonText, selectedLineFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                  </TouchableOpacity>
                      <TouchableOpacity 
                              style={[styles.filterButton, selectedLineFilter === '3E' && styles.filterButtonActive]}
                              onPress={() => { setSelectedLineFilter('3E'); setCurrentPage(1); }}
                            >
                              <Text style={[styles.filterButtonText, selectedLineFilter === '3E' && styles.filterButtonTextActive]}>3E</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.filterButton, selectedLineFilter === 'Rapid' && styles.filterButtonActive]}
                              onPress={() => { setSelectedLineFilter('Rapid'); setCurrentPage(1); }}
                            >
                              <Text style={[styles.filterButtonText, selectedLineFilter === 'Rapid' && styles.filterButtonTextActive]}>Rapid</Text>
                      </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.filterButton, selectedLineFilter === 'Betty' && styles.filterButtonActive]}
                              onPress={() => { setSelectedLineFilter('Betty'); setCurrentPage(1); }}
                            >
                              <Text style={[styles.filterButtonText, selectedLineFilter === 'Betty' && styles.filterButtonTextActive]}>Betty</Text>
                      </TouchableOpacity>
                    </View>
                        </View>

                        {/* Status Filter */}
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Status:</Text>
                          <View style={styles.filterButtons}>
                            <TouchableOpacity
                              style={[styles.filterButton, selectedStatusFilter === 'all' && styles.filterButtonActive]}
                              onPress={() => { setSelectedStatusFilter('all'); setCurrentPage(1); }}
                            >
                              <Text style={[styles.filterButtonText, selectedStatusFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.filterButton, selectedStatusFilter === 'pending' && styles.filterButtonActive]}
                              onPress={() => { setSelectedStatusFilter('pending'); setCurrentPage(1); }}
                            >
                              <Text style={[styles.filterButtonText, selectedStatusFilter === 'pending' && styles.filterButtonTextActive]}>Pending</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.filterButton, selectedStatusFilter === 'Completed' && styles.filterButtonActive]}
                              onPress={() => { setSelectedStatusFilter('Completed'); setCurrentPage(1); }}
                            >
                              <Text style={[styles.filterButtonText, selectedStatusFilter === 'Completed' && styles.filterButtonTextActive]}>Complete</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                  </View>

                      {crusherLogsLoading ? (
                        <View style={styles.loadingState}>
                          <ActivityIndicator size="large" color="#17a34a" />
                          <Text style={styles.loadingText}>Loading entries...</Text>
                </View>
                      ) : crusherLogs.length > 0 ? (
                        <View style={styles.logsList}>
                          {crusherLogs.map((log, index) => (
                            <View key={index} style={styles.logItem}>
                              <View style={styles.logMain}>
                                <Text style={styles.logQr}>{log.output_bag_qr}</Text>
                                <View style={styles.logDetails}>
                                  <Text style={styles.logWeight}>{log.weight} kg</Text>
                                  <Text style={styles.logTime}>{new Date(log.created_at).toLocaleString()}</Text>
              </View>
                                <View style={styles.logStatusRow}>
                                  <View style={[styles.statusBadge, { backgroundColor: log.status === 'pending' ? '#FEF3C7' : '#DCFCE7' }]}>
                                    <Text style={[styles.statusBadgeText, { color: log.status === 'pending' ? '#D97706' : '#15803D' }]}>
                                      {log.status || 'Completed'}
                                    </Text>
                    </View>
                  </View>
                </View>
                              <View style={styles.logActions}>
                                {user?.role?.toLowerCase() === 'ppic' && (
                                  <TouchableOpacity
                                    style={styles.editIconButton}
                                    onPress={() => openEditLogWeight(log)}
                                  >
                                    <Pencil color="#0ea5e9" size={18} />
                                  </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                  style={styles.printIconButton}
                                  onPress={() => {
                                    setSelectedLogForPrint(log);
                                    setShowListPrintPreview(true);
                                  }}
                                >
                                  <PrinterIcon color="#17a34a" size={20} />
                                </TouchableOpacity>
                                <View style={[styles.logBadge, { 
                                  backgroundColor: log.sub_line === '3E' ? '#EBF5FF' : log.sub_line === 'Rapid' ? '#F5F3FF' : '#D1FAE5',
                                }]}>
                                  <Text style={[styles.logBadgeText, { 
                                    color: log.sub_line === '3E' ? '#2563eb' : log.sub_line === 'Rapid' ? '#7c3aed' : '#059669'
                                  }]}>{log.sub_line}</Text>
                                </View>
                              </View>
                            </View>
                            ))}
                          </View>
                      ) : (
                        <View style={styles.emptyState}>
                          <Package size={48} color="#94a3b8" opacity={0.5} />
                          <Text style={styles.emptyText}>No entries found for this date</Text>
                      </View>
                      )}

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <View style={styles.pagination}>
                      <TouchableOpacity 
                            style={[styles.pageBtn, currentPage === 1 && styles.pageBtnDisabled]}
                            onPress={() => setCurrentPage(Math.max(1, currentPage - 1))}
                            disabled={currentPage === 1}
                          >
                            <ChevronRight color={currentPage === 1 ? "#CCC" : "#475569"} size={20} style={{ transform: [{ rotate: '180deg' }] }} />
                      </TouchableOpacity>
                          <Text style={styles.pageInfo}>Page {currentPage} of {totalPages} ({totalLogs} total)</Text>
                      <TouchableOpacity 
                            style={[styles.pageBtn, currentPage === totalPages && styles.pageBtnDisabled]}
                            onPress={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage === totalPages}
                          >
                            <ChevronRight color={currentPage === totalPages ? "#CCC" : "#475569"} size={20} />
                      </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    </View>
                  ) : selectedSubLine === 'Betty' ? (
                  /* ── Betty Crusher: input from 3E / Rapid bags ──────────────── */
                  <>
                    <View style={styles.sublineBadgeWrapper}>
                      <View style={[styles.sublineBadge, { backgroundColor: '#D1FAE5', borderColor: '#a7f3d0' }]}>
                        <Text style={[styles.sublineBadgeText, { color: '#059669' }]}>Working on: Betty Line</Text>
                      </View>
                    </View>

                    {/* Section picker — shown before choosing Input or Output */}
                    {!selectedSection ? (
                      <View style={styles.sectionOptions}>
                        <TouchableOpacity
                          style={styles.sectionOption}
                          onPress={() => { setSelectedSection('input'); setSelectedInputBag(null); setBagSearchQuery(''); }}
                        >
                          <View style={[styles.optionIcon, { backgroundColor: '#3b82f6' }]}>
                            <Plus color="#FFF" size={24} />
                          </View>
                          <View>
                            <Text style={styles.optionTitle}>INPUT</Text>
                            <Text style={styles.optionSubtitle}>Scan 3E / Rapid bag</Text>
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.sectionOption}
                          onPress={() => { setSelectedSection('output'); }}
                        >
                          <View style={[styles.optionIcon, { backgroundColor: '#22c55e' }]}>
                            <Minus color="#FFF" size={24} />
                          </View>
                          <View>
                            <Text style={styles.optionTitle}>OUTPUT</Text>
                            <Text style={styles.optionSubtitle}>Generate Betty bag QR</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    ) : selectedSection === 'input' ? (
                      /* ── Betty INPUT: scan a 3E / Rapid crusher bag ── */
                      <View style={styles.sectionCard}>
                        <View style={styles.sectionHeaderRow}>
                          <View style={[styles.typePill, { backgroundColor: '#E0F2FE' }]}>
                            <Text style={[styles.typePillText, { color: '#0369A1' }]}>INPUT</Text>
                          </View>
                          <Text style={styles.sectionTitleText}>From 3E / Rapid Crusher</Text>
                        </View>

                        {/* Search */}
                        <View style={styles.searchContainer}>
                          <View style={styles.searchInputWrapper}>
                            <Search size={20} color="#666" style={{ marginRight: 10 }} />
                            <TextInput
                              style={styles.searchTextInput}
                              placeholder="Search QR code (3E / Rapid bag)…"
                              value={bagSearchQuery}
                              onChangeText={onBagSearch}
                              onFocus={() => { if (suggestedBags.length > 0) setShowSuggestions(true); }}
                            />
                          </View>
                          {showSuggestions && (
                            <View style={styles.suggestionsList}>
                              {suggestedBags.map((bag, i) => (
                                <TouchableOpacity
                                  key={i}
                                  style={styles.suggestionItem}
                                  onPress={() => { setSelectedInputBag(bag); setShowSuggestions(false); setBagSearchQuery(''); }}
                                >
                                  <Text style={styles.suggestionId}>{bag.output_bag_qr}</Text>
                                  <Text style={styles.suggestionDetail}>{bag.sub_line} — {bag.weight} kg</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>

                        {/* Scan */}
                        <TouchableOpacity style={styles.scanButton} onPress={() => { setScanned(false); setShowScanner(true); }}>
                          <CameraIcon color="#17a34a" size={20} />
                          <Text style={styles.scanButtonText}>Scan QR Code</Text>
                        </TouchableOpacity>

                        {/* Selected bag preview */}
                        {selectedInputBag && (
                          <View style={styles.selectedBagCard}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.selectedBagId}>{selectedInputBag.output_bag_qr}</Text>
                              <Text style={styles.selectedBagWeight}>{selectedInputBag.weight} kg</Text>
                            </View>
                            <TouchableOpacity onPress={() => setSelectedInputBag(null)}>
                              <X color="#EB445A" size={20} />
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* Confirm button */}
                        <TouchableOpacity
                          style={[styles.primaryButton, (!selectedInputBag || isLoading) && { opacity: 0.5 }]}
                          disabled={!selectedInputBag || isLoading}
                          onPress={async () => {
                            if (!selectedInputBag) return;
                            try {
                              setIsLoading(true);
                              const response = await productionApi.updateLogStatus(
                                selectedInputBag.output_bag_qr,
                                'Completed',
                                undefined,
                                undefined,
                                'Betty', // usedLine
                              );
                              if (response.data.success) {
                                Alert.alert('Success', 'Bag marked as received by Betty crusher.');
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedSection(null);
                              } else {
                                Alert.alert('Error', 'Failed to update bag status.');
                              }
                            } catch (err) {
                              Alert.alert('Error', 'Could not update bag status.');
                            } finally {
                              setIsLoading(false);
                            }
                          }}
                        >
                          <Text style={styles.primaryButtonText}>Confirm Input (Mark as Received)</Text>
                        </TouchableOpacity>

                        {/* Back */}
                        <TouchableOpacity style={[styles.secondaryButton, { marginTop: 8 }]} onPress={() => { setSelectedSection(null); setSelectedInputBag(null); }}>
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      /* ── Betty OUTPUT: same form as 3E / Rapid ── */
                      <>
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View style={[styles.typePill, { backgroundColor: '#DCFCE7' }]}>
                              <Text style={[styles.typePillText, { color: '#15803D' }]}>OUTPUT</Text>
                            </View>
                            <Text style={styles.sectionTitleText}>Jumbo Bag (Betty)</Text>
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={styles.label}>Weight (kg)</Text>
                            <View style={styles.inputWithIcon}>
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                placeholder="Enter weight"
                                placeholderTextColor="#999"
                                keyboardType="numeric"
                                value={weightInput}
                                onChangeText={setWeightInput}
                              />
                              <TouchableOpacity style={styles.iconInsideInput}>
                                <Scale size={20} color="#666" />
                              </TouchableOpacity>
                            </View>
                          </View>

                          <TouchableOpacity style={styles.secondaryButton} onPress={handleTakePhoto}>
                            <CameraIcon size={20} color="#475569" />
                            <Text style={styles.secondaryButtonText}>Take Photo</Text>
                          </TouchableOpacity>

                          {capturedImages.length > 0 && (
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosPreviewContainer} contentContainerStyle={styles.photosPreviewContent}>
                              {capturedImages.map((imageUri, index) => (
                                <View key={index} style={styles.photoPreviewItem}>
                                  <Image source={{ uri: imageUri }} style={styles.photoPreviewThumbnail} />
                                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => setCapturedImages(prev => prev.filter((_, i) => i !== index))}>
                                    <X size={16} color="#FFF" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </ScrollView>
                          )}

                          <TouchableOpacity
                            style={[styles.primaryButton, (!weightInput || isLoading) && { opacity: 0.5, backgroundColor: '#E2E8F0' }]}
                            onPress={handleLogProduction}
                            disabled={!weightInput || isLoading}
                          >
                            {isLoading ? <ActivityIndicator color="#666" /> : <PrinterIcon size={20} color={!weightInput ? '#94A3B8' : '#FFF'} />}
                            <Text style={[styles.primaryButtonText, !weightInput && { color: '#94A3B8' }]}>Generate QR & Print</Text>
                          </TouchableOpacity>

                          <TouchableOpacity style={[styles.secondaryButton, { marginTop: 8 }]} onPress={() => setSelectedSection(null)}>
                            <Text style={styles.secondaryButtonText}>← Back</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>Shift Progress (Betty)</Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>Outputs this shift</Text>
                            <Text style={styles.progressDataValue}>{currentViewBags} bags</Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>Total weight</Text>
                            <Text style={styles.progressDataValue}>{currentViewWeight.toFixed(1)} kg</Text>
                          </View>
                        </View>
                      </>
                    )}
                  </>
                  ) : (
                  /* ── 3E / Rapid: no input scanning, direct output ───────────── */
                  <>
                    <View style={styles.sublineBadgeWrapper}>
                      <View style={[styles.sublineBadge, { 
                        backgroundColor: selectedSubLine === '3E' ? '#EBF5FF' : '#F5F3FF',
                        borderColor: selectedSubLine === '3E' ? '#bfdbfe' : '#ddd6fe'
                      }]}>
                        <Text style={[styles.sublineBadgeText, { 
                          color: selectedSubLine === '3E' ? '#2563eb' : '#7c3aed'
                        }]}>Working on: {selectedSubLine} Line</Text>
                      </View>
                    </View>

                    {/* Input Section */}
                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <View style={[styles.typePill, { backgroundColor: '#E0F2FE' }]}>
                      <Text style={[styles.typePillText, { color: '#0369A1' }]}>INPUT</Text>
                    </View>
                    <Text style={styles.sectionTitleText}>Continuous from Label Removal</Text>
                  </View>
                  <View style={styles.grayEmptyBox}>
                    <Text style={styles.grayEmptyText}>Continuous flow - no scanning required</Text>
                  </View>
                </View>

                    {/* Output Section */}
                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <View style={[styles.typePill, { backgroundColor: '#DCFCE7' }]}>
                      <Text style={[styles.typePillText, { color: '#15803D' }]}>OUTPUT</Text>
                    </View>
                    <Text style={styles.sectionTitleText}>Jumbo Bag</Text>
                  </View>
                  
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Weight (kg)</Text>
                    <View style={styles.inputWithIcon}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Enter weight"
                            placeholderTextColor="#999"
                        keyboardType="numeric"
                        value={weightInput}
                        onChangeText={setWeightInput}
                      />
                      <TouchableOpacity style={styles.iconInsideInput}>
                        <Scale size={20} color="#666" />
                      </TouchableOpacity>
                    </View>
                  </View>

                      <TouchableOpacity style={styles.secondaryButton} onPress={handleTakePhoto}>
                        <CameraIcon size={20} color="#475569" />
                        <Text style={styles.secondaryButtonText}>Take Photo</Text>
                  </TouchableOpacity>

                  {capturedImages.length > 0 && (
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      style={styles.photosPreviewContainer}
                      contentContainerStyle={styles.photosPreviewContent}
                    >
                      {capturedImages.map((imageUri, index) => (
                        <View key={index} style={styles.photoPreviewItem}>
                          <Image source={{ uri: imageUri }} style={styles.photoPreviewThumbnail} />
                          <TouchableOpacity 
                            style={styles.removePhotoButton} 
                            onPress={() => {
                              setCapturedImages(prev => prev.filter((_, i) => i !== index));
                            }}
                          >
                            <X size={16} color="#FFF" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  )}

                      <TouchableOpacity 
                        style={[styles.primaryButton, (!weightInput || isLoading) && { opacity: 0.5, backgroundColor: '#E2E8F0' }]}
                    onPress={handleLogProduction}
                    disabled={!weightInput || isLoading}
                  >
                        {isLoading ? (
                          <ActivityIndicator color="#666" />
                        ) : (
                          <PrinterIcon size={20} color={!weightInput ? "#94A3B8" : "#FFF"} />
                        )}
                        <Text style={[styles.primaryButtonText, !weightInput && { color: '#94A3B8' }]}>Generate QR & Print</Text>
                  </TouchableOpacity>
                </View>

                {/* Shift Progress Section */}
                    <View style={styles.progressCardRedesign}>
                      <Text style={styles.progressTitleRedesign}>Shift Progress ({selectedSubLine})</Text>
                  <View style={styles.progressDataRow}>
                    <Text style={styles.progressDataLabel}>Outputs this shift</Text>
                        <Text style={styles.progressDataValue}>{currentViewBags} bags</Text>
                  </View>
                  <View style={styles.progressDataRow}>
                    <Text style={styles.progressDataLabel}>Total weight</Text>
                        <Text style={styles.progressDataValue}>{currentViewWeight.toFixed(1)} kg</Text>
                  </View>
                </View>
                  </>
                  )}
              </View>
            ) : selectedStation.name === 'Washing' ? (
              <View style={styles.crusherContainer}>
                {!selectedSubLine ? (
                  <React.Fragment>
                    <View style={styles.selectionContainer}>
                      <Text style={styles.selectionTitle}>Select Washing Line</Text>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingWashingLine('Washing 1'); setShowWashingModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#06b6d4' }]}><Droplets color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Washing 1</Text>
                          <Text style={styles.selectionCardSub}>Primary Washing Line</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingWashingLine('Washing 2'); setShowWashingModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#0891b2' }]}><Droplets color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Washing 2</Text>
                          <Text style={styles.selectionCardSub}>Secondary Washing Line</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingWashingLine('Washing 3'); setShowWashingModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#0e7490' }]}><Droplets color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Washing 3</Text>
                          <Text style={styles.selectionCardSub}>Tertiary Washing Line</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                    </View>

                    {/* Logs List Section */}
                    <View style={[styles.crusherLogsSection, { marginTop: 8 }]}>
                    <View style={styles.logsHeader}>
                      <Text style={styles.logsTitle}>Recent Entries</Text>
                    </View>

                    {/* Date Picker */}
                    <View style={styles.datePickerContainer}>
                      <Text style={styles.datePickerLabel}>Select Date:</Text>
                      <StationDatePicker
                        value={parseDateLocal(washingSelectedDate)}
                        onChange={(date) => {
                          setWashingSelectedDate(formatDateLocal(date));
                          setWashingCurrentPage(1);
                        }}
                        maximumDate={maxDate}
                      />
                    </View>
                    
                    <View style={styles.searchBox}>
                      <Search size={18} color="#64748b" />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search by QR code..."
                        value={washingSearchQuery}
                        onChangeText={(text) => { setWashingSearchQuery(text); setWashingCurrentPage(1); }}
                        placeholderTextColor="#94a3b8"
                        clearButtonMode="while-editing"
                        returnKeyType="search"
                        autoCorrect={false}
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      {washingSearchQuery.length > 0 && (
                        <TouchableOpacity 
                          onPress={() => { setWashingSearchQuery(''); setWashingCurrentPage(1); }}
                          style={styles.clearButton}
                        >
                          <X size={16} color="#64748b" />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Filters */}
                    <View style={styles.filtersContainer}>
                      {/* Line Filter */}
                      <View style={styles.filterGroup}>
                        <Text style={styles.filterLabel}>Line:</Text>
                        <View style={styles.filterButtons}>
                          <TouchableOpacity 
                            style={[styles.filterButton, washingSelectedLineFilter === 'all' && styles.filterButtonActive]}
                            onPress={() => { setWashingSelectedLineFilter('all'); setWashingCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, washingSelectedLineFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={[styles.filterButton, washingSelectedLineFilter === 'Washing 1' && styles.filterButtonActive]}
                            onPress={() => { setWashingSelectedLineFilter('Washing 1'); setWashingCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, washingSelectedLineFilter === 'Washing 1' && styles.filterButtonTextActive]}>W1</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, washingSelectedLineFilter === 'Washing 2' && styles.filterButtonActive]}
                            onPress={() => { setWashingSelectedLineFilter('Washing 2'); setWashingCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, washingSelectedLineFilter === 'Washing 2' && styles.filterButtonTextActive]}>W2</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, washingSelectedLineFilter === 'Washing 3' && styles.filterButtonActive]}
                            onPress={() => { setWashingSelectedLineFilter('Washing 3'); setWashingCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, washingSelectedLineFilter === 'Washing 3' && styles.filterButtonTextActive]}>W3</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Status Filter */}
                      <View style={styles.filterGroup}>
                        <Text style={styles.filterLabel}>Status:</Text>
                        <View style={styles.filterButtons}>
                          <TouchableOpacity
                            style={[styles.filterButton, washingSelectedStatusFilter === 'all' && styles.filterButtonActive]}
                            onPress={() => { setWashingSelectedStatusFilter('all'); setWashingCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, washingSelectedStatusFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, washingSelectedStatusFilter === 'pending' && styles.filterButtonActive]}
                            onPress={() => { setWashingSelectedStatusFilter('pending'); setWashingCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, washingSelectedStatusFilter === 'pending' && styles.filterButtonTextActive]}>Pending</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, washingSelectedStatusFilter === 'Completed' && styles.filterButtonActive]}
                            onPress={() => { setWashingSelectedStatusFilter('Completed'); setWashingCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, washingSelectedStatusFilter === 'Completed' && styles.filterButtonTextActive]}>Complete</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    {washingLogsLoading ? (
                      <View style={styles.loadingState}>
                        <ActivityIndicator size="large" color="#17a34a" />
                        <Text style={styles.loadingText}>Loading entries...</Text>
                      </View>
                    ) : washingLogs.length > 0 ? (
                      <View style={styles.logsList}>
                        {washingLogs.map((log, index) => (
                          <View key={index} style={styles.logItem}>
                            <View style={styles.logMain}>
                              <Text style={styles.logQr}>{log.output_bag_qr}</Text>
                              <View style={styles.logDetails}>
                                <Text style={styles.logWeight}>{log.weight} kg</Text>
                                <Text style={styles.logTime}>{new Date(log.created_at).toLocaleString()}</Text>
                              </View>
                              <View style={styles.logStatusRow}>
                                <View style={[styles.statusBadge, { backgroundColor: log.status === 'pending' ? '#FEF3C7' : '#DCFCE7' }]}>
                                  <Text style={[styles.statusBadgeText, { color: log.status === 'pending' ? '#D97706' : '#15803D' }]}>
                                    {log.status || 'Completed'}
                                  </Text>
                                </View>
                              </View>
                            </View>
                            <View style={styles.logActions}>
                              {user?.role?.toLowerCase() === 'ppic' && (
                                <TouchableOpacity
                                  style={styles.editIconButton}
                                  onPress={() => openEditLogWeight(log)}
                                >
                                  <Pencil color="#0ea5e9" size={18} />
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity 
                                style={styles.printIconButton}
                                onPress={() => {
                                  setSelectedLogForPrint(log);
                                  setShowListPrintPreview(true);
                                }}
                              >
                                <Printer size={18} color="#17a34a" />
                              </TouchableOpacity>
                              <View style={[
                                styles.logBadge,
                                log.sub_line === 'Washing 1' && { backgroundColor: '#06b6d4' },
                                log.sub_line === 'Washing 2' && { backgroundColor: '#0891b2' },
                                log.sub_line === 'Washing 3' && { backgroundColor: '#0e7490' }
                              ]}>
                                <Text style={styles.logBadgeText}>{log.sub_line}</Text>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View style={styles.emptyState}>
                        <Package size={48} color="#94a3b8" opacity={0.5} />
                        <Text style={styles.emptyText}>No entries found for this date</Text>
                      </View>
                    )}

                    {/* Pagination */}
                    {washingTotalPages > 1 && (
                      <View style={styles.pagination}>
                        <TouchableOpacity 
                          style={[styles.pageBtn, washingCurrentPage === 1 && styles.pageBtnDisabled]}
                          onPress={() => washingCurrentPage > 1 && setWashingCurrentPage(washingCurrentPage - 1)}
                          disabled={washingCurrentPage === 1}
                        >
                          <ChevronLeft size={20} color={washingCurrentPage === 1 ? "#94a3b8" : "#17a34a"} />
                        </TouchableOpacity>
                        <Text style={styles.pageInfo}>{washingCurrentPage} / {washingTotalPages}</Text>
                        <TouchableOpacity 
                          style={[styles.pageBtn, washingCurrentPage === washingTotalPages && styles.pageBtnDisabled]}
                          onPress={() => washingCurrentPage < washingTotalPages && setWashingCurrentPage(washingCurrentPage + 1)}
                          disabled={washingCurrentPage === washingTotalPages}
                        >
                          <ChevronRight size={20} color={washingCurrentPage === washingTotalPages ? "#94a3b8" : "#17a34a"} />
                        </TouchableOpacity>
                      </View>
                    )}
                    </View>
                  </React.Fragment>
                ) : selectedSection === 'input' ? (
                  <React.Fragment>
                    <View style={styles.sublineBadgeWrapper}>
                      <View style={[styles.sublineBadge, { backgroundColor: '#CFFAFE', borderColor: '#67e8f9' }]}>
                        <Text style={[styles.sublineBadgeText, { color: '#0e7490' }]}>Working on: {selectedSubLine}</Text>
                  </View>
                </View>

                    {/* Input Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View style={[styles.typePill, { backgroundColor: '#E0F2FE' }]}>
                          <Text style={[styles.typePillText, { color: '#0369A1' }]}>INPUT</Text>
                        </View>
                        <Text style={styles.sectionTitleText}>From Previous Station</Text>
                      </View>
                      <View style={styles.searchContainer}>
                        <View style={styles.searchInputWrapper}>
                          <Search size={20} color="#666" style={{ marginRight: 10 }} />
                          <TextInput
                            style={styles.searchTextInput}
                            placeholder="Search QR code..." 
                            value={bagSearchQuery}
                            onChangeText={onBagSearch}
                            onFocus={handleBagSearchFocus} 
                          />
                        </View>
                        {showSuggestions && (
                          <View style={styles.suggestionsList}>
                            {suggestedBags.map((bag, i) => (
                              <TouchableOpacity 
                                key={i} 
                                style={styles.suggestionItem}
                                onPress={() => {
                                  setSelectedInputBag(bag);
                                  setShowSuggestions(false);
                                  setBagSearchQuery('');
                                }}
                              >
                                <Text style={styles.suggestionId}>{bag.output_bag_qr}</Text>
                                <Text style={styles.suggestionDetail}>{bag.weight} kg</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </View>
                      <TouchableOpacity style={styles.scanButton} onPress={() => { setScanned(false); setShowScanner(true); }}>
                        <CameraIcon color="#17a34a" size={20} />
                        <Text style={styles.scanButtonText}>Scan QR Code</Text>
                      </TouchableOpacity>
                      {selectedInputBag && (
                        <View style={styles.selectedBagCard}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.selectedBagId}>{selectedInputBag.output_bag_qr}</Text>
                            <Text style={styles.selectedBagWeight}>{selectedInputBag.weight} kg</Text>
                          </View>
                          <TouchableOpacity onPress={() => setSelectedInputBag(null)}>
                            <X color="#EB445A" size={20} />
                          </TouchableOpacity>
                        </View>
                      )}
                      <TouchableOpacity 
                        style={[styles.primaryButton, !selectedInputBag && { opacity: 0.5 }]}
                        disabled={!selectedInputBag || isLoading}
                        onPress={async () => {
                          if (!selectedInputBag || !selectedStation) return;
                          try {
                            setIsLoading(true);
                            // Check if this is washing station by name or code (more robust than ID)
                            const isWashingStation = selectedStation.name?.toLowerCase().includes('washing') || 
                                                     selectedStation.code === 'WSH' || 
                                                     selectedStation.id === 3;
                            
                            // If this is washing station, ONLY update the existing crusher batch (NO new entry)
                            if (isWashingStation && selectedInputBag.output_bag_qr) {
                              // Pass the selected washing line name (e.g., "Washing 1", "Washing 2", "Washing 3")
                              const washingLine = selectedSubLine || undefined;
                              const response = await productionApi.updateLogStatus(selectedInputBag.output_bag_qr, 'Completed', washingLine);
                              if (response.data.success) {
                          Alert.alert(t('common.success'), t('messages.materialProcessingStarted'));
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                          setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              } else {
                                Alert.alert(t('common.error'), t('messages.failedToUpdateBatchStatus'));
                              }
                            } else {
                              // For other stations (NOT washing), create a new processing log entry
                              if (!backendShiftId) {
                                Alert.alert(t('common.error'), t('messages.noActiveShift'));
                                return;
                              }
                              const logData = {
                                shiftId: backendShiftId,
                                stationId: selectedStation.id,
                                inputBagQr: selectedInputBag.output_bag_qr,
                                weight: selectedInputBag.weight,
                                status: 'Processing'
                              };
                              const response = await productionApi.logProduction(logData);
                              if (response.data.success) {
                                Alert.alert(t('common.success'), t('messages.materialProcessingStarted'));
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              }
                            }
                          } catch (error) {
                            console.error('Save input error:', error);
                            Alert.alert(t('common.error'), t('messages.failedToStartProcessing'));
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                      >
                        <Text style={styles.primaryButtonText}>Save & Start Processing</Text>
                      </TouchableOpacity>
                    </View>
                  </React.Fragment>
                ) : selectedSection === 'output' ? (
                  <React.Fragment>
                    <View style={styles.sublineBadgeWrapper}>
                      <View style={[styles.sublineBadge, { backgroundColor: '#CFFAFE', borderColor: '#67e8f9' }]}>
                        <Text style={[styles.sublineBadgeText, { color: '#0e7490' }]}>Working on: {selectedSubLine}</Text>
                      </View>
                    </View>

                    {/* Output Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View style={[styles.typePill, { backgroundColor: '#DCFCE7' }]}>
                          <Text style={[styles.typePillText, { color: '#15803D' }]}>OUTPUT</Text>
                        </View>
                        <Text style={styles.sectionTitleText}>Jumbo Bag</Text>
                      </View>
                      
                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Weight (kg)</Text>
                        <View style={styles.inputWithIcon}>
                        <TextInput
                            style={[styles.input, { flex: 1 }]}
                            placeholder="Enter weight"
                            placeholderTextColor="#999"
                          keyboardType="numeric"
                          value={weightInput}
                          onChangeText={setWeightInput}
                        />
                          <TouchableOpacity style={styles.iconInsideInput}>
                            <Scale size={20} color="#666" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <TouchableOpacity style={styles.secondaryButton} onPress={handleTakePhoto}>
                        <CameraIcon size={20} color="#475569" />
                        <Text style={styles.secondaryButtonText}>Take Photo</Text>
                      </TouchableOpacity>

                      {capturedImages.length > 0 && (
                        <ScrollView 
                          horizontal 
                          showsHorizontalScrollIndicator={false}
                          style={styles.photosPreviewContainer}
                          contentContainerStyle={styles.photosPreviewContent}
                        >
                          {capturedImages.map((imageUri, index) => (
                            <View key={index} style={styles.photoPreviewItem}>
                              <Image source={{ uri: imageUri }} style={styles.photoPreviewThumbnail} />
                              <TouchableOpacity 
                                style={styles.removePhotoButton} 
                                onPress={() => {
                                  setCapturedImages(prev => prev.filter((_, i) => i !== index));
                                }}
                              >
                                <X size={16} color="#FFF" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </ScrollView>
                      )}

                      <TouchableOpacity 
                        style={[styles.primaryButton, (!weightInput || isLoading) && { opacity: 0.5, backgroundColor: '#E2E8F0' }]}
                        onPress={handleLogProduction}
                        disabled={!weightInput || isLoading}
                      >
                        {isLoading ? (
                          <ActivityIndicator color="#666" />
                        ) : (
                          <PrinterIcon size={20} color={!weightInput ? "#94A3B8" : "#FFF"} />
                        )}
                        <Text style={[styles.primaryButtonText, !weightInput && { color: '#94A3B8' }]}>Generate QR & Print</Text>
                      </TouchableOpacity>
                </View>

                    {/* Stats Cards Section */}
                    <View style={styles.statsRow}>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{currentViewBags}</Text>
                        <Text style={styles.statLabel}>Outputs</Text>
                      </View>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{currentViewWeight.toFixed(1)}</Text>
                        <Text style={styles.statLabel}>Total kg</Text>
                      </View>
                    </View>

                    {/* Shift Progress Section */}
                    <View style={styles.progressCardRedesign}>
                      <Text style={styles.progressTitleRedesign}>Shift Progress ({selectedSubLine})</Text>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>Outputs this shift</Text>
                        <Text style={styles.progressDataValue}>{currentViewBags} bags</Text>
                  </View>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>Total weight</Text>
                        <Text style={styles.progressDataValue}>{currentViewWeight.toFixed(1)} kg</Text>
                  </View>
                </View>
              </React.Fragment>
                ) : null}
          </View>
            ) : selectedStation.name === 'Extrusion' ? (
              <View style={styles.crusherContainer}>
                {!selectedSubLine ? (
                  <React.Fragment>
                    <View style={styles.selectionContainer}>
                      <Text style={styles.selectionTitle}>Select Extrusion Line</Text>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingExtrusionLine('Extrusion 1'); setShowExtrusionModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#f97316' }]}><Zap color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Extrusion 1</Text>
                          <Text style={styles.selectionCardSub}>{t('dashboard.primaryExtrusionLine')}</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingExtrusionLine('Extrusion 2'); setShowExtrusionModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#ea580c' }]}><Zap color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Extrusion 2</Text>
                          <Text style={styles.selectionCardSub}>{t('dashboard.secondaryExtrusionLine')}</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingExtrusionLine('Extrusion 3'); setShowExtrusionModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#c2410c' }]}><Zap color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Extrusion 3</Text>
                          <Text style={styles.selectionCardSub}>{t('dashboard.tertiaryExtrusionLine')}</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingExtrusionLine('Mixture'); setShowExtrusionModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#dc2626' }]}><Zap color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Mixture</Text>
                          <Text style={styles.selectionCardSub}>{t('dashboard.mixtureLine')}</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                    </View>

                    {/* Logs List Section */}
                    <View style={[styles.crusherLogsSection, { marginTop: 8 }]}>
                    <View style={styles.logsHeader}>
                      <Text style={styles.logsTitle}>Recent Entries</Text>
                    </View>

                    {/* Date Picker */}
                    <View style={styles.datePickerContainer}>
                      <Text style={styles.datePickerLabel}>Select Date:</Text>
                      <StationDatePicker
                        value={parseDateLocal(extrusionSelectedDate)}
                        onChange={(date) => {
                          setExtrusionSelectedDate(formatDateLocal(date));
                          setExtrusionCurrentPage(1);
                        }}
                        maximumDate={maxDate}
                      />
                    </View>
                    
                    <View style={styles.searchBox}>
                      <Search size={18} color="#64748b" />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search by QR code..."
                        value={extrusionSearchQuery}
                        onChangeText={(text) => { setExtrusionSearchQuery(text); setExtrusionCurrentPage(1); }}
                        placeholderTextColor="#94a3b8"
                        clearButtonMode="while-editing"
                        returnKeyType="search"
                        autoCorrect={false}
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      {extrusionSearchQuery.length > 0 && (
                        <TouchableOpacity 
                          onPress={() => { setExtrusionSearchQuery(''); setExtrusionCurrentPage(1); }}
                          style={styles.clearButton}
                        >
                          <X size={16} color="#64748b" />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Filters */}
                    <View style={styles.filtersContainer}>
                      {/* Line Filter */}
                      <View style={styles.filterGroup}>
                        <Text style={styles.filterLabel}>Line:</Text>
                        <View style={styles.filterButtons}>
                          <TouchableOpacity 
                            style={[styles.filterButton, extrusionSelectedLineFilter === 'all' && styles.filterButtonActive]}
                            onPress={() => { setExtrusionSelectedLineFilter('all'); setExtrusionCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, extrusionSelectedLineFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={[styles.filterButton, extrusionSelectedLineFilter === 'Extrusion 1' && styles.filterButtonActive]}
                            onPress={() => { setExtrusionSelectedLineFilter('Extrusion 1'); setExtrusionCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, extrusionSelectedLineFilter === 'Extrusion 1' && styles.filterButtonTextActive]}>E1</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, extrusionSelectedLineFilter === 'Extrusion 2' && styles.filterButtonActive]}
                            onPress={() => { setExtrusionSelectedLineFilter('Extrusion 2'); setExtrusionCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, extrusionSelectedLineFilter === 'Extrusion 2' && styles.filterButtonTextActive]}>E2</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, extrusionSelectedLineFilter === 'Extrusion 3' && styles.filterButtonActive]}
                            onPress={() => { setExtrusionSelectedLineFilter('Extrusion 3'); setExtrusionCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, extrusionSelectedLineFilter === 'Extrusion 3' && styles.filterButtonTextActive]}>E3</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, extrusionSelectedLineFilter === 'Mixture' && styles.filterButtonActive]}
                            onPress={() => { setExtrusionSelectedLineFilter('Mixture'); setExtrusionCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, extrusionSelectedLineFilter === 'Mixture' && styles.filterButtonTextActive]}>MIX</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Status Filter */}
                      <View style={styles.filterGroup}>
                        <Text style={styles.filterLabel}>Status:</Text>
                        <View style={styles.filterButtons}>
                          <TouchableOpacity
                            style={[styles.filterButton, extrusionSelectedStatusFilter === 'all' && styles.filterButtonActive]}
                            onPress={() => { setExtrusionSelectedStatusFilter('all'); setExtrusionCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, extrusionSelectedStatusFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, extrusionSelectedStatusFilter === 'pending' && styles.filterButtonActive]}
                            onPress={() => { setExtrusionSelectedStatusFilter('pending'); setExtrusionCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, extrusionSelectedStatusFilter === 'pending' && styles.filterButtonTextActive]}>Pending</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, extrusionSelectedStatusFilter === 'Completed' && styles.filterButtonActive]}
                            onPress={() => { setExtrusionSelectedStatusFilter('Completed'); setExtrusionCurrentPage(1); }}
                          >
                            <Text style={[styles.filterButtonText, extrusionSelectedStatusFilter === 'Completed' && styles.filterButtonTextActive]}>Complete</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    {extrusionLogsLoading ? (
                      <View style={styles.loadingState}>
                        <ActivityIndicator size="large" color="#17a34a" />
                        <Text style={styles.loadingText}>Loading entries...</Text>
                      </View>
                    ) : extrusionLogs.length > 0 ? (
                      <View style={styles.logsList}>
                        {extrusionLogs.map((log, index) => (
                          <View key={index} style={styles.logItem}>
                            <View style={styles.logMain}>
                              <Text style={styles.logQr}>{log.output_bag_qr}</Text>
                              <View style={styles.logDetails}>
                                <Text style={styles.logWeight}>{log.weight} kg</Text>
                                <Text style={styles.logTime}>{new Date(log.created_at).toLocaleString()}</Text>
                              </View>
                              <View style={styles.logStatusRow}>
                                <View style={[styles.statusBadge, { backgroundColor: log.status === 'pending' ? '#FEF3C7' : '#DCFCE7' }]}>
                                  <Text style={[styles.statusBadgeText, { color: log.status === 'pending' ? '#D97706' : '#15803D' }]}>
                                    {log.status || 'Completed'}
                                  </Text>
                                </View>
                              </View>
                            </View>
                            <View style={styles.logActions}>
                              {user?.role?.toLowerCase() === 'ppic' && (
                                <TouchableOpacity
                                  style={styles.editIconButton}
                                  onPress={() => openEditLogWeight(log)}
                                >
                                  <Pencil color="#0ea5e9" size={18} />
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity 
                                style={styles.printIconButton}
                                onPress={() => {
                                  setSelectedLogForPrint(log);
                                  setShowListPrintPreview(true);
                                }}
                              >
                                <Printer size={18} color="#17a34a" />
                              </TouchableOpacity>
                              <View style={[
                                styles.logBadge,
                                log.sub_line === 'Extrusion 1' && { backgroundColor: '#f97316' },
                                log.sub_line === 'Extrusion 2' && { backgroundColor: '#ea580c' },
                                log.sub_line === 'Extrusion 3' && { backgroundColor: '#c2410c' },
                                log.sub_line === 'Mixture' && { backgroundColor: '#dc2626' }
                              ]}>
                                <Text style={styles.logBadgeText}>{log.sub_line}</Text>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View style={styles.emptyState}>
                        <Package size={48} color="#94a3b8" opacity={0.5} />
                        <Text style={styles.emptyText}>No entries found for this date</Text>
                      </View>
                    )}

                    {/* Pagination */}
                    {extrusionTotalPages > 1 && (
                      <View style={styles.pagination}>
                        <TouchableOpacity 
                          style={[styles.pageBtn, extrusionCurrentPage === 1 && styles.pageBtnDisabled]}
                          onPress={() => extrusionCurrentPage > 1 && setExtrusionCurrentPage(extrusionCurrentPage - 1)}
                          disabled={extrusionCurrentPage === 1}
                        >
                          <ChevronLeft size={20} color={extrusionCurrentPage === 1 ? "#94a3b8" : "#17a34a"} />
                        </TouchableOpacity>
                        <Text style={styles.pageInfo}>{extrusionCurrentPage} / {extrusionTotalPages}</Text>
                        <TouchableOpacity 
                          style={[styles.pageBtn, extrusionCurrentPage === extrusionTotalPages && styles.pageBtnDisabled]}
                          onPress={() => extrusionCurrentPage < extrusionTotalPages && setExtrusionCurrentPage(extrusionCurrentPage + 1)}
                          disabled={extrusionCurrentPage === extrusionTotalPages}
                        >
                          <ChevronRight size={20} color={extrusionCurrentPage === extrusionTotalPages ? "#94a3b8" : "#17a34a"} />
                        </TouchableOpacity>
                      </View>
                    )}
                    </View>
                  </React.Fragment>
                ) : !selectedSection ? (
                  /* Sub-line chosen but section not yet selected — show the picker inline */
                  <View style={styles.sectionOptions}>
                    <View style={styles.sublineBadgeWrapper}>
                      <View style={[styles.sublineBadge, { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }]}>
                        <Text style={[styles.sublineBadgeText, { color: '#D97706' }]}>Line: {selectedSubLine}</Text>
                      </View>
                    </View>
                    <TouchableOpacity style={styles.sectionOption} onPress={() => setSelectedSection('input')}>
                      <View style={[styles.optionIcon, { backgroundColor: '#f97316' }]}><Plus color="#FFF" size={24} /></View>
                      <View><Text style={styles.optionTitle}>INPUT</Text><Text style={styles.optionSubtitle}>Scan washing bag</Text></View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.sectionOption} onPress={() => setSelectedSection('output')}>
                      <View style={[styles.optionIcon, { backgroundColor: '#17a34a' }]}><Box color="#FFF" size={24} /></View>
                      <View><Text style={styles.optionTitle}>OUTPUT</Text><Text style={styles.optionSubtitle}>Generate bag QR</Text></View>
                    </TouchableOpacity>
                  </View>
                ) : selectedSection === 'input' ? (
                  <React.Fragment>
                    <View style={styles.sublineBadgeWrapper}>
                      <View style={[styles.sublineBadge, { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }]}>
                        <Text style={[styles.sublineBadgeText, { color: '#D97706' }]}>Working on: {selectedSubLine}</Text>
                  </View>
                </View>

                    {/* Input Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View style={[styles.typePill, { backgroundColor: '#E0F2FE' }]}>
                          <Text style={[styles.typePillText, { color: '#0369A1' }]}>INPUT</Text>
                        </View>
                        <Text style={styles.sectionTitleText}>From Previous Station</Text>
                      </View>
                      <View style={styles.searchContainer}>
                        <View style={styles.searchInputWrapper}>
                          <Search size={20} color="#666" style={{ marginRight: 10 }} />
                          <TextInput
                            style={styles.searchTextInput}
                            placeholder="Search QR code..." 
                            value={bagSearchQuery}
                            onChangeText={onBagSearch}
                            onFocus={handleBagSearchFocus} 
                          />
                        </View>
                        {showSuggestions && (
                          <View style={styles.suggestionsList}>
                            {suggestedBags.map((bag, i) => (
                              <TouchableOpacity 
                                key={i} 
                                style={styles.suggestionItem}
                                onPress={() => {
                                  setSelectedInputBag(bag);
                                  setShowSuggestions(false);
                                  setBagSearchQuery('');
                                }}
                              >
                                <Text style={styles.suggestionId}>{bag.output_bag_qr}</Text>
                                <Text style={styles.suggestionDetail}>{bag.weight} kg</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </View>
                      <TouchableOpacity style={styles.scanButton} onPress={() => { setScanned(false); setShowScanner(true); }}>
                        <CameraIcon color="#17a34a" size={20} />
                        <Text style={styles.scanButtonText}>Scan QR Code</Text>
                      </TouchableOpacity>
                      {selectedInputBag && (
                        <View style={styles.selectedBagCard}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.selectedBagId}>{selectedInputBag.output_bag_qr}</Text>
                            <Text style={styles.selectedBagWeight}>{selectedInputBag.weight} kg</Text>
                          </View>
                          <TouchableOpacity onPress={() => setSelectedInputBag(null)}>
                            <X color="#EB445A" size={20} />
                          </TouchableOpacity>
                        </View>
                      )}
                      <TouchableOpacity 
                        style={[styles.primaryButton, !selectedInputBag && { opacity: 0.5 }]}
                        disabled={!selectedInputBag || isLoading}
                        onPress={async () => {
                          if (!selectedInputBag || !selectedStation) return;
                          try {
                            setIsLoading(true);
                            // Check if this is extrusion station
                            const isExtrusionStation = selectedStation.name?.toLowerCase().includes('extrusion') || 
                                                       selectedStation.code === 'EXT' || 
                                                       selectedStation.id === 4;
                            
                            // If this is extrusion station, ONLY update the existing washing batch (NO new entry)
                            if (isExtrusionStation && selectedInputBag.output_bag_qr) {
                              // Ensure we have an extrusion line selected
                              if (!selectedSubLine) {
                                Alert.alert(t('common.error'), t('messages.pleaseSelectExtrusionLine'));
                                setIsLoading(false);
                                return;
                              }
                              // Pass the selected extrusion line name (e.g., "Extrusion 1", "Extrusion 2", "Extrusion 3")
                              // This will update the washing batch status to 'Completed' and set used_line to the extrusion line
                              const extrusionLine = selectedSubLine;
                              const response = await productionApi.updateLogStatus(selectedInputBag.output_bag_qr, 'Completed', undefined, extrusionLine);
                              if (response.data.success) {
                                Alert.alert(t('common.success'), t('messages.materialProcessingStarted'));
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              } else {
                                Alert.alert(t('common.error'), t('messages.failedToUpdateBatchStatus'));
                              }
                            } else {
                              // For other stations (NOT extrusion), create a new processing log entry
                              if (!backendShiftId) {
                                Alert.alert(t('common.error'), t('messages.noActiveShift'));
                                return;
                              }
                              const logData = {
                                shiftId: backendShiftId,
                                stationId: selectedStation.id,
                                inputBagQr: selectedInputBag.output_bag_qr,
                                weight: selectedInputBag.weight,
                                status: 'Processing'
                              };
                              const response = await productionApi.logProduction(logData);
                              if (response.data.success) {
                                Alert.alert(t('common.success'), t('messages.materialProcessingStarted'));
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              }
                            }
                          } catch (error) {
                            console.error('Save input error:', error);
                            Alert.alert(t('common.error'), t('messages.failedToStartProcessing'));
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                      >
                        <Text style={styles.primaryButtonText}>Save & Start Processing</Text>
                      </TouchableOpacity>
                    </View>
                  </React.Fragment>
                ) : selectedSection === 'output' ? (
                  <React.Fragment>
                    <View style={styles.sublineBadgeWrapper}>
                      <View style={[styles.sublineBadge, { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }]}>
                        <Text style={[styles.sublineBadgeText, { color: '#D97706' }]}>Working on: {selectedSubLine}</Text>
                      </View>
                    </View>

                    {/* Output Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View style={[styles.typePill, { backgroundColor: '#DCFCE7' }]}>
                          <Text style={[styles.typePillText, { color: '#15803D' }]}>OUTPUT</Text>
                        </View>
                        <Text style={styles.sectionTitleText}>Jumbo Bag</Text>
                      </View>
                      
                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Weight (kg)</Text>
                        <View style={styles.inputWithIcon}>
                        <TextInput
                            style={[styles.input, { flex: 1 }]}
                            placeholder="Enter weight"
                            placeholderTextColor="#999"
                          keyboardType="numeric"
                          value={weightInput}
                          onChangeText={setWeightInput}
                        />
                          <TouchableOpacity style={styles.iconInsideInput}>
                            <Scale size={20} color="#666" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <TouchableOpacity style={styles.secondaryButton} onPress={handleTakePhoto}>
                        <CameraIcon size={20} color="#475569" />
                        <Text style={styles.secondaryButtonText}>Take Photo</Text>
                      </TouchableOpacity>

                      {capturedImages.length > 0 && (
                        <ScrollView 
                          horizontal 
                          showsHorizontalScrollIndicator={false}
                          style={styles.photosPreviewContainer}
                          contentContainerStyle={styles.photosPreviewContent}
                        >
                          {capturedImages.map((imageUri, index) => (
                            <View key={index} style={styles.photoPreviewItem}>
                              <Image source={{ uri: imageUri }} style={styles.photoPreviewThumbnail} />
                              <TouchableOpacity 
                                style={styles.removePhotoButton} 
                                onPress={() => {
                                  setCapturedImages(prev => prev.filter((_, i) => i !== index));
                                }}
                              >
                                <X size={16} color="#FFF" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </ScrollView>
                      )}

                      <TouchableOpacity 
                        style={[styles.primaryButton, (!weightInput || isLoading) && { opacity: 0.5, backgroundColor: '#E2E8F0' }]}
                        onPress={handleLogProduction}
                        disabled={!weightInput || isLoading}
                      >
                        {isLoading ? (
                          <ActivityIndicator color="#666" />
                        ) : (
                          <PrinterIcon size={20} color={!weightInput ? "#94A3B8" : "#FFF"} />
                        )}
                        <Text style={[styles.primaryButtonText, !weightInput && { color: '#94A3B8' }]}>Generate QR & Print</Text>
                      </TouchableOpacity>
                </View>

                {/* Shift Progress Section */}
                    <View style={styles.progressCardRedesign}>
                      <Text style={styles.progressTitleRedesign}>Shift Progress ({selectedSubLine})</Text>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>Outputs this shift</Text>
                        <Text style={styles.progressDataValue}>{currentViewBags} bags</Text>
                  </View>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>Total weight</Text>
                        <Text style={styles.progressDataValue}>{currentViewWeight.toFixed(1)} kg</Text>
                  </View>
                </View>
              </React.Fragment>
                ) : null}
          </View>
            ) : (
              <>
                <View style={[styles.stationHero, { backgroundColor: selectedStation.color }]}><View style={styles.heroHeader}>{renderStationIcon(selectedStation.name, selectedStation.color)}<View style={{ marginLeft: 15, flex: 1 }}><Text style={styles.heroTitle}>{selectedStation.name}</Text><Text style={styles.heroDesc}>{selectedStation.description}</Text></View></View></View>
                <View style={styles.formCard}>
                  {selectedSection === 'input' ? (
                    <View>
                      <Text style={styles.formTitle}>Input Material</Text>
                      <View style={styles.searchContainer}><View style={styles.searchInputWrapper}><Search size={20} color="#666" style={{ marginRight: 10 }} /><TextInput style={styles.searchTextInput} placeholder="Search ID..." value={bagSearchQuery} onChangeText={onBagSearch} onFocus={handleBagSearchFocus} /></View>
                        {showSuggestions && (<View style={styles.suggestionsList}>{suggestedBags.map((bag, i) => (<TouchableOpacity key={i} style={styles.suggestionItem} onPress={() => { setSelectedInputBag(bag); setShowSuggestions(false); setBagSearchQuery(''); }}><Text style={styles.suggestionId}>{bag.output_bag_qr}</Text><Text style={styles.suggestionDetail}>{bag.weight} kg</Text></TouchableOpacity>))}</View>)}
                  </View>
                      <TouchableOpacity style={styles.scanButton} onPress={() => { setScanned(false); setShowScanner(true); }}><CameraIcon color="#17a34a" size={20} /><Text style={styles.scanButtonText}>Scan QR Code</Text></TouchableOpacity>
                      {selectedInputBag && (<View style={styles.selectedBagCard}><View style={{ flex: 1 }}><Text style={styles.selectedBagId}>{selectedInputBag.output_bag_qr}</Text><Text style={styles.selectedBagWeight}>{selectedInputBag.weight} kg</Text></View><TouchableOpacity onPress={() => setSelectedInputBag(null)}><X color="#EB445A" size={20} /></TouchableOpacity></View>)}
                      <TouchableOpacity 
                        style={[styles.primaryButton, !selectedInputBag && { opacity: 0.5 }]} 
                        disabled={!selectedInputBag || isLoading} 
                        onPress={async () => {
                          if (!selectedInputBag || !selectedStation) return;
                          try {
                            setIsLoading(true);
                            // Check if this is washing station by name or code (more robust than ID)
                            const isWashingStation = selectedStation.name?.toLowerCase().includes('washing') || 
                                                     selectedStation.code === 'WSH' || 
                                                     selectedStation.id === 3;
                            
                            // Check if this is Final Packaging station
                            const isFinalPackaging = selectedStation?.id === 5 ||
                              selectedStation?.name?.toLowerCase().includes('final') ||
                              selectedStation?.name?.toLowerCase().includes('packing');
                            
                            // If this is washing station, ONLY update the existing crusher batch (NO new entry)
                            if (isWashingStation && selectedInputBag.output_bag_qr) {
                              // Pass the selected washing line name (e.g., "Washing 1", "Washing 2", "Washing 3")
                              const washingLine = selectedSubLine || undefined;
                              const response = await productionApi.updateLogStatus(selectedInputBag.output_bag_qr, 'Completed', washingLine);
                              if (response.data.success) {
                                Alert.alert(t('common.success'), t('messages.materialProcessingStarted'));
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                              } else {
                                Alert.alert(t('common.error'), t('messages.failedToUpdateBatchStatus'));
                              }
                            } else if (isFinalPackaging && selectedInputBag.output_bag_qr) {
                              // Final Packaging: ONLY update the existing extrusion batch (NO new entry)
                              // Update status to 'Completed' and set used_line (Final Packaging line/subline if available)
                              const finalPackagingLine = selectedSubLine || selectedStation.name || undefined;
                              const response = await productionApi.updateLogStatus(selectedInputBag.output_bag_qr, 'Completed', undefined, undefined, finalPackagingLine);
                              if (response.data.success) {
                                Alert.alert(t('common.success'), t('messages.materialProcessingStarted'));
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              } else {
                                Alert.alert(t('common.error'), t('messages.failedToUpdateBatchStatus'));
                              }
                            } else {
                              // For other stations (NOT washing, NOT Final Packaging), create a new processing log entry
                              if (!backendShiftId) {
                                Alert.alert(t('common.error'), t('messages.noActiveShift'));
                                return;
                              }
                              const logData = {
                                shiftId: backendShiftId,
                                stationId: selectedStation.id,
                                inputBagQr: selectedInputBag.output_bag_qr,
                                weight: selectedInputBag.weight,
                                status: 'Processing'
                              };
                              const response = await productionApi.logProduction(logData);
                              if (response.data.success) {
                                Alert.alert(t('common.success'), t('messages.materialProcessingStarted'));
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                              }
                            }
                          } catch (error) {
                            console.error('Save input error:', error);
                            Alert.alert(t('common.error'), t('messages.failedToStartProcessing'));
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                      >
                        <Text style={styles.primaryButtonText}>Save & Start Processing</Text>
            </TouchableOpacity>
          </View>
                  ) : (
                    <View><Text style={styles.formTitle}>{t('dashboard.outputRecording')}</Text><View style={styles.inputGroup}><Text style={styles.label}>{t('dashboard.weightKg')}</Text><TextInput style={styles.input} keyboardType="numeric" placeholder="0.00" value={weightInput} onChangeText={setWeightInput} /></View><TouchableOpacity style={styles.primaryButton} disabled={!weightInput || isLoading} onPress={handleLogProduction}><PrinterIcon color="#FFF" size={20} /><Text style={styles.primaryButtonText}>{t('dashboard.generateQRPrint')}</Text></TouchableOpacity></View>
                  )}
        </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={showScanner} animationType="fade"><View style={styles.scannerContainer}><CameraView onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} style={StyleSheet.absoluteFillObject} /><View style={styles.scannerOverlay}><Text style={styles.scannerText}>{t('dashboard.scanBagQR')}</Text><TouchableOpacity style={styles.closeScanner} onPress={() => setShowScanner(false)}><X color="#FFF" size={32} /></TouchableOpacity></View></View></Modal>
      
      {/* Camera Preview Modal */}
      <Modal visible={showCameraPreview} animationType="fade">
        <View style={styles.cameraContainer}>
          {hasPermission && (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing="back"
            />
          )}
          <View style={styles.cameraOverlay}>
            <View style={styles.cameraHeader}>
              <TouchableOpacity style={styles.cameraCloseButton} onPress={handleCancelPhoto}>
                <X color="#FFF" size={32} />
              </TouchableOpacity>
            </View>
            <View style={styles.cameraControls}>
              <TouchableOpacity 
                style={styles.captureButton} 
                onPress={handleCapturePhoto}
                disabled={!hasPermission}
              >
                <View style={styles.captureButtonInner} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Photo Preview Modal */}
      <Modal visible={showPhotoPreview} transparent animationType="fade">
        <View style={styles.photoPreviewOverlay}>
          <View style={styles.photoPreviewContent}>
            <View style={styles.photoPreviewHeader}>
              <Text style={styles.photoPreviewTitle}>{t('dashboard.photoPreview')}</Text>
              <TouchableOpacity onPress={handleCancelPhoto}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            {tempCapturedImage && (
              <Image 
                source={{ uri: tempCapturedImage }} 
                style={styles.photoPreviewImage}
                resizeMode="contain"
              />
            )}
            <View style={styles.photoPreviewActions}>
              <TouchableOpacity 
                style={[styles.photoPreviewButton, styles.retakeButton]} 
                onPress={handleRetakePhoto}
              >
                <Text style={styles.retakeButtonText}>{t('dashboard.retake')}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.photoPreviewButton, styles.acceptButton]} 
                onPress={handleAcceptPhoto}
              >
                <Text style={styles.acceptButtonText}>{t('dashboard.usePhoto')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={showPrintPreview} transparent animationType="fade">
        <View style={styles.previewOverlay}>
          <View style={styles.previewContent}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>{t('dashboard.labelPreview')}</Text>
              <TouchableOpacity onPress={handleClosePreview} disabled={isPrinting || isLoading}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <View style={styles.previewLabelBox}>
              <Text style={styles.previewCompany}>Greencore Resources</Text>
              <View style={styles.qrContainer}>
                {previewData?.qrCode && (
                  <QRCode value={previewData.qrCode} size={120} getRef={(c) => (qrRef.current = c)} />
                )}
              </View>
              <View style={styles.previewQRIdBox}>
                <Text style={styles.previewQRIdText}>{previewData?.qrCode}</Text>
              </View>
              <View style={styles.previewGrid}>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>Weight</Text>
                  <Text style={styles.previewValue}>{previewData?.weight} kg</Text>
                </View>
                <View style={[styles.previewItem, { alignItems: 'flex-end' }]}>
                  <Text style={styles.previewLabel}>Station</Text>
                  <Text style={styles.previewValue}>
                    {previewData?.station || 'N/A'}
                  </Text>
                </View>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>Shift</Text>
                  <Text style={styles.previewValue}>{selectedShift?.name}</Text>
                </View>
                <View style={[styles.previewItem, { alignItems: 'flex-end' }]}>
                  <Text style={styles.previewLabel}>Date</Text>
                  <Text style={styles.previewValue}>{previewData?.date}</Text>
                </View>
              </View>

              {/* Jumbo bag type: Pending (temporary) or Completed (final) */}
              {!isCurrentLogSaved && (
                <View style={[styles.inputGroup, { marginTop: 12, width: '100%' }]}>
                  <Text style={styles.label}>{t('dashboard.jumboBagType')}</Text>
                  <View style={styles.filterButtons}>
                    <TouchableOpacity
                      style={[styles.filterButton, previewBagStatus === 'pending' && styles.filterButtonActive]}
                      onPress={() => setPreviewBagStatus('pending')}
                    >
                      <Text style={[styles.filterButtonText, previewBagStatus === 'pending' && styles.filterButtonTextActive]}>
                        {t('dashboard.temporaryJumboBag')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterButton, previewBagStatus === 'Completed' && styles.filterButtonActive]}
                      onPress={() => setPreviewBagStatus('Completed')}
                    >
                      <Text style={[styles.filterButtonText, previewBagStatus === 'Completed' && styles.filterButtonTextActive]}>
                        {t('dashboard.finalJumboBag')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Remark (final stage for worker – optional before save) */}
              {!isCurrentLogSaved && (
                <View style={[styles.inputGroup, { marginTop: 12, width: '100%' }]}>
                  <Text style={styles.label}>{t('dashboard.remark')}</Text>
                  <TextInput
                    style={[styles.input, { minHeight: 44 }]}
                    placeholder={t('dashboard.remarkPlaceholder')}
                    placeholderTextColor="#94a3b8"
                    value={remarkInput}
                    onChangeText={setRemarkInput}
                    multiline
                    numberOfLines={2}
                  />
                </View>
              )}
            </View>

            {/* STEP 1: SAVE Button (Initially visible) */}
            {!isCurrentLogSaved && (
              <TouchableOpacity 
                style={[styles.primaryButton, { backgroundColor: '#17a34a', marginBottom: 0, height: 56 }]}
                onPress={handleSaveProduction}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Package color="#FFF" size={24} style={{ marginRight: 10 }} />
                    <Text style={[styles.primaryButtonText, { fontSize: 18, fontWeight: '700' }]}>SAVE</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* STEP 2: PRINT Button (Shown after saving) */}
            {isCurrentLogSaved && (
              <>
                <TouchableOpacity 
                  style={[styles.primaryButton, { backgroundColor: '#17a34a', marginBottom: 8, height: 56 }]}
                  onPress={executePrint}
                  disabled={isPrinting}
                >
                  {isPrinting ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <PrinterIcon color="#FFF" size={24} style={{ marginRight: 10 }} />
                      <Text style={[styles.primaryButtonText, { fontSize: 18, fontWeight: '700' }]}>Print Label</Text>
                    </>
                  )}
                </TouchableOpacity>
                {/* Printer-down hint: close preview and reprint from the logs list */}
                <View style={{ backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10, marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 13, color: '#92400e', flex: 1 }}>
                    Printer not responding? Close this preview — your QR is saved. Go to the station logs list and tap the 🖨️ icon to reprint any time.
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* List Print Preview Modal */}
      <Modal visible={showListPrintPreview} transparent animationType="fade">
        <View style={styles.previewOverlay}>
          <View style={styles.previewContent}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>{t('dashboard.labelPreview')}</Text>
              <TouchableOpacity onPress={() => { setShowListPrintPreview(false); setSelectedLogForPrint(null); }} disabled={isPrinting}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <View style={styles.previewLabelBox}>
              <Text style={styles.previewCompany}>Greencore Resources</Text>
              <View style={styles.qrContainer}>
                {selectedLogForPrint?.output_bag_qr && (
                  <QRCode value={selectedLogForPrint.output_bag_qr} size={120} getRef={(c) => (listQrRef.current = c)} />
                )}
              </View>
              <View style={styles.previewQRIdBox}>
                <Text style={styles.previewQRIdText}>{selectedLogForPrint?.output_bag_qr}</Text>
              </View>
              <View style={styles.previewGrid}>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>Weight</Text>
                  <Text style={styles.previewValue}>{selectedLogForPrint?.weight} kg</Text>
                </View>
                <View style={[styles.previewItem, { alignItems: 'flex-end' }]}>
                  <Text style={styles.previewLabel}>Station</Text>
                  <Text style={styles.previewValue}>
                    {(() => {
                      const sl = selectedLogForPrint?.sub_line;
                      if (!sl) return 'Crusher';
                      if (sl.includes('Washing')) return `Washing-W${sl.replace('Washing ', '')}`;
                      if (sl.includes('Extrusion')) return `Extrusion-E${sl.replace('Extrusion ', '')}`;
                      if (sl === 'Mixture') return 'Extrusion-MIX';
                      return `Crusher-${sl}`;
                    })()}
                  </Text>
                </View>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>Shift</Text>
                  <Text style={styles.previewValue}>{selectedShift?.name}</Text>
                </View>
                <View style={[styles.previewItem, { alignItems: 'flex-end' }]}>
                  <Text style={styles.previewLabel}>Date</Text>
                  <Text style={styles.previewValue}>{selectedLogForPrint ? new Date(selectedLogForPrint.created_at).toLocaleDateString() : ''}</Text>
                </View>
              </View>
            </View>

            {/* REPRINT Button */}
            <View style={{ backgroundColor: '#DCFCE7', borderRadius: 8, padding: 8, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: '#15803D', flex: 1 }}>Re-printing saved label — QR already recorded in the system.</Text>
            </View>
            <TouchableOpacity 
              style={[styles.primaryButton, { backgroundColor: '#17a34a', marginBottom: 0, height: 56 }]}
              onPress={executeListPrint}
              disabled={isPrinting}
            >
              {isPrinting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <PrinterIcon color="#FFF" size={24} style={{ marginRight: 10 }} />
                  <Text style={[styles.primaryButtonText, { fontSize: 18, fontWeight: '700' }]}>Reprint Label</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showStationModal} transparent animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>{pendingStation?.name}</Text><TouchableOpacity onPress={() => setShowStationModal(false)}><X color="#333" size={24} /></TouchableOpacity></View><Text style={styles.modalSubtitle}>Select section:</Text><View style={styles.sectionOptions}><TouchableOpacity style={styles.sectionOption} onPress={() => { if (pendingStation) { setSelectedStation(pendingStation); setSelectedSection('input'); setShowStationModal(false); } }}><View style={[styles.optionIcon, { backgroundColor: '#3b82f6' }]}><Plus color="#FFF" size={24} /></View><View><Text style={styles.optionTitle}>INPUT</Text></View></TouchableOpacity><TouchableOpacity style={styles.sectionOption} onPress={() => { if (pendingStation) { setSelectedStation(pendingStation); setSelectedSection('output'); setShowStationModal(false); } }}><View style={[styles.optionIcon, { backgroundColor: '#22c55e' }]}><Minus color="#FFF" size={24} /></View><View><Text style={styles.optionTitle}>OUTPUT</Text></View></TouchableOpacity></View></View></View></Modal>
      
      <Modal visible={showWashingModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pendingWashingLine}</Text>
              <TouchableOpacity onPress={() => { setShowWashingModal(false); setPendingWashingLine(null); }}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select section:</Text>
            <View style={styles.sectionOptions}>
            <TouchableOpacity 
              style={styles.sectionOption}
              onPress={() => {
                  if (pendingWashingLine) { 
                    setSelectedSubLine(pendingWashingLine); 
                  setSelectedSection('input');
                    setShowWashingModal(false); 
                    setPendingWashingLine(null);
                }
              }}
            >
              <View style={[styles.optionIcon, { backgroundColor: '#3b82f6' }]}>
                <Plus color="#FFF" size={24} />
              </View>
              <View>
                <Text style={styles.optionTitle}>INPUT</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.sectionOption}
              onPress={() => {
                  if (pendingWashingLine) { 
                    setSelectedSubLine(pendingWashingLine); 
                  setSelectedSection('output');
                    setShowWashingModal(false); 
                    setPendingWashingLine(null);
                }
              }}
            >
                <View style={[styles.optionIcon, { backgroundColor: '#17a34a' }]}>
                  <Box color="#FFF" size={24} />
              </View>
              <View>
                <Text style={styles.optionTitle}>OUTPUT</Text>
              </View>
            </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showExtrusionModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pendingExtrusionLine}</Text>
              <TouchableOpacity onPress={() => { setShowExtrusionModal(false); setPendingExtrusionLine(null); }}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select section:</Text>
            <View style={styles.sectionOptions}>
            <TouchableOpacity 
              style={styles.sectionOption}
              onPress={() => {
                  if (pendingExtrusionLine) { 
                    setSelectedSubLine(pendingExtrusionLine); 
                  setSelectedSection('input');
                    setShowExtrusionModal(false); 
                    setPendingExtrusionLine(null);
                }
              }}
            >
              <View style={[styles.optionIcon, { backgroundColor: '#f97316' }]}>
                <Plus color="#FFF" size={24} />
              </View>
              <View>
                <Text style={styles.optionTitle}>INPUT</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.sectionOption}
              onPress={() => {
                  if (pendingExtrusionLine) { 
                    setSelectedSubLine(pendingExtrusionLine); 
                  setSelectedSection('output');
                    setShowExtrusionModal(false); 
                    setPendingExtrusionLine(null);
                }
              }}
            >
                <View style={[styles.optionIcon, { backgroundColor: '#17a34a' }]}>
                  <Box color="#FFF" size={24} />
              </View>
              <View>
                <Text style={styles.optionTitle}>OUTPUT</Text>
              </View>
            </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editingLogWeight != null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('dashboard.editWeight')}</Text>
              <TouchableOpacity onPress={() => { setEditingLogWeight(null); setEditWeightValue(''); }}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('dashboard.weightKg')}</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder="0.00"
                value={editWeightValue}
                onChangeText={setEditWeightValue}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1, backgroundColor: '#64748b' }]}
                onPress={() => { setEditingLogWeight(null); setEditWeightValue(''); }}
              >
                <Text style={styles.primaryButtonText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1 }]}
                onPress={saveEditedLogWeight}
                disabled={isLoading || !editWeightValue}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>{t('common.save')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showClosedReportsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('dashboard.closedReports')}</Text>
              <TouchableOpacity onPress={() => setShowClosedReportsModal(false)}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>{t('dashboard.selectShiftToEditPrint')}</Text>
            {closedShiftsLoading ? (
              <View style={{ padding: 24, alignItems: 'center' }}><ActivityIndicator color="#333" /></View>
            ) : closedShiftsList.length === 0 ? (
              <Text style={{ padding: 16, color: '#666' }}>{t('dashboard.noClosedShifts')}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingBottom: 16 }}>
                {closedShiftsList.map((item: any) => (
                  <TouchableOpacity
                    key={item.shiftId}
                    style={[styles.selectionCard, { marginBottom: 8 }]}
                    onPress={() => handleSelectClosedShift(item.shiftId)}
                  >
                    <Text style={styles.cardTitle}>{item.shiftName} — {item.date}</Text>
                    <Text style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{item.operatorName}</Text>
                    <Text style={{ fontSize: 12, color: '#17a34a', marginTop: 4 }}>{item.totalOutputs} outputs · {item.totalWeight} kg</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={editingByProductIndex != null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit weight</Text>
              <TouchableOpacity onPress={() => { setEditingByProductIndex(null); setEditByProductWeight(''); }}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            {editingByProductIndex != null && (() => {
              const byProductsList = showShiftClosedView ? closedShiftByProducts : savedByProductsOnStartPage;
              const product = byProductsList[editingByProductIndex];
              return product ? (
                <>
                  <Text style={styles.modalSubtitle}>{product.name} — {product.stationName}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 20 }}>
                    <TextInput
                      style={[styles.byProductInput, { flex: 1, marginRight: 8 }]}
                      keyboardType="decimal-pad"
                      value={editByProductWeight}
                      onChangeText={setEditByProductWeight}
                      placeholder="Weight (kg)"
                    />
                    <Text style={{ fontSize: 16 }}>kg</Text>
                  </View>
                  <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity style={[styles.closeShiftBtn, { flex: 1, backgroundColor: '#6b7280', marginRight: 6 }]} onPress={() => { setEditingByProductIndex(null); setEditByProductWeight(''); }}>
                      <Text style={styles.closeShiftText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.closeShiftBtn, { flex: 1, marginLeft: 6 }]} onPress={saveEditedByProduct}>
                      <Text style={styles.closeShiftText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : null;
            })()}
          </View>
        </View>
      </Modal>
      
    </SafeAreaView>
  );
};

// Define consistent font family
const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: 'System',
});

const styles = StyleSheet.create({
  container: Platform.OS === 'web' ? {
    flex: 1,
    backgroundColor: '#F8F9FA',
    height: '100vh' as any,
    width: '100vw' as any,
    overflow: 'hidden' as any,
    display: 'flex' as any,
    flexDirection: 'column' as any
  } : { flex: 1, backgroundColor: '#F8F9FA' },
  toast: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 12 : 56,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#C62828',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    zIndex: 9999,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  toastText: { color: '#FFF', fontSize: 14, flex: 1, marginRight: 12 },
  toastClose: { padding: 4 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#EEE' },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerPill: { backgroundColor: '#F0F0F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8 },
  pillLabel: { fontSize: 10, color: '#666' },
  pillValue: { fontSize: 12, fontWeight: '700', color: '#333' },
  userName: { fontSize: 14, fontWeight: '600', color: '#333', marginRight: 8 },
  logoutButton: { padding: 8 },
  printerHeaderButton: { padding: 8, marginRight: 8, borderRadius: 8, backgroundColor: '#F5F5F5' },
  printerActive: { backgroundColor: '#DCFCE7' },
  backButton: { flexDirection: 'row', alignItems: 'center' },
  stationTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  contextPills: { flexDirection: 'row' },
  smallPill: { fontSize: 10, color: '#666', backgroundColor: '#EEE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginRight: 4 },
  timerPill: { backgroundColor: '#232938', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  timerText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  content: Platform.OS === 'web' ? { 
    flex: 1,
    height: 'calc(100vh - 70px)' as any,
    maxHeight: 'calc(100vh - 70px)' as any,
    overflowY: 'scroll' as any,
    overflowX: 'hidden' as any,
    WebkitOverflowScrolling: 'touch' as any,
    position: 'relative' as any,
    '-webkit-overflow-scrolling': 'touch' as any
  } : { flex: 1 },
  contentContainer: Platform.OS === 'web' ? {
    paddingBottom: 40,
    minHeight: '100%' as any
  } : { paddingBottom: 40 },
  startShiftContainer: { padding: 20, marginTop: 20 },
  ppicHomeContainer: { paddingVertical: 8 },
  ppicHomeTitle: { fontSize: 22, fontWeight: '700', color: '#0ea5e9', marginBottom: 8, textAlign: 'center' },
  ppicHomeSubtitle: { fontSize: 13, color: '#64748b', marginBottom: 16, textAlign: 'center', paddingHorizontal: 8 },
  ppicHomeCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  ppicHomeLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  ppicShiftRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  ppicShiftBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#F1F5F9', borderWidth: 2, borderColor: 'transparent', marginRight: 10, marginBottom: 10 },
  ppicShiftBtnActive: { backgroundColor: '#E0F2FE', borderColor: '#0ea5e9' },
  ppicShiftBtnText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  ppicShiftBtnTextActive: { color: '#0ea5e9' },
  /* PPIC section headers */
  ppicSectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  ppicSectionTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  /* Pulsing live dot */
  ppicLiveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e', marginRight: 8 },
  ppicLiveDotSmall: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e', marginRight: 4 },
  /* Active shift cards on PPIC home */
  ppicActiveShiftCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0FDF4', borderRadius: 12, borderWidth: 1, borderColor: '#86EFAC', padding: 14, marginBottom: 10 },
  ppicActiveShiftName: { fontSize: 15, fontWeight: '700', color: '#166534', flex: 1 },
  ppicActiveShiftOperator: { fontSize: 12, color: '#4b7a57', marginTop: 2 },
  ppicActiveShiftMeta: { fontSize: 12, color: '#4b7a57', marginTop: 1 },
  ppicLivePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 8 },
  ppicLivePillText: { fontSize: 10, fontWeight: '800', color: '#15803D', letterSpacing: 0.5 },
  /* Empty state */
  ppicEmptyActive: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0', borderStyle: 'dashed' },
  ppicEmptyActiveText: { fontSize: 13, color: '#94a3b8' },
  /* LIVE banner on the shift detail view */
  ppicLiveBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#86EFAC' },
  ppicLiveDotBanner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e', marginRight: 10 },
  ppicLiveBannerText: { flex: 1, fontSize: 12, color: '#15803D', lineHeight: 18 },
  /* ── Shift logs: category view ── */
  shiftLogsSearchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  shiftLogsSearchInput: { flex: 1, fontSize: 14, color: '#111', marginHorizontal: 8, paddingVertical: 0 },
  shiftLogCategory: { borderRadius: 12, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  shiftLogCategoryHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
  shiftLogCatDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  shiftLogCatLabel: { fontSize: 14, fontWeight: '700', flex: 1 },
  shiftLogCatBadge: { backgroundColor: 'rgba(0,0,0,0.07)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 },
  shiftLogCatBadgeText: { fontSize: 11, fontWeight: '700' },
  shiftLogCatWeight: { fontSize: 13, fontWeight: '700' },
  shiftLogRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)' },
  shiftLogQr: { fontSize: 13, fontWeight: '600', color: '#1e293b', marginBottom: 2 },
  shiftLogMeta: { fontSize: 11, color: '#64748b', marginRight: 4 },
  shiftLogStatusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  shiftLogWeight: { fontSize: 13, fontWeight: '700', color: '#1e293b', marginRight: 10, minWidth: 52, textAlign: 'right' },
  shiftLogPrintBtn: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', marginRight: 6 },
  shiftLogEditBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  shiftLogEditText: { fontSize: 12, fontWeight: '700', color: '#0ea5e9', marginLeft: 3 },
  shiftLogPager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  shiftLogPagerBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center', marginHorizontal: 12 },
  shiftLogPagerBtnDisabled: { backgroundColor: 'transparent' },
  shiftLogPagerText: { fontSize: 13, fontWeight: '700', minWidth: 50, textAlign: 'center' },
  startShiftCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#17a34a', borderRadius: 16, padding: 20, elevation: 6 },
  playIconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  startShiftText: { flex: 1, marginLeft: 15 },
  startShiftTitle: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  startShiftSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  dashboardGrid: { padding: 16 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  activeStatus: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#17a34a', marginRight: 8 },
  statusText: { fontSize: 14, fontWeight: '600', color: '#17a34a' },
  durationText: { fontSize: 14, color: '#666' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  statCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, width: '48%', alignItems: 'center', borderWidth: 1, borderBottomWidth: 3, borderColor: '#EEE' },
  statValue: { fontSize: 24, fontWeight: '700', color: '#333' },
  statLabel: { fontSize: 12, color: '#666', marginTop: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#999', marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' },
  processSectionHeader: { fontSize: 13, fontWeight: '600', color: '#64748b', marginBottom: 8 },
  stationCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#EEE' },
  stationIconBox: { width: 44, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  stationInfo: { flex: 1, marginLeft: 12 },
  stationName: { fontSize: 16, fontWeight: '700', color: '#333' },
  stationDesc: { fontSize: 12, color: '#666' },
  stationMiniStats: { marginRight: 10 },
  miniStat: { fontSize: 12, fontWeight: '600', color: '#333' },
  endShiftButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#232938', borderRadius: 12, padding: 16, marginTop: 12, marginBottom: 30 },
  endShiftText: { color: '#FFF', fontSize: 16, fontWeight: '700', marginLeft: 10 },
  detailContainer: {},
  stationHero: { padding: 24, paddingBottom: 40 },
  heroHeader: { flexDirection: 'row', alignItems: 'center' },
  heroTitle: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  heroDesc: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 2 },
  statusBox: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 16, marginTop: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  statusLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  statusValue: { color: '#FFF', fontSize: 18, fontWeight: '700', marginTop: 4 },
  statusDesc: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 8, lineHeight: 18 },
  heroIconCircle: { width: 56, height: 56, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  byProductsCard: { backgroundColor: '#fffbeb', borderRadius: 16, marginHorizontal: 16, marginTop: -20, padding: 20, borderWidth: 1, borderColor: '#fef3c7', elevation: 3 },
  byProductsHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  byProductsTitle: { fontSize: 18, fontWeight: '700', color: '#92400e' },
  byProductsSubtitle: { fontSize: 14, color: '#b45309', opacity: 0.8 },
  bulletList: { gap: 8 },
  bulletItem: { fontSize: 15, fontWeight: '500', color: '#b45309' },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 16, marginBottom: 12 },
  secondaryButtonText: { color: '#475569', fontSize: 16, fontWeight: '700', marginLeft: 10 },
  progressCardRedesign: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginTop: 8, borderWidth: 1, borderColor: '#EEE' },
  progressTitleRedesign: { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 16 },
  progressDataRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  progressDataLabel: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  progressDataValue: { fontSize: 15, fontWeight: '800', color: '#1e293b' },
  selectionContainer: { padding: 16 },
  selectionTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b', marginBottom: 24, textAlign: 'center' },
  selectionCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#EEE', elevation: 2 },
  selectionIconBox: { width: 52, height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  selectionText: { flex: 1 },
  selectionCardTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  selectionCardSub: { fontSize: 13, color: '#64748b', marginTop: 2 },
  sublineBadgeWrapper: { paddingHorizontal: 16, marginBottom: 8 },
  sublineBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, borderWidth: 1, alignSelf: 'flex-start' },
  sublineBadgeText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  crusherLogsSection: { 
    marginTop: 24, 
    padding: 16, 
    backgroundColor: '#FFF', 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#f1f5f9' 
  },
  logsHeader: { 
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16 
  },
  logsTitle: { 
    fontSize: 16, 
    fontWeight: '700',
    color: '#1e293b', 
    fontFamily 
  },
  datePickerContainer: { 
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#ffffff', 
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0' 
  },
  datePickerLabel: { 
    fontSize: 14,
    fontWeight: '600',
    color: '#475569', 
    marginBottom: 8,
    fontFamily 
  },
  searchBox: { 
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10, 
    backgroundColor: '#ffffff', 
    borderWidth: 1,
    borderColor: '#e2e8f0', 
    borderRadius: 12,
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1
  },
  searchInput: { 
    flex: 1,
    fontSize: 15, 
    color: '#1e293b', 
    padding: 0,
    fontWeight: '400',
    minHeight: 20,
    outline: 'none',
    borderWidth: 0,
    border: 'none',
    outlineWidth: 0,
    outlineStyle: 'none',
    outlineColor: 'transparent',
    fontFamily
  },
  clearButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: '#f1f5f9'
  },
  logsList: { marginBottom: 16 },
  logItem: { 
    flexDirection: 'row',
    justifyContent: 'space-between', 
    alignItems: 'flex-start', 
    padding: 14, 
    backgroundColor: '#f8fafc', 
    borderRadius: 10, 
    borderWidth: 1, 
    borderColor: '#e2e8f0', 
    marginBottom: 10 
  },
  logMain: { flex: 1, marginRight: 8 },
  logQr: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 4, fontFamily: 'monospace' },
  logDetails: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  logWeight: { fontSize: 12, fontWeight: '700', color: '#17a34a' },
  logTime: { fontSize: 12, color: '#64748b' },
  logStatusRow: { marginTop: 6 },
  statusBadge: { 
    paddingHorizontal: 8, 
    paddingVertical: 4, 
    borderRadius: 8, 
    alignSelf: 'flex-start',
    minHeight: 20
  },
  statusBadgeText: { 
    fontSize: 10, 
    fontWeight: '700',
    textTransform: 'uppercase', 
    fontFamily 
  },
  filtersContainer: { marginBottom: 16, gap: 14 },
  filterGroup: { 
    flexDirection: 'row',
    alignItems: 'flex-start', 
    gap: 10,
    marginBottom: 2
  },
  filterLabel: { 
    fontSize: 13, 
    fontWeight: '600',
    color: '#475569', 
    minWidth: 55,
    paddingTop: 6,
    fontFamily 
  },
  filterButtons: { 
    flexDirection: 'row',
    gap: 6, 
    flex: 1, 
    flexWrap: 'wrap',
    alignItems: 'flex-start'
  },
  filterButton: { 
    paddingHorizontal: 10, 
    paddingVertical: 7, 
    borderRadius: 8, 
    backgroundColor: '#f1f5f9', 
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center'
  },
  filterButtonActive: { 
    backgroundColor: '#17a34a', 
    borderColor: '#17a34a' 
  },
  filterButtonText: { 
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b', 
    fontFamily 
  },
  filterButtonTextActive: { 
    color: '#ffffff', 
    fontFamily 
  },
  logActions: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 6,
    justifyContent: 'flex-end'
  },
  editIconButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#E0F2FE',
  },
  printIconButton: { 
    padding: 8, 
    borderRadius: 8, 
    backgroundColor: '#F0FDF4',
  },
  logBadge: { 
    paddingHorizontal: 10, 
    paddingVertical: 4, 
    borderRadius: 12,
  },
  logBadgeText: { 
    fontSize: 11, 
    fontWeight: '700', 
    textTransform: 'uppercase',
    fontFamily
  },
  emptyState: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  emptyText: { marginTop: 12, fontSize: 14, color: '#94a3b8' },
  loadingState: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#94a3b8' },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  pageBtn: { padding: 8, borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  pageBtnDisabled: { opacity: 0.4 },
  pageInfo: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  formCard: { backgroundColor: '#FFF', borderRadius: 20, marginHorizontal: 16, marginTop: -20, padding: 24, elevation: 3 },
  formTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 20 },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, color: '#666', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    outline: 'none',
    outlineWidth: 0,
    outlineStyle: 'none',
    outlineColor: 'transparent'
  },
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#17a34a', borderRadius: 12, padding: 16, marginTop: 10 },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700', marginLeft: 10 },
  searchContainer: { marginBottom: 20, position: 'relative', zIndex: 1000 },
  searchInputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#DDD', borderRadius: 10, paddingHorizontal: 12, height: 48 },
  searchTextInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    outline: 'none',
    outlineWidth: 0,
    outlineStyle: 'none',
    outlineColor: 'transparent'
  },
  suggestionsList: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#EEE',
    borderRadius: 10,
    elevation: 5,
    zIndex: 1000,
    maxHeight: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8
  },
  suggestionItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', flexDirection: 'row', justifyContent: 'space-between' },
  suggestionId: { fontSize: 14, fontWeight: '600', color: '#333' },
  suggestionDetail: { fontSize: 12, color: '#666' },
  scanButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#17a34a', borderStyle: 'dashed', borderRadius: 12, padding: 16, marginBottom: 20 },
  scanButtonText: { color: '#17a34a', fontSize: 16, fontWeight: '700', marginLeft: 10 },
  selectedBagCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F9FF', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#BAE6FD' },
  selectedBagId: { fontSize: 14, fontWeight: '700', color: '#0369A1' },
  selectedBagWeight: { fontSize: 12, color: '#0369A1' },
  stationProgressCard: { padding: 24 },
  progressTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 12 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel: { color: '#666' },
  progressValue: { fontWeight: '600', color: '#333' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#333' },
  modalSubtitle: { fontSize: 14, color: '#666', marginBottom: 24 },
  sectionOptions: { gap: 12 },
  sectionOption: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#EEE' },
  optionIcon: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  optionTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scannerOverlay: { position: 'absolute', top: 50, left: 0, right: 0, alignItems: 'center' },
  scannerText: { color: '#FFF', fontSize: 18, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  closeScanner: { marginTop: 20 },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' },
  cameraHeader: { paddingTop: 50, paddingHorizontal: 20, alignItems: 'flex-start' },
  cameraCloseButton: { padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  cameraControls: { paddingBottom: 50, alignItems: 'center' },
  captureButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#17a34a' },
  captureButtonInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#17a34a' },
  photoPreviewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  photoPreviewContent: { backgroundColor: '#FFF', borderRadius: 24, padding: 24, width: '100%', maxWidth: 500 },
  photoPreviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  photoPreviewTitle: { fontSize: 20, fontWeight: '700', color: '#333' },
  photoPreviewImage: { width: '100%', height: 400, borderRadius: 16, marginBottom: 20, backgroundColor: '#F9FAFB' },
  photoPreviewActions: { flexDirection: 'row', gap: 12 },
  photoPreviewButton: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  retakeButton: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  retakeButtonText: { color: '#64748B', fontSize: 16, fontWeight: '700' },
  acceptButton: { backgroundColor: '#17a34a' },
  acceptButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  photosPreviewContainer: { marginTop: 12, marginBottom: 12, maxHeight: 140 },
  photosPreviewContent: { paddingRight: 12, gap: 12 },
  photoPreviewItem: { position: 'relative', marginRight: 12 },
  photoPreviewThumbnail: { width: 120, height: 120, borderRadius: 12, backgroundColor: '#F9FAFB' },
  removePhotoButton: { position: 'absolute', top: -8, right: -8, width: 28, height: 28, borderRadius: 14, backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFF' },
  summaryContainer: { padding: 16 },
  summaryStatsCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginBottom: 24, elevation: 3 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 16 },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { alignItems: 'center', width: '48%' },
  summaryValue: { fontSize: 20, fontWeight: '700', color: '#17a34a' },
  summaryLabel: { fontSize: 12, color: '#666', marginTop: 4 },
  byProductRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#EEE' },
  editByProductBtn: { padding: 8 },
  byProductName: { fontSize: 16, fontWeight: '700', color: '#333' },
  byProductStation: { fontSize: 12, color: '#666' },
  byProductInputWrapper: { flexDirection: 'row', alignItems: 'center' },
  byProductInput: { width: 60, borderWidth: 1, borderColor: '#DDD', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 16, fontWeight: '600' },
  unitLabel: { marginLeft: 6, color: '#666', fontWeight: '600' },
  crusherContainer: Platform.OS === 'web' ? {
    padding: 16,
    minHeight: '100%' as any
  } : { padding: 16 },
  sectionCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginBottom: 16, elevation: 2 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  typePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 10 },
  typePillText: { fontSize: 10, fontWeight: '800' },
  sectionTitleText: { fontSize: 16, fontWeight: '700', color: '#333' },
  grayEmptyBox: { backgroundColor: '#F8F9FA', borderRadius: 10, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed' },
  grayEmptyText: { color: '#999', fontSize: 14 },
  inputWithIcon: { flexDirection: 'row', alignItems: 'center' },
  iconInsideInput: { position: 'absolute', right: 12 },
  afterCloseHint: { fontSize: 13, color: '#666', marginTop: 12, marginBottom: 4, lineHeight: 18 },
  closeShiftBtn: { backgroundColor: '#232938', padding: 18, borderRadius: 12, alignItems: 'center', marginTop: 20, marginBottom: 40 },
  closeShiftText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  previewContent: { backgroundColor: '#FFF', borderRadius: 24, padding: 24, width: '100%', maxWidth: 400, elevation: 10 },
  previewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  previewTitle: { fontSize: 20, fontWeight: '700', color: '#333' },
  previewLabelBox: { backgroundColor: '#F9FAFB', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', marginBottom: 20 },
  previewCompany: { fontSize: 14, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  qrContainer: { padding: 10, backgroundColor: '#FFF', borderRadius: 10, marginBottom: 15, elevation: 2 },
  previewQRIdBox: { backgroundColor: '#000', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, marginBottom: 15 },
  previewQRIdText: { color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  previewGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  previewItem: { width: '45%', marginBottom: 10 },
  previewLabel: { fontSize: 10, color: '#999', textTransform: 'uppercase', marginBottom: 2 },
  previewValue: { fontSize: 14, fontWeight: '700', color: '#333' },
  printActionBtn: { flexDirection: 'row', backgroundColor: '#17a34a', padding: 18, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  printActionText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

export default DashboardScreen;
