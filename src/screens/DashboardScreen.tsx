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
  
  // PE (Polyethylene) material flow — separate from PC, does not affect PC logic
  const isPE = user?.role?.toLowerCase() === 'pe';

  const isPPIC = user?.role?.toLowerCase() === 'ppic';

  /** Output type options for a given PE raw-material sub-line */
  const getPeOutputOptions = (subLine: string): string[] => {
    if (subLine === 'PE SUPER') return ['Flakes PE SUPER', 'Flakes PE 1'];
    if (subLine === 'PE 1')    return ['Flakes PE 1'];
    if (subLine === 'EVA SUPER') return ['Flakes EVA SUPER', 'Flakes EVA 1'];
    if (subLine === 'EVA 1')   return ['Flakes EVA 1'];
    return [];
  };

  /** Short code used in QR generation for PE output types */
  const getPeOutputCode = (outputType: string): string => {
    const map: Record<string, string> = {
      'Flakes PE SUPER': 'FPS',
      'Flakes PE 1':     'FP1',
      'Flakes EVA SUPER':'FES',
      'Flakes EVA 1':    'FE1',
      'Pellet PE SUPER': 'PPS',
      'Pellet PE 1':     'PP1',
      'Pellet EVA SUPER':'PES',
      'Pellet EVA 1':    'PV1',
    };
    return map[outputType] || 'PE';
  };

  /**
   * Primary flakes input label for each PE extruder product line.
   * Additional materials are always logged as 0 (weighed at shift-end by PPIC).
   */
  const PE_EXTRUDER_PRIMARY: Record<string, string> = {
    'Pellet PE SUPER':  'Flakes PE SUPER',
    'Pellet PE 1':      'Flakes PE 1',
    'Pellet EVA SUPER': 'Flakes EVA SUPER',
    'Pellet EVA 1':     'Flakes EVA 1',
  };

  /** Additional (unmeasured) materials per product line — shown as 0 in app */
  const PE_EXTRUDER_ADDITIONAL: Record<string, string[]> = {
    'Pellet PE SUPER':  ['Flakes PE 1', 'Flakes EVA SUPER', 'Flakes EVA 1', 'Pellet PE 1', 'Pellet EVA 1'],
    'Pellet PE 1':      [],
    'Pellet EVA SUPER': ['Flakes PE SUPER', 'Flakes PE 1', 'Flakes EVA 1', 'Pellet PE 1', 'Pellet EVA 1'],
    'Pellet EVA 1':     [],
  };
  
  // App State
  const [stations, setStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Shift State
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [shiftStartTime, setShiftStartTime] = useState<number | null>(null);
  const [shiftEndedAt, setShiftEndedAt] = useState<number | null>(null);
  // Refs so polling interval always sees the latest values without stale closures
  const backendShiftIdRef = React.useRef<number | null>(null);
  const isShiftActiveRef = React.useRef<boolean>(false);
  const [shiftDuration, setShiftDuration] = useState('0h 00m 00s');
  // True when shift is closed — blocks all input/output creation
  const isShiftEnded = shiftEndedAt !== null;
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
  const [selectedSubLine, setSelectedSubLine] = useState<
    '3E' | 'Rapid' | 'Betty' |
    'Washing 1' | 'Washing 2' | 'Washing 3' |
    'Extrusion 1' | 'Extrusion 2' | 'Extrusion 3' | 'Mixture' |
    'PE SUPER' | 'PE 1' | 'EVA SUPER' | 'EVA 1' |
    'Pellet PE SUPER' | 'Pellet PE 1' | 'Pellet EVA SUPER' | 'Pellet EVA 1' |
    null
  >(null);
  /** PE only: selected output type (e.g. 'Flakes PE SUPER') for Crusher-Washing station */
  const [peOutputType, setPeOutputType] = useState<string | null>(null);
  /** PE Crusher-Washing: search and filter for raw material list */
  const [peRawMaterialSearch, setPeRawMaterialSearch] = useState('');
  const [peRawMaterialFilter, setPeRawMaterialFilter] = useState<'all' | 'PE' | 'EVA'>('all');
  /** PE Crusher-Washing: Recent Entries list (like PC Crusher) */
  const [peCrusherLogs, setPeCrusherLogs] = useState<any[]>([]);
  const [peCrusherLogsLoading, setPeCrusherLogsLoading] = useState(false);
  const [peCrusherSelectedDate, setPeCrusherSelectedDate] = useState(formatDateLocal(new Date()));
  const [peCrusherSearchQuery, setPeCrusherSearchQuery] = useState('');
  const [peCrusherLineFilter, setPeCrusherLineFilter] = useState<string>('all');
  const [peCrusherStatusFilter, setPeCrusherStatusFilter] = useState<string>('all');
  const [peCrusherCurrentPage, setPeCrusherCurrentPage] = useState(1);
  const [peCrusherTotalPages, setPeCrusherTotalPages] = useState(1);
  const [peCrusherTotalLogs, setPeCrusherTotalLogs] = useState(0);
  /** PE Extrusion & Packaging: Recent Entries list */
  const [peExtrusionLogs, setPeExtrusionLogs] = useState<any[]>([]);
  const [peExtrusionLogsLoading, setPeExtrusionLogsLoading] = useState(false);
  const [peExtrusionSelectedDate, setPeExtrusionSelectedDate] = useState(formatDateLocal(new Date()));
  const [peExtrusionSearchQuery, setPeExtrusionSearchQuery] = useState('');
  const [peExtrusionLineFilter, setPeExtrusionLineFilter] = useState<string>('all');
  const [peExtrusionStatusFilter, setPeExtrusionStatusFilter] = useState<string>('all');
  const [peExtrusionCurrentPage, setPeExtrusionCurrentPage] = useState(1);
  const [peExtrusionTotalPages, setPeExtrusionTotalPages] = useState(1);
  const [peExtrusionTotalLogs, setPeExtrusionTotalLogs] = useState(0);
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
  
  // Final Packing logs list state
  const [packingLogs, setPackingLogs] = useState<any[]>([]);
  const [packingLogsLoading, setPackingLogsLoading] = useState(false);
  const [packingSelectedDate, setPackingSelectedDate] = useState(formatDateLocal(new Date()));
  const [packingSearchQuery, setPackingSearchQuery] = useState('');
  const [packingCurrentPage, setPackingCurrentPage] = useState(1);
  const [packingTotalPages, setPackingTotalPages] = useState(1);
  const [packingTotalLogs, setPackingTotalLogs] = useState(0);
  const [packingSelectedStatusFilter, setPackingSelectedStatusFilter] = useState<string>('all');
  
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
  const [shiftLogsPageLabel, setShiftLogsPageLabel] = useState(1);
  const [shiftLogsPagePacking, setShiftLogsPagePacking] = useState(1);
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

  // PPIC Station Overview
  const [ppicOverviewDate, setPpicOverviewDate] = useState(() => formatDateLocal(new Date()));
  const [ppicOverviewShiftId, setPpicOverviewShiftId] = useState<number | null>(null);
  const [ppicOverviewData, setPpicOverviewData] = useState<any[]>([]);
  const [ppicOverviewLoading, setPpicOverviewLoading] = useState(false);
  const [ppicExpandedStation, setPpicExpandedStation] = useState<string | null>(null);
  const [ppicOverviewSearch, setPpicOverviewSearch] = useState('');

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
  const previewBagStatusRef = React.useRef<'pending' | 'Completed'>('pending');
  // Ref is set directly in status toggle and preview open/close handlers. Do NOT sync ref from state
  // here — a re-render with stale state can overwrite the ref to 'pending' after user chose 'Completed'.
  const [isPrinting, setIsPrinting] = useState(false);
  const qrRef = React.useRef<any>(null);
  const listQrRef = React.useRef<any>(null);

  /** Stable "today" for date picker max – avoids picker resetting when prop reference changes. */
  const maxDate = useMemo(() => new Date(), []);

  /** JUMBO/bag ID from API (supports snake_case and camelCase so web and native both show full ID). */
  const getBagDisplayId = (bag: any): string => {
    const qr = (bag?.output_bag_qr ?? bag?.outputBagQr ?? bag?.input_bag_qr ?? bag?.inputBagQr ?? '') as string;
    return typeof qr === 'string' && qr.trim() !== '' ? qr.trim() : '—';
  };

  /** Normalize search result bags so QR is always in output_bag_qr/outputBagQr for dropdown display. */
  const normalizeSuggestedBags = (bags: any[]): any[] =>
    (bags || []).map((b: any) => {
      const qr = b?.output_bag_qr ?? b?.outputBagQr ?? b?.input_bag_qr ?? b?.inputBagQr ?? '';
      const qrStr = typeof qr === 'string' ? qr.trim() : String(qr || '').trim();
      return {
        ...b,
        output_bag_qr: qrStr || (b?.output_bag_qr ?? b?.outputBagQr ?? b?.input_bag_qr ?? b?.inputBagQr),
        outputBagQr: qrStr || (b?.outputBagQr ?? b?.output_bag_qr ?? b?.inputBagQr ?? b?.input_bag_qr),
      };
    });

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

  const loadPpicOverview = async (date?: string, shiftTypeId?: number | null) => {
    if (user?.role?.toLowerCase() !== 'ppic') return;
    setPpicOverviewLoading(true);
    try {
      const res = await productionApi.getPpicStationOverview(
        date ?? ppicOverviewDate,
        shiftTypeId !== undefined ? shiftTypeId : ppicOverviewShiftId,
      );
      if (res.data?.success && Array.isArray(res.data.data)) {
        setPpicOverviewData(res.data.data);
      } else {
        setPpicOverviewData([]);
      }
    } catch (e) {
      setPpicOverviewData([]);
    } finally {
      setPpicOverviewLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { loadPpicActiveShifts(); }, [user?.role]));
  useFocusEffect(useCallback(() => { if (user?.role?.toLowerCase() === 'ppic') loadPpicOverview(); }, [user?.role]));
  useFocusEffect(useCallback(() => {
    if (user?.role?.toLowerCase() !== 'ppic') return;
    // Load initial closed shifts list for PPIC home
    setShowClosedReportsModal(false);
    setClosedShiftsLoading(true);
    productionApi.getClosedShifts(100, ppicSelectedDate, undefined)
      .then(res => { if (res.data?.success && Array.isArray(res.data.data)) setClosedShiftsList(res.data.data); else setClosedShiftsList([]); })
      .catch(() => setClosedShiftsList([]))
      .finally(() => setClosedShiftsLoading(false));
  }, [user?.role]));

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
      setShiftLogsPageLabel(1);
      setShiftLogsPagePacking(1);
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

  // Helper: format millisecond diff as "Xh YYm ZZs"
  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
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
        setShiftEndedAt(null);
        setBackendShiftId(shift.id);
        const logsRes = await productionApi.getShiftLogs(shift.id);
        if (logsRes.data.success) setShiftLogs(logsRes.data.data);
      } else {
        // No active shift — check if there is a recently closed shift *for this shift type* today
        // so we can display "Shift Closed" only when it matches the selected shift (e.g. Shift 1).
        // If user switched to Shift 2, we must show "Start Shift" for Shift 2, not Shift 1 closed.
        try {
          const latestRes = await productionApi.getLatestShift();
          if (latestRes.data.success && latestRes.data.data) {
            const latest = latestRes.data.data;
            const isSameShiftType = latest.shift_type_id != null && selectedShift?.id != null && Number(latest.shift_type_id) === Number(selectedShift.id);
            if (isSameShiftType && !latest.is_active && latest.end_time) {
              const startMs = new Date(latest.start_time).getTime();
              const endMs = new Date(latest.end_time).getTime();
              setIsShiftActive(false);
              setBackendShiftId(latest.id);
              setShiftStartTime(startMs);
              setShiftEndedAt(endMs);
              setShiftDuration(formatDuration(endMs - startMs));
              const logsRes = await productionApi.getShiftLogs(latest.id);
              if (logsRes.data.success) setShiftLogs(logsRes.data.data);
              else setShiftLogs([]);
            } else {
              setIsShiftActive(false);
              setBackendShiftId(null);
              setShiftStartTime(null);
              setShiftEndedAt(null);
              setShiftLogs([]);
            }
          } else {
            setIsShiftActive(false);
            setBackendShiftId(null);
            setShiftStartTime(null);
            setShiftEndedAt(null);
            setShiftLogs([]);
          }
        } catch (_) {
          setIsShiftActive(false);
          setBackendShiftId(null);
          setShiftStartTime(null);
          setShiftEndedAt(null);
          setShiftLogs([]);
        }
      }
    } catch (e) {
      console.error('Failed to load shift state', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll every 5s while shift is active to detect PPIC-ended shifts.
  // Uses refs so the closure always sees the latest backendShiftId / isShiftActive.
  const checkShiftEndedByPPIC = React.useCallback(async () => {
    const shiftId = backendShiftIdRef.current;
    const active = isShiftActiveRef.current;
    if (!shiftId || !active) return;
    try {
      const res = await productionApi.getShiftStatus(shiftId);
      if (!res.data?.success) return;
      const s = res.data.data;
      if (!s.is_active && s.end_time) {
        // PPIC closed this shift — freeze using DB timestamps
        const startMs = new Date(s.start_time).getTime();
        const endMs = new Date(s.end_time).getTime();
        const duration = formatDuration(endMs - startMs);
        setIsShiftActive(false);
        setShiftEndedAt(endMs);
        setShiftDuration(duration);
      }
    } catch (_) {}
  }, []);

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
          'Label Removal': '#3b82f6',
          'Crusher': isPE ? '#0d9488' : '#a855f7',
          'Washing': '#06b6d4',
          'Extrusion': '#f97316',
          'Re-Packaging': '#22c55e',
        };
        const mappedStations = response.data.data.map((s: any) => ({
          ...s,
          color: uiColors[s.name] || '#64748b',
          // For PE, rename Crusher card to "Crusher-Washing" in the UI
          displayName: isPE && s.name === 'Crusher' ? 'Crusher-Washing' : s.name,
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
      // Clear any previously frozen end time when shift restarts
      setShiftEndedAt(null);
      interval = setInterval(() => {
        setShiftDuration(formatDuration(Date.now() - shiftStartTime));
      }, 1000);
    } else if (!isShiftActive && shiftStartTime !== null && shiftEndedAt === null) {
      // Shift just ended client-side — freeze at current elapsed (will be overwritten by DB poll)
      const now = Date.now();
      setShiftEndedAt(now);
      setShiftDuration(formatDuration(now - shiftStartTime));
    }
    return () => clearInterval(interval);
  }, [isShiftActive, shiftStartTime]);

  // When shift ends, reset selectedSection so no input/output form stays open
  useEffect(() => {
    if (isShiftEnded) {
      setSelectedSection(null);
    }
  }, [isShiftEnded]);
  useEffect(() => { isShiftActiveRef.current = isShiftActive; }, [isShiftActive]);
  useEffect(() => { backendShiftIdRef.current = backendShiftId; }, [backendShiftId]);

  // Poll every 30 seconds to detect PPIC-ended shifts.
  // Single interval for the component lifetime — refs ensure we always read latest values.
  useEffect(() => {
    const poll = setInterval(() => { checkShiftEndedByPPIC(); }, 30000);
    return () => clearInterval(poll);
  }, [checkShiftEndedByPPIC]);

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
        setShiftEndedAt(null);
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
    const list: any[] = [];

    if (isPE) {
      // PE waste template: Crusher-Washing + Extruder
      const crusherStation = stations.find(s => s.name?.toLowerCase().includes('crusher') || (s as any).code === 'CRS');
      const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || (s as any).code === 'EXT');
      if (crusherStation) {
        ['Dust', 'Sweep Floor'].forEach(name => {
          list.push({ name, category: 'Waste', weight: 0, stationId: crusherStation.id, stationName: 'Crusher-Washing', processLabel: 'crusherWashing' });
        });
      }
      if (extrusionStation) {
        ['Lumps', 'Sweep Floor', 'Dust'].forEach(name => {
          list.push({ name, category: 'Waste', weight: 0, stationId: extrusionStation.id, stationName: extrusionStation.name, processLabel: 'extrusion' });
        });
      }
      return list;
    }

    // PC/PET waste template (unchanged)
    const labelRemovalStation = stations.find(s => s.name?.toLowerCase().includes('label removal') || (s as any).code === 'LR');
    const crusherStation = stations.find(s => s.name?.toLowerCase().includes('crusher') || (s as any).code === 'CRS');
    const washingStation = stations.find(s => s.name?.toLowerCase().includes('washing') || (s as any).code === 'WSH');
    const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4 || (s as any).code === 'EXT');
    const stationForRemoveLabelCrushing = labelRemovalStation || crusherStation;
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
  }, [stations, isPE]);

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
    setSavedByProductsOnStartPage([]);
    setSavedByProductsMeta(null);
    // PPIC stays on their home dashboard — no ShiftSelection navigation needed
    if (user?.role?.toLowerCase() !== 'ppic') {
    navigation.navigate('ShiftSelection');
    }
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
      setShiftLogsPageLabel(1);
      setShiftLogsPagePacking(1);
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
      } else if (selectedStation?.name === 'Extrusion & Packaging') {
        if (isPE) {
          setPeExtrusionLogs(prev => prev.map(log => log.id === editingLogWeight.id ? { ...log, weight: w } : log));
        } else {
          setExtrusionLogs(prev => prev.map(log => log.id === editingLogWeight.id ? { ...log, weight: w } : log));
        }
      } else if (
        selectedStation?.id === 5 ||
        selectedStation?.name?.toLowerCase().includes('final') ||
        selectedStation?.name?.toLowerCase().includes('re-packaging')
      ) {
        setPackingLogs(prev => prev.map(log =>
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
        // Only scope to current shift when viewing today — for past dates use the date filter
        selectedDate === formatDateLocal(new Date()) ? backendShiftId : undefined
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

  /** PE Crusher-Washing: load recent entries (same API as PC crusher, CRS station; sub_line = output type e.g. Flakes PE SUPER). */
  const loadPeCrusherLogs = async () => {
    try {
      setPeCrusherLogsLoading(true);
      const subLineMap: Record<string, string> = {
        'PE SUPER': 'Flakes PE SUPER',
        'PE 1': 'Flakes PE 1',
        'EVA SUPER': 'Flakes EVA SUPER',
        'EVA 1': 'Flakes EVA 1',
      };
      const subLine = peCrusherLineFilter !== 'all' ? (subLineMap[peCrusherLineFilter] || undefined) : undefined;
      const statusFilter = peCrusherStatusFilter !== 'all' ? peCrusherStatusFilter : undefined;
      const response = await productionApi.getCrusherLogs(
        subLine,
        peCrusherSelectedDate,
        peCrusherSearchQuery || undefined,
        statusFilter,
        peCrusherCurrentPage,
        10,
        peCrusherSelectedDate === formatDateLocal(new Date()) ? backendShiftId : undefined
      );
      if (response.data.success) {
        setPeCrusherLogs(response.data.data);
        setPeCrusherTotalPages(response.data.pagination.totalPages);
        setPeCrusherTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error loading PE crusher logs:', error);
    } finally {
      setPeCrusherLogsLoading(false);
    }
  };

  /** PE Extrusion & Packaging: load recent entries (same API as PC extrusion; sub_line = Pellet PE SUPER, etc.). */
  const loadPeExtrusionLogs = async () => {
    try {
      setPeExtrusionLogsLoading(true);
      const subLine = peExtrusionLineFilter !== 'all' ? peExtrusionLineFilter : undefined;
      const statusFilter = peExtrusionStatusFilter !== 'all' ? peExtrusionStatusFilter : undefined;
      const response = await productionApi.getExtrusionLogs(
        subLine,
        peExtrusionSelectedDate,
        peExtrusionSearchQuery || undefined,
        statusFilter,
        peExtrusionCurrentPage,
        10,
        peExtrusionSelectedDate === formatDateLocal(new Date()) ? backendShiftId : undefined
      );
      if (response.data.success) {
        setPeExtrusionLogs(response.data.data);
        setPeExtrusionTotalPages(response.data.pagination.totalPages);
        setPeExtrusionTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error loading PE extrusion logs:', error);
    } finally {
      setPeExtrusionLogsLoading(false);
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
        washingSelectedDate === formatDateLocal(new Date()) ? backendShiftId : undefined
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
        extrusionSelectedDate === formatDateLocal(new Date()) ? backendShiftId : undefined
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

  const loadPackingLogs = async () => {
    try {
      setPackingLogsLoading(true);
      const statusFilter = packingSelectedStatusFilter !== 'all' ? packingSelectedStatusFilter : undefined;
      const response = await productionApi.getFinalPackingLogs(
        packingSelectedDate,
        packingSearchQuery || undefined,
        statusFilter,
        packingCurrentPage,
        10,
        packingSelectedDate === formatDateLocal(new Date()) ? backendShiftId : undefined,
      );
      if (response.data.success) {
        setPackingLogs(response.data.data);
        setPackingTotalPages(response.data.pagination.totalPages);
        setPackingTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error loading packing logs:', error);
    } finally {
      setPackingLogsLoading(false);
    }
  };

  useEffect(() => {
    // Clear selected input bag when station or section changes
    setSelectedInputBag(null);
    setBagSearchQuery('');
    setSuggestedBags([]);
    setShowSuggestions(false);
  }, [selectedStation, selectedSection, selectedSubLine]);

  // Calculate crusher totals from shiftLogs for the current sub-line
  useEffect(() => {
    const isCrusherStation = selectedStation?.name?.toLowerCase().includes('crusher') ||
                             selectedStation?.code === 'CRS';
    if (!isCrusherStation || !backendShiftId || !selectedSubLine) {
      if (selectedStation?.name?.toLowerCase().includes('crusher')) {
        setCurrentViewBags(0);
        setCurrentViewWeight(0);
      }
      return;
    }
    const logs = shiftLogs.filter((log: any) =>
      log.station_id === selectedStation?.id &&
      log.shift_id === backendShiftId &&
      log.sub_line === selectedSubLine
    );
    setCurrentViewBags(logs.length);
    setCurrentViewWeight(logs.reduce((acc: number, log: any) => acc + (Number(log.weight) || 0), 0));
  }, [shiftLogs, selectedStation, selectedSubLine, backendShiftId]);

  // Calculate washing totals from shiftLogs for the current sub-line
  useEffect(() => {
    const isWashingStation = selectedStation?.name?.toLowerCase().includes('washing') ||
                             selectedStation?.code === 'WSH';
    if (!isWashingStation || !backendShiftId || !selectedSubLine) {
      if (isWashingStation) {
        setCurrentViewBags(0);
        setCurrentViewWeight(0);
      }
      return;
    }
    const logs = shiftLogs.filter((log: any) =>
      log.station_id === selectedStation?.id &&
      log.shift_id === backendShiftId &&
      log.sub_line === selectedSubLine
    );
    setCurrentViewBags(logs.length);
    setCurrentViewWeight(logs.reduce((acc: number, log: any) => acc + (Number(log.weight) || 0), 0));
  }, [shiftLogs, selectedStation, selectedSubLine, backendShiftId]);

  // Calculate final packing totals from shiftLogs
  useEffect(() => {
    const isPackingStation = selectedStation?.id === 5 ||
                             selectedStation?.name?.toLowerCase().includes('final') ||
                             selectedStation?.name?.toLowerCase().includes('re-packaging');
    if (!isPackingStation || !backendShiftId) {
      if (isPackingStation) {
        setCurrentViewBags(0);
        setCurrentViewWeight(0);
      }
      return;
    }
    const logs = shiftLogs.filter((log: any) =>
      log.station_id === selectedStation?.id &&
      log.shift_id === backendShiftId
    );
    setCurrentViewBags(logs.length);
    setCurrentViewWeight(logs.reduce((acc: number, log: any) => acc + (Number(log.weight) || 0), 0));
  }, [shiftLogs, selectedStation, backendShiftId]);

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
      if (isPE) loadPeCrusherLogs();
      else loadCrusherLogs();
    }
    // Load logs when in Washing station view (whether sub-line is selected or not)
    if (selectedStation?.name === 'Washing') {
      loadWashingLogs();
    }
    // Load logs when in Extrusion station view (whether sub-line is selected or not)
    if (selectedStation?.name === 'Extrusion & Packaging') {
      if (isPE) loadPeExtrusionLogs();
      else loadExtrusionLogs();
    }
    // Load logs when in Final Packaging station view
    if (selectedStation?.id === 5 || selectedStation?.name?.toLowerCase().includes('final') || selectedStation?.name?.toLowerCase().includes('re-packaging')) {
      loadPackingLogs();
    }
  }, [selectedSubLine, selectedDate, searchQuery, currentPage, selectedStation, selectedLineFilter, selectedStatusFilter, washingSelectedDate, washingSearchQuery, washingCurrentPage, washingSelectedLineFilter, washingSelectedStatusFilter, extrusionSelectedDate, extrusionSearchQuery, extrusionCurrentPage, extrusionSelectedLineFilter, extrusionSelectedStatusFilter, packingSelectedDate, packingSearchQuery, packingCurrentPage, packingSelectedStatusFilter, isPE, peCrusherSelectedDate, peCrusherSearchQuery, peCrusherCurrentPage, peCrusherLineFilter, peCrusherStatusFilter, peExtrusionSelectedDate, peExtrusionSearchQuery, peExtrusionCurrentPage, peExtrusionLineFilter, peExtrusionStatusFilter]);

  useEffect(() => {
    if (showShiftClosedView && closedShiftId) {
      fetchClosedShiftByProducts();
    }
  }, [showShiftClosedView, closedShiftId, fetchClosedShiftByProducts]);

  const handleStationSelect = (station: Station) => {
    setCurrentViewBags(0);
    setCurrentViewWeight(0);
    if (station.name === 'Label Removal' || station.name === 'Crusher' || station.name === 'Washing' || station.name === 'Extrusion & Packaging') {
      setSelectedStation(station); setSelectedSection(null);
    } else if (isShiftEnded) {
      // Shift ended — go straight to view-only, skip the INPUT/OUTPUT modal
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
        // Washing input: only crusher bags (3E, Rapid, Betty) with pending status
        targetStationId = 2;
        statusFilter = 'pending';
        expectedStationName = 'crusher';
      } else if (selectedSection === 'input' && (selectedStation?.id === 4 || selectedStation?.name?.toLowerCase().includes('extrusion'))) {
        if (isPE) {
          // PE Extrusion: input comes from Crusher-Washing (CRS) bags
          const crsStation = stations.find(s => (s as any).code === 'CRS' || s.name?.toLowerCase().includes('crusher'));
          targetStationId = crsStation?.id ?? 2;
          expectedStationName = 'Crusher-Washing';
        } else {
          // PC Extrusion: input comes from Washing (WSH) bags
        targetStationId = 3;
        expectedStationName = 'washing';
        }
        statusFilter = 'pending';
      } else if (selectedSection === 'input' && (selectedStation?.id === 5 || selectedStation?.name?.toLowerCase().includes('final') || selectedStation?.name?.toLowerCase().includes('re-packaging'))) {
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
        // For washing: restrict source bags to crusher sub-lines only (3E, Rapid, Betty)
        const isWashingInput = selectedSection === 'input' &&
          (selectedStation?.id === 3 || selectedStation?.name?.toLowerCase().includes('washing'));
        const sourceSubLines = isWashingInput ? ['3E', 'Rapid', 'Betty'] : undefined;

        const response = await productionApi.searchLogs(
          qrCode,
          targetStationId,
          selectedStation?.id,
          statusFilter,
          sourceSubLines,
        );
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
    if (isShiftEnded) { Alert.alert('Shift Ended', 'Cannot add output after shift has ended.'); return; }
    try {
      setIsLoading(true);
      setIsCurrentLogSaved(false);

      // For PE: translate the output type / sub-line to a short QR code
      let qrSubLine: string | undefined = selectedSubLine || undefined;
      if (isPE) {
        const isExtStn = selectedStation.name?.toLowerCase().includes('extrusion');
        if (isExtStn) {
          // Extrusion: sub-line is 'Pellet PE SUPER' | 'Pellet EVA SUPER'
          qrSubLine = getPeOutputCode(selectedSubLine || '');
        } else {
          // Crusher-Washing: use peOutputType (e.g. 'Flakes PE SUPER')
          qrSubLine = getPeOutputCode(peOutputType || '');
        }
      }

      const response = await productionApi.getNextQr(selectedStation.id, backendShiftId, qrSubLine, selectedShift?.id);
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
          date: new Date().toLocaleDateString(),
          bagStatus: 'pending' as const
        });
        setPreviewBagStatus('pending');
        previewBagStatusRef.current = 'pending';
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

  const handleSaveProduction = async (statusAtTap?: 'pending' | 'Completed') => {
    if (!previewData || !backendShiftId || !selectedStation) return;
    if (isShiftEnded) { Alert.alert('Shift Ended', 'Cannot add output after shift has ended.'); return; }
    try {
      setIsLoading(true);
      // Status must be exactly what the user chose (Final = Completed, Temporary = pending). Prefer value passed at SAVE tap.
      const chosenStatus: 'pending' | 'Completed' = statusAtTap ?? previewBagStatusRef.current ?? previewBagStatus;
      const photoUrl = capturedImages.length > 0 ? capturedImages.join(',') : null;
      const savedWeight = parseFloat(previewData.weight ?? weightInput);
      const saveSubLine = isPE
        ? (selectedStation.name?.toLowerCase().includes('extrusion')
            ? selectedSubLine
            : peOutputType)
        : selectedSubLine;
      const payload = {
        shiftId: backendShiftId,
        stationId: selectedStation.id,
        inputBagQr: selectedInputBag?.output_bag_qr || null,
        outputBagQr: previewData.qrCode,
        weight: isNaN(savedWeight) ? 0 : savedWeight,
        status: chosenStatus === 'Completed' ? 'Completed' : 'pending',
        subLine: saveSubLine || undefined,
        photoUrl: photoUrl,
        remark: remarkInput.trim() || undefined,
        shiftTypeId: selectedShift?.id
      };
      const response = await productionApi.logProduction(payload);
      if (response.data.success) {
        const savedLog = response.data.data;
        const updatedLogs = [...shiftLogs, savedLog];
        setShiftLogs(updatedLogs);

        // When Betty saves its output, mark the consumed 3E/Rapid input bag as Completed
        if (
          selectedStation?.name?.toLowerCase().includes('crusher') &&
          selectedSubLine === 'Betty' &&
          selectedInputBag?.output_bag_qr
        ) {
          try {
            await productionApi.updateLogStatus(
              selectedInputBag.output_bag_qr,
              'Completed',
              undefined,
              undefined,
              'Betty',
            );
          } catch (err) {
            console.error('Error marking input bag as Completed:', err);
          }
        }
        
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
        
        // Crusher, Washing, Final Packing and Extrusion use useEffect to auto-recalculate from shiftLogs
        if (selectedStation?.name !== 'Extrusion & Packaging' &&
            !selectedStation?.name?.toLowerCase().includes('crusher') &&
            !selectedStation?.name?.toLowerCase().includes('washing') &&
            !selectedStation?.name?.toLowerCase().includes('final') &&
            !selectedStation?.name?.toLowerCase().includes('re-packaging')) {
          setCurrentViewBags(0);
          setCurrentViewWeight(0);
        }
        // For extrusion/crusher/washing, the useEffect will automatically recalculate totals

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
    previewBagStatusRef.current = 'pending';
    setSelectedInputBag(null);
    setCapturedImages([]);
    // Keep user on station
  };

  const handleBack = () => {
    if (showShiftClosedView) {
      handleBackToShifts();
      return;
    }

    // ── PE-specific back navigation ─────────────────────────────────────────
    if (isPE) {
      if (selectedStation?.name === 'Extrusion & Packaging') {
      if (selectedSection) {
        setSelectedSection(null);
        } else if (selectedSubLine) {
        setSelectedSubLine(null);
      } else {
          setSelectedStation(null);
        }
        return;
      }
      if (selectedStation?.name === 'Crusher') {
        // Multiple output options (PE SUPER / EVA SUPER) → back clears output type first
        if (peOutputType && getPeOutputOptions(selectedSubLine || '').length > 1) {
          setPeOutputType(null);
        } else if (selectedSubLine) {
        setSelectedSubLine(null);
          setPeOutputType(null);
        } else {
          setSelectedStation(null);
        }
        return;
      }
    }

    // ── PC/PET back navigation (unchanged) ───────────────────────────────────
    if (selectedStation?.name === 'Extrusion & Packaging' && selectedSubLine) {
      if (selectedSection) {
        setSelectedSection(null);
      } else {
        setSelectedSubLine(null);
      }
    } else if ((selectedStation?.name === 'Crusher' || selectedStation?.name === 'Washing') && selectedSubLine) {
      if (selectedSection) {
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
      setPeOutputType(null);
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
          const list = normalizeSuggestedBags(response.data.data || []);
          setSuggestedBags(list);
          setShowSuggestions(list.length > 0);
        } else {
          setSuggestedBags([]);
          setShowSuggestions(false);
        }
        return;
      }

      if (selectedStation?.id === 3 || selectedStation?.name?.toLowerCase().includes('washing')) {
        // For washing, only search if user has typed something
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        targetStationId = 2; // Washing searches from Crusher
        statusFilter = 'pending'; // Only show pending crusher batches
        const response = await productionApi.searchLogs(
          text,
          targetStationId,
          selectedStation.id,
          statusFilter,
          ['3E', 'Rapid', 'Betty'], // Only crusher sub-lines are valid washing inputs
        );
        if (response.data.success) { 
          const list = normalizeSuggestedBags(response.data.data || []);
          setSuggestedBags(list);
          setShowSuggestions(list.length > 0);
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
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        if (isPE) {
          // PE Extrusion: input comes from Crusher-Washing (CRS) pending bags
          const crsStation = stations.find(s => (s as any).code === 'CRS' || s.name?.toLowerCase().includes('crusher'));
          targetStationId = crsStation?.id ?? 2;
        } else {
          // PC Extrusion: input comes from Washing (WSH) pending bags
          targetStationId = 3;
        }
        statusFilter = 'pending';
        const response = await productionApi.searchLogs(text, targetStationId, selectedStation.id, statusFilter);
        if (response.data.success) { 
          const list = normalizeSuggestedBags(response.data.data || []);
          setSuggestedBags(list);
          setShowSuggestions(list.length > 0);
        } else {
          setSuggestedBags([]);
          setShowSuggestions(false);
        }
        return;
      }
      // Final Packaging: Extrusion batches for PC/PET flow, Washing batches for PE flow (no Extrusion station)
      const isFinalPackaging = selectedStation?.id === 5 ||
        selectedStation?.name?.toLowerCase().includes('final') ||
        selectedStation?.name?.toLowerCase().includes('re-packaging');
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
          const list = normalizeSuggestedBags(response.data.data || []);
          setSuggestedBags(list);
          setShowSuggestions(list.length > 0);
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
        const list = normalizeSuggestedBags(response.data.data || []);
        setSuggestedBags(list);
        setShowSuggestions(list.length > 0);
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
      case 'Re-Packaging': return <Box {...props} />;
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
              isPPIC ? null : (
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
              )
          ) : (
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <ArrowLeft color="#333" size={24} />
              <View style={{ marginLeft: 10 }}>
                <Text style={styles.stationTitle}>
                  {showShiftClosedView ? (viewingActiveShift ? 'Active Shift' : 'Shift closed') : showEndShiftSummary ? 'End Shift' : (selectedStation?.name === 'Washing' ? selectedStation?.name : (selectedSubLine ? `${selectedStation?.name} (${selectedSubLine})` : selectedStation?.name))}
                </Text>
                {!showEndShiftSummary && !showShiftClosedView && !isPPIC && <View style={styles.contextPills}><Text style={styles.smallPill}>{selectedShift?.name}</Text></View>}
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
                  if (code === 'LBL' || name.includes('label')) return 'label';
                  if (code === 'CRS' || name.includes('crusher')) return 'crusher';
                  if (code === 'WSH' || name.includes('washing')) return 'washing';
                  if (code === 'EXT' || code === 'EXTR' || name.includes('extrusion')) return 'extrusion';
                  if (code === 'PKG' || name.includes('re-packaging') || name.includes('final') || name.includes('packing')) return 'packing';
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
                  { key: 'label',     label: 'Label Removal',        color: '#FDF4FF', accent: '#9333EA', page: shiftLogsPageLabel,     setPage: setShiftLogsPageLabel },
                  { key: 'crusher',   label: 'Crusher',              color: '#FFF7ED', accent: '#EA580C', page: shiftLogsPageCrusher,   setPage: setShiftLogsPageCrusher },
                  { key: 'washing',   label: 'Washing',              color: '#EFF6FF', accent: '#2563EB', page: shiftLogsPageWashing,   setPage: setShiftLogsPageWashing },
                  { key: 'extrusion', label: 'Extrusion & Packaging',color: '#F0FDF4', accent: '#16A34A', page: shiftLogsPageExtrusion, setPage: setShiftLogsPageExtrusion },
                  { key: 'packing',   label: 'Re-Packaging',         color: '#F0FDFA', accent: '#0D9488', page: shiftLogsPagePacking,   setPage: setShiftLogsPagePacking },
                  { key: 'other',     label: 'Other',                color: '#F8FAFC', accent: '#64748B', page: 1,                      setPage: () => {} },
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
                        onChangeText={(t) => { setShiftLogsSearch(t); setShiftLogsPageCrusher(1); setShiftLogsPageWashing(1); setShiftLogsPageExtrusion(1); setShiftLogsPageLabel(1); setShiftLogsPagePacking(1); }}
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
        ) : !isShiftActive && !isShiftEnded ? (
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
                  <View>
                  {ppicActiveShifts.map((s: any) => (
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
                  ))}
                  </View>
                )}

                {/* ── Closed Reports ── */}
                <View style={[styles.ppicSectionHeader, { marginTop: 20 }]}>
                  <FileText color="#0ea5e9" size={14} />
                  <Text style={[styles.ppicSectionTitle, { marginLeft: 6, color: '#0ea5e9' }]}>Closed Reports</Text>
                  <TouchableOpacity onPress={() => handleOpenClosedReports(ppicSelectedDate, ppicSelectedShiftId)} style={{ marginLeft: 'auto' }}>
                    <Text style={{ fontSize: 12, color: '#0ea5e9', fontWeight: '600' }}>Refresh</Text>
                  </TouchableOpacity>
                </View>

                {/* Date filter */}
                <View style={styles.ppicHomeCard}>
                  <Text style={styles.ppicHomeLabel}>{t('dashboard.ppicSelectDate')}</Text>
                  <StationDatePicker
                    value={parseDateLocal(ppicSelectedDate)}
                    onChange={(date) => {
                      const d = formatDateLocal(date);
                      setPpicSelectedDate(d);
                      handleOpenClosedReports(d, ppicSelectedShiftId);
                    }}
                    maximumDate={maxDate}
                  />
                </View>

                {/* Shift filter */}
                <View style={styles.ppicHomeCard}>
                  <Text style={styles.ppicHomeLabel}>{t('dashboard.ppicSelectShift')}</Text>
                  <View style={styles.ppicShiftRow}>
                    <TouchableOpacity
                      style={[styles.ppicShiftBtn, ppicSelectedShiftId === null && styles.ppicShiftBtnActive]}
                      onPress={() => { setPpicSelectedShiftId(null); handleOpenClosedReports(ppicSelectedDate, null); }}
                    >
                      <Text style={[styles.ppicShiftBtnText, ppicSelectedShiftId === null && styles.ppicShiftBtnTextActive]}>{t('dashboard.all')}</Text>
                    </TouchableOpacity>
                    {ppicShifts.map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.ppicShiftBtn, ppicSelectedShiftId === s.id && styles.ppicShiftBtnActive]}
                        onPress={() => { setPpicSelectedShiftId(s.id); handleOpenClosedReports(ppicSelectedDate, s.id); }}
                      >
                        <Text style={[styles.ppicShiftBtnText, ppicSelectedShiftId === s.id && styles.ppicShiftBtnTextActive]}>{s.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Inline list of closed shifts */}
                {closedShiftsLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                    <ActivityIndicator size="small" color="#0ea5e9" />
                    <Text style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Loading reports…</Text>
                  </View>
                ) : closedShiftsList.length === 0 ? (
                  <View style={[styles.ppicEmptyActive, { marginTop: 4 }]}>
                    <Text style={styles.ppicEmptyActiveText}>No closed shifts found for this date / shift.</Text>
                  </View>
                ) : (
                  <View>
                  {closedShiftsList.map((item: any) => (
                    <TouchableOpacity
                      key={item.shiftId}
                      style={[styles.ppicActiveShiftCard, { marginBottom: 8, borderLeftColor: '#0ea5e9' }]}
                      onPress={() => handleSelectClosedShift(item.shiftId)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#1e293b' }}>{item.shiftName} — {item.date}</Text>
                        <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{item.operatorName}</Text>
                        {item.materialTypeName ? <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{item.materialTypeName}</Text> : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#0ea5e9' }}>{item.totalOutputs} bags</Text>
                        <Text style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{item.totalWeight} kg</Text>
                      </View>
                      <ChevronRight color="#CBD5E1" size={18} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
                  ))}
                  </View>
                )}

                {/* ── Station Overview ── */}
                <View style={[styles.ppicSectionHeader, { marginTop: 24 }]}>
                  <Package color="#475569" size={14} />
                  <Text style={[styles.ppicSectionTitle, { marginLeft: 6, color: '#475569' }]}>Station Overview</Text>
                  <TouchableOpacity onPress={() => loadPpicOverview()} style={{ marginLeft: 'auto' }}>
                    <Text style={{ fontSize: 12, color: '#0ea5e9', fontWeight: '600' }}>Refresh</Text>
                  </TouchableOpacity>
                </View>

                {/* Date Picker */}
                <View style={styles.ppicHomeCard}>
                  <Text style={styles.ppicHomeLabel}>Select Date</Text>
                  <StationDatePicker
                    value={parseDateLocal(ppicOverviewDate)}
                    onChange={(date) => {
                      const d = formatDateLocal(date);
                      setPpicOverviewDate(d);
                      setPpicExpandedStation(null);
                      loadPpicOverview(d, ppicOverviewShiftId);
                    }}
                    maximumDate={maxDate}
                  />
                </View>

                {/* Shift Filter */}
                <View style={styles.ppicHomeCard}>
                  <Text style={styles.ppicHomeLabel}>Filter by Shift</Text>
                  <View style={styles.ppicShiftRow}>
                    <TouchableOpacity
                      style={[styles.ppicShiftBtn, ppicOverviewShiftId === null && styles.ppicShiftBtnActive]}
                      onPress={() => { setPpicOverviewShiftId(null); loadPpicOverview(ppicOverviewDate, null); }}
                    >
                      <Text style={[styles.ppicShiftBtnText, ppicOverviewShiftId === null && styles.ppicShiftBtnTextActive]}>All</Text>
                    </TouchableOpacity>
                    {ppicShifts.map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.ppicShiftBtn, ppicOverviewShiftId === s.id && styles.ppicShiftBtnActive]}
                        onPress={() => { setPpicOverviewShiftId(s.id); loadPpicOverview(ppicOverviewDate, s.id); }}
                      >
                        <Text style={[styles.ppicShiftBtnText, ppicOverviewShiftId === s.id && styles.ppicShiftBtnTextActive]}>{s.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Search */}
                <View style={[styles.shiftLogsSearchBar, { marginHorizontal: 0, marginBottom: 8 }]}>
                  <Search size={16} color="#94a3b8" />
                  <TextInput
                    style={styles.shiftLogsSearchInput}
                    placeholder="Search QR, station, sub-line…"
                    placeholderTextColor="#94a3b8"
                    value={ppicOverviewSearch}
                    onChangeText={setPpicOverviewSearch}
                    returnKeyType="search"
                  />
                  {ppicOverviewSearch !== '' && (
                    <TouchableOpacity onPress={() => setPpicOverviewSearch('')}>
                      <X size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>

                {ppicOverviewLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <ActivityIndicator size="large" color="#17a34a" />
                    <Text style={{ fontSize: 12, color: '#666', marginTop: 8 }}>Loading station data…</Text>
                  </View>
                ) : ppicOverviewData.length === 0 ? (
                  <View style={[styles.ppicEmptyActive, { marginTop: 4 }]}>
                    <Text style={styles.ppicEmptyActiveText}>No data found for this date / shift.</Text>
                  </View>
                ) : (
                  <View>
                  {ppicOverviewData.map((station: any) => {
                    const isExpanded = ppicExpandedStation === String(station.station_id);
                    const q = ppicOverviewSearch.trim().toLowerCase();
                    const filteredLogs = q
                      ? station.logs.filter((l: any) =>
                          (l.output_bag_qr || '').toLowerCase().includes(q) ||
                          (l.sub_line || '').toLowerCase().includes(q) ||
                          (l.operator_name || '').toLowerCase().includes(q) ||
                          (l.shift_name || '').toLowerCase().includes(q)
                        )
                      : station.logs;
                    const stationColors: Record<string, { bg: string; accent: string }> = {
                      label: { bg: '#FDF4FF', accent: '#9333EA' },
                      crusher: { bg: '#FFF7ED', accent: '#EA580C' },
                      washing: { bg: '#EFF6FF', accent: '#2563EB' },
                      extrusion: { bg: '#F0FDF4', accent: '#16A34A' },
                      packing: { bg: '#F0FDFA', accent: '#0D9488' },
                    };
                    const sname = (station.station_name || '').toLowerCase();
                    const colorKey = sname.includes('label') ? 'label'
                      : sname.includes('crush') ? 'crusher'
                      : sname.includes('wash') ? 'washing'
                      : sname.includes('extru') ? 'extrusion'
                      : sname.includes('re-pack') || sname.includes('final') ? 'packing'
                      : 'washing';
                    const { bg, accent } = stationColors[colorKey] || { bg: '#F8FAFC', accent: '#64748B' };
                    return (
                      <View key={station.station_id} style={[styles.shiftLogCategory, { backgroundColor: bg, borderColor: accent + '55', marginBottom: 10 }]}>
                        <TouchableOpacity
                          style={styles.shiftLogCategoryHeader}
                          onPress={() => setPpicExpandedStation(isExpanded ? null : String(station.station_id))}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.shiftLogCatDot, { backgroundColor: accent }]} />
                          <Text style={[styles.shiftLogCatLabel, { color: accent, flex: 1 }]}>{station.station_name}</Text>
                          <View style={styles.shiftLogCatBadge}>
                            <Text style={[styles.shiftLogCatBadgeText, { color: accent }]}>{station.total_bags} bags</Text>
                          </View>
                          <Text style={[styles.shiftLogCatWeight, { color: accent }]}>{station.total_weight} kg</Text>
                          <ChevronRight size={16} color={accent} style={{ marginLeft: 4, transform: [{ rotate: isExpanded ? '90deg' : '0deg' }] }} />
                        </TouchableOpacity>

                        {isExpanded && (
                          <View style={{ marginTop: 8 }}>
                            {filteredLogs.length === 0 ? (
                              <Text style={{ fontSize: 12, color: '#94a3b8', paddingVertical: 8, textAlign: 'center' }}>No matching entries</Text>
                            ) : (
                              filteredLogs.map((log: any, idx: number) => {
                                const statusColor = log.status === 'pending' ? '#f59e0b' : log.status === 'Cancelled' ? '#ef4444' : '#22c55e';
                                return (
                                  <View key={log.id} style={[styles.shiftLogRow, idx === 0 && { borderTopWidth: 1, borderTopColor: accent + '30' }]}>
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                      <Text style={styles.shiftLogQr} numberOfLines={1}>{log.output_bag_qr || '—'}</Text>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                                        {log.sub_line ? <Text style={[styles.shiftLogMeta, { color: accent }]}>{log.sub_line}</Text> : null}
                                        <View style={[styles.shiftLogStatusDot, { backgroundColor: statusColor }]} />
                                        <Text style={[styles.shiftLogMeta, { color: statusColor }]}>{log.status}</Text>
                                        {log.shift_name ? <Text style={[styles.shiftLogMeta, { color: '#94a3b8' }]}>· {log.shift_name}</Text> : null}
                                        {log.operator_name ? <Text style={[styles.shiftLogMeta, { color: '#94a3b8' }]}>· {log.operator_name}</Text> : null}
                                      </View>
                                    </View>
                                    <Text style={styles.shiftLogWeight}>{Number(log.weight) || 0} kg</Text>
                                    <TouchableOpacity
                                      onPress={() => { setSelectedLogForPrint(log); setShowListPrintPreview(true); }}
                                      style={styles.shiftLogPrintBtn}
                                    >
                                      <PrinterIcon color="#475569" size={14} />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => openEditLogWeight(log)} style={styles.shiftLogEditBtn}>
                                      <Pencil color="#0ea5e9" size={14} />
                                      <Text style={styles.shiftLogEditText}>Edit</Text>
                                    </TouchableOpacity>
                                  </View>
                                );
                              })
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                  </View>
                )}
              </View>
            ) : (
              <View style={{ width: '100%' }}>
            {/* Shift Ended — shown after shift is closed, hide start button */}
            {shiftEndedAt ? (
              <View style={{ alignItems: 'center', padding: 24 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <Square color="#EF4444" size={28} fill="#EF4444" />
                </View>
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#DC2626', marginBottom: 6 }}>Shift Ended</Text>
                <Text style={{ fontSize: 14, color: '#7f1d1d', textAlign: 'center', marginBottom: 8 }}>
                  Ended at {new Date(shiftEndedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {shiftDuration}
                </Text>
                <Text style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>This shift has been closed. Contact PPIC to start a new shift.</Text>
              </View>
            ) : (
              <>
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
              </>
            )}
              </View>
            )}
          </View>
        ) : !selectedStation ? (
          <View style={styles.dashboardGrid}>
            <View style={styles.statusRow}>
              {shiftEndedAt ? (
                <>
                  <View style={[styles.activeStatus, { backgroundColor: '#FEF2F2' }]}>
                    <View style={[styles.statusDot, { backgroundColor: '#EF4444' }]} />
                    <Text style={[styles.statusText, { color: '#DC2626' }]}>Shift Closed</Text>
                  </View>
                  <Text style={[styles.durationText, { color: '#DC2626' }]}>
                    Ended {new Date(shiftEndedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {shiftDuration}
                  </Text>
                </>
              ) : (
                <>
              <View style={styles.activeStatus}><View style={styles.statusDot} /><Text style={styles.statusText}>{t('dashboard.shiftActive')}</Text></View>
                <Text style={styles.durationText}>{shiftDuration}</Text>
                </>
              )}
              </View>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {(() => {
                    const extrusionStation = stations.find(s =>
                      s.name?.toLowerCase().includes('extrusion')
                    );
                    if (!extrusionStation) return 0;
                    return shiftLogs.filter((l: any) => l.station_id === extrusionStation.id).length;
                  })()}
                </Text>
                <Text style={styles.statLabel}>Outputs</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {(() => {
                    const extrusionStation = stations.find(s =>
                      s.name?.toLowerCase().includes('extrusion')
                    );
                    if (!extrusionStation) return '0.0';
                    return shiftLogs
                      .filter((l: any) => l.station_id === extrusionStation.id)
                      .reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0)
                      .toFixed(1);
                  })()}
                </Text>
                <Text style={styles.statLabel}>Total kg</Text>
              </View>
              </View>
            <Text style={styles.sectionTitle}>{t('dashboard.selectStation')}</Text>
            {stations.map((s) => (
              <TouchableOpacity key={s.id} style={styles.stationCard} onPress={() => handleStationSelect(s)}>
                <View style={[styles.stationIconBox, { backgroundColor: s.color }]}>{renderStationIcon(s.name, s.color)}</View>
                <View style={styles.stationInfo}><Text style={styles.stationName}>{(s as any).displayName || s.name}</Text><Text style={styles.stationDesc} numberOfLines={1}>{s.description}</Text></View>
                <View style={styles.stationMiniStats}>
                  <Text style={styles.miniStat}>{shiftLogs.filter(l => l.station_id === s.id).length} bags</Text>
                  <Text style={{ fontSize: 11, color: '#64748b', textAlign: 'right' }}>
                    {shiftLogs.filter(l => l.station_id === s.id).reduce((sum, l: any) => sum + (parseFloat(l.weight) || 0), 0).toFixed(1)} kg
                  </Text>
                </View>
                <ChevronRight color="#CCC" size={20} />
              </TouchableOpacity>
            ))}
            {isShiftActive && !shiftEndedAt && (
            <TouchableOpacity style={styles.endShiftButton} onPress={handleEndShift}><Square color="#FFF" size={20} /><Text style={styles.endShiftText}>{t('dashboard.closeShift')}</Text></TouchableOpacity>
            )}
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
                {/* ══════════════════════════════════════════════════════════
                    PE CRUSHER-WASHING FLOW
                    Step 1 → select raw material sub-line
                    Step 2 → select output type (if multiple options)
                    Step 3 → enter weight, generate QR, print
                    ══════════════════════════════════════════════════════════ */}
                {isPE ? (
                  <>
                    {/* Hero header */}
                    <View style={[styles.stationHero, { backgroundColor: selectedStation.color, paddingBottom: 20, marginBottom: 0 }]}>
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(selectedStation.name, selectedStation.color)}
                        </View>
                        <View style={{ marginLeft: 15, flex: 1 }}>
                          <Text style={styles.heroTitle}>Crusher-Washing</Text>
                          <Text style={styles.heroDesc}>PE flakes production</Text>
                        </View>
                      </View>
                    </View>

                    {/* Step 1: Select raw material */}
                    {!selectedSubLine && (() => {
                      const PE_RAW_MATERIALS = ['PE SUPER', 'PE 1', 'EVA SUPER', 'EVA 1'] as const;
                      const q = peRawMaterialSearch.trim().toLowerCase();
                      const filtered = PE_RAW_MATERIALS.filter((mat) => {
                        const matchFilter = peRawMaterialFilter === 'all' || (peRawMaterialFilter === 'PE' && (mat === 'PE SUPER' || mat === 'PE 1')) || (peRawMaterialFilter === 'EVA' && (mat === 'EVA SUPER' || mat === 'EVA 1'));
                        if (!matchFilter) return false;
                        if (!q) return true;
                        const opts = getPeOutputOptions(mat).join(' ').toLowerCase();
                        return mat.toLowerCase().includes(q) || opts.includes(q);
                      });
                      return (
                      <View style={styles.selectionContainer}>
                        <Text style={styles.selectionTitle}>Select Raw Material</Text>
                        <View style={[styles.shiftLogsSearchBar, { marginHorizontal: 0, marginBottom: 10 }]}>
                          <Search size={16} color="#94a3b8" />
                          <TextInput
                            style={styles.shiftLogsSearchInput}
                            placeholder="Search raw material..."
                            placeholderTextColor="#94a3b8"
                            value={peRawMaterialSearch}
                            onChangeText={setPeRawMaterialSearch}
                            returnKeyType="search"
                          />
                          {peRawMaterialSearch !== '' && (
                            <TouchableOpacity onPress={() => setPeRawMaterialSearch('')}>
                              <X size={16} color="#94a3b8" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.filterButtons}>
                          <TouchableOpacity
                            style={[styles.filterButton, peRawMaterialFilter === 'all' && styles.filterButtonActive]}
                            onPress={() => setPeRawMaterialFilter('all')}
                          >
                            <Text style={[styles.filterButtonText, peRawMaterialFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, peRawMaterialFilter === 'PE' && styles.filterButtonActive]}
                            onPress={() => setPeRawMaterialFilter('PE')}
                          >
                            <Text style={[styles.filterButtonText, peRawMaterialFilter === 'PE' && styles.filterButtonTextActive]}>PE</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterButton, peRawMaterialFilter === 'EVA' && styles.filterButtonActive]}
                            onPress={() => setPeRawMaterialFilter('EVA')}
                          >
                            <Text style={[styles.filterButtonText, peRawMaterialFilter === 'EVA' && styles.filterButtonTextActive]}>EVA</Text>
                          </TouchableOpacity>
                        </View>
                        {/* List below subline */}
                        <View style={styles.peRawMaterialListContainer}>
                          <Text style={styles.peRawMaterialListLabel}>Raw materials</Text>
                          {filtered.length === 0 ? (
                            <View style={[styles.grayEmptyBox, { marginTop: 8 }]}>
                              <Text style={styles.grayEmptyText}>No raw material matches search or filter</Text>
                            </View>
                          ) : (
                            <ScrollView style={styles.peRawMaterialList} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                              {filtered.map((mat, idx) => {
                                const colors = ['#0d9488', '#0891b2', '#7c3aed', '#db2777'];
                                const colorIdx = PE_RAW_MATERIALS.indexOf(mat);
                                return (
                                  <TouchableOpacity key={mat} style={styles.selectionCard}
                                    onPress={() => {
                                      setSelectedSubLine(mat);
                                      const opts = getPeOutputOptions(mat);
                                      if (opts.length === 1) setPeOutputType(opts[0]);
                                      else setPeOutputType(null);
                                    }}>
                                    <View style={[styles.selectionIconBox, { backgroundColor: colors[colorIdx] }]}>
                                      <Package color="#FFF" size={28} />
                                    </View>
                                    <View style={styles.selectionText}>
                                      <Text style={styles.selectionCardTitle}>{mat}</Text>
                                      <Text style={styles.selectionCardSub}>{getPeOutputOptions(mat).join(' / ')}</Text>
                                    </View>
                                    <ChevronRight color="#CCC" size={24} />
                                  </TouchableOpacity>
                                );
                              })}
                            </ScrollView>
                          )}
                        </View>
                      </View>
                      );
                    })()}

                    {/* Recent Entries list only when no raw material selected (not in subline) */}
                    {selectedStation?.name === 'Crusher' && !selectedSubLine && (
                    <View style={[styles.crusherLogsSection, { marginHorizontal: 16, marginBottom: 24 }]}>
                      <View style={styles.logsHeader}>
                        <Text style={styles.logsTitle}>Recent Entries</Text>
                      </View>
                      <View style={styles.datePickerContainer}>
                        <Text style={styles.datePickerLabel}>Select Date:</Text>
                        <StationDatePicker
                          value={parseDateLocal(peCrusherSelectedDate)}
                          onChange={(date) => { setPeCrusherSelectedDate(formatDateLocal(date)); setPeCrusherCurrentPage(1); }}
                          maximumDate={maxDate}
                        />
                      </View>
                      <View style={styles.searchBox}>
                        <Search size={18} color="#64748b" />
                        <TextInput
                          style={styles.searchInput}
                          placeholder="Search by QR code..."
                          value={peCrusherSearchQuery}
                          onChangeText={(text) => { setPeCrusherSearchQuery(text); setPeCrusherCurrentPage(1); }}
                          placeholderTextColor="#94a3b8"
                          returnKeyType="search"
                          autoCorrect={false}
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        {peCrusherSearchQuery.length > 0 && (
                          <TouchableOpacity onPress={() => { setPeCrusherSearchQuery(''); setPeCrusherCurrentPage(1); }} style={styles.clearButton}>
                            <X size={16} color="#64748b" />
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={styles.filtersContainer}>
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Line:</Text>
                          <View style={styles.filterButtons}>
                            <TouchableOpacity style={[styles.filterButton, peCrusherLineFilter === 'all' && styles.filterButtonActive]} onPress={() => { setPeCrusherLineFilter('all'); setPeCrusherCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peCrusherLineFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peCrusherLineFilter === 'PE SUPER' && styles.filterButtonActive]} onPress={() => { setPeCrusherLineFilter('PE SUPER'); setPeCrusherCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peCrusherLineFilter === 'PE SUPER' && styles.filterButtonTextActive]}>PE SUPER</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peCrusherLineFilter === 'PE 1' && styles.filterButtonActive]} onPress={() => { setPeCrusherLineFilter('PE 1'); setPeCrusherCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peCrusherLineFilter === 'PE 1' && styles.filterButtonTextActive]}>PE 1</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peCrusherLineFilter === 'EVA SUPER' && styles.filterButtonActive]} onPress={() => { setPeCrusherLineFilter('EVA SUPER'); setPeCrusherCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peCrusherLineFilter === 'EVA SUPER' && styles.filterButtonTextActive]}>EVA SUPER</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peCrusherLineFilter === 'EVA 1' && styles.filterButtonActive]} onPress={() => { setPeCrusherLineFilter('EVA 1'); setPeCrusherCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peCrusherLineFilter === 'EVA 1' && styles.filterButtonTextActive]}>EVA 1</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Status:</Text>
                          <View style={styles.filterButtons}>
                            <TouchableOpacity style={[styles.filterButton, peCrusherStatusFilter === 'all' && styles.filterButtonActive]} onPress={() => { setPeCrusherStatusFilter('all'); setPeCrusherCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peCrusherStatusFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peCrusherStatusFilter === 'pending' && styles.filterButtonActive]} onPress={() => { setPeCrusherStatusFilter('pending'); setPeCrusherCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peCrusherStatusFilter === 'pending' && styles.filterButtonTextActive]}>Pending</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peCrusherStatusFilter === 'Completed' && styles.filterButtonActive]} onPress={() => { setPeCrusherStatusFilter('Completed'); setPeCrusherCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peCrusherStatusFilter === 'Completed' && styles.filterButtonTextActive]}>Complete</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                      {peCrusherLogsLoading ? (
                        <View style={styles.loadingState}>
                          <ActivityIndicator size="large" color="#17a34a" />
                          <Text style={styles.loadingText}>Loading entries...</Text>
                        </View>
                      ) : peCrusherLogs.length > 0 ? (
                        <View style={styles.logsList}>
                          {peCrusherLogs.map((log: any, index: number) => (
                            <View key={log.id || index} style={styles.logItem}>
                              <View style={styles.logMain}>
                                <Text style={styles.logQr}>{log.output_bag_qr || log.outputBagQr || '—'}</Text>
                                <View style={styles.logDetails}>
                                  <Text style={styles.logWeight}>{log.weight} kg</Text>
                                  <Text style={styles.logTime}>{new Date(log.created_at).toLocaleString()}</Text>
                                </View>
                                <View style={styles.logStatusRow}>
                                  <View style={[styles.statusBadge, { backgroundColor: log.status === 'pending' ? '#FEF3C7' : '#DCFCE7' }]}>
                                    <Text style={[styles.statusBadgeText, { color: log.status === 'pending' ? '#D97706' : '#15803D' }]}>{log.status || 'Completed'}</Text>
                                  </View>
                                </View>
                              </View>
                              <View style={styles.logActions}>
                                {(user?.role?.toLowerCase() === 'ppic' || log.status === 'pending') && (
                                  <TouchableOpacity style={styles.editIconButton} onPress={() => openEditLogWeight(log)}>
                                    <Pencil color="#0ea5e9" size={18} />
                                  </TouchableOpacity>
                                )}
                                <TouchableOpacity style={styles.printIconButton} onPress={() => { setSelectedLogForPrint(log); setShowListPrintPreview(true); }}>
                                  <PrinterIcon color="#17a34a" size={20} />
                                </TouchableOpacity>
                                <View style={[styles.logBadge, { backgroundColor: '#CCFBF1' }]}>
                                  <Text style={[styles.logBadgeText, { color: '#0d9488' }]}>{log.sub_line || '—'}</Text>
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
                      {peCrusherTotalPages > 1 && (
                        <View style={styles.pagination}>
                          <TouchableOpacity style={[styles.pageBtn, peCrusherCurrentPage === 1 && styles.pageBtnDisabled]} onPress={() => setPeCrusherCurrentPage(Math.max(1, peCrusherCurrentPage - 1))} disabled={peCrusherCurrentPage === 1}>
                            <ChevronLeft color={peCrusherCurrentPage === 1 ? '#cbd5e1' : '#475569'} size={18} />
                          </TouchableOpacity>
                          <View style={styles.pageInfoBox}>
                            <Text style={styles.pageInfoMain}>{peCrusherCurrentPage} / {peCrusherTotalPages}</Text>
                            <Text style={styles.pageInfoSub}>{peCrusherTotalLogs} total</Text>
                          </View>
                          <TouchableOpacity style={[styles.pageBtn, peCrusherCurrentPage === peCrusherTotalPages && styles.pageBtnDisabled]} onPress={() => setPeCrusherCurrentPage(Math.min(peCrusherTotalPages, peCrusherCurrentPage + 1))} disabled={peCrusherCurrentPage === peCrusherTotalPages}>
                            <ChevronRight color={peCrusherCurrentPage === peCrusherTotalPages ? '#cbd5e1' : '#475569'} size={18} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    )}

                    {/* Step 2: Select output type (only when multiple options exist) */}
                    {selectedSubLine && !peOutputType && getPeOutputOptions(selectedSubLine).length > 1 && (
                      <View style={styles.selectionContainer}>
                        <Text style={styles.selectionTitle}>Select Output Type</Text>
                        <View style={[styles.sublineBadgeWrapper, { marginBottom: 8 }]}>
                          <View style={[styles.sublineBadge, { backgroundColor: '#CCFBF1', borderColor: '#99F6E4' }]}>
                            <Text style={[styles.sublineBadgeText, { color: '#0d9488' }]}>Raw Material: {selectedSubLine}</Text>
                          </View>
                        </View>
                        {getPeOutputOptions(selectedSubLine).map((opt, idx) => (
                          <TouchableOpacity key={opt} style={styles.selectionCard}
                            onPress={() => setPeOutputType(opt)}>
                            <View style={[styles.selectionIconBox, { backgroundColor: idx === 0 ? '#0d9488' : '#64748b' }]}>
                              <Package color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>{opt}</Text>
                              <Text style={styles.selectionCardSub}>{idx === 0 ? 'Primary output' : 'Alternative output'}</Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {/* Step 3: Weight entry + QR generation */}
                    {selectedSubLine && peOutputType && (
                      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                        <View style={[styles.sublineBadgeWrapper, { paddingHorizontal: 0, marginBottom: 12 }]}>
                          <View style={[styles.sublineBadge, { backgroundColor: '#CCFBF1', borderColor: '#99F6E4' }]}>
                            <Text style={[styles.sublineBadgeText, { color: '#0d9488' }]}>
                              {selectedSubLine} → {peOutputType}
                            </Text>
                          </View>
                        </View>

                        {/* Input: continuous, no scanning */}
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View style={[styles.typePill, { backgroundColor: '#E0F2FE' }]}>
                              <Text style={[styles.typePillText, { color: '#0369A1' }]}>INPUT</Text>
                            </View>
                            <Text style={styles.sectionTitleText}>Continuous — no scanning required</Text>
                          </View>
                          <View style={styles.grayEmptyBox}>
                            <Text style={styles.grayEmptyText}>Crusher-Washing is one combined process for PE</Text>
                          </View>
                        </View>

                        {/* Output: weight + QR */}
                        {isShiftEnded ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#FECACA' }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                            <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New output is disabled.</Text>
                          </View>
                        ) : (
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View style={[styles.typePill, { backgroundColor: '#DCFCE7' }]}>
                              <Text style={[styles.typePillText, { color: '#15803D' }]}>OUTPUT</Text>
                            </View>
                            <Text style={styles.sectionTitleText}>{peOutputType}</Text>
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
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}
                              style={styles.photosPreviewContainer} contentContainerStyle={styles.photosPreviewContent}>
                              {capturedImages.map((imageUri, index) => (
                                <View key={index} style={styles.photoPreviewItem}>
                                  <Image source={{ uri: imageUri }} style={styles.photoPreviewThumbnail} />
                                  <TouchableOpacity style={styles.removePhotoButton}
                                    onPress={() => setCapturedImages(prev => prev.filter((_, i) => i !== index))}>
                                    <X size={16} color="#FFF" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </ScrollView>
                          )}
                          <TouchableOpacity
                            style={[styles.primaryButton, (!weightInput || isLoading) && { opacity: 0.5, backgroundColor: '#E2E8F0' }]}
                            onPress={handleLogProduction}
                            disabled={!weightInput || isLoading}>
                            {isLoading ? <ActivityIndicator color="#666" /> : <PrinterIcon size={20} color={!weightInput ? '#94A3B8' : '#FFF'} />}
                            <Text style={[styles.primaryButtonText, !weightInput && { color: '#94A3B8' }]}>Generate QR & Print</Text>
                          </TouchableOpacity>
                        </View>
                        )}

                        {/* Shift progress */}
                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>Shift Progress — {peOutputType}</Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>Outputs this shift</Text>
                            <Text style={styles.progressDataValue}>
                              {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === peOutputType).length} bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>Total weight</Text>
                            <Text style={styles.progressDataValue}>
                              {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === peOutputType)
                                .reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0).toFixed(1)} kg
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </>
                ) : (
                /* ══════════════════════════════════════════════════════════
                    PC CRUSHER FLOW (unchanged)
                    ══════════════════════════════════════════════════════════ */
                !selectedSubLine ? (
                  <View style={styles.selectionContainer}>
                    <Text style={styles.selectionTitle}>Select Crusher Line</Text>
                    <TouchableOpacity style={[styles.selectionCard, isShiftEnded && { opacity: 0.4 }]} disabled={isShiftEnded} onPress={() => setSelectedSubLine('3E')}>
                      <View style={[styles.selectionIconBox, { backgroundColor: '#3b82f6' }]}><Package color="#FFF" size={28} /></View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>3E</Text>
                        <Text style={styles.selectionCardSub}>{t('dashboard.primaryCrusherLine')}</Text>
                    </View>
                      <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>
                          {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === '3E').length} bags
                        </Text>
                        <Text style={{ fontSize: 11, color: '#64748b' }}>
                          {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === '3E').reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0).toFixed(1)} kg
                        </Text>
                    </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.selectionCard, isShiftEnded && { opacity: 0.4 }]} disabled={isShiftEnded} onPress={() => setSelectedSubLine('Rapid')}>
                      <View style={[styles.selectionIconBox, { backgroundColor: '#a855f7' }]}><Zap color="#FFF" size={28} /></View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>Rapid</Text>
                        <Text style={styles.selectionCardSub}>{t('dashboard.fastProcessingLine')}</Text>
                  </View>
                      <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>
                          {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Rapid').length} bags
                        </Text>
                        <Text style={{ fontSize: 11, color: '#64748b' }}>
                          {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Rapid').reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0).toFixed(1)} kg
                        </Text>
                  </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.selectionCard, isShiftEnded && { opacity: 0.4 }]} disabled={isShiftEnded} onPress={() => setSelectedSubLine('Betty')}>
                      <View style={[styles.selectionIconBox, { backgroundColor: '#10b981' }]}><Box color="#FFF" size={28} /></View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>Betty</Text>
                        <Text style={styles.selectionCardSub}>{t('dashboard.bettyMachineLine')}</Text>
                  </View>
                      <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>
                          {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Betty').length} bags
                        </Text>
                        <Text style={{ fontSize: 11, color: '#64748b' }}>
                          {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Betty').reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0).toFixed(1)} kg
                        </Text>
                  </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>

                    {/* Shift Ended banner for Crusher */}
                    {isShiftEnded && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 4, marginBottom: 4, borderWidth: 1, borderColor: '#FECACA' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                        <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New input/output is disabled.</Text>
                      </View>
                    )}

                    {/* Crusher Station Totals */}
                    {(() => {
                      const lines = [
                        { label: '3E',    color: '#3b82f6', icon: '⚙' },
                        { label: 'Rapid', color: '#a855f7', icon: '⚡' },
                        { label: 'Betty', color: '#10b981', icon: '📦' },
                      ];
                      const totalBags = shiftLogs.filter((l: any) => l.station_id === selectedStation.id).length;
                      const totalKg   = shiftLogs.filter((l: any) => l.station_id === selectedStation.id).reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0);
                      return (
                        <View style={{ marginBottom: 12 }}>
                          {/* Station-wide summary bar */}
                          <View style={{ backgroundColor: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#94a3b8' }}>Crusher — This Shift</Text>
                            <View style={{ flexDirection: 'row', gap: 16 }}>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff' }}>{totalBags}</Text>
                                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>bags</Text>
                              </View>
                              <View style={{ width: 1, backgroundColor: '#334155' }} />
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff' }}>{totalKg.toFixed(1)}</Text>
                                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>kg</Text>
                              </View>
                            </View>
                          </View>
                          {/* Per-line breakdown */}
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            {lines.map(({ label, color }) => {
                              const bags = shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === label).length;
                              const kg   = shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === label).reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0);
                              return (
                                <View key={label} style={{ flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderTopWidth: 3, borderTopColor: color, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color, marginBottom: 6 }}>{label}</Text>
                                  <Text style={{ fontSize: 22, fontWeight: '800', color: '#1e293b' }}>{bags}</Text>
                                  <Text style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>bags</Text>
                                  <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 6 }}>
                                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>{kg.toFixed(1)} kg</Text>
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })()}

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
                                {(user?.role?.toLowerCase() === 'ppic' || log.status === 'pending') && (
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
                            <ChevronLeft color={currentPage === 1 ? '#cbd5e1' : '#475569'} size={18} />
                      </TouchableOpacity>
                          <View style={styles.pageInfoBox}>
                            <Text style={styles.pageInfoMain}>{currentPage} / {totalPages}</Text>
                            <Text style={styles.pageInfoSub}>{totalLogs} total</Text>
                          </View>
                      <TouchableOpacity 
                            style={[styles.pageBtn, currentPage === totalPages && styles.pageBtnDisabled]}
                            onPress={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage === totalPages}
                          >
                            <ChevronRight color={currentPage === totalPages ? '#cbd5e1' : '#475569'} size={18} />
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
                    {isShiftEnded ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#FECACA' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                        <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New input/output is disabled.</Text>
                      </View>
                    ) : !selectedSection ? (
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
                            <ScrollView style={styles.suggestionsList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                              {suggestedBags.map((bag, i) => (
                                <TouchableOpacity
                                  key={i}
                                  style={[styles.suggestionItem, i === suggestedBags.length - 1 && { borderBottomWidth: 0 }]}
                                  onPress={() => { setSelectedInputBag(bag); setShowSuggestions(false); setBagSearchQuery(''); }}
                                >
                                  <View style={styles.suggestionLeftCol}>
                                    <Text style={styles.suggestionQrLine} numberOfLines={2} selectable>{getBagDisplayId(bag)}</Text>
                                    {bag.sub_line ? <Text style={styles.suggestionSubLine}>{bag.sub_line}</Text> : null}
                                  </View>
                                  <Text style={styles.suggestionDetail}>{bag.weight} kg</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
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
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{t('dashboard.jumboId')}</Text>
                              <Text style={[styles.selectedBagId, { minWidth: 0 }]} numberOfLines={2} selectable>{getBagDisplayId(selectedInputBag)}</Text>
                              {(selectedInputBag as any).sub_line ? <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{t('dashboard.lineLabel')}: {(selectedInputBag as any).sub_line}</Text> : null}
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
                        {isShiftEnded ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#FECACA' }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                            <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New output is disabled.</Text>
                          </View>
                        ) : (
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
                        )}

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
                {isShiftEnded ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#FECACA' }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                    <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New output is disabled.</Text>
                  </View>
                ) : (
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
                )}

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
                  )
                )
              }
              </View>
            ) : selectedStation.name === 'Washing' ? (
              <View style={styles.crusherContainer}>
                {!selectedSubLine ? (
                  <React.Fragment>
                    <View style={styles.selectionContainer}>
                      <Text style={styles.selectionTitle}>Select Washing Line</Text>
                      <TouchableOpacity style={[styles.selectionCard, isShiftEnded && { opacity: 0.4 }]} disabled={isShiftEnded} onPress={() => { setPendingWashingLine('Washing 1'); setShowWashingModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#06b6d4' }]}><Droplets color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Washing 1</Text>
                          <Text style={styles.selectionCardSub}>Primary Washing Line</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>
                            {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Washing 1').length} bags
                          </Text>
                          <Text style={{ fontSize: 11, color: '#64748b' }}>
                            {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Washing 1').reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0).toFixed(1)} kg
                          </Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.selectionCard, isShiftEnded && { opacity: 0.4 }]} disabled={isShiftEnded} onPress={() => { setPendingWashingLine('Washing 2'); setShowWashingModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#0891b2' }]}><Droplets color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Washing 2</Text>
                          <Text style={styles.selectionCardSub}>Secondary Washing Line</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>
                            {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Washing 2').length} bags
                          </Text>
                          <Text style={{ fontSize: 11, color: '#64748b' }}>
                            {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Washing 2').reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0).toFixed(1)} kg
                          </Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.selectionCard, isShiftEnded && { opacity: 0.4 }]} disabled={isShiftEnded} onPress={() => { setPendingWashingLine('Washing 3'); setShowWashingModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#0e7490' }]}><Droplets color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Washing 3</Text>
                          <Text style={styles.selectionCardSub}>Tertiary Washing Line</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>
                            {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Washing 3').length} bags
                          </Text>
                          <Text style={{ fontSize: 11, color: '#64748b' }}>
                            {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === 'Washing 3').reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0).toFixed(1)} kg
                          </Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                    </View>

                    {/* Logs List Section */}
                    {isShiftEnded && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#FECACA' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                        <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New input/output is disabled.</Text>
                      </View>
                    )}
                    {/* Washing Station Totals */}
                    {(() => {
                      const lines = [
                        { label: 'Washing 1', short: 'Line 1', color: '#06b6d4' },
                        { label: 'Washing 2', short: 'Line 2', color: '#0891b2' },
                        { label: 'Washing 3', short: 'Line 3', color: '#0e7490' },
                      ];
                      const totalBags = shiftLogs.filter((l: any) => l.station_id === selectedStation.id).length;
                      const totalKg   = shiftLogs.filter((l: any) => l.station_id === selectedStation.id).reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0);
                      return (
                        <View style={{ marginBottom: 12 }}>
                          <View style={{ backgroundColor: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#94a3b8' }}>Washing — This Shift</Text>
                            <View style={{ flexDirection: 'row', gap: 16 }}>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff' }}>{totalBags}</Text>
                                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>bags</Text>
                              </View>
                              <View style={{ width: 1, backgroundColor: '#334155' }} />
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff' }}>{totalKg.toFixed(1)}</Text>
                                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>kg</Text>
                              </View>
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            {lines.map(({ label, short, color }) => {
                              const bags = shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === label).length;
                              const kg   = shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === label).reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0);
                              return (
                                <View key={label} style={{ flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderTopWidth: 3, borderTopColor: color, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color, marginBottom: 6 }}>{short}</Text>
                                  <Text style={{ fontSize: 22, fontWeight: '800', color: '#1e293b' }}>{bags}</Text>
                                  <Text style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>bags</Text>
                                  <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 6 }}>
                                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>{kg.toFixed(1)} kg</Text>
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })()}
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
                              {(user?.role?.toLowerCase() === 'ppic' || log.status === 'pending') && (
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
                          <ChevronLeft size={18} color={washingCurrentPage === 1 ? '#cbd5e1' : '#475569'} />
                        </TouchableOpacity>
                        <View style={styles.pageInfoBox}>
                          <Text style={styles.pageInfoMain}>{washingCurrentPage} / {washingTotalPages}</Text>
                          <Text style={styles.pageInfoSub}>{washingTotalLogs} total</Text>
                        </View>
                        <TouchableOpacity 
                          style={[styles.pageBtn, washingCurrentPage === washingTotalPages && styles.pageBtnDisabled]}
                          onPress={() => washingCurrentPage < washingTotalPages && setWashingCurrentPage(washingCurrentPage + 1)}
                          disabled={washingCurrentPage === washingTotalPages}
                        >
                          <ChevronRight size={18} color={washingCurrentPage === washingTotalPages ? '#cbd5e1' : '#475569'} />
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
                          <ScrollView style={styles.suggestionsList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                            {suggestedBags.map((bag, i) => (
                              <TouchableOpacity 
                                key={i} 
                                style={[styles.suggestionItem, i === suggestedBags.length - 1 && { borderBottomWidth: 0 }]}
                                onPress={() => {
                                  setSelectedInputBag(bag);
                                  setShowSuggestions(false);
                                  setBagSearchQuery('');
                                }}
                              >
                                <View style={styles.suggestionLeftCol}>
                                <Text style={styles.suggestionQrLine} numberOfLines={2} selectable>{getBagDisplayId(bag)}</Text>
                                  {bag.sub_line ? <Text style={styles.suggestionSubLine}>{bag.sub_line}</Text> : null}
                                </View>
                                <Text style={styles.suggestionDetail}>{bag.weight} kg</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                      <TouchableOpacity style={styles.scanButton} onPress={() => { setScanned(false); setShowScanner(true); }}>
                        <CameraIcon color="#17a34a" size={20} />
                        <Text style={styles.scanButtonText}>Scan QR Code</Text>
                      </TouchableOpacity>
                      {selectedInputBag && (
                        <View style={styles.selectedBagCard}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{t('dashboard.jumboId')}</Text>
                            <Text style={[styles.selectedBagId, { minWidth: 0 }]} numberOfLines={2} selectable>{getBagDisplayId(selectedInputBag)}</Text>
                            {(selectedInputBag as any).sub_line ? <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{t('dashboard.lineLabel')}: {(selectedInputBag as any).sub_line}</Text> : null}
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
            ) : selectedStation.name === 'Extrusion & Packaging' ? (
              <View style={styles.crusherContainer}>
                {/* ══════════════════════════════════════════════════════════
                    PE EXTRUDER FLOW
                    Step 1 → select product line (Pellet PE SUPER / EVA SUPER)
                    Step 2 → input/output section picker
                    Step 3a input  → scan primary flakes bag from CRS
                    Step 3b output → enter weight, generate QR, print
                    ══════════════════════════════════════════════════════════ */}
                {isPE ? (
                  <>
                    {/* Hero header */}
                    <View style={[styles.stationHero, { backgroundColor: selectedStation.color, paddingBottom: 20, marginBottom: 0 }]}>
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(selectedStation.name, selectedStation.color)}
                        </View>
                        <View style={{ marginLeft: 15, flex: 1 }}>
                          <Text style={styles.heroTitle}>Extruder (PE)</Text>
                          <Text style={styles.heroDesc}>Pellet production</Text>
                        </View>
                      </View>
                    </View>

                    {/* Step 1: Select product line — all 4 outputs, sellable marker shown */}
                    {!selectedSubLine && (
                    <View style={styles.selectionContainer}>
                        <Text style={styles.selectionTitle}>Select Output Product Line</Text>
                        {([
                          { line: 'Pellet PE SUPER',  primary: 'Flakes PE SUPER',  color: '#f97316', sellable: true  },
                          { line: 'Pellet PE 1',      primary: 'Flakes PE 1',      color: '#ea580c', sellable: false },
                          { line: 'Pellet EVA SUPER', primary: 'Flakes EVA SUPER', color: '#9333ea', sellable: true  },
                          { line: 'Pellet EVA 1',     primary: 'Flakes EVA 1',     color: '#7c3aed', sellable: false },
                        ] as const).map(({ line, primary, color, sellable }) => (
                          <TouchableOpacity key={line} style={[styles.selectionCard, isShiftEnded && { opacity: 0.4 }]}
                            disabled={isShiftEnded}
                            onPress={() => { setSelectedSubLine(line as any); setSelectedSection(null); }}>
                            <View style={[styles.selectionIconBox, { backgroundColor: color }]}>
                              <Zap color="#FFF" size={28} />
                            </View>
                        <View style={styles.selectionText}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={styles.selectionCardTitle}>{line}</Text>
                                {sellable && (
                                  <View style={{ backgroundColor: '#dcfce7', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                                    <Text style={{ fontSize: 10, color: '#166534', fontWeight: '700' }}>SELLABLE</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.selectionCardSub}>Primary input: {primary}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                              <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>
                                {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === line).length} bags
                              </Text>
                              <Text style={{ fontSize: 11, color: '#64748b' }}>
                                {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === line).reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0).toFixed(1)} kg
                              </Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {/* Recent Entries list for PE Extrusion (only when no product line selected) */}
                    {!selectedSubLine && (
                    <View style={[styles.crusherLogsSection, { marginHorizontal: 16, marginBottom: 24 }]}>
                      <View style={styles.logsHeader}>
                        <Text style={styles.logsTitle}>Recent Entries</Text>
                      </View>
                      <View style={styles.datePickerContainer}>
                        <Text style={styles.datePickerLabel}>Select Date:</Text>
                        <StationDatePicker
                          value={parseDateLocal(peExtrusionSelectedDate)}
                          onChange={(date) => { setPeExtrusionSelectedDate(formatDateLocal(date)); setPeExtrusionCurrentPage(1); }}
                          maximumDate={maxDate}
                        />
                      </View>
                      <View style={styles.searchBox}>
                        <Search size={18} color="#64748b" />
                        <TextInput
                          style={styles.searchInput}
                          placeholder="Search by QR code..."
                          value={peExtrusionSearchQuery}
                          onChangeText={(text) => { setPeExtrusionSearchQuery(text); setPeExtrusionCurrentPage(1); }}
                          placeholderTextColor="#94a3b8"
                          returnKeyType="search"
                          autoCorrect={false}
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        {peExtrusionSearchQuery.length > 0 && (
                          <TouchableOpacity onPress={() => { setPeExtrusionSearchQuery(''); setPeExtrusionCurrentPage(1); }} style={styles.clearButton}>
                            <X size={16} color="#64748b" />
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={styles.filtersContainer}>
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Line:</Text>
                          <View style={styles.filterButtons}>
                            <TouchableOpacity style={[styles.filterButton, peExtrusionLineFilter === 'all' && styles.filterButtonActive]} onPress={() => { setPeExtrusionLineFilter('all'); setPeExtrusionCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peExtrusionLineFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peExtrusionLineFilter === 'Pellet PE SUPER' && styles.filterButtonActive]} onPress={() => { setPeExtrusionLineFilter('Pellet PE SUPER'); setPeExtrusionCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peExtrusionLineFilter === 'Pellet PE SUPER' && styles.filterButtonTextActive]}>Pellet PE SUPER</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peExtrusionLineFilter === 'Pellet PE 1' && styles.filterButtonActive]} onPress={() => { setPeExtrusionLineFilter('Pellet PE 1'); setPeExtrusionCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peExtrusionLineFilter === 'Pellet PE 1' && styles.filterButtonTextActive]}>Pellet PE 1</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peExtrusionLineFilter === 'Pellet EVA SUPER' && styles.filterButtonActive]} onPress={() => { setPeExtrusionLineFilter('Pellet EVA SUPER'); setPeExtrusionCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peExtrusionLineFilter === 'Pellet EVA SUPER' && styles.filterButtonTextActive]}>Pellet EVA SUPER</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peExtrusionLineFilter === 'Pellet EVA 1' && styles.filterButtonActive]} onPress={() => { setPeExtrusionLineFilter('Pellet EVA 1'); setPeExtrusionCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peExtrusionLineFilter === 'Pellet EVA 1' && styles.filterButtonTextActive]}>Pellet EVA 1</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Status:</Text>
                          <View style={styles.filterButtons}>
                            <TouchableOpacity style={[styles.filterButton, peExtrusionStatusFilter === 'all' && styles.filterButtonActive]} onPress={() => { setPeExtrusionStatusFilter('all'); setPeExtrusionCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peExtrusionStatusFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peExtrusionStatusFilter === 'pending' && styles.filterButtonActive]} onPress={() => { setPeExtrusionStatusFilter('pending'); setPeExtrusionCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peExtrusionStatusFilter === 'pending' && styles.filterButtonTextActive]}>Pending</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.filterButton, peExtrusionStatusFilter === 'Completed' && styles.filterButtonActive]} onPress={() => { setPeExtrusionStatusFilter('Completed'); setPeExtrusionCurrentPage(1); }}>
                              <Text style={[styles.filterButtonText, peExtrusionStatusFilter === 'Completed' && styles.filterButtonTextActive]}>Complete</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                      {peExtrusionLogsLoading ? (
                        <View style={styles.loadingState}>
                          <ActivityIndicator size="large" color="#17a34a" />
                          <Text style={styles.loadingText}>Loading entries...</Text>
                        </View>
                      ) : peExtrusionLogs.length > 0 ? (
                        <View style={styles.logsList}>
                          {peExtrusionLogs.map((log: any, index: number) => (
                            <View key={log.id || index} style={styles.logItem}>
                              <View style={styles.logMain}>
                                <Text style={styles.logQr}>{log.output_bag_qr || log.outputBagQr || '—'}</Text>
                                <View style={styles.logDetails}>
                                  <Text style={styles.logWeight}>{log.weight} kg</Text>
                                  <Text style={styles.logTime}>{new Date(log.created_at).toLocaleString()}</Text>
                                </View>
                                <View style={styles.logStatusRow}>
                                  <View style={[styles.statusBadge, { backgroundColor: log.status === 'pending' ? '#FEF3C7' : '#DCFCE7' }]}>
                                    <Text style={[styles.statusBadgeText, { color: log.status === 'pending' ? '#D97706' : '#15803D' }]}>{log.status || 'Completed'}</Text>
                                  </View>
                                </View>
                              </View>
                              <View style={styles.logActions}>
                                {(user?.role?.toLowerCase() === 'ppic' || log.status === 'pending') && (
                                  <TouchableOpacity style={styles.editIconButton} onPress={() => openEditLogWeight(log)}>
                                    <Pencil color="#0ea5e9" size={18} />
                                  </TouchableOpacity>
                                )}
                                <TouchableOpacity style={styles.printIconButton} onPress={() => { setSelectedLogForPrint(log); setShowListPrintPreview(true); }}>
                                  <PrinterIcon color="#17a34a" size={20} />
                                </TouchableOpacity>
                                <View style={[styles.logBadge, { backgroundColor: '#FFF7ED' }]}>
                                  <Text style={[styles.logBadgeText, { color: '#ea580c' }]}>{log.sub_line || '—'}</Text>
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
                      {peExtrusionTotalPages > 1 && (
                        <View style={styles.pagination}>
                          <TouchableOpacity style={[styles.pageBtn, peExtrusionCurrentPage === 1 && styles.pageBtnDisabled]} onPress={() => setPeExtrusionCurrentPage(Math.max(1, peExtrusionCurrentPage - 1))} disabled={peExtrusionCurrentPage === 1}>
                            <ChevronLeft color={peExtrusionCurrentPage === 1 ? '#cbd5e1' : '#475569'} size={18} />
                          </TouchableOpacity>
                          <View style={styles.pageInfoBox}>
                            <Text style={styles.pageInfoMain}>{peExtrusionCurrentPage} / {peExtrusionTotalPages}</Text>
                            <Text style={styles.pageInfoSub}>{peExtrusionTotalLogs} total</Text>
                          </View>
                          <TouchableOpacity style={[styles.pageBtn, peExtrusionCurrentPage === peExtrusionTotalPages && styles.pageBtnDisabled]} onPress={() => setPeExtrusionCurrentPage(Math.min(peExtrusionTotalPages, peExtrusionCurrentPage + 1))} disabled={peExtrusionCurrentPage === peExtrusionTotalPages}>
                            <ChevronRight color={peExtrusionCurrentPage === peExtrusionTotalPages ? '#cbd5e1' : '#475569'} size={18} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    )}

                    {/* Step 2: Input / Output section picker */}
                    {selectedSubLine && !selectedSection && (
                      <View style={styles.selectionContainer}>
                        <View style={[styles.sublineBadgeWrapper, { marginBottom: 8 }]}>
                          <View style={[styles.sublineBadge, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
                            <Text style={[styles.sublineBadgeText, { color: '#f97316' }]}>{selectedSubLine}</Text>
                          </View>
                        </View>
                        <Text style={styles.selectionTitle}>Select Section</Text>
                        <TouchableOpacity style={styles.selectionCard}
                          onPress={() => setSelectedSection('input')}>
                          <View style={[styles.selectionIconBox, { backgroundColor: '#0ea5e9' }]}>
                            <Package color="#FFF" size={28} />
                          </View>
                        <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>Input</Text>
                            <Text style={styles.selectionCardSub}>Scan primary flakes bag</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                        <TouchableOpacity style={styles.selectionCard}
                          onPress={() => setSelectedSection('output')}>
                          <View style={[styles.selectionIconBox, { backgroundColor: '#22c55e' }]}>
                            <Box color="#FFF" size={28} />
                          </View>
                        <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>Output</Text>
                            <Text style={styles.selectionCardSub}>Enter weight & generate QR</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      </View>
                    )}

                    {/* Step 3a: Input — scan PRIMARY flakes bag + show additional materials (always 0) */}
                    {selectedSubLine && selectedSection === 'input' && (
                      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                        <View style={[styles.sublineBadgeWrapper, { paddingHorizontal: 0, marginBottom: 12 }]}>
                          <View style={[styles.sublineBadge, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
                            <Text style={[styles.sublineBadgeText, { color: '#f97316' }]}>
                              {selectedSubLine} — Input
                            </Text>
                          </View>
                        </View>

                        {/* Primary material: scan QR bag */}
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View style={[styles.typePill, { backgroundColor: '#DCFCE7' }]}>
                              <Text style={[styles.typePillText, { color: '#15803D' }]}>PRIMARY</Text>
                            </View>
                            <Text style={styles.sectionTitleText}>
                              {PE_EXTRUDER_PRIMARY[selectedSubLine] || 'Flakes bag'}
                            </Text>
                          </View>
                          {selectedInputBag ? (
                            <View style={styles.selectedBagCard}>
                              <View style={[styles.selectedBagInfo, { flex: 1, minWidth: 0 }]}>
                                <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{t('dashboard.jumboId')}</Text>
                                <Text style={[styles.selectedBagQr, { minWidth: 0 }]} numberOfLines={2} selectable>{getBagDisplayId(selectedInputBag)}</Text>
                                {(selectedInputBag as any).sub_line ? <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{t('dashboard.lineLabel')}: {(selectedInputBag as any).sub_line}</Text> : null}
                                <Text style={styles.selectedBagWeight}>{selectedInputBag.weight} kg</Text>
                              </View>
                              <TouchableOpacity onPress={() => setSelectedInputBag(null)}>
                                <X size={20} color="#ef4444" />
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <>
                              <View style={styles.inputWithIcon}>
                                <TextInput
                                  style={[styles.input, { flex: 1 }]}
                                  placeholder={`Search or scan ${PE_EXTRUDER_PRIMARY[selectedSubLine] || 'flakes'} QR...`}
                                  placeholderTextColor="#999"
                                  value={bagSearchQuery}
                                  onChangeText={(text) => { setBagSearchQuery(text); onBagSearch(text); }}
                                />
                                <TouchableOpacity style={styles.iconInsideInput}
                                  onPress={() => { setShowScanner(true); setScanned(false); }}>
                                  <ScanLine size={20} color="#666" />
                                </TouchableOpacity>
                              </View>
                              {showSuggestions && suggestedBags.length > 0 && (
                                <ScrollView style={styles.suggestionsContainer} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                                  {suggestedBags.map((bag: any, idx: number) => (
                                    <TouchableOpacity
                                      key={idx}
                                      style={[styles.suggestionItem, idx === suggestedBags.length - 1 && { borderBottomWidth: 0 }]}
                                      onPress={() => {
                                        setSelectedInputBag({ ...bag, output_bag_qr: bag.output_bag_qr ?? bag.outputBagQr, weight: bag.weight });
                                        setSuggestedBags([]);
                                        setShowSuggestions(false);
                                        setBagSearchQuery('');
                                      }}>
                                      <View style={styles.suggestionLeftCol}>
                                        <Text style={styles.suggestionQrLine} numberOfLines={2} selectable>{getBagDisplayId(bag)}</Text>
                                        {bag.sub_line ? <Text style={styles.suggestionSubLine}>{bag.sub_line}</Text> : null}
                                      </View>
                                      <Text style={styles.suggestionDetail}>{bag.weight} kg</Text>
                                    </TouchableOpacity>
                                  ))}
                                </ScrollView>
                              )}
                            </>
                          )}
                        </View>

                        {/* Additional materials — always 0 (weighed at shift-end by PPIC) */}
                        {(PE_EXTRUDER_ADDITIONAL[selectedSubLine] || []).length > 0 && (
                          <View style={[styles.sectionCard, { marginTop: 8 }]}>
                            <View style={styles.sectionHeaderRow}>
                              <View style={[styles.typePill, { backgroundColor: '#F1F5F9' }]}>
                                <Text style={[styles.typePillText, { color: '#64748b' }]}>ADDITIONAL</Text>
                              </View>
                              <Text style={styles.sectionTitleText}>Input = 0 (weighed at shift end)</Text>
                            </View>
                            <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginTop: 6 }}>
                              <Text style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                                These materials are added unmeasured during production.{'\n'}
                                PPIC weighs remaining stock at shift end to calculate usage.
                              </Text>
                              {(PE_EXTRUDER_ADDITIONAL[selectedSubLine] || []).map((mat: string) => (
                                <View key={mat} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                                  <Text style={{ fontSize: 13, color: '#475569' }}>{mat}</Text>
                                  <Text style={{ fontSize: 13, color: '#94a3b8', fontWeight: '600' }}>0 kg</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Step 3b: Output — enter weight, generate QR, print */}
                    {selectedSubLine && selectedSection === 'output' && (
                      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                        <View style={[styles.sublineBadgeWrapper, { paddingHorizontal: 0, marginBottom: 12 }]}>
                          <View style={[styles.sublineBadge, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
                            <Text style={[styles.sublineBadgeText, { color: '#f97316' }]}>
                              {selectedSubLine} — Output
                            </Text>
                          </View>
                        </View>
                        {isShiftEnded ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#FECACA' }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                            <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New output is disabled.</Text>
                          </View>
                        ) : (
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View style={[styles.typePill, { backgroundColor: '#DCFCE7' }]}>
                              <Text style={[styles.typePillText, { color: '#15803D' }]}>OUTPUT</Text>
                            </View>
                            <Text style={styles.sectionTitleText}>{selectedSubLine}</Text>
                          </View>
                          <View style={styles.inputGroup}>
                            <Text style={styles.label}>Weight (kg)</Text>
                            <View style={styles.inputWithIcon}>
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                placeholder="Enter output weight"
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
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}
                              style={styles.photosPreviewContainer} contentContainerStyle={styles.photosPreviewContent}>
                              {capturedImages.map((imageUri, index) => (
                                <View key={index} style={styles.photoPreviewItem}>
                                  <Image source={{ uri: imageUri }} style={styles.photoPreviewThumbnail} />
                                  <TouchableOpacity style={styles.removePhotoButton}
                                    onPress={() => setCapturedImages(prev => prev.filter((_, i) => i !== index))}>
                                    <X size={16} color="#FFF" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </ScrollView>
                          )}
                          <TouchableOpacity
                            style={[styles.primaryButton, (!weightInput || isLoading) && { opacity: 0.5, backgroundColor: '#E2E8F0' }]}
                            onPress={handleLogProduction}
                            disabled={!weightInput || isLoading}>
                            {isLoading ? <ActivityIndicator color="#666" /> : <PrinterIcon size={20} color={!weightInput ? '#94A3B8' : '#FFF'} />}
                            <Text style={[styles.primaryButtonText, !weightInput && { color: '#94A3B8' }]}>Generate QR & Print</Text>
                          </TouchableOpacity>
                        </View>
                        )}

                        {/* Shift progress */}
                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>Shift Progress — {selectedSubLine}</Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>Outputs this shift</Text>
                            <Text style={styles.progressDataValue}>
                              {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === selectedSubLine).length} bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>Total weight</Text>
                            <Text style={styles.progressDataValue}>
                              {shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === selectedSubLine)
                                .reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0).toFixed(1)} kg
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </>
                ) : (
                /* ══════════════════════════════════════════════════════════
                    PC EXTRUSION FLOW (unchanged)
                    ══════════════════════════════════════════════════════════ */
                !selectedSubLine ? (
                  <React.Fragment>
                    <View style={styles.selectionContainer}>
                      <Text style={styles.selectionTitle}>Select Extrusion Line</Text>
                      {([
                        { line: 'Extrusion 1', sub: t('dashboard.primaryExtrusionLine'),   color: '#f97316' },
                        { line: 'Extrusion 2', sub: t('dashboard.secondaryExtrusionLine'),  color: '#ea580c' },
                        { line: 'Extrusion 3', sub: t('dashboard.tertiaryExtrusionLine'),   color: '#c2410c' },
                        { line: 'Mixture',     sub: t('dashboard.mixtureLine'),              color: '#dc2626' },
                      ] as const).map(({ line, sub, color }) => {
                        const bags = shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === line).length;
                        const kg   = shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === line).reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0);
                        return (
                          <TouchableOpacity
                            key={line}
                            style={[styles.selectionCard, isShiftEnded && { opacity: 0.4 }]}
                            disabled={isShiftEnded}
                            onPress={() => { setPendingExtrusionLine(line as any); setShowExtrusionModal(true); }}
                          >
                            <View style={[styles.selectionIconBox, { backgroundColor: color }]}><Zap color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>{line}</Text>
                              <Text style={styles.selectionCardSub}>{sub}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                              <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>{bags} bags</Text>
                              <Text style={{ fontSize: 11, color: '#64748b' }}>{kg.toFixed(1)} kg</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Shift Ended banner for Extrusion */}
                    {isShiftEnded && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#FECACA' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                        <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New input/output is disabled.</Text>
                      </View>
                    )}

                    {/* Extrusion Station Totals */}
                    {(() => {
                      const lines = [
                        { label: 'Extrusion 1', short: 'E1', color: '#f97316' },
                        { label: 'Extrusion 2', short: 'E2', color: '#ea580c' },
                        { label: 'Extrusion 3', short: 'E3', color: '#c2410c' },
                        { label: 'Mixture',     short: 'Mix',color: '#dc2626' },
                      ];
                      const totalBags = shiftLogs.filter((l: any) => l.station_id === selectedStation.id).length;
                      const totalKg   = shiftLogs.filter((l: any) => l.station_id === selectedStation.id).reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0);
                      return (
                        <View style={{ marginBottom: 12 }}>
                          <View style={{ backgroundColor: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#94a3b8' }}>Extrusion — This Shift</Text>
                            <View style={{ flexDirection: 'row', gap: 16 }}>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff' }}>{totalBags}</Text>
                                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>bags</Text>
                              </View>
                              <View style={{ width: 1, backgroundColor: '#334155' }} />
                              <View style={{ alignItems: 'center' }}>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff' }}>{totalKg.toFixed(1)}</Text>
                                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>kg</Text>
                              </View>
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {lines.map(({ label, short, color }) => {
                              const bags = shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === label).length;
                              const kg   = shiftLogs.filter((l: any) => l.station_id === selectedStation.id && l.sub_line === label).reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0);
                              return (
                                <View key={label} style={{ width: '48%', backgroundColor: '#fff', borderRadius: 12, padding: 12, borderTopWidth: 3, borderTopColor: color, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color, marginBottom: 6 }}>{short}</Text>
                                  <Text style={{ fontSize: 22, fontWeight: '800', color: '#1e293b' }}>{bags}</Text>
                                  <Text style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>bags</Text>
                                  <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 6 }}>
                                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>{kg.toFixed(1)} kg</Text>
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })()}

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
                              {(user?.role?.toLowerCase() === 'ppic' || log.status === 'pending') && (
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
                          <ChevronLeft size={18} color={extrusionCurrentPage === 1 ? '#cbd5e1' : '#475569'} />
                        </TouchableOpacity>
                        <View style={styles.pageInfoBox}>
                          <Text style={styles.pageInfoMain}>{extrusionCurrentPage} / {extrusionTotalPages}</Text>
                          <Text style={styles.pageInfoSub}>{extrusionTotalLogs} total</Text>
                        </View>
                        <TouchableOpacity 
                          style={[styles.pageBtn, extrusionCurrentPage === extrusionTotalPages && styles.pageBtnDisabled]}
                          onPress={() => extrusionCurrentPage < extrusionTotalPages && setExtrusionCurrentPage(extrusionCurrentPage + 1)}
                          disabled={extrusionCurrentPage === extrusionTotalPages}
                        >
                          <ChevronRight size={18} color={extrusionCurrentPage === extrusionTotalPages ? '#cbd5e1' : '#475569'} />
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
                    {isShiftEnded ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#FECACA' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                        <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New input/output is disabled.</Text>
                      </View>
                    ) : (
                      <>
                    <TouchableOpacity style={styles.sectionOption} onPress={() => setSelectedSection('input')}>
                      <View style={[styles.optionIcon, { backgroundColor: '#f97316' }]}><Plus color="#FFF" size={24} /></View>
                      <View><Text style={styles.optionTitle}>INPUT</Text><Text style={styles.optionSubtitle}>Scan washing bag</Text></View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.sectionOption} onPress={() => setSelectedSection('output')}>
                      <View style={[styles.optionIcon, { backgroundColor: '#17a34a' }]}><Box color="#FFF" size={24} /></View>
                      <View><Text style={styles.optionTitle}>OUTPUT</Text><Text style={styles.optionSubtitle}>Generate bag QR</Text></View>
                    </TouchableOpacity>
                      </>
                    )}
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
                          <ScrollView style={styles.suggestionsList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                            {suggestedBags.map((bag, i) => (
                              <TouchableOpacity 
                                key={i} 
                                style={[styles.suggestionItem, i === suggestedBags.length - 1 && { borderBottomWidth: 0 }]}
                                onPress={() => {
                                  setSelectedInputBag(bag);
                                  setShowSuggestions(false);
                                  setBagSearchQuery('');
                                }}
                              >
                                <View style={styles.suggestionLeftCol}>
                                <Text style={styles.suggestionQrLine} numberOfLines={2} selectable>{getBagDisplayId(bag)}</Text>
                                  {bag.sub_line ? <Text style={styles.suggestionSubLine}>{bag.sub_line}</Text> : null}
                                </View>
                                <Text style={styles.suggestionDetail}>{bag.weight} kg</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                      <TouchableOpacity style={styles.scanButton} onPress={() => { setScanned(false); setShowScanner(true); }}>
                        <CameraIcon color="#17a34a" size={20} />
                        <Text style={styles.scanButtonText}>Scan QR Code</Text>
                      </TouchableOpacity>
                      {selectedInputBag && (
                        <View style={styles.selectedBagCard}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{t('dashboard.jumboId')}</Text>
                            <Text style={[styles.selectedBagId, { minWidth: 0 }]} numberOfLines={2} selectable>{getBagDisplayId(selectedInputBag)}</Text>
                            {(selectedInputBag as any).sub_line ? <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{t('dashboard.lineLabel')}: {(selectedInputBag as any).sub_line}</Text> : null}
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
                ) : null
              )
            }
          </View>
            ) : (
              <>
                <View style={[styles.stationHero, { backgroundColor: selectedStation.color }]}><View style={styles.heroHeader}>{renderStationIcon(selectedStation.name, selectedStation.color)}<View style={{ marginLeft: 15, flex: 1 }}><Text style={styles.heroTitle}>{selectedStation.name}</Text><Text style={styles.heroDesc}>{selectedStation.description}</Text></View></View></View>
                {isShiftEnded && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderWidth: 1, borderColor: '#FECACA' }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 8 }} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>Shift Ended — View Only</Text>
                    <Text style={{ fontSize: 12, color: '#7f1d1d', marginLeft: 6 }}>New input/output is disabled.</Text>
                  </View>
                )}
                <View style={[styles.formCard, { display: isShiftEnded ? 'none' : 'flex' }]}>
                  {selectedSection === 'input' ? (
                    <View>
                      <Text style={styles.formTitle}>Input Material</Text>
                      <View style={styles.searchContainer}><View style={styles.searchInputWrapper}><Search size={20} color="#666" style={{ marginRight: 10 }} /><TextInput style={styles.searchTextInput} placeholder="Search ID..." value={bagSearchQuery} onChangeText={onBagSearch} onFocus={handleBagSearchFocus} /></View>
                        {showSuggestions && (
                          <ScrollView style={styles.suggestionsList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                            {suggestedBags.map((bag, i) => (
                              <TouchableOpacity
                                key={i}
                                style={[styles.suggestionItem, i === suggestedBags.length - 1 && { borderBottomWidth: 0 }]}
                                onPress={() => { setSelectedInputBag(bag); setShowSuggestions(false); setBagSearchQuery(''); }}
                              >
                                <View style={styles.suggestionLeftCol}>
                                  <Text style={styles.suggestionQrLine} numberOfLines={2} selectable>{getBagDisplayId(bag)}</Text>
                                  {bag.sub_line ? <Text style={styles.suggestionSubLine}>{bag.sub_line}</Text> : null}
                                </View>
                                <Text style={styles.suggestionDetail}>{bag.weight} kg</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                  </View>
                      <TouchableOpacity style={styles.scanButton} onPress={() => { setScanned(false); setShowScanner(true); }}><CameraIcon color="#17a34a" size={20} /><Text style={styles.scanButtonText}>Scan QR Code</Text></TouchableOpacity>
                      {selectedInputBag && (<View style={styles.selectedBagCard}><View style={{ flex: 1, minWidth: 0 }}><Text style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{t('dashboard.jumboId')}</Text><Text style={[styles.selectedBagId, { minWidth: 0 }]} numberOfLines={2} selectable>{getBagDisplayId(selectedInputBag)}</Text>{(selectedInputBag as any).sub_line ? <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{t('dashboard.lineLabel')}: {(selectedInputBag as any).sub_line}</Text> : null}<Text style={styles.selectedBagWeight}>{selectedInputBag.weight} kg</Text></View><TouchableOpacity onPress={() => setSelectedInputBag(null)}><X color="#EB445A" size={20} /></TouchableOpacity></View>)}
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
                              selectedStation?.name?.toLowerCase().includes('re-packaging');
                            
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

                {/* Re-Packaging Station Totals */}
                {(() => {
                  const logs = shiftLogs.filter((l: any) => l.station_id === selectedStation.id);
                  const totalBags = logs.length;
                  const totalKg = logs.reduce((s: number, l: any) => s + (parseFloat(l.weight) || 0), 0);
                  return (
                    <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 4 }}>
                      {/* Dark header bar */}
                      <View style={{ backgroundColor: '#1e293b', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.3 }}>Re-Packaging — This Shift</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                          <View style={{ alignItems: 'center' }}>
                            <Text style={{ fontSize: 22, fontWeight: '800', color: '#fff', lineHeight: 26 }}>{totalBags}</Text>
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>bags</Text>
                          </View>
                          <View style={{ width: 1, height: 32, backgroundColor: '#334155' }} />
                          <View style={{ alignItems: 'center' }}>
                            <Text style={{ fontSize: 22, fontWeight: '800', color: '#fff', lineHeight: 26 }}>{totalKg.toFixed(1)}</Text>
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>kg</Text>
                          </View>
                        </View>
                      </View>
                      {/* Two stat cards */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 18, paddingHorizontal: 14, borderTopWidth: 3, borderTopColor: '#22c55e', elevation: 2, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#22c55e', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Total Bags</Text>
                          <Text style={{ fontSize: 32, fontWeight: '800', color: '#1e293b', lineHeight: 36 }}>{totalBags}</Text>
                          <Text style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>bags this shift</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 18, paddingHorizontal: 14, borderTopWidth: 3, borderTopColor: '#10b981', elevation: 2, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#10b981', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Total Weight</Text>
                          <Text style={{ fontSize: 32, fontWeight: '800', color: '#1e293b', lineHeight: 36 }}>{totalKg.toFixed(1)}</Text>
                          <Text style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>kg this shift</Text>
                        </View>
                      </View>
                    </View>
                  );
                })()}

                <View style={[styles.crusherLogsSection, { marginTop: 16, marginHorizontal: 16 }]}>
                  <View style={styles.logsHeader}>
                    <Text style={styles.logsTitle}>Recent Entries</Text>
                  </View>
                  <View style={styles.datePickerContainer}>
                    <Text style={styles.datePickerLabel}>Select Date:</Text>
                    <StationDatePicker
                      value={parseDateLocal(packingSelectedDate)}
                      onChange={(date) => {
                        setPackingSelectedDate(formatDateLocal(date));
                        setPackingCurrentPage(1);
                      }}
                      maximumDate={maxDate}
                    />
                  </View>

                  {/* Search */}
                  <View style={styles.searchBox}>
                    <Search size={18} color="#64748b" />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search by QR code..."
                      value={packingSearchQuery}
                      onChangeText={(text) => { setPackingSearchQuery(text); setPackingCurrentPage(1); }}
                      placeholderTextColor="#94a3b8"
                      clearButtonMode="while-editing"
                      returnKeyType="search"
                      autoCorrect={false}
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    {packingSearchQuery.length > 0 && (
                      <TouchableOpacity
                        onPress={() => { setPackingSearchQuery(''); setPackingCurrentPage(1); }}
                        style={styles.clearButton}
                      >
                        <X size={16} color="#64748b" />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Status Filter */}
                  <View style={styles.filtersContainer}>
                    <View style={styles.filterGroup}>
                      <Text style={styles.filterLabel}>Status:</Text>
                      <View style={styles.filterButtons}>
                        <TouchableOpacity
                          style={[styles.filterButton, packingSelectedStatusFilter === 'all' && styles.filterButtonActive]}
                          onPress={() => { setPackingSelectedStatusFilter('all'); setPackingCurrentPage(1); }}
                        >
                          <Text style={[styles.filterButtonText, packingSelectedStatusFilter === 'all' && styles.filterButtonTextActive]}>All</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.filterButton, packingSelectedStatusFilter === 'pending' && styles.filterButtonActive]}
                          onPress={() => { setPackingSelectedStatusFilter('pending'); setPackingCurrentPage(1); }}
                        >
                          <Text style={[styles.filterButtonText, packingSelectedStatusFilter === 'pending' && styles.filterButtonTextActive]}>Pending</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.filterButton, packingSelectedStatusFilter === 'Completed' && styles.filterButtonActive]}
                          onPress={() => { setPackingSelectedStatusFilter('Completed'); setPackingCurrentPage(1); }}
                        >
                          <Text style={[styles.filterButtonText, packingSelectedStatusFilter === 'Completed' && styles.filterButtonTextActive]}>Complete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  {packingLogsLoading ? (
                    <View style={styles.loadingState}>
                      <ActivityIndicator size="large" color="#17a34a" />
                      <Text style={styles.loadingText}>Loading entries...</Text>
                    </View>
                  ) : packingLogs.length > 0 ? (
                    <View style={styles.logsList}>
                      {packingLogs.map((log, index) => (
                        <View key={index} style={styles.logItem}>
                          <View style={styles.logMain}>
                            <Text style={styles.logQr}>{log.output_bag_qr}</Text>
                            <View style={styles.logDetails}>
                              <Text style={styles.logWeight}>{log.weight} kg</Text>
                              <View style={[styles.statusBadge, log.status === 'pending' ? styles.statusPending : styles.statusCompleted]}>
                                <Text style={[styles.statusBadgeText, log.status === 'pending' ? styles.statusPendingText : styles.statusCompletedText]}>
                                  {log.status || 'Completed'}
                                </Text>
                              </View>
                            </View>
                          </View>
                          <View style={styles.logActions}>
                            {(user?.role?.toLowerCase() === 'ppic' || log.status === 'pending') && (
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
                  {packingTotalPages > 1 && (
                    <View style={styles.pagination}>
                      <TouchableOpacity
                        style={[styles.pageBtn, packingCurrentPage === 1 && styles.pageBtnDisabled]}
                        onPress={() => packingCurrentPage > 1 && setPackingCurrentPage(packingCurrentPage - 1)}
                        disabled={packingCurrentPage === 1}
                      >
                        <ChevronLeft size={18} color={packingCurrentPage === 1 ? '#cbd5e1' : '#475569'} />
                      </TouchableOpacity>
                      <View style={styles.pageInfoBox}>
                        <Text style={styles.pageInfoMain}>{packingCurrentPage} / {packingTotalPages}</Text>
                        <Text style={styles.pageInfoSub}>{packingTotalLogs} total</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.pageBtn, packingCurrentPage === packingTotalPages && styles.pageBtnDisabled]}
                        onPress={() => packingCurrentPage < packingTotalPages && setPackingCurrentPage(packingCurrentPage + 1)}
                        disabled={packingCurrentPage === packingTotalPages}
                      >
                        <ChevronRight size={18} color={packingCurrentPage === packingTotalPages ? '#cbd5e1' : '#475569'} />
                      </TouchableOpacity>
                    </View>
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

              {/* Jumbo bag type toggle — hidden for crusher (3E/Rapid/Betty are always pending) */}
              {!isCurrentLogSaved &&
               !selectedStation?.name?.toLowerCase().includes('crusher') && (
                <View style={[styles.inputGroup, { marginTop: 12, width: '100%' }]}>
                  <Text style={styles.label}>{t('dashboard.jumboBagType')}</Text>
                  <View style={styles.filterButtons}>
                    <TouchableOpacity
                      style={[styles.filterButton, previewBagStatus === 'pending' && styles.filterButtonActive]}
                      onPress={() => {
                        previewBagStatusRef.current = 'pending';
                        setPreviewBagStatus('pending');
                        setPreviewData((prev: any) => prev ? { ...prev, bagStatus: 'pending' as const } : prev);
                      }}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.filterButtonText, previewBagStatus === 'pending' && styles.filterButtonTextActive]}>
                        {t('dashboard.temporaryJumboBag')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterButton, previewBagStatus === 'Completed' && styles.filterButtonActive]}
                      onPress={() => {
                        previewBagStatusRef.current = 'Completed';
                        setPreviewBagStatus('Completed');
                        setPreviewData((prev: any) => prev ? { ...prev, bagStatus: 'Completed' as const } : prev);
                      }}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      activeOpacity={0.7}
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
                onPress={() => {
                  // Prefer 'Completed' if user selected it (ref is set on tap; state may lag)
                  const fromRef = previewBagStatusRef.current;
                  const fromState = previewBagStatus;
                  const statusToSend = (fromRef === 'Completed' || fromState === 'Completed') ? 'Completed' : 'pending';
                  handleSaveProduction(statusToSend);
                }}
                disabled={isLoading}
                activeOpacity={0.8}
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
  peRawMaterialListContainer: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 16 },
  peRawMaterialListLabel: { fontSize: 13, fontWeight: '600', color: '#64748b', marginBottom: 12 },
  peRawMaterialList: { maxHeight: 360 },
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
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  pageBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  pageBtnDisabled: { opacity: 0.35 },
  pageInfo: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  pageInfoBox: { alignItems: 'center' },
  pageInfoMain: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  pageInfoSub: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
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
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    marginTop: 6,
    maxHeight: 280,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  suggestionsContainer: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    marginTop: 6,
    maxHeight: 280,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  suggestionLeftCol: { flex: 1, minWidth: 120, marginRight: 8 },
  suggestionId: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  suggestionQrLine: { fontSize: 13, fontWeight: '700', color: '#0f766e', marginBottom: 2 },
  suggestionSubLine: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  suggestionDetail: { fontSize: 13, color: '#64748b', fontWeight: '500', marginLeft: 8 },
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
