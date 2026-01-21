import React, { useState, useEffect, useCallback } from 'react';
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
  FileText
} from 'lucide-react-native';
import { useAuth } from '../navigation/AuthContext';
import { productionApi } from '../api/production';
import { Station, ProductionLog } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import QRCode from 'react-native-qrcode-svg';
import InlineDatePicker from '../components/InlineDatePicker';

import { printService } from '../utils/print';

const DashboardScreen = ({ navigation }: any) => {
  const { user, logout, selectedShift } = useAuth();
  
  // App State
  const [stations, setStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Shift State
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [shiftStartTime, setShiftStartTime] = useState<number>(0);
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
  const [pendingExtrusionLine, setPendingExtrusionLine] = useState<'Extrusion 1' | 'Extrusion 2' | 'Extrusion 3' | null>(null);
  const [showExtrusionModal, setShowExtrusionModal] = useState(false);
  
  // Input/Output State
  const [weightInput, setWeightInput] = useState('');
  const [bagSearchQuery, setBagSearchQuery] = useState('');
  const [suggestedBags, setSuggestedBags] = useState<any[]>([]);
  const [selectedInputBag, setSelectedInputBag] = useState<any>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isCurrentLogSaved, setIsCurrentLogSaved] = useState(false);
  const [selectedSubLine, setSelectedSubLine] = useState<'3E' | 'Rapid' | 'Washing 1' | 'Washing 2' | 'Washing 3' | 'Extrusion 1' | 'Extrusion 2' | 'Extrusion 3' | null>(null);
  const [currentViewBags, setCurrentViewBags] = useState(0);
  const [currentViewWeight, setCurrentViewWeight] = useState(0);
  
  // Crusher logs list state
  const [crusherLogs, setCrusherLogs] = useState<any[]>([]);
  const [crusherLogsLoading, setCrusherLogsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [datePickerDate, setDatePickerDate] = useState(new Date());
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>('all'); // 'all', '3E', 'Rapid'
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all'); // 'all', 'pending', 'Completed'
  const [showListPrintPreview, setShowListPrintPreview] = useState(false);
  const [selectedLogForPrint, setSelectedLogForPrint] = useState<any>(null);

  // Washing logs list state
  const [washingLogs, setWashingLogs] = useState<any[]>([]);
  const [washingLogsLoading, setWashingLogsLoading] = useState(false);
  const [washingSelectedDate, setWashingSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [washingSearchQuery, setWashingSearchQuery] = useState('');
  const [washingCurrentPage, setWashingCurrentPage] = useState(1);
  const [washingTotalPages, setWashingTotalPages] = useState(1);
  const [washingTotalLogs, setWashingTotalLogs] = useState(0);
  const [washingDatePickerDate, setWashingDatePickerDate] = useState(new Date());
  const [washingSelectedLineFilter, setWashingSelectedLineFilter] = useState<string>('all'); // 'all', 'Washing 1', 'Washing 2', 'Washing 3'
  const [washingSelectedStatusFilter, setWashingSelectedStatusFilter] = useState<string>('all'); // 'all', 'pending', 'Completed'
  
  // Extrusion logs list state
  const [extrusionLogs, setExtrusionLogs] = useState<any[]>([]);
  const [extrusionLogsLoading, setExtrusionLogsLoading] = useState(false);
  const [extrusionSelectedDate, setExtrusionSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [extrusionSearchQuery, setExtrusionSearchQuery] = useState('');
  const [extrusionCurrentPage, setExtrusionCurrentPage] = useState(1);
  const [extrusionTotalPages, setExtrusionTotalPages] = useState(1);
  const [extrusionTotalLogs, setExtrusionTotalLogs] = useState(0);
  const [extrusionDatePickerDate, setExtrusionDatePickerDate] = useState(new Date());
  const [extrusionSelectedLineFilter, setExtrusionSelectedLineFilter] = useState<string>('all'); // 'all', 'Extrusion 1', 'Extrusion 2', 'Extrusion 3'
  const [extrusionSelectedStatusFilter, setExtrusionSelectedStatusFilter] = useState<string>('all'); // 'all', 'pending', 'Completed'
  
  // Scanner State
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Photo State
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  // Summary State
  const [showEndShiftSummary, setShowEndShiftSummary] = useState(false);
  const [byProductsInputs, setByProductsInputs] = useState<any[]>([]);

  // Printer & Preview State
  const [selectedPrinter, setSelectedPrinter] = useState<any>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const qrRef = React.useRef<any>(null);
  const listQrRef = React.useRef<any>(null);
  
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
    if (isShiftActive && shiftStartTime) {
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

  const handleStartShift = async () => {
    if (!selectedShift) return;
    try {
      setIsLoading(true);
      const response = await productionApi.startShift(selectedShift.id);
      if (response.data.success) {
        setBackendShiftId(response.data.data.id);
        setIsShiftActive(true);
        setShiftStartTime(Date.now());
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to start shift');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndShift = async () => {
    if (!backendShiftId) return;
    initByProducts();
    setShowEndShiftSummary(true);
  };

  const initByProducts = () => {
    const stationByProducts: any = {
      'Label Removal': [{ name: 'PP Cords', category: 'Sellable', weight: 0 }, { name: 'Dust', category: 'Landfill', weight: 0 }, { name: 'Floor Sweep', category: 'Landfill', weight: 0 }],
      'Crusher': [{ name: 'Spillage', category: 'Reprocess', weight: 0 }, { name: 'Off-spec Flakes', category: 'Reprocess', weight: 0 }],
      'Washing': [{ name: 'Wet Fines', category: 'Dewater & Landfill', weight: 0 }],
      'Extrusion': [{ name: 'Looms', category: 'HIGH VALUE - Regrind', weight: 0 }, { name: 'Filtered Material', category: 'Reprocess', weight: 0 }],
      'Final Packaging': [{ name: 'Damaged Bags', category: 'Repack', weight: 0 }, { name: 'Spillage', category: 'Reprocess', weight: 0 }]
    };
    const initialByProducts: any[] = [];
    stations.forEach(s => {
      (stationByProducts[s.name] || []).forEach((p: any) => {
        initialByProducts.push({ ...p, stationId: s.id, stationName: s.name });
      });
    });
    setByProductsInputs(initialByProducts);
  };

  const handleCloseShift = async () => {
    if (!backendShiftId) return;
    try {
      setIsLoading(true);
      const toSave = byProductsInputs.filter(p => p.weight > 0);
      await printService.printShiftSummary({
        shift: selectedShift?.name, operator: user?.name, date: new Date().toLocaleDateString(),
        totalOutputs: (() => {
          const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4);
          if (!extrusionStation) return 0;
          return shiftLogs.filter((l: any) => l.station_id === extrusionStation.id).length;
        })(),
        totalWeight: (() => {
          const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4);
          if (!extrusionStation) return '0.0';
          const extrusionLogs = shiftLogs.filter((l: any) => l.station_id === extrusionStation.id);
          return extrusionLogs.reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0).toFixed(1);
        })(),
        byProducts: toSave
      });
      if (toSave.length > 0) {
        await productionApi.logByProducts(backendShiftId, toSave.map(p => ({ stationId: p.stationId, name: p.name, weight: p.weight })));
      }
      const response = await productionApi.endShift(backendShiftId);
      if (response.data.success) {
        setIsShiftActive(false); setBackendShiftId(null); setShiftLogs([]); setShowEndShiftSummary(false);
        Alert.alert('Success', 'Shift closed successfully');
        navigation.navigate('ShiftSelection');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to close shift');
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
        10
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
        10
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
        10
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
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.7 });
    if (!result.canceled) setCapturedImage(result.assets[0].uri);
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

      // Validate the scanned QR code matches the expected batch type
      let targetStationId: number | undefined;
      let statusFilter: string | undefined;
      let expectedStationName: string = '';

      if (selectedStation?.id === 3 || selectedStation?.name?.toLowerCase().includes('washing')) {
        // Washing expects crusher batches (station_id = 2) with status pending
        targetStationId = 2;
        statusFilter = 'pending';
        expectedStationName = 'crusher';
      } else if (selectedStation?.id === 4 || selectedStation?.name?.toLowerCase().includes('extrusion')) {
        // Extrusion expects washing batches (station_id = 3) with status pending
        targetStationId = 3;
        statusFilter = 'pending';
        expectedStationName = 'washing';
      }

      // If we have a target station, validate the QR code
      if (targetStationId && statusFilter) {
        const response = await productionApi.searchLogs(qrCode, targetStationId, selectedStation?.id, statusFilter);
        if (response.data.success && response.data.data.length > 0) {
          // Found matching batch - use the data from the API
          const matchedBatch = response.data.data[0];
          setSelectedInputBag({ 
            output_bag_qr: matchedBatch.output_bag_qr, 
            weight: matchedBatch.weight || weight 
          });
          setShowScanner(false); // Close scanner only on success
        } else {
          // QR code doesn't match expected batch type
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
      Alert.alert('Error', 'Failed to validate scanned QR code. Please try again.');
      setScanned(false); // Allow scanning again
    }
  };

  const handleLogProduction = async () => {
    if (!weightInput || !backendShiftId || !selectedStation) return;
    try {
      setIsLoading(true);
      setIsCurrentLogSaved(false); // Reset save state
      const response = await productionApi.getNextQr(selectedStation.id, backendShiftId, selectedSubLine || undefined);
      if (response.data.success) {
        const qrCode = response.data.data.qrCode;
        // Use stationName from backend response (e.g., "Crusher-3E", "Washing-W1")
        // Backend returns formatted station name with washing line number matching QR code format
        const stationDisplay = response.data.data.details?.stationName || selectedStation.name;
        setPreviewData({
          qrCode: qrCode,
          weight: weightInput,
          station: stationDisplay,
          subLine: selectedSubLine,
          date: new Date().toLocaleDateString()
        });
        setShowPrintPreview(true);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to generate QR preview');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProduction = async () => {
    if (!previewData || !backendShiftId || !selectedStation) return;
    try {
      setIsLoading(true);
      // Set status to 'pending' for crusher, washing, and extrusion entries, 'Completed' for others
      const status = (selectedStation.id === 2 || selectedStation.id === 3 || selectedStation.id === 4) ? 'pending' : 'Completed';
      const response = await productionApi.logProduction({
        shiftId: backendShiftId,
        stationId: selectedStation.id,
        inputBagQr: selectedInputBag?.output_bag_qr || null,
        outputBagQr: previewData.qrCode,
        weight: parseFloat(weightInput),
        status: status,
        subLine: selectedSubLine || undefined
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
        Alert.alert('Success', 'Production log saved successfully');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save production log');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClosePreview = () => {
    setShowPrintPreview(false);
    setIsCurrentLogSaved(false);
    setWeightInput('');
    setSelectedInputBag(null);
    setCapturedImage(null);
    // Keep user on station
  };

  const handleBack = () => {
    if ((selectedStation?.name === 'Crusher' || selectedStation?.name === 'Washing') && selectedSubLine) {
      if (selectedSection) {
        // If in input/output section, go back to washing line selection
        setSelectedSection(null);
        // Also clear selectedSubLine to show the washing line selection screen
        setSelectedSubLine(null);
      } else {
        // If no section selected but subLine is set, clear subLine to show selection screen
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
      if (success) { setShowPrintPreview(false); setSelectedStation(null); }
    } catch (error) {
      Alert.alert('Print Error', 'Could not print');
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
        date: new Date(selectedLogForPrint.created_at).toLocaleDateString(),
        qrImage: qrBase64
      };
      const success = await printService.printQRLabel(printData);
      if (success) { setShowListPrintPreview(false); setSelectedLogForPrint(null); }
    } catch (error) {
      Alert.alert('Print Error', 'Could not print');
    } finally {
      setIsPrinting(false);
    }
  };

  const onBagSearch = async (text: string) => {
    setBagSearchQuery(text);
    try {
      let targetStationId: number | undefined;
      let statusFilter: string | undefined;
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
      // For other stations, require at least 2 characters
    if (text.length < 2) {
      setSuggestedBags([]);
      setShowSuggestions(false);
      return;
    }
      if (selectedStation?.id === 5) targetStationId = 4; // Final Packaging searches from Extrusion
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
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!selectedStation && !showEndShiftSummary ? (
              <TouchableOpacity onPress={() => navigation.navigate('ShiftSelection')} style={styles.headerPill}>
                <Text style={styles.pillLabel}>Shift</Text>
                <Text style={styles.pillValue}>{selectedShift?.name || 'Shift 1'}</Text>
              </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <ArrowLeft color="#333" size={24} />
              <View style={{ marginLeft: 10 }}>
                <Text style={styles.stationTitle}>
                  {showEndShiftSummary ? 'End Shift' : (selectedStation?.name === 'Washing' ? selectedStation?.name : (selectedSubLine ? `${selectedStation?.name} (${selectedSubLine})` : selectedStation?.name))}
                </Text>
                {!showEndShiftSummary && <View style={styles.contextPills}><Text style={styles.smallPill}>{selectedShift?.name}</Text></View>}
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
        {showEndShiftSummary ? (
          <View style={styles.summaryContainer}>
            <View style={styles.summaryStatsCard}>
              <Text style={styles.cardTitle}>Shift Summary</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}><Text style={styles.summaryValue}>{shiftDuration}</Text><Text style={styles.summaryLabel}>Duration</Text></View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>
                    {(() => {
                      const extrusionStation = stations.find(s => s.name?.toLowerCase().includes('extrusion') || s.id === 4);
                      if (!extrusionStation) return 0;
                      return shiftLogs.filter((l: any) => l.station_id === extrusionStation.id).length;
                    })()}
                  </Text>
                  <Text style={styles.summaryLabel}>Total Outputs</Text>
                </View>
                </View>
                </View>
            <Text style={styles.sectionTitle}>BY-PRODUCTS (OPTIONAL)</Text>
            {byProductsInputs.map((item, index) => (
              <View key={index} style={styles.byProductRow}>
                <View style={{ flex: 1 }}><Text style={styles.byProductName}>{item.name}</Text><Text style={styles.byProductStation}>{item.stationName} - {item.category}</Text></View>
                <View style={styles.byProductInputWrapper}>
                  <TextInput style={styles.byProductInput} keyboardType="numeric" value={item.weight.toString()} onChangeText={(val) => { const n = [...byProductsInputs]; n[index].weight = val; setByProductsInputs(n); }} />
                  <Text style={styles.unitLabel}>kg</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.closeShiftBtn} onPress={handleCloseShift} disabled={isLoading}>{isLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.closeShiftText}>Close Shift</Text>}</TouchableOpacity>
          </View>
        ) : !isShiftActive ? (
          <View style={styles.startShiftContainer}>
            <TouchableOpacity style={styles.startShiftCard} onPress={handleStartShift}>
              <View style={styles.playIconCircle}><Play fill="#FFF" color="#FFF" size={24} /></View>
              <View style={styles.startShiftText}><Text style={styles.startShiftTitle}>Start Shift</Text><Text style={styles.startShiftSubtitle}>Tap to begin working</Text></View>
              <ChevronRight color="#FFF" size={24} />
            </TouchableOpacity>
          </View>
        ) : !selectedStation ? (
          <View style={styles.dashboardGrid}>
            <View style={styles.statusRow}>
              <View style={styles.activeStatus}><View style={styles.statusDot} /><Text style={styles.statusText}>Shift Active</Text></View>
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
            <Text style={styles.sectionTitle}>SELECT STATION</Text>
            {stations.map((s) => (
              <TouchableOpacity key={s.id} style={styles.stationCard} onPress={() => handleStationSelect(s)}>
                <View style={[styles.stationIconBox, { backgroundColor: s.color }]}>{renderStationIcon(s.name, s.color)}</View>
                <View style={styles.stationInfo}><Text style={styles.stationName}>{s.name}</Text><Text style={styles.stationDesc} numberOfLines={1}>{s.description}</Text></View>
                <View style={styles.stationMiniStats}><Text style={styles.miniStat}>{shiftLogs.filter(l => l.station_id === s.id).length} bags</Text></View>
                <ChevronRight color="#CCC" size={20} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.endShiftButton} onPress={handleEndShift}><Square color="#FFF" size={20} /><Text style={styles.endShiftText}>Close Shift</Text></TouchableOpacity>
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
                        <Text style={styles.selectionCardSub}>Primary Crusher Line</Text>
                    </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.selectionCard} onPress={() => setSelectedSubLine('Rapid')}>
                      <View style={[styles.selectionIconBox, { backgroundColor: '#a855f7' }]}><Zap color="#FFF" size={28} /></View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>Rapid</Text>
                        <Text style={styles.selectionCardSub}>Fast Processing Line</Text>
                  </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>

                    {/* Logs List Section */}
                    <View style={styles.crusherLogsSection}>
                      <View style={styles.logsHeader}>
                        <Text style={styles.logsTitle}>Recent Entries</Text>
                </View>

                      {/* Inline Date Picker */}
                      <View style={styles.datePickerContainer}>
                        <Text style={styles.datePickerLabel}>Select Date:</Text>
                        <InlineDatePicker
                          value={datePickerDate}
                          onChange={(date) => {
                            // Always update with the new date - user explicitly selected it
                            const dateStr = date.toISOString().split('T')[0];
                            setDatePickerDate(date);
                            setSelectedDate(dateStr);
                            setCurrentPage(1);
                          }}
                          maximumDate={new Date()}
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
                              {log.status === 'pending' && (
                                <TouchableOpacity
                                  style={styles.printIconButton}
                                  onPress={() => {
                                    setSelectedLogForPrint(log);
                                    setShowListPrintPreview(true);
                                  }}
                                >
                                  <PrinterIcon color="#17a34a" size={20} />
                                </TouchableOpacity>
                              )}
                                <View style={[styles.logBadge, { backgroundColor: log.sub_line === '3E' ? '#EBF5FF' : '#F5F3FF' }]}>
                                  <Text style={[styles.logBadgeText, { color: log.sub_line === '3E' ? '#2563eb' : '#7c3aed' }]}>{log.sub_line}</Text>
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
                  ) : (
                  <>
                    <View style={styles.sublineBadgeWrapper}>
                      <View style={[styles.sublineBadge, { backgroundColor: selectedSubLine === '3E' ? '#EBF5FF' : '#F5F3FF', borderColor: selectedSubLine === '3E' ? '#bfdbfe' : '#ddd6fe' }]}>
                        <Text style={[styles.sublineBadgeText, { color: selectedSubLine === '3E' ? '#2563eb' : '#7c3aed' }]}>Working on: {selectedSubLine} Line</Text>
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

                    {/* Inline Date Picker */}
                    <View style={styles.datePickerContainer}>
                      <Text style={styles.datePickerLabel}>Select Date:</Text>
                      <InlineDatePicker
                        value={washingDatePickerDate}
                        onChange={(date) => {
                          const dateStr = date.toISOString().split('T')[0];
                          setWashingDatePickerDate(date);
                          setWashingSelectedDate(dateStr);
                          setWashingCurrentPage(1);
                        }}
                        maximumDate={new Date()}
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
                              {log.status === 'pending' && (
                                <TouchableOpacity 
                                  style={styles.printIconBtn}
                                  onPress={() => {
                                    setSelectedLogForPrint(log);
                                    setShowListPrintPreview(true);
                                  }}
                                >
                                  <Printer size={18} color="#17a34a" />
                                </TouchableOpacity>
                              )}
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
                              const washingLine = selectedSubLine || null;
                              const response = await productionApi.updateLogStatus(selectedInputBag.output_bag_qr, 'Completed', washingLine);
                              if (response.data.success) {
                          Alert.alert('Success', 'Material processing started');
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                          setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              } else {
                                Alert.alert('Error', 'Failed to update batch status');
                              }
                            } else {
                              // For other stations (NOT washing), create a new processing log entry
                              if (!backendShiftId) {
                                Alert.alert('Error', 'No active shift');
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
                                Alert.alert('Success', 'Material processing started');
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
                            Alert.alert('Error', 'Failed to start processing');
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
                          <Text style={styles.selectionCardSub}>Primary Extrusion Line</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingExtrusionLine('Extrusion 2'); setShowExtrusionModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#ea580c' }]}><Zap color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Extrusion 2</Text>
                          <Text style={styles.selectionCardSub}>Secondary Extrusion Line</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.selectionCard} onPress={() => { setPendingExtrusionLine('Extrusion 3'); setShowExtrusionModal(true); }}>
                        <View style={[styles.selectionIconBox, { backgroundColor: '#c2410c' }]}><Zap color="#FFF" size={28} /></View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>Extrusion 3</Text>
                          <Text style={styles.selectionCardSub}>Tertiary Extrusion Line</Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                    </View>

                    {/* Logs List Section */}
                    <View style={[styles.crusherLogsSection, { marginTop: 8 }]}>
                    <View style={styles.logsHeader}>
                      <Text style={styles.logsTitle}>Recent Entries</Text>
                    </View>

                    {/* Inline Date Picker */}
                    <View style={styles.datePickerContainer}>
                      <Text style={styles.datePickerLabel}>Select Date:</Text>
                      <InlineDatePicker
                        value={extrusionDatePickerDate}
                        onChange={(date) => {
                          const dateStr = date.toISOString().split('T')[0];
                          setExtrusionDatePickerDate(date);
                          setExtrusionSelectedDate(dateStr);
                          setExtrusionCurrentPage(1);
                        }}
                        maximumDate={new Date()}
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
                              {log.status === 'pending' && (
                                <TouchableOpacity 
                                  style={styles.printIconBtn}
                                  onPress={() => {
                                    setSelectedLogForPrint(log);
                                    setShowListPrintPreview(true);
                                  }}
                                >
                                  <Printer size={18} color="#17a34a" />
                                </TouchableOpacity>
                              )}
                              <View style={[
                                styles.logBadge,
                                log.sub_line === 'Extrusion 1' && { backgroundColor: '#f97316' },
                                log.sub_line === 'Extrusion 2' && { backgroundColor: '#ea580c' },
                                log.sub_line === 'Extrusion 3' && { backgroundColor: '#c2410c' }
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
                                Alert.alert('Error', 'Please select an extrusion line first');
                                setIsLoading(false);
                                return;
                              }
                              // Pass the selected extrusion line name (e.g., "Extrusion 1", "Extrusion 2", "Extrusion 3")
                              // This will update the washing batch status to 'Completed' and set used_line to the extrusion line
                              const extrusionLine = selectedSubLine;
                              const response = await productionApi.updateLogStatus(selectedInputBag.output_bag_qr, 'Completed', undefined, extrusionLine);
                              if (response.data.success) {
                                Alert.alert('Success', 'Material processing started');
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              } else {
                                Alert.alert('Error', 'Failed to update batch status');
                              }
                            } else {
                              // For other stations (NOT extrusion), create a new processing log entry
                              if (!backendShiftId) {
                                Alert.alert('Error', 'No active shift');
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
                                Alert.alert('Success', 'Material processing started');
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
                            Alert.alert('Error', 'Failed to start processing');
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
                            
                            // If this is washing station, ONLY update the existing crusher batch (NO new entry)
                            if (isWashingStation && selectedInputBag.output_bag_qr) {
                              // Pass the selected washing line name (e.g., "Washing 1", "Washing 2", "Washing 3")
                              const washingLine = selectedSubLine || null;
                              const response = await productionApi.updateLogStatus(selectedInputBag.output_bag_qr, 'Completed', washingLine);
                              if (response.data.success) {
                                Alert.alert('Success', 'Material processing started');
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                              } else {
                                Alert.alert('Error', 'Failed to update batch status');
                              }
                            } else {
                              // For other stations (NOT washing), create a new processing log entry
                              if (!backendShiftId) {
                                Alert.alert('Error', 'No active shift');
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
                                Alert.alert('Success', 'Material processing started');
                                setSelectedInputBag(null);
                                setBagSearchQuery('');
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                              }
                            }
                          } catch (error) {
                            console.error('Save input error:', error);
                            Alert.alert('Error', 'Failed to start processing');
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                      >
                        <Text style={styles.primaryButtonText}>Save & Start Processing</Text>
            </TouchableOpacity>
          </View>
                  ) : (
                    <View><Text style={styles.formTitle}>Output Recording</Text><View style={styles.inputGroup}><Text style={styles.label}>Weight (kg)</Text><TextInput style={styles.input} keyboardType="numeric" placeholder="0.00" value={weightInput} onChangeText={setWeightInput} /></View><TouchableOpacity style={styles.primaryButton} disabled={!weightInput || isLoading} onPress={handleLogProduction}><PrinterIcon color="#FFF" size={20} /><Text style={styles.primaryButtonText}>Generate QR & Print</Text></TouchableOpacity></View>
                  )}
        </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={showScanner} animationType="fade"><View style={styles.scannerContainer}><CameraView onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} style={StyleSheet.absoluteFillObject} /><View style={styles.scannerOverlay}><Text style={styles.scannerText}>Scan Bag QR Code</Text><TouchableOpacity style={styles.closeScanner} onPress={() => setShowScanner(false)}><X color="#FFF" size={32} /></TouchableOpacity></View></View></Modal>
      <Modal visible={showPrintPreview} transparent animationType="fade">
        <View style={styles.previewOverlay}>
          <View style={styles.previewContent}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>Label Preview</Text>
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
            <TouchableOpacity 
                style={[styles.primaryButton, { backgroundColor: '#17a34a', marginBottom: 0, height: 56 }]}
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
            )}
          </View>
        </View>
      </Modal>

      {/* List Print Preview Modal */}
      <Modal visible={showListPrintPreview} transparent animationType="fade">
        <View style={styles.previewOverlay}>
          <View style={styles.previewContent}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>Label Preview</Text>
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
                    {selectedLogForPrint?.sub_line 
                      ? (selectedLogForPrint.sub_line.includes('Washing')
                          ? `Washing-L${selectedLogForPrint.sub_line.replace('Washing ', '')}`
                          : `Crusher-${selectedLogForPrint.sub_line}`)
                      : 'Crusher'}
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

            {/* PRINT Button */}
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
                  <Text style={[styles.primaryButtonText, { fontSize: 18, fontWeight: '700' }]}>Print Label</Text>
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
    flexDirection: 'column', 
    alignItems: 'flex-end', 
    gap: 6,
    justifyContent: 'flex-start'
  },
  printIconButton: { 
    padding: 8, 
    borderRadius: 8, 
    backgroundColor: '#F0FDF4',
    alignSelf: 'flex-end'
  },
  logBadge: { 
    paddingHorizontal: 10, 
    paddingVertical: 4, 
    borderRadius: 12,
    alignSelf: 'flex-end'
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
  summaryContainer: { padding: 16 },
  summaryStatsCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginBottom: 24, elevation: 3 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 16 },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { alignItems: 'center', width: '48%' },
  summaryValue: { fontSize: 20, fontWeight: '700', color: '#17a34a' },
  summaryLabel: { fontSize: 12, color: '#666', marginTop: 4 },
  byProductRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#EEE' },
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
