import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Image,
  Platform,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  Download,
  PauseCircle,
} from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { productionLineTitleKeyFromRole } from "../utils/productionLine";
import { useAuth } from "../navigation/AuthContext";
import { productionApi, masterDataApi } from "../api/production";
import {
  shareProductionLogsAsXlsx,
  type LogsAllGrouped,
} from "../utils/shareProductionLogsXlsx";
import { Station, ProductionLog, Shift } from "../types";

/**
 * True for extrusion / PE extruder / PET Boretech row.
 * DB seed uses name "Extrusion" + code EXT; some envs use "Extrusion & Packaging".
 */
function isExtrusionPackagingStation(s: Station | null | undefined): boolean {
  if (!s) return false;
  const code = String((s as any).code || "").toUpperCase();
  if (code === "EXT" || code === "EXTR") return true;
  const n = (s.name || "").trim().toLowerCase();
  return (
    n === "extrusion" ||
    n.includes("extrusion & packaging") ||
    n.includes("boretech") ||
    n.includes("extruder")
  );
}

/** Pellet Packing (PLT) — final station after Final Packaging; inputs = PKG + EXT outputs. */
function isPelletPackingStation(s: Station | null | undefined): boolean {
  if (!s) return false;
  const code = String((s as any).code || "").toUpperCase();
  if (code === "PLT") return true;
  const n = (s.name || "").trim().toLowerCase();
  return n.includes("pellet pack");
}

/**
 * PET Starlinger (pellets) — not Boretech. Includes legacy DB name "Re-Packaging" when it is the Starlinger step
 * before a separate Final Packaging station.
 */
/** True when this row is the PET Starlinger step (DB name or UI-only row below Boretech). */
function isPetStarlingerLine(s: Station | null | undefined): boolean {
  if (!s || isExtrusionPackagingStation(s)) return false;
  if ((s as any).petUiSegment === "starlinger") return true;
  const display = String((s as any).displayName || "").toLowerCase();
  if (display.includes("starlinger")) return true;
  const n = (s.name || "").toLowerCase();
  return n.includes("starlinger") || n.includes("re-packaging");
}

/**
 * PET Final packing — after Starlinger. Excludes Boretech and Starlinger / Re-Packaging rows.
 */
function isPetFinalPackingLine(s: Station | null | undefined): boolean {
  if (!s || isExtrusionPackagingStation(s)) return false;
  // Pellet Packing (PLT) is its own final station — name contains "packing" but it is NOT the PET Final Packing line.
  if (
    String((s as any).code || "").toUpperCase() === "PLT" ||
    (s.name || "").toLowerCase().includes("pellet")
  )
    return false;
  if ((s as any).petUiSegment === "starlinger") return false;
  const n = (s.name || "").toLowerCase();
  if (n.includes("starlinger") || n.includes("re-packaging")) return false;
  const code = String((s as any).code || "").toUpperCase();
  if (code === "PKG" || code === "FP" || code === "FIN" || code === "PACK")
    return true;
  return (
    s.id === 5 ||
    (n.includes("final") && !n.includes("extrusion")) ||
    (n.includes("packing") && !n.includes("re-pack"))
  );
}

/** PET: station card / shift summary — Boretech counts only Flakes PET outputs (not Processing input rows). */
function petLogMatchesStationDisplay(
  l: { station_id?: number; sub_line?: string | null },
  station: Station,
): boolean {
  if (l.station_id !== station.id) return false;
  if (isExtrusionPackagingStation(station)) {
    return l.sub_line === "Flakes PET";
  }
  if (isPetStarlingerLine(station)) {
    return l.sub_line === "Pellet PET";
  }
  if (isPetFinalPackingLine(station)) {
    return l.sub_line === "Final PET";
  }
  return true;
}

/** Legacy: any PET post-Boretech station (Starlinger or Final packing). */
function isPetStarlingerOrFinalStation(s: Station | null | undefined): boolean {
  return isPetStarlingerLine(s) || isPetFinalPackingLine(s);
}

/**
 * Station id whose outputs are Pellet PET (Starlinger). When there is no DB row named Starlinger/Re-Packaging,
 * pellets use the same station as Final Packing — this returns that id so search/API still work.
 */
function getPetStarlingerBackendStationId(
  stationList: Station[] | null | undefined,
): number | undefined {
  if (!stationList?.length) return undefined;
  const explicit = stationList.find((s) => {
    if (isExtrusionPackagingStation(s)) return false;
    const n = (s.name || "").toLowerCase();
    return n.includes("starlinger") || n.includes("re-packaging");
  });
  if (explicit) return explicit.id;
  const fin = stationList.find((s) => isPetFinalPackingLine(s));
  return fin?.id;
}

/** CRS/WSH lookup: code match is case-insensitive (API may return "crs"); avoids falling back to wrong numeric id. */
function findStationIdByCode(
  stationList: Station[] | null | undefined,
  code: string,
  nameHint?: string,
): number | undefined {
  if (!stationList?.length) return undefined;
  const want = String(code || "")
    .toUpperCase()
    .trim();
  const byCode = stationList.find(
    (s) =>
      String((s as any).code || "")
        .toUpperCase()
        .trim() === want,
  );
  if (byCode) return byCode.id;
  if (nameHint) {
    const h = nameHint.toLowerCase();
    const byName = stationList.find((s) =>
      (s.name || "").toLowerCase().includes(h),
    );
    if (byName) return byName.id;
  }
  return undefined;
}

/** Compare shift log rows to station/shift/material without === pitfalls (string ids, bigint). */
function shiftLogMatchesStationShiftMaterial(
  l: any,
  stationId: number | undefined,
  shiftId: number | null | undefined,
  materialTypeId?: number | null,
): boolean {
  if (stationId == null) return false;
  if (Number(l.station_id) !== Number(stationId)) return false;
  if (shiftId != null && Number(l.shift_id) !== Number(shiftId)) return false;
  if (
    materialTypeId != null &&
    l.material_type_id != null &&
    Number(l.material_type_id) !== Number(materialTypeId)
  ) {
    return false;
  }
  return true;
}

/** PET Crusher Rapid outputs: DB sub_line is usually "Rapid"; include "CRP" if stored from QR/station code. */
const PET_CRUSHER_RAPID_INPUT_SUB_LINES = ["Rapid", "CRP"];

import { CameraView, Camera } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import QRCode from "react-native-qrcode-svg";
import StationDatePicker from "../components/StationDatePicker";

import { printService } from "../utils/print";
import { t } from "../utils/i18n";

/** Format date as YYYY-MM-DD in local timezone (avoids toISOString UTC shift). */
function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Restrict typing to digits + one decimal; must contain at least one digit (rejects "....", ".", etc.). */
function filterNumericWeight(text: string): string {
  if (text === "") return "";
  const invalidRemoved = text.replace(/[^0-9.]/g, "");
  const dotIndex = invalidRemoved.indexOf(".");
  const merged =
    dotIndex === -1
      ? invalidRemoved
      : invalidRemoved.slice(0, dotIndex + 1) +
        invalidRemoved.slice(dotIndex + 1).replace(/\./g, "");
  if (!/\d/.test(merged)) return "";
  return merged;
}

/** True when the field is a positive finite weight in kg (for Generate QR / save). */
function isValidProductionWeightInput(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0;
}

/** Label / reprint: hide invalid stored weights. */
function formatWeightKgDisplay(w: unknown): string {
  if (w === null || w === undefined) return "—";
  const n = typeof w === "number" ? w : parseFloat(String(w).trim());
  if (!Number.isFinite(n) || n < 0) return "—";
  return String(n);
}

/** Label preview/readability: normalize separators so station names don't visually collapse. */
function formatStationLabelDisplay(station: unknown): string {
  const text = String(station ?? "").trim();
  if (!text) return "N/A";
  return text.replace(/\s*-\s*/g, " - ").replace(/\s{2,}/g, " ");
}

/**
 * Label preview/print station line: keep compact hyphens (e.g. Crusher-Flakes PE 1).
 * Does not insert spaces around hyphens — matches operator reference labels.
 */
function formatCompactStationLabel(station: unknown): string {
  const text = String(station ?? "").trim();
  if (!text) return "N/A";
  return text.replace(/\s{2,}/g, " ");
}

/** PE Crusher flakes output → label station text (e.g. Crusher-Flakes PE 1). */
function peCrusherCompactStationLabel(
  stationName: string,
  outputOrSubLine: string,
): string | null {
  const sn = String(stationName || "").trim() || "Crusher";
  const sl = String(outputOrSubLine || "").trim();
  if (!sl) return null;
  const lower = sl.toLowerCase();
  if (lower === "flakes pe super" || sl === "FPS")
    return `${sn}-Flakes PE Super`;
  if (lower === "flakes pe 1" || sl === "FP1") return `${sn}-Flakes PE 1`;
  if (lower === "flakes eva super" || sl === "FES")
    return `${sn}-Flakes EVA Super`;
  if (lower === "flakes eva 1" || sl === "FE1") return `${sn}-Flakes EVA 1`;
  return null;
}

/**
 * List reprint: same station string as first-print preview (`next-qr` details.stationName).
 * Uses production_logs.station_id + sub_line (human labels and short codes). See production.js /next-qr.
 */
function getReprintStationDisplayName(
  log: any,
  stations: Station[] | null | undefined,
): string {
  const slRaw = String(log?.sub_line ?? "").trim();
  const slLower = slRaw.toLowerCase();
  const st = (stations || []).find(
    (s) => Number(s.id) === Number(log?.station_id),
  );
  const stationName = (st?.name || "").trim() || "Crusher";
  const code = String((st as any)?.code || "").toUpperCase();
  const n = stationName.toLowerCase();

  const isCrusher = code === "CRS" || n.includes("crusher");
  const isWashing = code === "WSH" || n.includes("washing");
  const isExtrusion =
    code === "EXT" ||
    code === "EXTR" ||
    n.includes("extrusion") ||
    n.includes("boretech");
  const isPkg = code === "PKG";

  if (isCrusher) {
    if (slRaw === "3E") return `${stationName}-3E`;
    if (slRaw === "Rapid" || slRaw === "CRP") return `${stationName}-Rapid`;
    if (slRaw === "Betty") return `${stationName}-Betty`;
    {
      const peCompact = peCrusherCompactStationLabel(stationName, slRaw);
      if (peCompact) return peCompact;
    }
    if (slRaw) return formatStationLabelDisplay(`${stationName}-${slRaw}`);
    return stationName;
  }

  if (isWashing) {
    if (slRaw === "Washing 1") return `${stationName}-W1`;
    if (slRaw === "Washing 2") return `${stationName}-W2`;
    if (slRaw === "Washing 3") return `${stationName}-W3`;
    if (slRaw.toLowerCase().includes("washing")) {
      const num = slRaw.replace(/Washing\s*/i, "").trim();
      return `${stationName}-W${num}`;
    }
    if (slRaw) return formatStationLabelDisplay(`${stationName}-${slRaw}`);
    return stationName;
  }

  if (isExtrusion) {
    if (slRaw === "Extrusion 1") return `${stationName}-E1`;
    if (slRaw === "Extrusion 2") return `${stationName}-E2`;
    if (slRaw === "Extrusion 3") return `${stationName}-E3`;
    if (slRaw === "Mixture") return `${stationName}-MIX`;
    if (slLower === "pellet pe super" || slRaw === "PPS")
      return "Extruder-Pellet PE Super";
    if (slLower === "pellet pe 1" || slRaw === "PP1")
      return "Extruder-Pellet PE 1";
    if (slLower === "pellet eva super" || slRaw === "PES")
      return "Extruder-Pellet EVA Super";
    if (slLower === "pellet eva 1" || slRaw === "PV1")
      return "Extruder-Pellet EVA 1";
    if (slRaw === "Flakes PET") return "Boretech";
    if (slRaw) return formatStationLabelDisplay(`${stationName}-${slRaw}`);
    return stationName;
  }

  if (isPkg) {
    // Align with production.js /next-qr + first-print preview (handleLogProduction):
    // - Pellet PET / Final PET get fixed display strings; Final PET prefers UI displayName (PET splits PKG into two steps).
    // - Other PKG sub_lines (e.g. PE packaging line): next-qr leaves stationDisplayName as base station name only — do not append sub_line to Station on the label.
    if (slRaw === "Pellet PET") {
      const disp = String((st as any)?.displayName || "").trim();
      return disp || "Starlinger";
    }
    if (slRaw === "Final PET") {
      const disp = String((st as any)?.displayName || "").trim();
      return disp || stationName || "Final Packing";
    }
    return stationName || "Final Packaging";
  }

  if (!st) {
    if (slRaw === "Flakes PET") return "Boretech";
    if (slRaw === "Pellet PET") return "Starlinger";
    if (slRaw === "Final PET") return "Final Packing";
    if (slRaw.includes("Washing"))
      return `Washing - W${slRaw.replace(/Washing\s*/i, "").trim()}`;
    if (slRaw.includes("Extrusion"))
      return `Extrusion - E${slRaw.replace("Extrusion ", "").trim()}`;
    if (slRaw === "Mixture") return "Extrusion - MIX";
    if (slRaw) return formatStationLabelDisplay(`Crusher - ${slRaw}`);
    return "Crusher";
  }

  if (slRaw) return formatStationLabelDisplay(`${stationName}-${slRaw}`);
  return stationName || "N/A";
}

/** Parse YYYY-MM-DD to Date at local noon (avoids timezone edge cases). */
function parseDateLocal(s: string): Date {
  return new Date(s + "T12:00:00");
}

/** Return total minutes from midnight. Handles "HH:MM" and "HH:MM:SS". */
function toMinutes(time: string): number {
  const parts = String(time || "")
    .trim()
    .split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

/** Current time in minutes from midnight (device local time). */
function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** True if the shift has already ended (previous/closed). Normal shifts only; overnight in [end,start) is not "previous". */
function isShiftPrevious(shift: Shift): boolean {
  const cur = nowMinutes();
  const start = toMinutes(shift.start_time);
  const end = toMinutes(shift.end_time);
  if (start < end) return cur >= end;
  return false;
}

/**
 * Build a professional, filesystem-safe basename for the Excel export.
 * Pattern: "Greencore_Production_Logs_<YYYY-MM-DD>[_<Shift>][_<Operator>]"
 * Example: "Greencore_Production_Logs_2026-05-05_Shift1_JohnDoe"
 *
 * Sanitization rules:
 *   - whitespace and dots collapse to "_"
 *   - characters illegal on common filesystems are stripped: \ / : * ? " < > |
 *   - any remaining char outside [A-Za-z0-9_-] is dropped
 *   - operator and shift segments are length-capped
 */
function buildExportFilenameBase(args: {
  date: string;
  dateEnd?: string | null;
  stationLabel?: string | null;
  operatorLabel?: string | null;
  shiftName?: string | null;
  operatorName?: string | null;
}): string {
  const sanitize = (raw: string, maxLen: number): string =>
    raw
      .trim()
      // Normalize so "María" becomes "María" → "Maria" after diacritic strip
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // combining diacritical marks
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[\s.]+/g, "_")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .replace(/_+/g, "_")
      .replace(/-+/g, "-")
      .replace(/^[_-]+|[_-]+$/g, "")
      .slice(0, maxLen);

  const parts: string[] = ["Greencore_Production_Logs"];

  const safeDate = sanitize(args.date, 10) || "Unknown_Date";
  parts.push(safeDate);

  if (args.dateEnd && args.dateEnd !== args.date) {
    const safeEnd = sanitize(args.dateEnd, 10);
    if (safeEnd) parts.push("to", safeEnd);
  }
  if (args.stationLabel) {
    const safeStation = sanitize(args.stationLabel, 24);
    if (safeStation) parts.push(safeStation);
  }
  if (args.operatorLabel) {
    const safeOperator = sanitize(args.operatorLabel, 24);
    if (safeOperator) parts.push(safeOperator);
  }
  if (args.shiftName) {
    const safeShift = sanitize(args.shiftName, 20);
    if (safeShift) parts.push(safeShift);
  }
  if (args.operatorName) {
    const safeOp = sanitize(args.operatorName, 40);
    if (safeOp) parts.push(safeOp);
  }

  return parts.join("_");
}

const DashboardScreen = ({ navigation }: any) => {
  const { user, logout, selectedShift, setSelectedShift } = useAuth();

  // PE (Polyethylene) material flow — separate from PC, does not affect PC logic
  const isPE = user?.role?.toLowerCase() === "pe";

  // PET (Polyethylene Terephthalate) material flow — separate from PC and PE
  const isPET = user?.role?.toLowerCase() === "pet";

  const isPPIC = user?.role?.toLowerCase() === "ppic";

  /**
   * Roles allowed to edit a log regardless of its status. PPIC has always had
   * this privilege; PE is now included so PE users can correct entries even
   * after they move to "completed".
   */
  const canEditAnyStatus = isPPIC || isPE;

  /** Output type options for a given PE raw-material sub-line */
  const getPeOutputOptions = (subLine: string): string[] => {
    if (subLine === "PE SUPER") return ["Flakes PE SUPER", "Flakes PE 1"];
    if (subLine === "PE 1") return ["Flakes PE 1"];
    if (subLine === "EVA SUPER") return ["Flakes EVA SUPER", "Flakes EVA 1"];
    if (subLine === "EVA 1") return ["Flakes EVA 1"];
    return [];
  };

  /** Short code used in QR generation for PE output types */
  const getPeOutputCode = (outputType: string): string => {
    const map: Record<string, string> = {
      "Flakes PE SUPER": "FPS",
      "Flakes PE 1": "FP1",
      "Flakes EVA SUPER": "FES",
      "Flakes EVA 1": "FE1",
      "Pellet PE SUPER": "PPS",
      "Pellet PE 1": "PP1",
      "Pellet EVA SUPER": "PES",
      "Pellet EVA 1": "PV1",
    };
    return map[outputType] || "PE";
  };

  /**
   * Primary flakes input label for each PE extruder product line.
   * Additional materials are always logged as 0 (weighed at shift-end by PPIC).
   */
  const PE_EXTRUDER_PRIMARY: Record<string, string> = {
    "Pellet PE SUPER": "Flakes PE SUPER",
    "Pellet PE 1": "Flakes PE 1",
    "Pellet EVA SUPER": "Flakes EVA SUPER",
    "Pellet EVA 1": "Flakes EVA 1",
  };

  /** Additional (unmeasured) materials per product line — shown as 0 in app */
  const PE_EXTRUDER_ADDITIONAL: Record<string, string[]> = {
    "Pellet PE SUPER": [
      "Flakes PE 1",
      "Flakes EVA SUPER",
      "Flakes EVA 1",
      "Pellet PE 1",
      "Pellet EVA 1",
    ],
    "Pellet PE 1": [],
    "Pellet EVA SUPER": [
      "Flakes PE SUPER",
      "Flakes PE 1",
      "Flakes EVA 1",
      "Pellet PE 1",
      "Pellet EVA 1",
    ],
    "Pellet EVA 1": [],
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
  // Prevent stale async shift-load responses from overriding the current selected shift.
  const shiftLoadRequestRef = React.useRef(0);
  const selectedShiftIdRef = React.useRef<number | null>(null);
  const closeShiftInProgressRef = React.useRef(false);
  const [shiftDuration, setShiftDuration] = useState("0h 00m 00s");
  // True when shift is closed — blocks all input/output creation
  const isShiftEnded = shiftEndedAt !== null;
  const [backendShiftId, setBackendShiftId] = useState<number | null>(null);
  const [shiftLogs, setShiftLogs] = useState<ProductionLog[]>([]);

  // Selection State
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [selectedSection, setSelectedSection] = useState<
    "input" | "output" | "hold" | null
  >(null);
  /** PET only: chosen after Start Shift — drives station list + Close Shift by-product rows */
  const [showStationModal, setShowStationModal] = useState(false);
  const [pendingStation, setPendingStation] = useState<Station | null>(null);
  const [pendingWashingLine, setPendingWashingLine] = useState<
    "Washing 1" | "Washing 2" | "Washing 3" | null
  >(null);
  const [showWashingModal, setShowWashingModal] = useState(false);
  const [pendingExtrusionLine, setPendingExtrusionLine] = useState<
    "Extrusion 1" | "Extrusion 2" | "Extrusion 3" | "Mixture" | null
  >(null);
  const [showExtrusionModal, setShowExtrusionModal] = useState(false);

  // Input/Output State
  const [weightInput, setWeightInput] = useState("");
  const [bagSearchQuery, setBagSearchQuery] = useState("");
  const [suggestedBags, setSuggestedBags] = useState<any[]>([]);
  const [selectedInputBag, setSelectedInputBag] = useState<any>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isCurrentLogSaved, setIsCurrentLogSaved] = useState(false);
  const [selectedSubLine, setSelectedSubLine] = useState<
    | "3E"
    | "Rapid"
    | "Betty"
    | "Washing 1"
    | "Washing 2"
    | "Washing 3"
    | "Extrusion 1"
    | "Extrusion 2"
    | "Extrusion 3"
    | "Mixture"
    | "PE SUPER"
    | "PE 1"
    | "EVA SUPER"
    | "EVA 1"
    | "Pellet PE SUPER"
    | "Pellet PE 1"
    | "Pellet EVA SUPER"
    | "Pellet EVA 1"
    | "Flakes PET"
    | "Pellet PET"
    | "Final PET"
    | null
  >(null);
  /** PE only: selected output type (e.g. 'Flakes PE SUPER') for Crusher-Washing station */
  const [peOutputType, setPeOutputType] = useState<string | null>(null);
  /** PE Crusher-Washing: search and filter for raw material list */
  const [peRawMaterialSearch, setPeRawMaterialSearch] = useState("");
  const [peRawMaterialFilter, setPeRawMaterialFilter] = useState<
    "all" | "PE" | "EVA"
  >("all");
  /** PE Crusher-Washing: Recent Entries list (like PC Crusher) */
  const [peCrusherLogs, setPeCrusherLogs] = useState<any[]>([]);
  const [peCrusherLogsLoading, setPeCrusherLogsLoading] = useState(false);
  const [peCrusherSelectedDate, setPeCrusherSelectedDate] = useState(
    formatDateLocal(new Date()),
  );
  const [peCrusherSearchQuery, setPeCrusherSearchQuery] = useState("");
  const [peCrusherLineFilter, setPeCrusherLineFilter] = useState<string>("all");
  const [peCrusherStatusFilter, setPeCrusherStatusFilter] =
    useState<string>("all");
  const [peCrusherCurrentPage, setPeCrusherCurrentPage] = useState(1);
  const [peCrusherTotalPages, setPeCrusherTotalPages] = useState(1);
  const [peCrusherTotalLogs, setPeCrusherTotalLogs] = useState(0);
  /** PE Extrusion & Packaging: Recent Entries list */
  const [peExtrusionLogs, setPeExtrusionLogs] = useState<any[]>([]);
  const [peExtrusionLogsLoading, setPeExtrusionLogsLoading] = useState(false);
  const [peExtrusionSelectedDate, setPeExtrusionSelectedDate] = useState(
    formatDateLocal(new Date()),
  );
  const [peExtrusionSearchQuery, setPeExtrusionSearchQuery] = useState("");
  const [peExtrusionLineFilter, setPeExtrusionLineFilter] =
    useState<string>("all");
  const [peExtrusionStatusFilter, setPeExtrusionStatusFilter] =
    useState<string>("all");
  const [peExtrusionCurrentPage, setPeExtrusionCurrentPage] = useState(1);
  const [peExtrusionTotalPages, setPeExtrusionTotalPages] = useState(1);
  const [peExtrusionTotalLogs, setPeExtrusionTotalLogs] = useState(0);
  const [currentViewBags, setCurrentViewBags] = useState(0);
  const [currentViewWeight, setCurrentViewWeight] = useState(0);

  // PET Boretech logs list state
  const [petBoretechLogs, setPetBoretechLogs] = useState<any[]>([]);
  const [petBoretechLogsLoading, setPetBoretechLogsLoading] = useState(false);
  const [petBoretechSelectedDate, setPetBoretechSelectedDate] = useState(
    formatDateLocal(new Date()),
  );
  const [petBoretechSearchQuery, setPetBoretechSearchQuery] = useState("");
  const [petBoretechStatusFilter, setPetBoretechStatusFilter] =
    useState<string>("all");
  const [petBoretechCurrentPage, setPetBoretechCurrentPage] = useState(1);
  const [petBoretechTotalPages, setPetBoretechTotalPages] = useState(1);
  const [petBoretechTotalLogs, setPetBoretechTotalLogs] = useState(0);
  // PET Starlinger logs list state
  const [petStarlingerLogs, setPetStarlingerLogs] = useState<any[]>([]);
  const [petStarlingerLogsLoading, setPetStarlingerLogsLoading] =
    useState(false);
  const [petStarlingerSelectedDate, setPetStarlingerSelectedDate] = useState(
    formatDateLocal(new Date()),
  );
  const [petStarlingerSearchQuery, setPetStarlingerSearchQuery] = useState("");
  const [petStarlingerStatusFilter, setPetStarlingerStatusFilter] =
    useState<string>("all");
  const [petStarlingerCurrentPage, setPetStarlingerCurrentPage] = useState(1);
  const [petStarlingerTotalPages, setPetStarlingerTotalPages] = useState(1);
  const [petStarlingerTotalLogs, setPetStarlingerTotalLogs] = useState(0);
  // PET Final Packing logs (separate from Starlinger so list filters do not cross between stations)
  const [petFinalPackingLogs, setPetFinalPackingLogs] = useState<any[]>([]);
  const [petFinalPackingLogsLoading, setPetFinalPackingLogsLoading] =
    useState(false);
  const [petFinalPackingSelectedDate, setPetFinalPackingSelectedDate] =
    useState(formatDateLocal(new Date()));
  const [petFinalPackingSearchQuery, setPetFinalPackingSearchQuery] =
    useState("");
  const [petFinalPackingStatusFilter, setPetFinalPackingStatusFilter] =
    useState<string>("all");
  const [petFinalPackingCurrentPage, setPetFinalPackingCurrentPage] =
    useState(1);
  const [petFinalPackingTotalPages, setPetFinalPackingTotalPages] = useState(1);
  const [petFinalPackingTotalLogs, setPetFinalPackingTotalLogs] = useState(0);
  // Pellet Packing (PLT) reuses the Final Packing list state (packingLogs / packing* filters).

  // Crusher logs list state
  const [crusherLogs, setCrusherLogs] = useState<any[]>([]);
  const [crusherLogsLoading, setCrusherLogsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(formatDateLocal(new Date()));
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>("all"); // 'all', '3E', 'Rapid', 'Betty'
  const [selectedStatusFilter, setSelectedStatusFilter] =
    useState<string>("all"); // 'all', 'pending', 'Completed'
  const [showListPrintPreview, setShowListPrintPreview] = useState(false);
  const [selectedLogForPrint, setSelectedLogForPrint] = useState<any>(null);
  const [editingLogWeight, setEditingLogWeight] = useState<any>(null);

  // Crusher DN No. (Delivery Note) — set once, persists to all crusher outputs until updated
  const [crusherDnNo, setCrusherDnNo] = useState<string>("");
  const [crusherDnNoInput, setCrusherDnNoInput] = useState<string>("");
  const [scanningForDnNo, setScanningForDnNo] = useState(false);
  const [crusherDnId, setCrusherDnId] = useState<number | null>(null);
  const [crusherDnNetWeight, setCrusherDnNetWeight] = useState<number | null>(null);
  const [dnSearchQuery, setDnSearchQuery] = useState<string>("");
  const [dnSearchResults, setDnSearchResults] = useState<{ id: number; deliveryNote: string; netWeight: number }[]>([]);
  const [dnSearchLoading, setDnSearchLoading] = useState(false);
  const [dnDropdownVisible, setDnDropdownVisible] = useState(false);

  // PE Hold flow state ───────────────────────────────────────────────────────
  /** Hold creation modal — PE captures weight + remark for material set aside for QC reprocess */
  const [peHoldModalVisible, setPeHoldModalVisible] = useState(false);
  const [peHoldWeight, setPeHoldWeight] = useState("");
  const [peHoldRemark, setPeHoldRemark] = useState("");
  const [peHoldSubmitting, setPeHoldSubmitting] = useState(false);
  /** Resolve modal — PE reviews a held log; OK enters new (reduced) weight, NO marks reject */
  const [peResolvingLog, setPeResolvingLog] = useState<any>(null);
  const [peResolveWeight, setPeResolveWeight] = useState("");
  const [peResolveSubmitting, setPeResolveSubmitting] = useState(false);
  const [editWeightValue, setEditWeightValue] = useState("");
  /** PPIC: edited together with weight in the same modal */
  const [editRemarkValue, setEditRemarkValue] = useState("");

  // Washing logs list state
  const [washingLogs, setWashingLogs] = useState<any[]>([]);
  const [washingLogsLoading, setWashingLogsLoading] = useState(false);
  const [washingSelectedDate, setWashingSelectedDate] = useState(
    formatDateLocal(new Date()),
  );
  const [washingSearchQuery, setWashingSearchQuery] = useState("");
  const [washingCurrentPage, setWashingCurrentPage] = useState(1);
  const [washingTotalPages, setWashingTotalPages] = useState(1);
  const [washingTotalLogs, setWashingTotalLogs] = useState(0);
  const [washingSelectedLineFilter, setWashingSelectedLineFilter] =
    useState<string>("all"); // 'all', 'Washing 1', 'Washing 2', 'Washing 3'
  const [washingSelectedStatusFilter, setWashingSelectedStatusFilter] =
    useState<string>("all"); // 'all', 'pending', 'Completed'

  // Extrusion logs list state
  const [extrusionLogs, setExtrusionLogs] = useState<any[]>([]);
  const [extrusionLogsLoading, setExtrusionLogsLoading] = useState(false);
  const [extrusionSelectedDate, setExtrusionSelectedDate] = useState(
    formatDateLocal(new Date()),
  );
  const [extrusionSearchQuery, setExtrusionSearchQuery] = useState("");
  const [extrusionCurrentPage, setExtrusionCurrentPage] = useState(1);
  const [extrusionTotalPages, setExtrusionTotalPages] = useState(1);
  const [extrusionTotalLogs, setExtrusionTotalLogs] = useState(0);
  const [extrusionSelectedLineFilter, setExtrusionSelectedLineFilter] =
    useState<string>("all"); // 'all', 'Extrusion 1', 'Extrusion 2', 'Extrusion 3', 'Mixture'
  const [extrusionSelectedStatusFilter, setExtrusionSelectedStatusFilter] =
    useState<string>("all"); // 'all', 'pending', 'Completed'

  // Final Packing logs list state
  const [packingLogs, setPackingLogs] = useState<any[]>([]);
  const [packingLogsLoading, setPackingLogsLoading] = useState(false);
  const [packingSelectedDate, setPackingSelectedDate] = useState(
    formatDateLocal(new Date()),
  );
  const [packingSearchQuery, setPackingSearchQuery] = useState("");
  const [packingCurrentPage, setPackingCurrentPage] = useState(1);
  const [packingTotalPages, setPackingTotalPages] = useState(1);
  const [packingTotalLogs, setPackingTotalLogs] = useState(0);
  const [packingSelectedStatusFilter, setPackingSelectedStatusFilter] =
    useState<string>("all");

  // Scanner State
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Photo State
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [showCameraPreview, setShowCameraPreview] = useState(false);
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);
  const [tempCapturedImage, setTempCapturedImage] = useState<string | null>(
    null,
  );
  const cameraRef = React.useRef<any>(null);

  // Summary State
  const [showEndShiftSummary, setShowEndShiftSummary] = useState(false);
  const [byProductsInputs, setByProductsInputs] = useState<any[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Shift-closed view (editable by-products, regenerate PDF)
  const [showShiftClosedView, setShowShiftClosedView] = useState(false);
  const [closedShiftId, setClosedShiftId] = useState<number | null>(null);
  const [closedShiftByProducts, setClosedShiftByProducts] = useState<any[]>([]);
  const [closedShiftMeta, setClosedShiftMeta] = useState<{
    shift: string;
    operator: string;
    date: string;
    totalOutputs: number;
    totalWeight: string;
    remark?: string;
    materialTypeName?: string | null;
    byStation?: {
      crusher: { outputs: number; weight: string };
      washing: { outputs: number; weight: string };
      extrusion: { outputs: number; weight: string };
      pellet_packing?: { outputs: number; weight: string };
    };
  } | null>(null);
  const [closedByProductsLoading, setClosedByProductsLoading] = useState(false);
  const [editingByProductIndex, setEditingByProductIndex] = useState<
    number | null
  >(null);
  const [editByProductWeight, setEditByProductWeight] = useState("");
  const [closedShiftRemarkEdit, setClosedShiftRemarkEdit] = useState("");
  const [closedShiftLogs, setClosedShiftLogs] = useState<any[]>([]);
  const [closedShiftLogsLoading, setClosedShiftLogsLoading] = useState(false);
  // PPIC shift detail: search + per-category pagination (10 rows/page)
  const [shiftLogsSearch, setShiftLogsSearch] = useState("");
  const [shiftLogsPageCrusher, setShiftLogsPageCrusher] = useState(1);
  const [shiftLogsPageWashing, setShiftLogsPageWashing] = useState(1);
  const [shiftLogsPageExtrusion, setShiftLogsPageExtrusion] = useState(1);
  const [shiftLogsPageLabel, setShiftLogsPageLabel] = useState(1);
  const [shiftLogsPagePacking, setShiftLogsPagePacking] = useState(1);
  const [shiftLogsPagePelletPacking, setShiftLogsPagePelletPacking] =
    useState(1);
  const SHIFT_LOGS_PAGE_SIZE = 10;

  // PPIC: list and open saved end-shift reports
  const [showClosedReportsModal, setShowClosedReportsModal] = useState(false);
  const [closedShiftsList, setClosedShiftsList] = useState<any[]>([]);
  const [closedShiftsLoading, setClosedShiftsLoading] = useState(false);
  // PPIC home: date and shift selection (different homepage from PC production)
  const [ppicSelectedDate, setPpicSelectedDate] = useState(() =>
    formatDateLocal(new Date()),
  );
  const [ppicSelectedShiftId, setPpicSelectedShiftId] = useState<number | null>(
    null,
  ); // null = All
  const [ppicShifts, setPpicShifts] = useState<Shift[]>([]);
  // PPIC home: live active shifts
  const [ppicActiveShifts, setPpicActiveShifts] = useState<any[]>([]);
  const [ppicActiveShiftsLoading, setPpicActiveShiftsLoading] = useState(false);
  // Track whether the currently viewed closed/active shift is still live
  const [viewingActiveShift, setViewingActiveShift] = useState(false);

  // PPIC Station Overview
  const [ppicOverviewDate, setPpicOverviewDate] = useState(() =>
    formatDateLocal(new Date()),
  );
  const [ppicOverviewShiftId, setPpicOverviewShiftId] = useState<number | null>(
    null,
  );
  const [ppicOverviewData, setPpicOverviewData] = useState<any[]>([]);
  const [ppicOverviewLoading, setPpicOverviewLoading] = useState(false);
  const [ppicExpandedStation, setPpicExpandedStation] = useState<string | null>(
    null,
  );
  const [ppicOverviewSearch, setPpicOverviewSearch] = useState("");
  /** PPIC Station Overview: null = all materials (PC + PE + PET) */
  const [ppicOverviewMaterialType, setPpicOverviewMaterialType] = useState<
    string | null
  >(null);
  const [ppicMaterialOptions, setPpicMaterialOptions] = useState<string[]>([]);
  const [ppicExportingExcel, setPpicExportingExcel] = useState(false);
  // PPIC Export Report panel: operator + station + date-range filters
  const [ppicOperators, setPpicOperators] = useState<
    { id: number; name: string; material_type?: string }[]
  >([]);
  const [ppicExportOperatorId, setPpicExportOperatorId] =
    useState<string>("all");
  const [ppicExportStationCode, setPpicExportStationCode] =
    useState<string>("all");
  const [ppicExportDateStart, setPpicExportDateStart] = useState(() =>
    formatDateLocal(new Date()),
  );
  const [ppicExportDateEnd, setPpicExportDateEnd] = useState(() =>
    formatDateLocal(new Date()),
  );

  // Saved by-products on start shift page (editable after save)
  const [savedByProductsOnStartPage, setSavedByProductsOnStartPage] = useState<
    any[]
  >([]);
  const [savedByProductsMeta, setSavedByProductsMeta] = useState<{
    shift: string;
    operator: string;
    date: string;
    totalOutputs: number;
    totalWeight: string;
    remark?: string;
    materialTypeName?: string | null;
    byStation?: {
      crusher: { outputs: number; weight: string };
      washing: { outputs: number; weight: string };
      extrusion: { outputs: number; weight: string };
      pellet_packing?: { outputs: number; weight: string };
    };
  } | null>(null);
  const [endShiftRemark, setEndShiftRemark] = useState("");

  // Auto-close shift tracking
  const [autoCloseWarningShown, setAutoCloseWarningShown] = useState(false);

  // Printer & Preview State
  const [selectedPrinter, setSelectedPrinter] = useState<any>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [remarkInput, setRemarkInput] = useState("");
  const [previewBagStatus, setPreviewBagStatus] = useState<
    "pending" | "Completed"
  >("pending");
  const previewBagStatusRef = React.useRef<"pending" | "Completed">("pending");
  const dnSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref is set directly in status toggle and preview open/close handlers. Do NOT sync ref from state
  // here — a re-render with stale state can overwrite the ref to 'pending' after user chose 'Completed'.
  const [isPrinting, setIsPrinting] = useState(false);
  const qrRef = React.useRef<any>(null);
  const listQrRef = React.useRef<any>(null);

  /** Stable "today" for date picker max – avoids picker resetting when prop reference changes. */
  const maxDate = useMemo(() => new Date(), []);

  /** JUMBO/bag ID from API (supports snake_case and camelCase so web and native both show full ID). */
  const getBagDisplayId = (bag: any): string => {
    const qr = (bag?.output_bag_qr ??
      bag?.outputBagQr ??
      bag?.input_bag_qr ??
      bag?.inputBagQr ??
      "") as string;
    return typeof qr === "string" && qr.trim() !== "" ? qr.trim() : "—";
  };

  /** Normalize search result bags so QR is always in output_bag_qr/outputBagQr for dropdown display. */
  const normalizeSuggestedBags = (bags: any[]): any[] =>
    (bags || []).map((b: any) => {
      const qr =
        b?.output_bag_qr ??
        b?.outputBagQr ??
        b?.input_bag_qr ??
        b?.inputBagQr ??
        "";
      const qrStr =
        typeof qr === "string" ? qr.trim() : String(qr || "").trim();
      return {
        ...b,
        output_bag_qr:
          qrStr ||
          (b?.output_bag_qr ??
            b?.outputBagQr ??
            b?.input_bag_qr ??
            b?.inputBagQr),
        outputBagQr:
          qrStr ||
          (b?.outputBagQr ??
            b?.output_bag_qr ??
            b?.inputBagQr ??
            b?.input_bag_qr),
      };
    });

  /** PET Boretech: merge pending bags from Crusher (Rapid) then Washing; dedupe by output QR; tag source for UI. */
  const mergePetBoretechInputRows = (
    crushRows: any[],
    washRows: any[],
  ): any[] => {
    const seen = new Set<string>();
    const out: any[] = [];
    const push = (rows: any[] | undefined, upstream: "Crusher" | "Washing") => {
      for (const b of rows || []) {
        const qr = String(b?.output_bag_qr ?? b?.outputBagQr ?? "").trim();
        if (!qr || seen.has(qr)) continue;
        seen.add(qr);
        out.push({ ...b, pet_upstream_source: upstream });
      }
    };
    push(crushRows, "Crusher");
    push(washRows, "Washing");
    return out;
  };

  /** PET Final Packing: merge pending Flakes PET (Boretech) + Pellet PET (Starlinger); dedupe by output QR. */
  const mergePetFinalPackingInputRows = (
    boretechRows: any[],
    starlingerRows: any[],
  ): any[] => {
    const seen = new Set<string>();
    const out: any[] = [];
    const push = (
      rows: any[] | undefined,
      upstream: "Boretech" | "Starlinger",
    ) => {
      for (const b of rows || []) {
        const qr = String(b?.output_bag_qr ?? b?.outputBagQr ?? "").trim();
        if (!qr || seen.has(qr)) continue;
        seen.add(qr);
        out.push({ ...b, pet_upstream_source: upstream });
      }
    };
    push(boretechRows, "Boretech");
    push(starlingerRows, "Starlinger");
    return out;
  };

  /** Pellet Packing: merge pending Final Packaging (PKG) + pending Extrusion (EXT) bags; dedupe by output QR. */
  const mergePelletPackingInputRows = (
    pkgRows: any[],
    extRows: any[],
  ): any[] => {
    const seen = new Set<string>();
    const out: any[] = [];
    const push = (
      rows: any[] | undefined,
      upstream: "Final Packing" | "Extrusion",
    ) => {
      for (const b of rows || []) {
        const qr = String(b?.output_bag_qr ?? b?.outputBagQr ?? "").trim();
        if (!qr || seen.has(qr)) continue;
        seen.add(qr);
        out.push({ ...b, pet_upstream_source: upstream });
      }
    };
    push(pkgRows, "Final Packing");
    push(extRows, "Extrusion");
    return out;
  };

  // Initial Load
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");

      const savedPrinter = await printService.getSavedPrinter();
      if (savedPrinter) setSelectedPrinter(savedPrinter);

      const savedDnNo = await AsyncStorage.getItem("crusher_dn_no");
      if (savedDnNo) {
        setCrusherDnNo(savedDnNo);
        setCrusherDnNoInput(savedDnNo);
        setDnSearchQuery(savedDnNo);
      }
      const savedDnId = await AsyncStorage.getItem("crusher_dn_id");
      if (savedDnId) setCrusherDnId(Number(savedDnId));
      const savedDnNetWeight = await AsyncStorage.getItem("crusher_dn_net_weight");
      if (savedDnNetWeight) setCrusherDnNetWeight(Number(savedDnNetWeight));
    })();
  }, []);

  const handleSelectPrinter = async () => {
    const result: any = await printService.selectPrinter();
    if (result) {
      setSelectedPrinter(result);
      await AsyncStorage.setItem("selected_printer", JSON.stringify(result));
    }
  };

  useFocusEffect(
    useCallback(() => {
      selectedShiftIdRef.current = selectedShift?.id ?? null;
      loadShiftState();
      loadStations();
    }, [selectedShift?.id, isPE, isPET]),
  );

  // PPIC: load shift types for date/shift selector on home
  useEffect(() => {
    if (user?.role?.toLowerCase() !== "ppic") return;
    (async () => {
      try {
        const [shiftsRes, materialsRes] = await Promise.all([
          masterDataApi.getShifts(),
          productionApi.getMaterials(),
        ]);
        if (shiftsRes.data?.success && Array.isArray(shiftsRes.data.data))
          setPpicShifts(shiftsRes.data.data);
        if (materialsRes.data?.success && Array.isArray(materialsRes.data.data)) {
          const names = materialsRes.data.data
            .map((m: { name?: string }) => (m.name || "").trim())
            .filter(Boolean);
          setPpicMaterialOptions(names);
        } else {
          setPpicMaterialOptions([]);
        }
      } catch (e) {
        setPpicShifts([]);
        setPpicMaterialOptions([]);
      }
    })();
  }, [user?.role]);

  // PPIC: load production operators (for the Export Report operator filter)
  useEffect(() => {
    if (user?.role?.toLowerCase() !== "ppic") return;
    (async () => {
      try {
        const res = await productionApi.getProductionOperators();
        if (res.data?.success && Array.isArray(res.data.data)) {
          setPpicOperators(res.data.data);
        } else {
          setPpicOperators([]);
        }
      } catch {
        setPpicOperators([]);
      }
    })();
  }, [user?.role]);

  // PPIC: load currently running (active) shifts on focus
  const loadPpicActiveShifts = async () => {
    if (user?.role?.toLowerCase() !== "ppic") return;
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

  const loadPpicOverview = async (
    date?: string,
    shiftTypeId?: number | null,
  ) => {
    if (user?.role?.toLowerCase() !== "ppic") return;
    setPpicOverviewLoading(true);
    try {
      const res = await productionApi.getPpicStationOverview(
        date ?? ppicOverviewDate,
        shiftTypeId !== undefined ? shiftTypeId : ppicOverviewShiftId,
        ppicOverviewMaterialType,
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

  /**
   * Export transactions to Excel. Open to every logged-in role.
   * - When called from the PPIC home screen, pass `{ date, shiftName }` so the
   *   export honors the date / shift filter selected in Station Overview.
   * - When called from anywhere else (header button on operator/admin views),
   *   omit the args — defaults to today's date and no shift filter (full day).
   */
  const exportTransactionsExcel = async (opts?: {
    date?: string;
    dateStart?: string;
    dateEnd?: string;
    shiftName?: string;
    stationCode?: string;
    stationLabel?: string;
    operatorId?: string;
    operatorLabel?: string;
  }) => {
    if (!user) return;
    setPpicExportingExcel(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const exportStart = opts?.dateStart ?? opts?.date ?? today;
      const exportEnd = opts?.dateEnd ?? opts?.date ?? exportStart;
      const shiftName = opts?.shiftName;
      const stationCode =
        opts?.stationCode && opts.stationCode !== "all"
          ? opts.stationCode
          : undefined;
      const operatorId =
        opts?.operatorId && opts.operatorId !== "all"
          ? opts.operatorId
          : undefined;
      const res = await productionApi.getLogsAll({
        date_start: exportStart,
        date_end: exportEnd,
        ...(shiftName ? { shift_type: shiftName } : {}),
        ...(stationCode ? { station_code: stationCode } : {}),
        ...(operatorId ? { operator_id: operatorId } : {}),
        limit: 25000,
      });
      const payload = res.data as
        | { success?: boolean; data?: LogsAllGrouped; total?: number }
        | undefined;
      if (!payload?.success || !payload.data) {
        const apiMsg =
          res.data &&
          typeof (res.data as { message?: unknown }).message === "string"
            ? (res.data as { message: string }).message
            : null;
        Alert.alert(
          t("common.error"),
          apiMsg || t("messages.exportExcelFailed"),
        );
        return;
      }
      const grouped = payload.data;
      let rowCount = 0;
      for (const st of Object.values(grouped)) {
        for (const sl of Object.values(st.subLines)) {
          rowCount += sl.logs.length;
        }
      }
      if (rowCount === 0) {
        Alert.alert(t("common.error"), t("messages.exportExcelNoData"));
        return;
      }
      const { format } = await shareProductionLogsAsXlsx(
        grouped,
        buildExportFilenameBase({
          date: exportStart,
          dateEnd: exportEnd,
          stationLabel: opts?.stationLabel ?? null,
          operatorLabel: opts?.operatorLabel ?? null,
          shiftName,
          operatorName: user?.name ?? null,
        }),
      );
      const successNotes: string[] = [];
      if (format === "csv") {
        successNotes.push(t("messages.exportExcelCsvFallback"));
      }
      if ((payload.total ?? 0) >= 25000) {
        successNotes.push(t("messages.exportExcelRowLimit"));
      }
      if (successNotes.length > 0) {
        Alert.alert(t("common.success"), successNotes.join("\n\n"));
      }
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      Alert.alert(
        t("common.error"),
        `${t("messages.exportExcelFailed")}\n\n${detail}`,
      );
    } finally {
      setPpicExportingExcel(false);
    }
  };

  /** Backwards-compat wrapper used by the PPIC Station Overview button. */
  const exportPpicTransactionsExcel = () =>
    exportTransactionsExcel({
      date: ppicOverviewDate,
      shiftName:
        ppicOverviewShiftId == null
          ? undefined
          : ppicShifts.find((s) => s.id === ppicOverviewShiftId)?.name,
    });

  /** PPIC Export Report panel: export by selected station + date range. */
  const exportPpicByFilters = () => {
    if (ppicExportDateStart > ppicExportDateEnd) {
      Alert.alert(
        t("common.error"),
        "Start date must be on or before the end date.",
      );
      return;
    }
    const stationLabel =
      ppicExportStationCode === "all"
        ? "All_Stations"
        : ((stations.find(
            (s) =>
              String((s as any).code || "").toUpperCase() ===
              ppicExportStationCode,
          )?.name as string) ?? ppicExportStationCode);
    const operatorLabel =
      ppicExportOperatorId === "all"
        ? undefined
        : (ppicOperators.find((o) => String(o.id) === ppicExportOperatorId)
            ?.name ?? ppicExportOperatorId);
    exportTransactionsExcel({
      dateStart: ppicExportDateStart,
      dateEnd: ppicExportDateEnd,
      stationCode: ppicExportStationCode,
      stationLabel,
      operatorId: ppicExportOperatorId,
      operatorLabel,
    });
  };

  useFocusEffect(
    useCallback(() => {
      loadPpicActiveShifts();
    }, [user?.role]),
  );
  useFocusEffect(
    useCallback(() => {
      if (user?.role?.toLowerCase() !== "ppic") return;
      setShowClosedReportsModal(false);
      loadPpicOverview(
        ppicOverviewDate,
        ppicOverviewShiftId,
        ppicOverviewMaterialType,
      );
      loadPpicClosedShiftsList(
        ppicSelectedDate,
        ppicSelectedShiftId,
        ppicOverviewMaterialType,
      );
    }, [user?.role]),
  );

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
        totalWeight: d.totalWeight ?? "0.0",
        byStation: d.byStation ?? undefined,
        remark: d.remark,
        materialTypeName: d.materialTypeName ?? null,
      });
      setClosedShiftRemarkEdit(d.remark ?? "");
      const saved = (d.byProducts || []).map((p: any) => ({
        name: p.name,
        stationName: p.stationName ?? "",
        category: p.category ?? "",
        weight: p.weight,
        stationId: p.stationId,
        processLabel: getProcessLabel(p.stationName ?? "", d.materialTypeName),
      }));
      const fullTemplate = getFullWasteTemplate(d.materialTypeName);
      const merged =
        fullTemplate.length > 0
          ? mergeSavedByProductsIntoFullTemplate(fullTemplate, saved)
          : saved;
      setClosedShiftByProducts(merged);
      setShowClosedReportsModal(false);
      setShowShiftClosedView(true);
      setShiftLogsSearch("");
      setShiftLogsPageCrusher(1);
      setShiftLogsPageWashing(1);
      setShiftLogsPageExtrusion(1);
      setShiftLogsPageLabel(1);
      setShiftLogsPagePacking(1);
      setShiftLogsPagePelletPacking(1);
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
      Alert.alert(t("common.error"), t("messages.failedToLoadShiftSummary"));
    }
  };

  // Helper: format millisecond diff as "Xh YYm ZZs"
  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  };

  const loadShiftState = async () => {
    if (!selectedShift) return;
    const requestedShiftTypeId = Number(selectedShift.id);
    selectedShiftIdRef.current = requestedShiftTypeId;
    const requestId = ++shiftLoadRequestRef.current;
    const isStaleRequest = () =>
      requestId !== shiftLoadRequestRef.current ||
      selectedShiftIdRef.current !== requestedShiftTypeId;
    try {
      setIsLoading(true);
      // Clear previous shift snapshot immediately so Shift 2 does not flash Shift 1 data.
      setIsShiftActive(false);
      setBackendShiftId(null);
      setShiftStartTime(null);
      setShiftEndedAt(null);
      setShiftLogs([]);
      setSelectedStation(null);
      setSelectedSubLine(null);
      setSelectedSection(null);

      // Load ANY open session for this user first (not only the selected Shift 1/2/3 tab).
      // Otherwise Shift 2 selected + Shift 1 running in DB shows "Start Shift" incorrectly.
      const activeAnyRes = await productionApi.getActiveShift();
      if (isStaleRequest()) return;
      if (activeAnyRes.data.success && activeAnyRes.data.data) {
        const shift = activeAnyRes.data.data;
        const activeTypeId = Number(shift.shift_type_id);
        if (
          !isPPIC &&
          activeTypeId > 0 &&
          activeTypeId !== requestedShiftTypeId
        ) {
          try {
            const shiftsRes = await masterDataApi.getShifts();
            const match = (shiftsRes.data?.data ?? []).find(
              (s: Shift) => Number(s.id) === activeTypeId,
            );
            if (match) {
              await setSelectedShift(match);
              selectedShiftIdRef.current = Number(match.id);
              showToast(
                t("messages.resumedOpenShift", {
                  shiftName: match.name ?? shift.shift_type_name ?? "",
                }),
              );
            }
          } catch (_) {
            /* use session anyway */
          }
        }
        setIsShiftActive(true);
        setShiftStartTime(new Date(shift.start_time).getTime());
        setShiftEndedAt(null);
        setBackendShiftId(shift.id);
        const logsRes = await productionApi.getShiftLogs(shift.id);
        if (isStaleRequest()) return;
        if (logsRes.data.success) setShiftLogs(logsRes.data.data);
      } else {
        // No active shift — check if there is a recently closed shift *for this shift type* today
        // so we can display "Shift Closed" only when it matches the selected shift (e.g. Shift 1).
        // If user switched to Shift 2, we must show "Start Shift" for Shift 2, not Shift 1 closed.
        try {
          const latestRes = await productionApi.getLatestShift();
          if (isStaleRequest()) return;
          if (latestRes.data.success && latestRes.data.data) {
            const latest = latestRes.data.data;
            const isSameShiftType =
              latest.shift_type_id != null &&
              Number(latest.shift_type_id) === requestedShiftTypeId;
            if (isSameShiftType && !latest.is_active && latest.end_time) {
              // Operator: show Start Shift so a new session can begin (do not auto-open closed report).
              if (!isPPIC) {
                setIsShiftActive(false);
                setBackendShiftId(null);
                setShiftStartTime(null);
                setShiftEndedAt(null);
                setShiftLogs([]);
                return;
              }
              // Existing flow (PPIC / others): keep original "Shift Closed" state
              const startMs = new Date(latest.start_time).getTime();
              const endMs = new Date(latest.end_time).getTime();
              setIsShiftActive(false);
              setBackendShiftId(latest.id);
              setShiftStartTime(startMs);
              setShiftEndedAt(endMs);
              setShiftDuration(formatDuration(endMs - startMs));
              const logsRes = await productionApi.getShiftLogs(latest.id);
              if (isStaleRequest()) return;
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
        // PC operator flow only: if selected shift is already closed (previous) and we have no same-type closed from latest,
        // load the most recent closed session for this shift type and show only its data (no Start Shift button).
        if (!isPPIC && selectedShift && isShiftPrevious(selectedShift)) {
          try {
            const closedRes = await productionApi.getClosedShifts(
              10,
              undefined,
              requestedShiftTypeId,
            );
            if (isStaleRequest()) return;
            if (
              closedRes.data?.success &&
              Array.isArray(closedRes.data.data) &&
              closedRes.data.data.length > 0
            ) {
              const first = closedRes.data.data[0];
              const sessionId = first.shiftId ?? first.id;
              if (sessionId != null) {
                await handleSelectAnyShift(Number(sessionId), false);
                return;
              }
            }
          } catch (_) {
            // ignore; fall through to show Start Shift or empty state
          }
        }
      }
    } catch (e) {
      console.error("Failed to load shift state", e);
    } finally {
      if (!isStaleRequest()) setIsLoading(false);
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
      const [endH, endM] = shiftType.end_time.split(":").map(Number);
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
    if (!isShiftActive || !backendShiftId || !selectedShift || !shiftStartTime)
      return;

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
              "Shift Auto-Closed",
              `Your ${selectedShift.name} shift has been automatically closed.\n\nThe shift ended at ${selectedShift.end_time} and the 15-minute grace period has elapsed.`,
              [
                {
                  text: "OK",
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
                },
              ],
            );
          }
        } catch (err) {
          console.error("Error auto-closing shift:", err);
          closing = false;
        }
        return;
      }

      // ── Scheduled end time reached → show one-time warning ─────────────────
      if (now >= times.scheduledEnd && !autoCloseWarningShown) {
        setAutoCloseWarningShown(true);
        Alert.alert(
          "Shift Ended",
          `Your ${selectedShift.name} shift has reached its scheduled end time (${selectedShift.end_time}).\n\nThe shift will be automatically closed in 15 minutes if not closed manually.`,
          [{ text: "OK" }],
        );
      }
    };

    tick(); // check immediately on mount / state change
    const interval = setInterval(tick, 30 * 1000); // check every 30 seconds
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isShiftActive,
    backendShiftId,
    selectedShift,
    shiftStartTime,
    autoCloseWarningShown,
  ]);

  const loadStations = async () => {
    try {
      const response = await productionApi.getStations();
      if (response.data.success) {
        const uiColors: any = {
          "Label Removal": "#3b82f6",
          Crusher: isPE ? "#0d9488" : isPET ? "#0369a1" : "#a855f7",
          Washing: "#06b6d4",
          // PET Boretech maps from "Extrusion" / EXT — use green for PET only (PC stays orange)
          Extrusion: isPET ? "#16a34a" : "#f97316",
          "Re-Packaging": isPET ? "#7c3aed" : "#22c55e",
          "Extrusion & Packaging": isPET ? "#16a34a" : "#f97316",
          "Final Packaging": isPET ? "#7c3aed" : "#22c55e",
          "Pellet Packing": "#0d9488",
        };

        // PE: show full line (Crusher, Washing, Extrusion, Final) — only hide PC-only Label Removal
        const PE_EXCLUDED = ["Label Removal"];
        // PET stations: Crusher Rapid PET, Washing, Boretech (=Extrusion & Packaging), Starlinger (=Re-Packaging)
        // Exclude Label Removal (PET has no label removal step)
        const PET_EXCLUDED = ["Label Removal"];

        const mappedStations = response.data.data
          .filter((s: any) => {
            if (isPE && PE_EXCLUDED.includes(s.name)) return false;
            if (isPET && PET_EXCLUDED.includes(s.name)) return false;
            return true;
          })
          .map((s: any) => ({
            ...s,
            color: uiColors[s.name] || "#64748b",
            displayName:
              isPE && s.name === "Crusher"
                ? "Crusher"
                : isPET && s.name === "Crusher"
                  ? "Crusher Rapid PET"
                  : isPET && isExtrusionPackagingStation(s)
                    ? "Boretech"
                    : isPET && isPetStarlingerLine(s)
                      ? "Starlinger"
                      : isPET && isPetFinalPackingLine(s)
                        ? "Final Packing"
                        : s.name,
          }));
        setStations(mappedStations);
      }
    } catch (error) {
      console.error("Error loading stations:", error);
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
    } else if (
      !isShiftActive &&
      shiftStartTime !== null &&
      shiftEndedAt === null
    ) {
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
  useEffect(() => {
    isShiftActiveRef.current = isShiftActive;
  }, [isShiftActive]);
  useEffect(() => {
    backendShiftIdRef.current = backendShiftId;
  }, [backendShiftId]);

  // Poll every 30 seconds to detect PPIC-ended shifts.
  // Single interval for the component lifetime — refs ensure we always read latest values.
  useEffect(() => {
    const poll = setInterval(() => {
      checkShiftEndedByPPIC();
    }, 30000);
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
      const existing = await productionApi.getActiveShift();
      if (existing.data?.success && existing.data.data) {
        const open = existing.data.data;
        const openTypeId = Number(open.shift_type_id);
        if (openTypeId > 0 && openTypeId !== Number(selectedShift.id)) {
          const shiftsRes = await masterDataApi.getShifts();
          const match = (shiftsRes.data?.data ?? []).find(
            (s: Shift) => Number(s.id) === openTypeId,
          );
          Alert.alert(
            t("messages.activeShiftBlockingTitle"),
            t("messages.activeShiftOpenOnOtherTab", {
              shiftName:
                match?.name ?? open.shift_type_name ?? String(openTypeId),
            }),
          );
          return;
        }
        await loadShiftState();
        return;
      }
      setIsLoading(true);
      // Clear saved by-products when starting new shift
      setSavedByProductsOnStartPage([]);
      setSavedByProductsMeta(null);
      setClosedShiftId(null);
      setEditingByProductIndex(null);
      setEditByProductWeight("");

      const response = await productionApi.startShift(selectedShift.id);
      if (response.data.success) {
        setBackendShiftId(response.data.data.id);
        setIsShiftActive(true);
        setShiftStartTime(Date.now());
        setShiftEndedAt(null);
        setAutoCloseWarningShown(false);
        if (isPET) {
          setByProductsInputs([]);
        } else {
          // By-product rows for Close Shift only (same pattern as PC / PE)
          setByProductsInputs(getFullWasteTemplate());
        }
      }
    } catch (error: any) {
      const message =
        error.response?.data?.message || t("messages.failedToStartShift");
      const isBlockedByOpenSession =
        typeof message === "string" &&
        message.toLowerCase().includes("active shift");
      if (isBlockedByOpenSession) {
        Alert.alert(
          t("messages.activeShiftBlockingTitle"),
          t("messages.activeShiftBlockingMessage"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("dashboard.changeShift"),
              onPress: () => navigation.navigate("ShiftSelection"),
            },
          ],
        );
      } else {
        showToast(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndShift = async () => {
    if (!backendShiftId) return;
    const full = getFullWasteTemplate();
    setByProductsInputs((prev) =>
      full.length > 0 ? mergeSavedByProductsIntoFullTemplate(full, prev) : prev,
    );
    setShowEndShiftSummary(true);
  };

  /** materialTypeOverride: shift's material (e.g. PE) when viewer is PPIC so labels match stored waste rows */
  const getProcessLabel = useCallback(
    (stationName: string, materialTypeOverride?: string | null): string => {
      const mat = (materialTypeOverride ?? "").trim().toUpperCase();
      const asPE = isPE || mat === "PE";
      const asPET = isPET || mat === "PET";
      const n = (stationName || "").toLowerCase();
      if (n.includes("label removal")) return "removeLabelCrushing";
      if (n.includes("crusher")) {
        if (asPET) return "crusher";
        if (asPE) return "crusherWashing";
        return "removeLabelCrushing";
      }
      if (n.includes("washing")) return "washing";
      if (n.includes("extrusion") || n.includes("boretech"))
        return asPET ? "boretech" : "extrusion";
      if (asPET) {
        if (n.includes("starlinger")) return "starlinger";
        if (
          n.includes("final packing") ||
          n.includes("re-packaging") ||
          n.includes("packing") ||
          (n.includes("final") && !n.includes("extrusion"))
        )
          return "finalPacking";
      }
      if (
        n.includes("starlinger") ||
        n.includes("re-packaging") ||
        n.includes("final") ||
        n.includes("packing")
      )
        return asPET ? "starlinger" : "extrusion";
      return "other";
    },
    [isPE, isPET],
  );

  const getProcessTitle = useCallback(
    (key: string) => {
      switch (key) {
        case "removeLabelCrushing":
          return t("dashboard.processRemoveLabelCrushing");
        case "washing":
          return t("dashboard.processWashing");
        case "extrusion":
          return t("dashboard.processExtrusion");
        case "crusher":
          return "Crusher Rapid PET";
        case "crusherWashing":
          return "Crusher-Washing";
        case "boretech":
          return "Boretech";
        case "starlinger":
          return "Starlinger";
        case "finalPacking":
          return "Final Packing";
        default:
          return key;
      }
    },
    [t],
  );

  const shiftClosedEditHint = useMemo(() => {
    const m = (closedShiftMeta?.materialTypeName ?? "").trim().toUpperCase();
    if (m === "PE") return t("dashboard.editAnyDataHintPE");
    if (m === "PC") return t("dashboard.editAnyDataHintPC");
    if (m === "PET") return t("dashboard.editAnyDataHintPET");
    return t("dashboard.editAnyDataHintGeneric");
  }, [closedShiftMeta?.materialTypeName, t]);

  // Full list of all waste labels (all processes) with 0 weight - for showing "all labels" in closed/saved view.
  // When viewing another shift (e.g. PPIC opens PE closed report), pass that shift's materialTypeName so PE/PET rows match DB.
  const getFullWasteTemplate = useCallback(
    (shiftMaterial?: string | null): any[] => {
      const provided =
        shiftMaterial != null && String(shiftMaterial).trim() !== "";
      const sm = provided ? String(shiftMaterial).trim().toUpperCase() : "";
      const usePE = provided ? sm === "PE" : isPE;
      const usePET = provided ? sm === "PET" : isPET;
      const list: any[] = [];

      if (usePE) {
        const crusherStation = stations.find(
          (s) =>
            s.name?.toLowerCase().includes("crusher") ||
            (s as any).code === "CRS",
        );
        const washingStation = stations.find(
          (s) =>
            s.name?.toLowerCase().includes("washing") ||
            (s as any).code === "WSH",
        );
        const extrusionStation = stations.find(
          (s) =>
            isExtrusionPackagingStation(s) ||
            s.name?.toLowerCase().includes("extrusion") ||
            (s as any).code === "EXT",
        );
        if (crusherStation) {
          ["Dust", "Sweep Floor"].forEach((name) => {
            list.push({
              name,
              category: "Waste",
              weight: 0,
              stationId: crusherStation.id,
              stationName: "Crusher",
              processLabel: "crusherWashing",
            });
          });
        }
        if (washingStation) {
          ["Dust"].forEach((name) => {
            list.push({
              name,
              category: "Waste",
              weight: 0,
              stationId: washingStation.id,
              stationName: washingStation.name,
              processLabel: "washing",
            });
          });
        }
        if (extrusionStation) {
          ["Lumps", "Sweep Floor", "Dust"].forEach((name) => {
            list.push({
              name,
              category: "Waste",
              weight: 0,
              stationId: extrusionStation.id,
              stationName: extrusionStation.name,
              processLabel: "extrusion",
            });
          });
        }
        return list;
      }

      if (usePET) {
        // PET waste template:
        // - Crusher Rapid PET: Dust, Sweep Floor
        // - Washing: Dust
        // - Boretech: Dust, Reject Flakesorter, Zigzag Dust, Sweep Floor
        // - Starlinger: NFG SSP, NFG Extruder, Metal Contamination Flake, Metal Contamination Pellet, Pellet Sweep Floor, Flake Sweep Floor, Lumps
        const crusherStation = stations.find(
          (s) =>
            s.name?.toLowerCase().includes("crusher") ||
            (s as any).code === "CRS",
        );
        const washingStation = stations.find(
          (s) =>
            s.name?.toLowerCase().includes("washing") ||
            (s as any).code === "WSH",
        );
        const boretechStation = stations.find((s) =>
          isExtrusionPackagingStation(s),
        );
        const starlingerStation = stations.find((s) => {
          if (isExtrusionPackagingStation(s)) return false;
          const n = (s.name || "").toLowerCase();
          return n.includes("starlinger") || n.includes("re-packaging");
        });
        const finalPackingStation = stations.find(
          (s) =>
            isPetFinalPackingLine(s) &&
            (!starlingerStation || s.id !== starlingerStation.id),
        );
        const starlingerWasteNames = [
          "NFG SSP",
          "NFG Extruder",
          "Metal Contamination Flake",
          "Metal Contamination Pellet",
          "Pellet Sweep Floor",
          "Flake Sweep Floor",
          "Lumps",
        ];
        if (crusherStation) {
          ["Dust", "Sweep Floor"].forEach((name) => {
            list.push({
              name,
              category: "Waste",
              weight: 0,
              stationId: crusherStation.id,
              stationName: "Crusher Rapid PET",
              processLabel: "crusher",
            });
          });
        }
        if (washingStation) {
          ["Dust"].forEach((name) => {
            list.push({
              name,
              category: "Waste",
              weight: 0,
              stationId: washingStation.id,
              stationName: washingStation.name,
              processLabel: "washing",
            });
          });
        }
        if (boretechStation) {
          ["Dust", "Reject Flakesorter", "Zigzag Dust", "Sweep Floor"].forEach(
            (name) => {
              list.push({
                name,
                category: "Waste",
                weight: 0,
                stationId: boretechStation.id,
                stationName: "Boretech",
                processLabel: "boretech",
              });
            },
          );
        }
        if (starlingerStation) {
          starlingerWasteNames.forEach((name) => {
            list.push({
              name,
              category: "Waste",
              weight: 0,
              stationId: starlingerStation.id,
              stationName: "Starlinger",
              processLabel: "starlinger",
            });
          });
        } else if (finalPackingStation) {
          // Single post-Boretech station in DB: attribute Starlinger-line waste to that row
          starlingerWasteNames.forEach((name) => {
            list.push({
              name,
              category: "Waste",
              weight: 0,
              stationId: finalPackingStation.id,
              stationName: "Starlinger",
              processLabel: "starlinger",
            });
          });
        }
        if (finalPackingStation && starlingerStation) {
          starlingerWasteNames.forEach((name) => {
            list.push({
              name,
              category: "Waste",
              weight: 0,
              stationId: finalPackingStation.id,
              stationName: "Final Packing",
              processLabel: "finalPacking",
            });
          });
        }
        return list;
      }

      // PC waste template (unchanged)
      const labelRemovalStation = stations.find(
        (s) =>
          s.name?.toLowerCase().includes("label removal") ||
          (s as any).code === "LR",
      );
      const crusherStation = stations.find(
        (s) =>
          s.name?.toLowerCase().includes("crusher") ||
          (s as any).code === "CRS",
      );
      const washingStation = stations.find(
        (s) =>
          s.name?.toLowerCase().includes("washing") ||
          (s as any).code === "WSH",
      );
      const extrusionStation = stations.find(
        (s) =>
          s.name?.toLowerCase().includes("extrusion") ||
          s.id === 4 ||
          (s as any).code === "EXT",
      );
      const stationForRemoveLabelCrushing =
        labelRemovalStation || crusherStation;
      if (stationForRemoveLabelCrushing) {
        ["Dust Remove Label", "Sweep Floor"].forEach((name) => {
          list.push({
            name,
            category: "Waste",
            weight: 0,
            stationId: stationForRemoveLabelCrushing.id,
            stationName: stationForRemoveLabelCrushing.name,
            processLabel: "removeLabelCrushing",
          });
        });
      }
      if (washingStation) {
        ["Dust wet"].forEach((name) => {
          list.push({
            name,
            category: "Waste",
            weight: 0,
            stationId: washingStation.id,
            stationName: washingStation.name,
            processLabel: "washing",
          });
        });
      }
      if (extrusionStation) {
        ["Lumps", "Sweep Floor"].forEach((name) => {
          list.push({
            name,
            category: "Waste",
            weight: 0,
            stationId: extrusionStation.id,
            stationName: extrusionStation.name,
            processLabel: "extrusion",
          });
        });
      }
      return list;
    },
    [stations, isPE, isPET],
  );

  const mergeSavedByProductsIntoFullTemplate = useCallback(
    (fullTemplate: any[], savedList: any[]): any[] => {
      const used = new Set<string>();
      const keyOf = (s: { stationId?: number | null; name?: string }) =>
        `${s.stationId ?? ""}|${String(s.name ?? "")}`;
      const out = fullTemplate.map((t) => {
        const matchStation = (s: any) =>
          s.stationId === t.stationId ||
          (s.stationName &&
            t.stationName &&
            String(s.stationName).trim() === String(t.stationName).trim());
        const saved = savedList.find(
          (s: any) => s.name === t.name && matchStation(s),
        );
        if (saved) used.add(keyOf(saved));
        return saved
          ? {
              ...t,
              weight: saved.weight,
              category: saved.category ?? t.category,
            }
          : t;
      });
      for (const s of savedList) {
        if (used.has(keyOf(s))) continue;
        out.push({
          name: s.name,
          category: s.category ?? "Waste",
          weight: s.weight,
          stationId: s.stationId,
          stationName: s.stationName ?? "",
          processLabel: s.processLabel ?? "other",
        });
      }
      return out;
    },
    [],
  );

  // PET: after resume, stations may load after shift — fill by-product template once
  useEffect(() => {
    if (!isPET || !backendShiftId || stations.length === 0) return;
    const tmpl = getFullWasteTemplate();
    if (tmpl.length === 0) return;
    setByProductsInputs((prev) => (prev.length > 0 ? prev : tmpl));
  }, [isPET, backendShiftId, stations.length, getFullWasteTemplate]);

  const initByProducts = () => {
    setByProductsInputs(getFullWasteTemplate());
  };

  const handleCloseShift = async () => {
    if (!backendShiftId || closeShiftInProgressRef.current) return;
    closeShiftInProgressRef.current = true;
    try {
      setIsLoading(true);
      const toSave = byProductsInputs.filter((p) => Number(p.weight) > 0);
      const crusherStation = stations.find(
        (s) =>
          s.name?.toLowerCase().includes("crusher") ||
          (s as any).code === "CRS",
      );
      const washingStation = stations.find(
        (s) =>
          s.name?.toLowerCase().includes("washing") ||
          (s as any).code === "WSH",
      );
      const extrusionStation = stations.find(
        (s) =>
          s.name?.toLowerCase().includes("extrusion") ||
          s.id === 4 ||
          (s as any).code === "EXT",
      );
      const byStation = {
        crusher: { outputs: 0, weight: "0.0" },
        washing: { outputs: 0, weight: "0.0" },
        extrusion: { outputs: 0, weight: "0.0" },
      };
      if (crusherStation) {
        const logs = shiftLogs.filter(
          (l: any) => l.station_id === crusherStation.id,
        );
        byStation.crusher.outputs = logs.length;
        byStation.crusher.weight = logs
          .reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0)
          .toFixed(1);
      }
      if (washingStation) {
        const logs = shiftLogs.filter(
          (l: any) => l.station_id === washingStation.id,
        );
        byStation.washing.outputs = logs.length;
        byStation.washing.weight = logs
          .reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0)
          .toFixed(1);
      }
      if (extrusionStation) {
        const logs = shiftLogs.filter(
          (l: any) => l.station_id === extrusionStation.id,
        );
        byStation.extrusion.outputs = logs.length;
        byStation.extrusion.weight = logs
          .reduce((acc: number, l: any) => acc + Number(l.weight || 0), 0)
          .toFixed(1);
      }
      const totalOutputs =
        byStation.crusher.outputs +
        byStation.washing.outputs +
        byStation.extrusion.outputs;
      const totalWeight = (
        Number(byStation.crusher.weight) +
        Number(byStation.washing.weight) +
        Number(byStation.extrusion.weight)
      ).toFixed(1);
      const byProductsForPdf = toSave.map((p) => ({
        name: p.name,
        stationName: p.stationName ?? "",
        category: p.category ?? "",
        weight: Number(p.weight),
        processLabel: p.processLabel ?? "",
      }));
      const shiftIdToClose = backendShiftId;
      const remarkTrimmed = endShiftRemark.trim() || undefined;

      // 1) Close in DB first — by-products and print must never block this (PET/PC/PE)
      const response = await productionApi.endShift(
        shiftIdToClose,
        remarkTrimmed,
      );
      if (!response.data?.success) {
        Alert.alert(t("common.error"), t("messages.failedToCloseShift"));
        return;
      }

      // Verify closed (retry once if still active — network/race)
      try {
        const statusRes = await productionApi.getShiftStatus(shiftIdToClose);
        if (statusRes.data?.success && statusRes.data.data?.is_active) {
          await productionApi.endShift(shiftIdToClose, remarkTrimmed);
        }
      } catch (_) {
        /* ignore verify errors */
      }

      // 2) Save by-products (best effort — shift is already closed)
      try {
        await productionApi.updateByProducts(
          shiftIdToClose,
          toSave.map((p) => ({
            stationId: p.stationId,
            name: p.name,
            weight:
              typeof p.weight === "number" ? p.weight : Number(p.weight) || 0,
            category: p.category ?? "",
          })),
        );
      } catch (bpErr) {
        console.warn("Shift closed; by-products save failed:", bpErr);
        Alert.alert(
          t("messages.shiftClosedByProductsFailedTitle"),
          t("messages.shiftClosedByProductsFailedMessage"),
        );
      }

      const savedShiftId = shiftIdToClose;
      const savedMeta = {
        shift: selectedShift?.name ?? "N/A",
        operator: user?.name ?? "N/A",
        date: new Date().toLocaleDateString(),
        totalOutputs,
        totalWeight,
        byStation,
        remark: remarkTrimmed,
        materialTypeName: isPE ? "PE" : isPET ? "PET" : "PC",
      };
      const savedByProducts = byProductsForPdf.map((p, i) => ({
        ...p,
        stationId: toSave[i].stationId,
        processLabel: toSave[i].processLabel,
      }));
      const fullTemplate = getFullWasteTemplate();
      const mergedForStartPage =
        fullTemplate.length > 0
          ? mergeSavedByProductsIntoFullTemplate(fullTemplate, savedByProducts)
          : savedByProducts;

      setClosedShiftId(savedShiftId);
      setSavedByProductsMeta(savedMeta);
      setSavedByProductsOnStartPage(mergedForStartPage);
      setShowEndShiftSummary(false);
      setEndShiftRemark("");
      setIsShiftActive(false);
      setBackendShiftId(null);
      setShiftStartTime(null);
      setShiftEndedAt(null);
      setShiftLogs([]);
      setAutoCloseWarningShown(false);
      setShowShiftClosedView(false);
      setViewingActiveShift(false);

      // Print/PDF after DB close — failure does not leave shift open
      try {
        await printService.printShiftSummary({
          shift: savedMeta.shift,
          operator: savedMeta.operator,
          date: savedMeta.date,
          totalOutputs,
          totalWeight,
          byStation,
          byProducts: byProductsForPdf,
          remark: remarkTrimmed,
        });
      } catch (printErr) {
        console.warn("Shift closed but print/PDF failed:", printErr);
        Alert.alert(
          t("messages.shiftClosedPrintFailedTitle"),
          t("messages.shiftClosedPrintFailedMessage"),
        );
      }
    } catch (error) {
      Alert.alert(t("common.error"), t("messages.failedToCloseShift"));
    } finally {
      setIsLoading(false);
      closeShiftInProgressRef.current = false;
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
          stationName: r.stationName ?? "",
          category: r.category ?? "",
          weight: r.weight,
          stationId: r.stationId,
          processLabel: getProcessLabel(
            r.stationName ?? "",
            closedShiftMeta?.materialTypeName,
          ),
        }));
        const fullTemplate = getFullWasteTemplate(
          closedShiftMeta?.materialTypeName,
        );
        const merged =
          fullTemplate.length > 0
            ? mergeSavedByProductsIntoFullTemplate(fullTemplate, saved)
            : saved;
        setClosedShiftByProducts(merged);
      }
    } catch (e) {
      console.warn("Fetch closed by-products failed", e);
    } finally {
      setClosedByProductsLoading(false);
    }
  }, [
    closedShiftId,
    closedShiftMeta?.materialTypeName,
    getFullWasteTemplate,
    mergeSavedByProductsIntoFullTemplate,
    getProcessLabel,
  ]);

  const handleGeneratePdfAgain = async () => {
    // Support both closed shift view and start page saved by-products
    const meta = showShiftClosedView ? closedShiftMeta : savedByProductsMeta;
    const byProducts = showShiftClosedView
      ? closedShiftByProducts
      : savedByProductsOnStartPage;

    if (!meta) return;
    await printService.printShiftSummary({
      shift: meta.shift,
      operator: meta.operator,
      date: meta.date,
      totalOutputs: meta.totalOutputs,
      totalWeight: meta.totalWeight,
      byStation: meta.byStation,
      remark: meta.remark,
      byProducts: byProducts.map((p) => ({
        name: p.name,
        stationName: p.stationName ?? "",
        category: p.category ?? "",
        weight: typeof p.weight === "number" ? p.weight : Number(p.weight) || 0,
        processLabel:
          p.processLabel ||
          getProcessLabel(p.stationName ?? "", meta.materialTypeName ?? null),
      })),
    });
  };

  const handleBackToShifts = () => {
    setShowShiftClosedView(false);
    setClosedShiftId(null);
    setClosedShiftByProducts([]);
    setClosedShiftMeta(null);
    setClosedShiftRemarkEdit("");
    setClosedShiftLogs([]);
    setEditingByProductIndex(null);
    setViewingActiveShift(false);
    setSavedByProductsOnStartPage([]);
    setSavedByProductsMeta(null);
    // PPIC stays on their home dashboard — no ShiftSelection navigation needed
    if (user?.role?.toLowerCase() !== "ppic") {
      navigation.navigate("ShiftSelection");
    }
  };

  const loadPpicClosedShiftsList = async (
    useDate?: string,
    useShiftId?: number | null,
    useMaterial?: string | null,
  ) => {
    setClosedShiftsLoading(true);
    try {
      const limit = 100;
      const date =
        user?.role?.toLowerCase() === "ppic"
          ? (useDate ?? ppicSelectedDate)
          : undefined;
      const shiftTypeIdRaw =
        user?.role?.toLowerCase() === "ppic"
          ? (useShiftId ?? ppicSelectedShiftId)
          : null;
      const shiftTypeId =
        shiftTypeIdRaw != null && shiftTypeIdRaw >= 1 && shiftTypeIdRaw <= 3
          ? Number(shiftTypeIdRaw)
          : undefined;
      const materialFilter =
        useMaterial !== undefined ? useMaterial : ppicOverviewMaterialType;
      const res = await productionApi.getClosedShifts(
        limit,
        date,
        shiftTypeId,
        materialFilter,
      );
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

  const handleOpenClosedReports = async (
    useDate?: string,
    useShiftId?: number | null,
    useMaterial?: string | null,
  ) => {
    setShowClosedReportsModal(true);
    await loadPpicClosedShiftsList(useDate, useShiftId, useMaterial);
  };

  const refreshPpicHomeData = (
    date?: string,
    shiftId?: number | null,
    material?: string | null,
  ) => {
    const d = date ?? ppicSelectedDate;
    const sh = shiftId !== undefined ? shiftId : ppicSelectedShiftId;
    const mat = material !== undefined ? material : ppicOverviewMaterialType;
    if (date) {
      setPpicSelectedDate(date);
      setPpicOverviewDate(date);
    }
    loadPpicClosedShiftsList(d, sh, mat);
    loadPpicOverview(d, sh, mat);
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
        totalWeight: d.totalWeight ?? "0.0",
        byStation: d.byStation ?? undefined,
        remark: d.remark,
        materialTypeName: d.materialTypeName ?? null,
      });
      setClosedShiftRemarkEdit(d.remark ?? "");
      const saved = (d.byProducts || []).map((p: any) => ({
        name: p.name,
        stationName: p.stationName ?? "",
        category: p.category ?? "",
        weight: p.weight,
        stationId: p.stationId,
        processLabel: getProcessLabel(p.stationName ?? "", d.materialTypeName),
      }));
      const fullTemplate = getFullWasteTemplate(d.materialTypeName);
      const merged =
        fullTemplate.length > 0
          ? mergeSavedByProductsIntoFullTemplate(fullTemplate, saved)
          : saved;
      setClosedShiftByProducts(merged);
      setShowClosedReportsModal(false);
      setShowShiftClosedView(true);
      setShiftLogsSearch("");
      setShiftLogsPageCrusher(1);
      setShiftLogsPageWashing(1);
      setShiftLogsPageExtrusion(1);
      setShiftLogsPageLabel(1);
      setShiftLogsPagePacking(1);
      setShiftLogsPagePelletPacking(1);
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
      Alert.alert(t("common.error"), t("messages.failedToLoadShiftSummary"));
    }
  };

  const openEditByProduct = (index: number) => {
    // Support both closed shift view and start page saved by-products
    const byProductsList = showShiftClosedView
      ? closedShiftByProducts
      : savedByProductsOnStartPage;
    const p = byProductsList[index];
    setEditingByProductIndex(index);
    setEditByProductWeight(String(p?.weight ?? ""));
  };

  const saveEditedByProduct = async () => {
    if (editingByProductIndex == null) return;
    const w = Number(editByProductWeight);
    if (Number.isNaN(w) || w < 0) {
      Alert.alert(t("common.error"), t("messages.invalidWeight"));
      return;
    }

    if (!closedShiftId) return;

    // Get the current list and update it
    const byProductsToUpdate = showShiftClosedView
      ? closedShiftByProducts
      : savedByProductsOnStartPage;
    const updated = byProductsToUpdate.map((p, i) =>
      i === editingByProductIndex ? { ...p, weight: w } : p,
    );

    // Update the appropriate list based on current view
    if (showShiftClosedView) {
      setClosedShiftByProducts(updated);
    } else {
      setSavedByProductsOnStartPage(updated);
    }

    setEditingByProductIndex(null);
    setEditByProductWeight("");

    try {
      await productionApi.updateByProducts(
        closedShiftId,
        updated.map((p) => ({
          stationId: p.stationId,
          name: p.name,
          weight: p.weight,
          category: p.category ?? "",
        })),
      );
    } catch (e) {
      Alert.alert(t("common.error"), t("messages.failedToSaveByProduct"));
    }
  };

  const saveClosedShiftRemark = async () => {
    if (closedShiftId == null) return;
    try {
      await productionApi.updateClosedShiftRemark(
        closedShiftId,
        closedShiftRemarkEdit,
      );
      setClosedShiftMeta((prev) =>
        prev ? { ...prev, remark: closedShiftRemarkEdit } : null,
      );
    } catch (e) {
      Alert.alert(t("common.error"), t("messages.failedToSaveByProduct"));
    }
  };

  const openEditLogWeight = (log: any) => {
    setEditingLogWeight(log);
    setEditWeightValue(String(log.weight || ""));
    setEditRemarkValue(String(log?.remark ?? ""));
  };

  const saveEditedLogWeight = async () => {
    if (!editingLogWeight) return;
    if (!isValidProductionWeightInput(editWeightValue)) {
      Alert.alert(t("common.error"), t("messages.invalidWeight"));
      return;
    }
    const w = parseFloat(String(editWeightValue).trim());
    const remarkTrim = editRemarkValue.trim();
    const newRemark = remarkTrim === "" ? null : remarkTrim;

    setIsLoading(true);
    try {
      if (isPPIC) {
        await productionApi.updateProductionLogFields(editingLogWeight.id, {
          weight: w,
          remark: remarkTrim === "" ? "" : remarkTrim,
        });
      } else {
        await productionApi.updateLogWeight(editingLogWeight.id, w);
      }

      const applyPatch = (log: any) => {
        if (log.id !== editingLogWeight.id) return log;
        return isPPIC
          ? { ...log, weight: w, remark: newRemark }
          : { ...log, weight: w };
      };

      if (showShiftClosedView && closedShiftId) {
        setClosedShiftLogs((prev) => prev.map(applyPatch));
        const sumRes = await productionApi.getClosedShiftSummary(closedShiftId);
        if (sumRes.data?.success && sumRes.data.data) {
          const d = sumRes.data.data;
          setClosedShiftMeta((prev) =>
            prev
              ? {
                  ...prev,
                  totalOutputs: d.totalOutputs ?? 0,
                  totalWeight: d.totalWeight ?? "0.0",
                  byStation: d.byStation ?? prev.byStation,
                }
              : null,
          );
        }
      } else {
        if (selectedStation?.name === "Crusher") {
          setCrusherLogs((prev) => prev.map(applyPatch));
        } else if (selectedStation?.name === "Washing") {
          setWashingLogs((prev) => prev.map(applyPatch));
        } else if (isExtrusionPackagingStation(selectedStation)) {
          if (isPE) {
            setPeExtrusionLogs((prev) => prev.map(applyPatch));
          } else if (isPET) {
            setPetBoretechLogs((prev) => prev.map(applyPatch));
          } else {
            setExtrusionLogs((prev) => prev.map(applyPatch));
          }
        } else if (isPET && isPetStarlingerLine(selectedStation)) {
          setPetStarlingerLogs((prev) => prev.map(applyPatch));
        } else if (isPET && isPetFinalPackingLine(selectedStation)) {
          setPetFinalPackingLogs((prev) => prev.map(applyPatch));
        } else if (
          isPelletPackingStation(selectedStation) ||
          selectedStation?.id === 5 ||
          selectedStation?.name?.toLowerCase().includes("final") ||
          selectedStation?.name?.toLowerCase().includes("re-packaging")
        ) {
          // Pellet Packing reuses the Final Packing list state (packingLogs)
          setPackingLogs((prev) => prev.map(applyPatch));
        }
      }

      setShiftLogs((prev) => prev.map(applyPatch));

      if (isPPIC) {
        setPpicOverviewData((prev) =>
          prev.map((st) => ({
            ...st,
            logs: st.logs.map(applyPatch),
          })),
        );
      }

      Alert.alert(
        t("common.success"),
        t("messages.weightUpdatedSuccessfully"),
      );
      setEditingLogWeight(null);
      setEditWeightValue("");
      setEditRemarkValue("");
    } catch (error: any) {
      Alert.alert(
        t("common.error"),
        error.response?.data?.message || t("messages.failedToUpdateWeight"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ── PE Hold flow handlers ───────────────────────────────────────────────
  /** Open the Hold creation modal (PE only). */
  const openPeHoldModal = () => {
    if (!isPE) return;
    setPeHoldWeight("");
    setPeHoldRemark("");
    setPeHoldModalVisible(true);
  };

  /** Submit a new Hold log. Goes through the same /production/log endpoint
   *  used by Output, but with status='hold' so it does not flow downstream
   *  until the operator marks it Reprocess OK or Reject. */
  const submitPeHold = async () => {
    if (!isPE) return;
    if (!isValidProductionWeightInput(peHoldWeight)) {
      Alert.alert(t("common.error"), t("messages.enterValidWeight"));
      return;
    }
    const w = parseFloat(String(peHoldWeight).trim());
    if (!backendShiftId || !selectedStation?.id) {
      Alert.alert(t("common.error"), t("messages.shiftOrStationMissing"));
      return;
    }
    setPeHoldSubmitting(true);
    try {
      // `shiftId` here is the operator_shifts session row id (backendShiftId),
      // NOT selectedShift.id (that's the shift TYPE 1/2/3, which goes in
      // `shiftTypeId` instead). Same convention as the Output flow.
      const payload: any = {
        shiftId: backendShiftId,
        stationId: selectedStation.id,
        inputBagQr: selectedInputBag?.output_bag_qr || null,
        outputBagQr: null,
        weight: w,
        status: "hold",
        subLine: selectedSubLine || undefined,
        remark: peHoldRemark.trim() || undefined,
        shiftTypeId: selectedShift?.id,
      };
      const res = await productionApi.logProduction(payload);
      if (res.data?.success) {
        const saved = res.data.data;
        // Optimistically push the new Hold row into the right per-station
        // list so it shows immediately. We MUST scope by selectedStation to
        // avoid leaking (e.g.) an Extrusion Hold into the Washing list.
        setShiftLogs((prev) => [...(prev || []), saved]);
        const stName = selectedStation?.name;
        if (stName === "Washing") {
          setWashingLogs((prev) => [saved, ...prev]);
        } else if (stName === "Crusher") {
          setPeCrusherLogs((prev) => [saved, ...prev]);
        } else if (isExtrusionPackagingStation(selectedStation)) {
          setPeExtrusionLogs((prev) => [saved, ...prev]);
        }
        setPeHoldModalVisible(false);
        setSelectedSection(null);
        Alert.alert(t("common.success"), t("messages.holdSavedSuccessfully"));
      } else {
        Alert.alert(
          t("common.error"),
          res.data?.message || t("messages.failedToSaveHold"),
        );
      }
    } catch (err: any) {
      Alert.alert(
        t("common.error"),
        err?.response?.data?.message || t("messages.failedToSaveHold"),
      );
    } finally {
      setPeHoldSubmitting(false);
    }
  };

  /** Open Resolve modal for an existing held log (PE only, status==='hold'). */
  const openPeResolveModal = (log: any) => {
    if (!isPE) return;
    setPeResolvingLog(log);
    setPeResolveWeight(String(log?.weight ?? ""));
  };

  /**
   * Optimistically apply a patch to a held log everywhere it's stored.
   * Mirrors the pattern used by saveEditedLogWeight so the change is reflected
   * immediately in the line-picker's "Items on Hold" section, the per-station
   * recent-entries list, and the closed-shift snapshots — no manual refresh
   * needed.
   */
  const patchHeldLogEverywhere = (
    logId: number,
    patch: Partial<{ weight: number; status: string }>,
  ) => {
    const applyPatch = (l: any) => (l?.id === logId ? { ...l, ...patch } : l);
    setShiftLogs((prev) => (prev || []).map(applyPatch));
    setCrusherLogs((prev) => prev.map(applyPatch));
    setWashingLogs((prev) => prev.map(applyPatch));
    setExtrusionLogs((prev) => prev.map(applyPatch));
    setPeCrusherLogs((prev) => prev.map(applyPatch));
    setPeExtrusionLogs((prev) => prev.map(applyPatch));
    setPackingLogs((prev) => prev.map(applyPatch));
    setClosedShiftLogs((prev) => prev.map(applyPatch));
  };

  /** Reprocess OK: write reduced weight + flip status to Completed.
   *  After this, the row behaves exactly like a normal output (next station
   *  can scan it as input, or it acts as finished goods). */
  const submitPeResolveOk = async () => {
    if (!isPE || !peResolvingLog) return;
    if (!isValidProductionWeightInput(peResolveWeight)) {
      Alert.alert(t("common.error"), t("messages.enterValidWeight"));
      return;
    }
    const w = parseFloat(String(peResolveWeight).trim());
    setPeResolveSubmitting(true);
    try {
      await productionApi.updateProductionLogFields(peResolvingLog.id, {
        weight: w,
        status: "Completed",
      });
      patchHeldLogEverywhere(peResolvingLog.id, {
        weight: w,
        status: "Completed",
      });
      setPeResolvingLog(null);
      setPeResolveWeight("");
      Alert.alert(t("common.success"), t("messages.holdResolvedOk"));
    } catch (err: any) {
      Alert.alert(
        t("common.error"),
        err?.response?.data?.message || t("messages.failedToResolveHold"),
      );
    } finally {
      setPeResolveSubmitting(false);
    }
  };

  /** Reject: flip status to 'reject'. The row stays in history but is
   *  ineligible to flow into any downstream station. */
  const submitPeResolveReject = async () => {
    if (!isPE || !peResolvingLog) return;
    setPeResolveSubmitting(true);
    try {
      await productionApi.updateProductionLogFields(peResolvingLog.id, {
        status: "reject",
      });
      patchHeldLogEverywhere(peResolvingLog.id, { status: "reject" });
      setPeResolvingLog(null);
      setPeResolveWeight("");
      Alert.alert(t("common.success"), t("messages.holdRejectedOk"));
    } catch (err: any) {
      Alert.alert(
        t("common.error"),
        err?.response?.data?.message || t("messages.failedToResolveHold"),
      );
    } finally {
      setPeResolveSubmitting(false);
    }
  };

  const loadCrusherLogs = async () => {
    // Load all entries (both 3E and Rapid) when no sub-line is selected
    // Load filtered entries when a sub-line is selected
    try {
      setCrusherLogsLoading(true);
      // Use line filter if set, otherwise use selectedSubLine for backward compatibility
      const lineFilter =
        selectedLineFilter !== "all"
          ? selectedLineFilter
          : selectedSubLine || undefined;
      const statusFilter =
        selectedStatusFilter !== "all" ? selectedStatusFilter : undefined;

      const response = await productionApi.getCrusherLogs(
        lineFilter,
        selectedDate,
        searchQuery || undefined,
        statusFilter,
        currentPage,
        10,
        // Only scope to current shift when viewing today — for past dates use the date filter
        selectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
      );
      if (response.data.success) {
        setCrusherLogs(response.data.data);
        setTotalPages(response.data.pagination.totalPages);
        setTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading crusher logs:", error);
    } finally {
      setCrusherLogsLoading(false);
    }
  };

  /** PE Crusher-Washing: load recent entries (same API as PC crusher, CRS station; sub_line = output type e.g. Flakes PE SUPER). */
  const loadPeCrusherLogs = async () => {
    try {
      setPeCrusherLogsLoading(true);
      const subLineMap: Record<string, string> = {
        "PE SUPER": "Flakes PE SUPER",
        "PE 1": "Flakes PE 1",
        "EVA SUPER": "Flakes EVA SUPER",
        "EVA 1": "Flakes EVA 1",
      };
      const subLine =
        peCrusherLineFilter !== "all"
          ? subLineMap[peCrusherLineFilter] || undefined
          : undefined;
      const statusFilter =
        peCrusherStatusFilter !== "all" ? peCrusherStatusFilter : undefined;
      const response = await productionApi.getCrusherLogs(
        subLine,
        peCrusherSelectedDate,
        peCrusherSearchQuery || undefined,
        statusFilter,
        peCrusherCurrentPage,
        10,
        peCrusherSelectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
      );
      if (response.data.success) {
        setPeCrusherLogs(response.data.data);
        setPeCrusherTotalPages(response.data.pagination.totalPages);
        setPeCrusherTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading PE crusher logs:", error);
    } finally {
      setPeCrusherLogsLoading(false);
    }
  };

  /** PE Extrusion & Packaging: load recent entries (same API as PC extrusion; sub_line = Pellet PE SUPER, etc.). */
  const loadPeExtrusionLogs = async () => {
    try {
      setPeExtrusionLogsLoading(true);
      const subLine =
        peExtrusionLineFilter !== "all" ? peExtrusionLineFilter : undefined;
      const statusFilter =
        peExtrusionStatusFilter !== "all" ? peExtrusionStatusFilter : undefined;
      const response = await productionApi.getExtrusionLogs(
        subLine,
        peExtrusionSelectedDate,
        peExtrusionSearchQuery || undefined,
        statusFilter,
        peExtrusionCurrentPage,
        10,
        peExtrusionSelectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
      );
      if (response.data.success) {
        setPeExtrusionLogs(response.data.data);
        setPeExtrusionTotalPages(response.data.pagination.totalPages);
        setPeExtrusionTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading PE extrusion logs:", error);
    } finally {
      setPeExtrusionLogsLoading(false);
    }
  };

  /** PET Boretech: load recent entries (uses extrusion logs API; sub_line = 'Flakes PET'). */
  const loadPetBoretechLogs = async () => {
    try {
      setPetBoretechLogsLoading(true);
      const statusFilter =
        petBoretechStatusFilter !== "all" ? petBoretechStatusFilter : undefined;
      const response = await productionApi.getExtrusionLogs(
        "Flakes PET",
        petBoretechSelectedDate,
        petBoretechSearchQuery || undefined,
        statusFilter,
        petBoretechCurrentPage,
        10,
        petBoretechSelectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
      );
      if (response.data.success) {
        setPetBoretechLogs(response.data.data);
        setPetBoretechTotalPages(response.data.pagination.totalPages);
        setPetBoretechTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading PET Boretech logs:", error);
    } finally {
      setPetBoretechLogsLoading(false);
    }
  };

  /** PET Starlinger: load recent entries (uses final packing logs API). */
  const loadPetStarlingerLogs = async () => {
    try {
      setPetStarlingerLogsLoading(true);
      const statusFilter =
        petStarlingerStatusFilter !== "all"
          ? petStarlingerStatusFilter
          : undefined;
      const stationId = selectedStation?.id;
      const response = await productionApi.getFinalPackingLogs(
        petStarlingerSelectedDate,
        petStarlingerSearchQuery || undefined,
        statusFilter,
        petStarlingerCurrentPage,
        10,
        petStarlingerSelectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
        stationId,
      );
      if (response.data.success) {
        setPetStarlingerLogs(response.data.data);
        setPetStarlingerTotalPages(response.data.pagination.totalPages);
        setPetStarlingerTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading PET Starlinger logs:", error);
    } finally {
      setPetStarlingerLogsLoading(false);
    }
  };

  /** PET Final Packing station: recent entries for this station only. */
  const loadPetFinalPackingLogs = async () => {
    try {
      setPetFinalPackingLogsLoading(true);
      const statusFilter =
        petFinalPackingStatusFilter !== "all"
          ? petFinalPackingStatusFilter
          : undefined;
      const stationId = selectedStation?.id;
      const response = await productionApi.getFinalPackingLogs(
        petFinalPackingSelectedDate,
        petFinalPackingSearchQuery || undefined,
        statusFilter,
        petFinalPackingCurrentPage,
        10,
        petFinalPackingSelectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
        stationId,
      );
      if (response.data.success) {
        setPetFinalPackingLogs(response.data.data);
        setPetFinalPackingTotalPages(response.data.pagination.totalPages);
        setPetFinalPackingTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading PET Final Packing logs:", error);
    } finally {
      setPetFinalPackingLogsLoading(false);
    }
  };


  const loadWashingLogs = async () => {
    // Load filtered entries when a sub-line is selected
    try {
      setWashingLogsLoading(true);
      // PET washing is single-line (no Line filter UI); always scope to current sub-line (e.g. Washing 1)
      const lineFilter =
        isPET && selectedStation?.name === "Washing"
          ? selectedSubLine || undefined
          : washingSelectedLineFilter !== "all"
            ? washingSelectedLineFilter
            : selectedSubLine || undefined;
      const statusFilter =
        washingSelectedStatusFilter !== "all"
          ? washingSelectedStatusFilter
          : undefined;

      const response = await productionApi.getWashingLogs(
        lineFilter,
        washingSelectedDate,
        washingSearchQuery || undefined,
        statusFilter,
        washingCurrentPage,
        10,
        washingSelectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
      );
      if (response.data.success) {
        setWashingLogs(response.data.data);
        setWashingTotalPages(response.data.pagination.totalPages);
        setWashingTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading washing logs:", error);
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
      const lineFilter =
        extrusionSelectedLineFilter !== "all"
          ? extrusionSelectedLineFilter
          : selectedSubLine || undefined;
      const statusFilter =
        extrusionSelectedStatusFilter !== "all"
          ? extrusionSelectedStatusFilter
          : undefined;

      const response = await productionApi.getExtrusionLogs(
        lineFilter,
        extrusionSelectedDate,
        extrusionSearchQuery || undefined,
        statusFilter,
        extrusionCurrentPage,
        10,
        extrusionSelectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
      );
      if (response.data.success) {
        setExtrusionLogs(response.data.data);
        setExtrusionTotalPages(response.data.pagination.totalPages);
        setExtrusionTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading extrusion logs:", error);
    } finally {
      setExtrusionLogsLoading(false);
    }
  };

  const loadPackingLogs = async () => {
    try {
      setPackingLogsLoading(true);
      const statusFilter =
        packingSelectedStatusFilter !== "all"
          ? packingSelectedStatusFilter
          : undefined;
      const response = await productionApi.getFinalPackingLogs(
        packingSelectedDate,
        packingSearchQuery || undefined,
        statusFilter,
        packingCurrentPage,
        10,
        packingSelectedDate === formatDateLocal(new Date())
          ? backendShiftId
          : undefined,
        selectedStation?.id,
      );
      if (response.data.success) {
        setPackingLogs(response.data.data);
        setPackingTotalPages(response.data.pagination.totalPages);
        setPackingTotalLogs(response.data.pagination.total);
      }
    } catch (error) {
      console.error("Error loading packing logs:", error);
    } finally {
      setPackingLogsLoading(false);
    }
  };

  useEffect(() => {
    // Pellet Packing: keep the chosen input bag when moving Input → Output so the
    // output log can carry input_bag_qr (PKG/EXT source); all other transitions clear as usual.
    if (
      isPelletPackingStation(selectedStation) &&
      selectedSection === "output"
    ) {
      setBagSearchQuery("");
      setSuggestedBags([]);
      setShowSuggestions(false);
      return;
    }
    // Clear selected input bag when station or section changes
    setSelectedInputBag(null);
    setBagSearchQuery("");
    setSuggestedBags([]);
    setShowSuggestions(false);
  }, [selectedStation, selectedSection, selectedSubLine]);

  // Calculate crusher totals from shiftLogs for the current sub-line
  useEffect(() => {
    const isCrusherStation =
      selectedStation?.name?.toLowerCase().includes("crusher") ||
      selectedStation?.code === "CRS";
    if (!isCrusherStation || !backendShiftId || !selectedSubLine) {
      if (selectedStation?.name?.toLowerCase().includes("crusher")) {
        setCurrentViewBags(0);
        setCurrentViewWeight(0);
      }
      return;
    }
    const logs = shiftLogs.filter(
      (log: any) =>
        log.station_id === selectedStation?.id &&
        log.shift_id === backendShiftId &&
        log.sub_line === selectedSubLine,
    );
    setCurrentViewBags(logs.length);
    setCurrentViewWeight(
      logs.reduce(
        (acc: number, log: any) => acc + (Number(log.weight) || 0),
        0,
      ),
    );
  }, [shiftLogs, selectedStation, selectedSubLine, backendShiftId]);

  // Calculate washing totals from shiftLogs for the current sub-line
  useEffect(() => {
    const isWashingStation =
      selectedStation?.name?.toLowerCase().includes("washing") ||
      selectedStation?.code === "WSH";
    if (!isWashingStation || !backendShiftId) {
      if (isWashingStation) {
        setCurrentViewBags(0);
        setCurrentViewWeight(0);
      }
      return;
    }
    // PET Washing: no sub-line concept — filter by station + shift + material type
    // PC/PE Washing: requires selectedSubLine to be set
    if (!isPET && !selectedSubLine) {
      setCurrentViewBags(0);
      setCurrentViewWeight(0);
      return;
    }
    const logs = shiftLogs.filter((log: any) => {
      const matchesStation = log.station_id === selectedStation?.id;
      const matchesShift = log.shift_id === backendShiftId;
      if (isPET)
        return (
          matchesStation &&
          matchesShift &&
          log.material_type_id === user?.materialTypeId
        );
      return matchesStation && matchesShift && log.sub_line === selectedSubLine;
    });
    setCurrentViewBags(logs.length);
    setCurrentViewWeight(
      logs.reduce(
        (acc: number, log: any) => acc + (Number(log.weight) || 0),
        0,
      ),
    );
  }, [
    shiftLogs,
    selectedStation,
    selectedSubLine,
    backendShiftId,
    isPET,
    user?.materialTypeId,
  ]);

  // Calculate final packing / Starlinger output totals from shiftLogs
  useEffect(() => {
    const isPackingStation =
      isPelletPackingStation(selectedStation) ||
      selectedStation?.id === 5 ||
      selectedStation?.name?.toLowerCase().includes("final") ||
      (selectedStation?.name?.toLowerCase().includes("re-packaging") &&
        !isPET) ||
      (isPET && isPetStarlingerOrFinalStation(selectedStation));
    if (!isPackingStation || !backendShiftId) {
      if (isPackingStation) {
        setCurrentViewBags(0);
        setCurrentViewWeight(0);
      }
      return;
    }
    let logs = shiftLogs.filter((log: any) =>
      shiftLogMatchesStationShiftMaterial(
        log,
        selectedStation?.id,
        backendShiftId,
        user?.materialTypeId ?? null,
      ),
    );
    if (isPET && isPetStarlingerLine(selectedStation)) {
      logs = logs.filter((log: any) => log.sub_line === "Pellet PET");
    } else if (isPET && isPetFinalPackingLine(selectedStation)) {
      logs = logs.filter((log: any) => log.sub_line === "Final PET");
    }
    setCurrentViewBags(logs.length);
    setCurrentViewWeight(
      logs.reduce(
        (acc: number, log: any) => acc + (Number(log.weight) || 0),
        0,
      ),
    );
  }, [shiftLogs, selectedStation, backendShiftId, isPET, user?.materialTypeId]);

  // Calculate extrusion totals based on material type and shift
  useEffect(() => {
    // Check if current station is Extrusion (by name, id, or code)
    const isExtrusionStation =
      selectedStation?.name?.toLowerCase().includes("extrusion") ||
      selectedStation?.id === 4 ||
      selectedStation?.code === "EXT" ||
      selectedStation?.code === "EXTR";

    if (isExtrusionStation && backendShiftId && user?.materialTypeId) {
      // Filter shiftLogs for extrusion outputs matching:
      // - station_id = 4 (Extrusion) or matches selectedStation.id
      // - material_type_id = user's material type
      // - shift_id = current shift
      // - sub_line = selectedSubLine (if selected)
      const extrusionLogs = shiftLogs.filter((log: any) => {
        const matchesStation =
          log.station_id === 4 || log.station_id === selectedStation?.id;
        const matchesMaterial = log.material_type_id === user.materialTypeId;
        const matchesShift = log.shift_id === backendShiftId;
        const matchesSubLine =
          !selectedSubLine || log.sub_line === selectedSubLine;

        return (
          matchesStation && matchesMaterial && matchesShift && matchesSubLine
        );
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
  }, [
    shiftLogs,
    selectedStation,
    selectedSubLine,
    backendShiftId,
    user?.materialTypeId,
  ]);

  // For SELECT STATION screen: only count logs from current date (same for PC and PE)
  const shiftLogsToday = useMemo(() => {
    const today = formatDateLocal(new Date());
    return shiftLogs.filter(
      (l: any) =>
        l.created_at && formatDateLocal(new Date(l.created_at)) === today,
    );
  }, [shiftLogs]);

  /** PET: fixed line Crusher → Washing → Boretech → Starlinger → Final Packing */
  const petStationsForGrid = useMemo(() => {
    if (!isPET) return stations;
    const filtered = stations.filter((s) => {
      const crush =
        s.name?.toLowerCase().includes("crusher") || (s as any).code === "CRS";
      const wash =
        s.name?.toLowerCase().includes("washing") || (s as any).code === "WSH";
      const bore = isExtrusionPackagingStation(s);
      return (
        crush ||
        wash ||
        bore ||
        isPetStarlingerLine(s) ||
        isPetFinalPackingLine(s) ||
        isPelletPackingStation(s)
      );
    });
    const orderRank = (s: Station) => {
      if (
        s.name?.toLowerCase().includes("crusher") ||
        (s as any).code === "CRS"
      )
        return 0;
      if (
        s.name?.toLowerCase().includes("washing") ||
        (s as any).code === "WSH"
      )
        return 1;
      if (isExtrusionPackagingStation(s)) return 2;
      if (isPetStarlingerLine(s)) return 3;
      if (isPetFinalPackingLine(s)) return 4;
      if (isPelletPackingStation(s)) return 5;
      return 99;
    };
    let sorted = [...filtered].sort(
      (a, b) => orderRank(a) - orderRank(b) || a.id - b.id,
    );
    // API often has only "Final Packing" — insert a Starlinger menu row above it (same backend station id for Pellet PET).
    const hasDbStarlingerRow = filtered.some((s) => {
      if (isExtrusionPackagingStation(s)) return false;
      const n = (s.name || "").toLowerCase();
      return n.includes("starlinger") || n.includes("re-packaging");
    });
    const finalIdx = sorted.findIndex((s) => isPetFinalPackingLine(s));
    if (!hasDbStarlingerRow && finalIdx >= 0) {
      const base = sorted[finalIdx];
      const starlingerUi: Station = {
        ...base,
        name: "Starlinger",
        petUiSegment: "starlinger",
        displayName: "Starlinger",
        description: "Pellets from Boretech — Flakes PET in / Pellet PET out",
        color: "#7c3aed",
      } as Station;
      sorted = [
        ...sorted.slice(0, finalIdx),
        starlingerUi,
        ...sorted.slice(finalIdx),
      ];
    }
    return sorted;
  }, [isPET, stations]);

  /** PE: fixed order Crusher → Washing → Extrusion → Final / Re-Packaging */
  const peStationsForGrid = useMemo(() => {
    if (!isPE) return stations;
    const rank = (s: Station) => {
      const n = (s.name || "").toLowerCase();
      const code = String((s as any).code || "").toUpperCase();
      if (n.includes("crusher") || code === "CRS") return 0;
      if (n.includes("washing") || code === "WSH") return 1;
      if (
        isExtrusionPackagingStation(s) ||
        ((n.includes("extrusion") || n.includes("extruder")) &&
          !n.includes("label"))
      )
        return 2;
      if (isPelletPackingStation(s)) return 4;
      if (
        n.includes("final") ||
        n.includes("re-packaging") ||
        n.includes("packing") ||
        ["PKG", "FP", "FIN", "PACK"].includes(code)
      )
        return 3;
      return 10;
    };
    return [...stations].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  }, [isPE, stations]);

  useEffect(() => {
    // Load logs when in Crusher station view (whether sub-line is selected or not)
    if (selectedStation?.name === "Crusher") {
      if (isPE) loadPeCrusherLogs();
      else loadCrusherLogs();
    }
    // Load logs when in Washing station view. Previously skipped for PE
    // because Recent Entries was hidden — now PE also sees the list, so we
    // need to fetch washingLogs for them too.
    if (selectedStation?.name === "Washing") {
      loadWashingLogs();
    }
    // Load logs when in Extrusion station view (whether sub-line is selected or not)
    if (isExtrusionPackagingStation(selectedStation)) {
      if (isPE) loadPeExtrusionLogs();
      else if (isPET) loadPetBoretechLogs();
      else loadExtrusionLogs();
    }
    // Pellet Packing (PLT): reuses Final Packing list state (loadPackingLogs filters by station id)
    if (isPelletPackingStation(selectedStation)) {
      loadPackingLogs();
    }
    // Load logs when in PET Starlinger vs Final Packing (separate list state per station)
    // Starlinger: skip list fetch while Input/Output form is open — Recent Entries hidden there
    if (isPET && isPetStarlingerLine(selectedStation) && !selectedSection) {
      loadPetStarlingerLogs();
    } else if (isPET && isPetFinalPackingLine(selectedStation)) {
      loadPetFinalPackingLogs();
    } else if (
      selectedStation?.id === 5 ||
      selectedStation?.name?.toLowerCase().includes("final") ||
      selectedStation?.name?.toLowerCase().includes("re-packaging")
    ) {
      loadPackingLogs();
    }
  }, [
    backendShiftId,
    selectedSubLine,
    selectedSection,
    selectedDate,
    searchQuery,
    currentPage,
    selectedStation,
    selectedLineFilter,
    selectedStatusFilter,
    washingSelectedDate,
    washingSearchQuery,
    washingCurrentPage,
    washingSelectedLineFilter,
    washingSelectedStatusFilter,
    extrusionSelectedDate,
    extrusionSearchQuery,
    extrusionCurrentPage,
    extrusionSelectedLineFilter,
    extrusionSelectedStatusFilter,
    packingSelectedDate,
    packingSearchQuery,
    packingCurrentPage,
    packingSelectedStatusFilter,
    isPE,
    isPET,
    peCrusherSelectedDate,
    peCrusherSearchQuery,
    peCrusherCurrentPage,
    peCrusherLineFilter,
    peCrusherStatusFilter,
    peExtrusionSelectedDate,
    peExtrusionSearchQuery,
    peExtrusionCurrentPage,
    peExtrusionLineFilter,
    peExtrusionStatusFilter,
    petBoretechSelectedDate,
    petBoretechSearchQuery,
    petBoretechCurrentPage,
    petBoretechStatusFilter,
    petStarlingerSelectedDate,
    petStarlingerSearchQuery,
    petStarlingerCurrentPage,
    petStarlingerStatusFilter,
    petFinalPackingSelectedDate,
    petFinalPackingSearchQuery,
    petFinalPackingCurrentPage,
    petFinalPackingStatusFilter,
  ]);

  useEffect(() => {
    if (showShiftClosedView && closedShiftId) {
      fetchClosedShiftByProducts();
    }
  }, [showShiftClosedView, closedShiftId, fetchClosedShiftByProducts]);

  const handleStationSelect = (station: Station) => {
    setCurrentViewBags(0);
    setCurrentViewWeight(0);

    // Pellet Packing (PLT): no sub-line; show the same INPUT/OUTPUT modal as Final Packaging (PC/PE/PET)
    if (isPelletPackingStation(station)) {
      setSelectedSubLine(null);
      if (isShiftEnded) {
        // Shift ended — view-only, skip the INPUT/OUTPUT modal
        setSelectedStation(station);
        setSelectedSection(null);
      } else {
        setPendingStation(station);
        setShowStationModal(true);
      }
      return;
    }

    // PET: auto-set sub-line on station entry (no selection step needed for Crusher/Boretech/Starlinger)
    if (isPET) {
      if (station.name === "Crusher") {
        setSelectedStation(station);
        setSelectedSubLine("Rapid");
        setSelectedSection(null);
        return;
      }
      if (isExtrusionPackagingStation(station)) {
        setSelectedStation(station);
        setSelectedSubLine("Flakes PET");
        setSelectedSection(null);
        return;
      }
      if (station.name === "Washing") {
        setSelectedStation(station);
        setSelectedSubLine("Washing 1");
        setSelectedSection(null);
        return;
      }
      if (isPetStarlingerLine(station)) {
        setSelectedStation(station);
        setSelectedSubLine("Pellet PET");
        setSelectedSection(null);
        return;
      }
      if (isPetFinalPackingLine(station)) {
        setSelectedStation(station);
        setSelectedSubLine("Final PET");
        setSelectedSection(null);
        return;
      }
      // PET Washing: fall through to standard selection
    }

    if (
      station.name === "Label Removal" ||
      station.name === "Crusher" ||
      station.name === "Washing" ||
      isExtrusionPackagingStation(station)
    ) {
      setSelectedStation(station);
      setSelectedSection(null);
    } else if (isShiftEnded) {
      // Shift ended — go straight to view-only, skip the INPUT/OUTPUT modal
      setSelectedStation(station);
      setSelectedSection(null);
    } else {
      setPendingStation(station);
      setShowStationModal(true);
    }
  };

  const handleTakePhoto = async () => {
    // Web: CameraView preview is unreliable — use image picker (gallery / file chooser).
    if (Platform.OS === "web") {
      try {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            t("common.error"),
            t("messages.cameraPermissionRequired"),
          );
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: false,
          quality: 0.7,
        });
        if (!result.canceled && result.assets?.[0]?.uri) {
          setCapturedImages((prev) => [...prev, result.assets[0].uri]);
        }
      } catch (e) {
        console.error("Web image pick error:", e);
        Alert.alert(t("common.error"), t("messages.failedToCapturePhoto"));
      }
      return;
    }
    if (hasPermission === false) {
      Alert.alert(t("common.error"), t("messages.cameraPermissionRequired"));
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
        console.error("Error capturing photo:", error);
        Alert.alert(t("common.error"), t("messages.failedToCapturePhoto"));
      }
    }
  };

  const handleAcceptPhoto = () => {
    if (tempCapturedImage) {
      setCapturedImages((prev) => [...prev, tempCapturedImage]);
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

  const handleBarCodeScanned = async (event: any) => {
    if (scanned) return; // Prevent multiple scans
    setScanned(true);
    try {
      // Support multiple barcode callback shapes: { data }, { type, data }, { nativeEvent: { data } }
      const raw =
        typeof event?.data === "string"
          ? event.data
          : event?.nativeEvent?.data != null
            ? String(event.nativeEvent.data)
            : typeof event === "string"
              ? event
              : "";
      if (!raw || String(raw).trim() === "") {
        setScanned(false);
        return;
      }

      let qrCode: string;
      let weight: number = 0;

      // Parse QR code data (may be JSON like {"id":"20260306-PC-S2-CRP-032","weight":890} or plain ID)
      try {
        const parsed = JSON.parse(raw);
        qrCode = (
          parsed.id ??
          parsed.output_bag_qr ??
          parsed.outputBagQr ??
          raw
        )
          .toString()
          .trim();
        weight = Number(parsed.weight) || 0;
      } catch {
        qrCode = String(raw).trim();
      }
      // If QR looks like a URL, take the last path segment as batch ID (e.g. .../batch/20260306-PC-S2-CRP-032)
      if (qrCode.startsWith("http") && qrCode.includes("/")) {
        const segment = qrCode.replace(/\/+$/, "").split("/").pop();
        if (segment && segment.length > 5) qrCode = segment;
      }
      if (!qrCode) {
        setScanned(false);
        return;
      }

      // If scanning for crusher DN No., capture the scanned value directly
      if (scanningForDnNo) {
        setCrusherDnNo(qrCode);
        setCrusherDnNoInput(qrCode);
        await AsyncStorage.setItem("crusher_dn_no", qrCode);
        setScanningForDnNo(false);
        setShowScanner(false);
        setScanned(false);
        return;
      }

      // Validate the scanned QR code matches the expected batch type (same flow as search)
      // Washing input: Crusher batches only. Extrusion input: Washing batches only.
      let targetStationId: number | undefined;
      let statusFilter: string | undefined;
      let expectedStationName: string = "";
      let usePetBoretechMergedSearch = false;
      let usePetFinalPackingMergedSearch = false;
      let usePelletPackingMergedSearch = false;

      // Betty crusher input: search for 3E/Rapid crusher bags
      const isBettyCrusherInput =
        selectedSection === "input" &&
        selectedStation?.name?.toLowerCase().includes("crusher") &&
        selectedSubLine === "Betty";

      if (isBettyCrusherInput) {
        const response = await productionApi.searchLogs(
          qrCode,
          selectedStation!.id,
          selectedStation!.id,
          "pending",
          ["3E", "Rapid"],
          undefined,
          true,
        );
        if (response.data.success && response.data.data.length > 0) {
          const matchedBatch = response.data.data[0];
          setSelectedInputBag({
            output_bag_qr: matchedBatch.output_bag_qr,
            weight: matchedBatch.weight || weight,
          });
          setShowScanner(false);
        } else {
          Alert.alert(
            "Invalid Batch",
            "This QR is not a valid 3E or Rapid crusher bag with pending status.",
          );
          setScanned(false);
        }
        return;
      }

      if (
        selectedSection === "input" &&
        (selectedStation?.id === 3 ||
          selectedStation?.name?.toLowerCase().includes("washing"))
      ) {
        // Washing input: only crusher bags (3E, Rapid, Betty) with pending status
        // For PET: only PET Rapid crusher bags (same station id but backend scopes by shift)
        targetStationId = 2;
        statusFilter = "pending";
        expectedStationName = "crusher";
      } else if (
        selectedSection === "input" &&
        isExtrusionPackagingStation(selectedStation)
      ) {
        if (isPE) {
          // PE Extrusion: input comes from Crusher-Washing (CRS) bags
          const crsStation = stations.find(
            (s) =>
              (s as any).code === "CRS" ||
              s.name?.toLowerCase().includes("crusher"),
          );
          targetStationId = crsStation?.id ?? 2;
          expectedStationName = "Crusher-Washing";
        } else if (isPET) {
          usePetBoretechMergedSearch = true;
          expectedStationName = "Crusher (Rapid) or Washing";
        } else {
          targetStationId = 3;
          expectedStationName = "washing";
        }
        statusFilter = "pending";
      } else if (
        selectedSection === "input" &&
        isPelletPackingStation(selectedStation)
      ) {
        // Pellet Packing input: pending Final Packaging (PKG) or pending Extrusion (EXT) bags
        usePelletPackingMergedSearch = true;
        expectedStationName = "Final Packaging or Extrusion";
      } else if (
        selectedSection === "input" &&
        (selectedStation?.id === 5 ||
          selectedStation?.name?.toLowerCase().includes("final") ||
          selectedStation?.name?.toLowerCase().includes("re-packaging") ||
          (isPET && isPetStarlingerLine(selectedStation)))
      ) {
        const extStation = stations.find(
          (s: Station) =>
            s.name?.toLowerCase().includes("extrusion") ||
            (s as any).code === "EXT",
        );
        const washStation = stations.find(
          (s: Station) =>
            s.name?.toLowerCase().includes("washing") ||
            (s as any).code === "WSH",
        );
        if (isPET && isPetFinalPackingLine(selectedStation)) {
          usePetFinalPackingMergedSearch = true;
          expectedStationName = "Boretech or Starlinger";
        } else if (isPET && extStation) {
          targetStationId = extStation.id;
          expectedStationName = "Boretech";
        } else if (extStation) {
          targetStationId = extStation.id;
          expectedStationName = "extrusion";
        } else if (washStation) {
          targetStationId = washStation.id;
          expectedStationName = "washing";
        }
        statusFilter = "pending";
      }

      if (usePelletPackingMergedSearch && selectedStation) {
        const pkgId = findStationIdByCode(stations, "PKG", "final");
        const extId = findStationIdByCode(stations, "EXT", "extrusion");
        const pltSid = selectedStation.id;
        const [rPkg, rExt] = await Promise.all([
          pkgId != null
            ? productionApi.searchLogs(
                qrCode,
                pkgId,
                pltSid,
                "pending",
                undefined,
                undefined,
                true,
              )
            : Promise.resolve({ data: { success: true, data: [] as any[] } }),
          extId != null
            ? productionApi.searchLogs(
                qrCode,
                extId,
                pltSid,
                "pending",
                undefined,
                undefined,
                true,
              )
            : Promise.resolve({ data: { success: true, data: [] as any[] } }),
        ]);
        const merged = mergePelletPackingInputRows(
          rPkg.data.success ? rPkg.data.data || [] : [],
          rExt.data.success ? rExt.data.data || [] : [],
        );
        const normalized = normalizeSuggestedBags(merged);
        const matchedBatch =
          normalized.find((b) => getBagDisplayId(b) === qrCode) ||
          normalized.find(
            (b) => getBagDisplayId(b).toLowerCase() === qrCode.toLowerCase(),
          );
        if (matchedBatch) {
          setSelectedInputBag({
            output_bag_qr: matchedBatch.output_bag_qr,
            weight: matchedBatch.weight || weight,
            ...(matchedBatch.pet_upstream_source
              ? { pet_upstream_source: matchedBatch.pet_upstream_source }
              : {}),
            ...(matchedBatch.sub_line
              ? { sub_line: matchedBatch.sub_line }
              : {}),
          });
          setShowScanner(false);
        } else {
          Alert.alert(
            "Invalid Batch",
            "This QR is not a valid Final Packaging (pending) or Extrusion (pending) bag.",
          );
          setScanned(false);
        }
        return;
      }

      if (usePetFinalPackingMergedSearch && selectedStation) {
        const boreSt = stations.find((s) => isExtrusionPackagingStation(s));
        const stlId = getPetStarlingerBackendStationId(stations);
        const sid = selectedStation.id;
        const [rBore, rStl] = await Promise.all([
          boreSt
            ? productionApi.searchLogs(
                qrCode,
                boreSt.id,
                sid,
                "pending",
                ["Flakes PET"],
                undefined,
                true,
              )
            : Promise.resolve({ data: { success: true, data: [] as any[] } }),
          stlId != null
            ? productionApi.searchLogs(
                qrCode,
                stlId,
                sid,
                "pending",
                ["Pellet PET"],
                undefined,
                true,
              )
            : Promise.resolve({ data: { success: true, data: [] as any[] } }),
        ]);
        const merged = mergePetFinalPackingInputRows(
          rBore.data.success ? rBore.data.data || [] : [],
          rStl.data.success ? rStl.data.data || [] : [],
        );
        const normalized = normalizeSuggestedBags(merged);
        const matchedBatch =
          normalized.find((b) => getBagDisplayId(b) === qrCode) ||
          normalized.find(
            (b) => getBagDisplayId(b).toLowerCase() === qrCode.toLowerCase(),
          );
        if (matchedBatch) {
          setSelectedInputBag({
            output_bag_qr: matchedBatch.output_bag_qr,
            weight: matchedBatch.weight || weight,
            ...(matchedBatch.pet_upstream_source
              ? { pet_upstream_source: matchedBatch.pet_upstream_source }
              : {}),
            ...(matchedBatch.sub_line
              ? { sub_line: matchedBatch.sub_line }
              : {}),
          });
          setShowScanner(false);
        } else {
          Alert.alert(
            "Invalid Batch",
            "This QR is not a valid pending bag from Boretech (Flakes PET) or Starlinger (Pellet PET).",
          );
          setScanned(false);
        }
        return;
      }

      if (usePetBoretechMergedSearch && selectedStation) {
        const crushId = findStationIdByCode(stations, "CRS", "crusher") ?? 2;
        const washId = findStationIdByCode(stations, "WSH", "washing") ?? 3;
        const sid = selectedStation.id;
        const [rCrush, rWash] = await Promise.all([
          productionApi.searchLogs(
            qrCode,
            crushId,
            sid,
            "pending",
            PET_CRUSHER_RAPID_INPUT_SUB_LINES,
            undefined,
            true,
          ),
          productionApi.searchLogs(
            qrCode,
            washId,
            sid,
            "pending",
            undefined,
            undefined,
            true,
          ),
        ]);
        const merged = mergePetBoretechInputRows(
          rCrush.data.success ? rCrush.data.data || [] : [],
          rWash.data.success ? rWash.data.data || [] : [],
        );
        const normalized = normalizeSuggestedBags(merged);
        const matchedBatch =
          normalized.find((b) => getBagDisplayId(b) === qrCode) ||
          normalized.find(
            (b) => getBagDisplayId(b).toLowerCase() === qrCode.toLowerCase(),
          );
        if (matchedBatch) {
          setSelectedInputBag({
            output_bag_qr: matchedBatch.output_bag_qr,
            weight: matchedBatch.weight || weight,
            ...(matchedBatch.pet_upstream_source
              ? { pet_upstream_source: matchedBatch.pet_upstream_source }
              : {}),
            ...(matchedBatch.sub_line
              ? { sub_line: matchedBatch.sub_line }
              : {}),
          });
          setShowScanner(false);
        } else {
          Alert.alert(
            "Invalid Batch",
            "This QR is not a valid pending bag from Crusher (Rapid) or Washing.",
          );
          setScanned(false);
        }
        return;
      }

      // If we have a target station, validate the QR code
      if (targetStationId && statusFilter) {
        // For PC washing: restrict source bags to crusher sub-lines (3E, Rapid, Betty). PE washing uses CRS sub-lines (Flakes PE SUPER, etc.) — no filter so backend uses material type. PET washing: only Rapid sub-line bags.
        const isWashingInput =
          selectedSection === "input" &&
          (selectedStation?.id === 3 ||
            selectedStation?.name?.toLowerCase().includes("washing"));
        let sourceSubLines =
          isWashingInput && !isPE && !isPET
            ? ["3E", "Rapid", "Betty"]
            : isWashingInput && isPET
              ? [...PET_CRUSHER_RAPID_INPUT_SUB_LINES]
              : undefined;
        const extStn = stations.find((s: Station) =>
          isExtrusionPackagingStation(s),
        );
        if (
          !sourceSubLines &&
          isPET &&
          extStn &&
          targetStationId === extStn.id
        ) {
          sourceSubLines = ["Flakes PET"];
        }

        const response = await productionApi.searchLogs(
          qrCode,
          targetStationId,
          selectedStation?.id,
          statusFilter,
          sourceSubLines,
          undefined,
          true,
        );
        if (response.data.success && response.data.data.length > 0) {
          // Found matching batch - show batch no., user taps Save to process (same as manual search)
          const matchedBatch = response.data.data[0];
          setSelectedInputBag({
            output_bag_qr: matchedBatch.output_bag_qr,
            weight: matchedBatch.weight || weight,
          });
          setShowScanner(false); // Close scanner only on success
        } else {
          // QR code doesn't match expected batch type (e.g. not a Crusher batch for Washing)
          Alert.alert(
            "Invalid Batch",
            `This QR code is not a valid ${expectedStationName} batch with pending status. Please scan a ${expectedStationName} batch QR code.`,
          );
          setScanned(false); // Allow scanning again
        }
      } else {
        // For other stations, just set the scanned data
        setSelectedInputBag({ output_bag_qr: qrCode, weight });
        setShowScanner(false); // Close scanner
      }
    } catch (error) {
      console.error("Scan validation error:", error);
      Alert.alert(t("common.error"), t("messages.failedToValidate"));
      setScanned(false); // Allow scanning again
    }
  };

  const handleWeightInputChange = (text: string) =>
    setWeightInput(filterNumericWeight(text));

  const clearCrusherDn = () => {
    setCrusherDnNo("");
    setCrusherDnNoInput("");
    setCrusherDnId(null);
    setCrusherDnNetWeight(null);
    setDnSearchQuery("");
    setDnDropdownVisible(false);
    setDnSearchResults([]);
    AsyncStorage.removeItem("crusher_dn_no");
    AsyncStorage.removeItem("crusher_dn_id");
    AsyncStorage.removeItem("crusher_dn_net_weight");
  };

  const searchDeliveryNotes = async (query: string) => {
    setDnSearchLoading(true);
    try {
      const res = await productionApi.getDeliveryNotes(query);
      if (res.data?.success) {
        setDnSearchResults(res.data.data || []);
        setDnDropdownVisible(true);
      }
    } catch {
      setDnSearchResults([]);
    } finally {
      setDnSearchLoading(false);
    }
  };

  const handleDnSearchChange = (text: string) => {
    setDnSearchQuery(text);
    setDnDropdownVisible(false);
    if (dnSearchTimerRef.current) clearTimeout(dnSearchTimerRef.current);
    if (text.trim().length > 0) {
      dnSearchTimerRef.current = setTimeout(() => {
        searchDeliveryNotes(text.trim());
      }, 400);
    } else {
      setDnSearchResults([]);
    }
  };

  const selectDn = async (item: { id: number; deliveryNote: string; netWeight: number }) => {
    setCrusherDnNo(item.deliveryNote);
    setCrusherDnNoInput(item.deliveryNote);
    setCrusherDnId(item.id);
    setCrusherDnNetWeight(item.netWeight);
    setDnSearchQuery(item.deliveryNote);
    setDnDropdownVisible(false);
    setDnSearchResults([]);
    await AsyncStorage.setItem("crusher_dn_no", item.deliveryNote);
    await AsyncStorage.setItem("crusher_dn_id", String(item.id));
    await AsyncStorage.setItem("crusher_dn_net_weight", String(item.netWeight));
    try {
      await productionApi.markDeliveryNoteCompleted(item.id);
    } catch (e) {
      console.error("Failed to mark DN as completed", e);
    }
  };

  /** Crusher DN No. card — searchable dropdown from raw_material.deliveryNote (PET only). */
  const renderCrusherDnNoSection = () => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeaderRow}>
        <View style={[styles.typePill, { backgroundColor: "#E0F2FE" }]}>
          <Text style={[styles.typePillText, { color: "#0369A1" }]}>INPUT</Text>
        </View>
        <Text style={styles.sectionTitleText}>Delivery Note (DN No.)</Text>
      </View>

      {/* Active DN badge */}
      {crusherDnNo ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "#D1FAE5",
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: "#6EE7B7",
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: "#065F46", fontWeight: "600", marginBottom: 2 }}>
              Active DN No.
            </Text>
            <Text style={{ fontSize: 16, color: "#065F46", fontWeight: "700" }}>
              {crusherDnNo}
            </Text>
            {crusherDnNetWeight != null && (
              <Text style={{ fontSize: 12, color: "#047857", marginTop: 3 }}>
                Net Weight: {crusherDnNetWeight.toLocaleString()} kg
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={clearCrusherDn} style={{ padding: 4 }}>
            <X size={18} color="#EF4444" />
          </TouchableOpacity>
        </View>
      ) : (
        <View
          style={{
            backgroundColor: "#FEF3C7",
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginBottom: 10,
            borderWidth: 1,
            borderColor: "#FDE047",
          }}
        >
          <Text style={{ fontSize: 12, color: "#92400E", fontWeight: "600" }}>
            No DN No. selected — search below
          </Text>
        </View>
      )}

      {/* Search input */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Search size={16} color="#94A3B8" style={{ marginRight: 6 }} />
          <TextInput
            style={[styles.searchInput, { flex: 1 }]}
            placeholder="Search Delivery Note..."
            placeholderTextColor="#94A3B8"
            value={dnSearchQuery}
            onChangeText={handleDnSearchChange}
            returnKeyType="search"
            autoCapitalize="none"
          />
          {dnSearchLoading && <ActivityIndicator size="small" color="#0369a1" style={{ marginLeft: 6 }} />}
          {dnSearchQuery.length > 0 && !dnSearchLoading && (
            <TouchableOpacity
              onPress={() => { setDnSearchQuery(""); setDnSearchResults([]); setDnDropdownVisible(false); }}
              style={{ padding: 2 }}
            >
              <X size={14} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Dropdown results */}
      {dnDropdownVisible && dnSearchResults.length > 0 && (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#E2E8F0",
            borderRadius: 8,
            marginTop: 4,
            backgroundColor: "#fff",
            maxHeight: 220,
            overflow: "hidden",
          }}
        >
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {dnSearchResults.map((item, idx) => (
              <TouchableOpacity
                key={item.id}
                onPress={() => selectDn(item)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderBottomWidth: idx < dnSearchResults.length - 1 ? 1 : 0,
                  borderBottomColor: "#F1F5F9",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#1E293B" }}>
                    {item.deliveryNote}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                    Net Weight: {item.netWeight.toLocaleString()} kg
                  </Text>
                </View>
                <ChevronRight size={16} color="#CBD5E1" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {dnDropdownVisible && dnSearchResults.length === 0 && !dnSearchLoading && (
        <View style={{ paddingVertical: 12, alignItems: "center" }}>
          <Text style={{ fontSize: 13, color: "#94A3B8" }}>No delivery notes found</Text>
        </View>
      )}
    </View>
  );

  const handleLogProduction = async () => {
    if (
      !isValidProductionWeightInput(weightInput) ||
      !backendShiftId ||
      !selectedStation
    )
      return;
    const weightNum = parseFloat(weightInput.trim());
    if (isShiftEnded) {
      Alert.alert("Shift Ended", "Cannot add output after shift has ended.");
      return;
    }
    try {
      setIsLoading(true);
      setIsCurrentLogSaved(false);

      // For PE: translate the output type / sub-line to a short QR code
      let qrSubLine: string | undefined = selectedSubLine || undefined;
      if (isPelletPackingStation(selectedStation)) {
        // Pellet Packing has no sub-line — QR comes from the station code (…-PLT-001)
        qrSubLine = undefined;
      } else if (isPE) {
        const isExtStn = selectedStation.name
          ?.toLowerCase()
          .includes("extrusion");
        if (isExtStn) {
          // Extrusion: sub-line is 'Pellet PE SUPER' | 'Pellet EVA SUPER'
          qrSubLine = getPeOutputCode(selectedSubLine || "");
        } else {
          // Crusher-Washing: use peOutputType (e.g. 'Flakes PE SUPER')
          qrSubLine = getPeOutputCode(peOutputType || "");
        }
      } else if (isPET) {
        const isBoretechStn = selectedStation.name
          ?.toLowerCase()
          .includes("extrusion");
        if (isBoretechStn) {
          qrSubLine = "Flakes PET";
        } else if (isPetStarlingerLine(selectedStation)) {
          qrSubLine = "Pellet PET";
        } else if (isPetFinalPackingLine(selectedStation)) {
          qrSubLine = "Final PET";
        } else {
          qrSubLine = "Rapid";
        }
      }

      const response = await productionApi.getNextQr(
        selectedStation.id,
        backendShiftId,
        qrSubLine,
        selectedShift?.id,
      );
      if (response.data.success) {
        const qrCode = response.data.data?.qrCode;
        if (!qrCode || String(qrCode).trim() === "") {
          Alert.alert(t("common.error"), t("messages.failedToGenerateQR"));
          return;
        }
        // Use stationName from backend when it encodes sub-line; PET Starlinger vs Final Packing share PKG — prefer UI station name
        let stationDisplay =
          response.data.data.details?.stationName || selectedStation.name;
        if (isPET) {
          if (isPetStarlingerLine(selectedStation)) {
            stationDisplay =
              (selectedStation as any).displayName ||
              selectedStation.name ||
              "Starlinger";
          } else if (isPetFinalPackingLine(selectedStation)) {
            stationDisplay =
              (selectedStation as any).displayName ||
              selectedStation.name ||
              "Final Packing";
          } else if (isExtrusionPackagingStation(selectedStation)) {
            stationDisplay =
              (selectedStation as any).displayName ||
              response.data.data.details?.stationName ||
              "Boretech";
          }
        } else if (
          isPE &&
          selectedStation?.name?.toLowerCase().includes("crusher")
        ) {
          let compact = peCrusherCompactStationLabel(
            selectedStation.name || "",
            peOutputType || "",
          );
          if (!compact) {
            const d = String(
              response.data.data.details?.stationName || "",
            );
            const m = d.match(
              /Flakes PE Super|Flakes PE 1|Flakes EVA Super|Flakes EVA 1/i,
            );
            if (m) {
              compact = peCrusherCompactStationLabel(
                selectedStation.name || "",
                m[0],
              );
            }
          }
          if (compact) {
            stationDisplay = compact;
          }
        }
        const lineDisplay = selectedSubLine || selectedStation.name;
        const isRepackagingStation = selectedStation.name
          ?.toLowerCase()
          .includes("re-packaging");
        // Pellet Packing outputs are final — server defaults PLT logs to Completed
        const initialBagStatus =
          isRepackagingStation || isPelletPackingStation(selectedStation)
            ? ("Completed" as const)
            : ("pending" as const);
        setPreviewData({
          qrCode: String(qrCode).trim(),
          weight: String(weightNum),
          station: stationDisplay || selectedStation.name,
          line: lineDisplay,
          date: new Date().toLocaleDateString(),
          bagStatus: initialBagStatus,
        });
        setPreviewBagStatus(initialBagStatus);
        previewBagStatusRef.current = initialBagStatus;
        setShowPrintPreview(true);
      } else {
        Alert.alert(
          t("common.error"),
          response.data?.message || t("messages.failedToGenerateQR"),
        );
      }
    } catch (error) {
      Alert.alert(t("common.error"), t("messages.failedToGenerateQR"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProduction = async (
    statusAtTap?: "pending" | "Completed",
  ) => {
    if (!previewData || !backendShiftId || !selectedStation) return;
    const rawWeight = previewData.weight ?? weightInput;
    const savedWeight = parseFloat(String(rawWeight ?? "").trim());
    if (!Number.isFinite(savedWeight) || savedWeight <= 0) {
      Alert.alert(t("common.error"), t("messages.invalidWeight"));
      return;
    }
    if (isShiftEnded) {
      Alert.alert("Shift Ended", "Cannot add output after shift has ended.");
      return;
    }
    try {
      setIsLoading(true);
      // Status must be exactly what the user chose (Final = Completed, Temporary = pending). Prefer value passed at SAVE tap.
      const chosenStatus: "pending" | "Completed" =
        statusAtTap ?? previewBagStatusRef.current ?? previewBagStatus;
      const photoUrl =
        capturedImages.length > 0 ? capturedImages.join(",") : null;
      const saveSubLine = isPE
        ? selectedStation.name?.toLowerCase().includes("extrusion")
          ? selectedSubLine
          : selectedStation.name?.toLowerCase().includes("crusher")
            ? peOutputType
            : selectedSubLine
        : isPET
          ? selectedSubLine // 'Rapid' / 'Flakes PET' / 'Pellet PET' — already set by handleStationSelect
          : selectedSubLine;
      const isCrusherStn = selectedStation?.name
        ?.toLowerCase()
        .includes("crusher");
      const payload = {
        shiftId: backendShiftId,
        stationId: selectedStation.id,
        inputBagQr: selectedInputBag?.output_bag_qr || null,
        outputBagQr: previewData.qrCode,
        weight: savedWeight,
        status: chosenStatus === "Completed" ? "Completed" : "pending",
        subLine: saveSubLine || undefined,
        photoUrl: photoUrl,
        remark: remarkInput.trim() || undefined,
        shiftTypeId: selectedShift?.id,
        ...(isCrusherStn && crusherDnNo ? { dnNo: crusherDnNo } : {}),
      };
      const response = await productionApi.logProduction(payload);
      if (response.data.success) {
        const savedLog = response.data.data;
        const updatedLogs = [...shiftLogs, savedLog];
        setShiftLogs(updatedLogs);

        // When Betty saves its output, mark the consumed 3E/Rapid input bag as Completed
        if (
          selectedStation?.name?.toLowerCase().includes("crusher") &&
          selectedSubLine === "Betty" &&
          selectedInputBag?.output_bag_qr
        ) {
          try {
            await productionApi.updateLogStatus(
              selectedInputBag.output_bag_qr,
              "Completed",
              undefined,
              undefined,
              "Betty",
            );
          } catch (err) {
            console.error("Error marking input bag as Completed:", err);
          }
        }

        // Pellet Packing: an Extrusion input was 'pending' — mark it Completed so it leaves
        // the pending pool. Final Packing inputs need no update (server excludes consumed bags
        // via PLT rows whose input_bag_qr matches).
        if (
          isPelletPackingStation(selectedStation) &&
          selectedInputBag?.output_bag_qr &&
          (selectedInputBag as any).pet_upstream_source === "Extrusion"
        ) {
          try {
            await productionApi.updateLogStatus(
              selectedInputBag.output_bag_qr,
              "Completed",
            );
          } catch (err) {
            console.error("Error marking input bag as Completed:", err);
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
            console.error("Error reloading shift logs:", error);
          }
        }
        if (isPelletPackingStation(selectedStation)) {
          // Pellet Packing reuses the Final Packing list (packingLogs)
          await loadPackingLogs();
        } else if (isPET && isPetFinalPackingLine(selectedStation)) {
          await loadPetFinalPackingLogs();
        } else if (
          selectedStation?.id === 5 ||
          selectedStation?.name?.toLowerCase().includes("final") ||
          selectedStation?.name?.toLowerCase().includes("re-packaging")
        ) {
          // PE/PC Final Packaging & Re-Packaging use `packingLogs` (not PET Final Packing list).
          await loadPackingLogs();
        }

        // Crusher, Washing, Final Packing / PET post-Boretech, and Extrusion use useEffect to auto-recalculate from shiftLogs
        if (
          !isExtrusionPackagingStation(selectedStation) &&
          !isPelletPackingStation(selectedStation) &&
          !selectedStation?.name?.toLowerCase().includes("crusher") &&
          !selectedStation?.name?.toLowerCase().includes("washing") &&
          !selectedStation?.name?.toLowerCase().includes("final") &&
          !selectedStation?.name?.toLowerCase().includes("re-packaging") &&
          !(isPET && isPetStarlingerOrFinalStation(selectedStation))
        ) {
          setCurrentViewBags(0);
          setCurrentViewWeight(0);
        }
        // For extrusion/crusher/washing, the useEffect will automatically recalculate totals

        setIsCurrentLogSaved(true); // Mark as saved
        setWeightInput(""); // Clear input field immediately after save
        setRemarkInput("");
        setCapturedImages([]); // Clear photos after saving
        Alert.alert(t("common.success"), t("messages.productionLogSaved"));
      }
    } catch (error) {
      Alert.alert(t("common.error"), t("messages.failedToSaveProductionLog"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClosePreview = () => {
    setShowPrintPreview(false);
    setIsCurrentLogSaved(false);
    setWeightInput("");
    setRemarkInput("");
    setPreviewBagStatus("pending");
    previewBagStatusRef.current = "pending";
    setSelectedInputBag(null);
    setCapturedImages([]);
    // Keep user on station
  };

  const handleBack = () => {
    if (showShiftClosedView) {
      handleBackToShifts();
      return;
    }

    // ── Pellet Packing (PLT) back navigation (PC/PE/PET) ────────────────────
    if (isPelletPackingStation(selectedStation)) {
      // Modal-entered (like Final Packaging): back from Input/Output returns to the station list
      setSelectedStation(null);
      setSelectedSubLine(null);
      setSelectedSection(null);
      return;
    }

    // ── PE-specific back navigation ─────────────────────────────────────────
    if (isPE) {
      if (isExtrusionPackagingStation(selectedStation)) {
        if (selectedSection) {
          setSelectedSection(null);
        } else if (selectedSubLine) {
          setSelectedSubLine(null);
        } else {
          setSelectedStation(null);
        }
        return;
      }
      if (selectedStation?.name === "Crusher") {
        // Multiple output options (PE SUPER / EVA SUPER) → back clears output type first
        if (
          peOutputType &&
          getPeOutputOptions(selectedSubLine || "").length > 1
        ) {
          setPeOutputType(null);
        } else if (selectedSubLine) {
          setSelectedSubLine(null);
          setPeOutputType(null);
        } else {
          setSelectedStation(null);
        }
        return;
      }
      const n = selectedStation?.name?.toLowerCase() || "";
      if (
        selectedStation?.id === 5 ||
        n.includes("final") ||
        n.includes("re-packaging")
      ) {
        setSelectedStation(null);
        setSelectedSubLine(null);
        setSelectedSection(null);
        return;
      }
      if (selectedStation?.name === "Washing") {
        if (selectedSection) {
          setSelectedSection(null);
        } else if (selectedSubLine) {
          setSelectedSubLine(null);
        } else {
          setSelectedStation(null);
        }
        return;
      }
    }

    // ── PET-specific back navigation ─────────────────────────────────────────
    if (isPET) {
      const isPETCrusher = selectedStation?.name === "Crusher";
      const isPETBoretech = isExtrusionPackagingStation(selectedStation);
      const isPETStarlingerOrFinal =
        isPetStarlingerOrFinalStation(selectedStation);
      if (isPETCrusher || isPETBoretech || isPETStarlingerOrFinal) {
        if (selectedSection) {
          setSelectedSection(null);
        } else {
          setSelectedStation(null);
          setSelectedSubLine(null);
        }
        return;
      }
      // PET Washing: single line (Washing 1) — back clears section then station (avoid PC Betty / multi-line quirks)
      if (selectedStation?.name === "Washing") {
        if (selectedSection) {
          setSelectedSection(null);
        } else {
          setSelectedStation(null);
          setSelectedSubLine(null);
        }
        return;
      }
    }

    // ── PC/PET back navigation (unchanged) ───────────────────────────────────
    if (isExtrusionPackagingStation(selectedStation) && selectedSubLine) {
      if (selectedSection) {
        setSelectedSection(null);
      } else {
        setSelectedSubLine(null);
      }
    } else if (
      (selectedStation?.name === "Crusher" ||
        selectedStation?.name === "Washing") &&
      selectedSubLine
    ) {
      if (selectedSection) {
        setSelectedSection(null);
        if (selectedSubLine !== "Betty") setSelectedSubLine(null);
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
      let qrBase64 = "";
      if (qrRef.current) {
        qrBase64 = await new Promise((resolve) => {
          qrRef.current.toDataURL((data: string) => {
            resolve(data);
          });
        });
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
      Alert.alert(t("common.error"), t("messages.printError"));
    } finally {
      setIsPrinting(false);
    }
  };

  const executeListPrint = async () => {
    if (!selectedLogForPrint) return;
    try {
      setIsPrinting(true);
      let qrBase64 = "";
      if (listQrRef.current) {
        qrBase64 = await new Promise((resolve) => {
          listQrRef.current.toDataURL((data: string) => {
            resolve(data);
          });
        });
      }
      const stationDisplay = formatCompactStationLabel(
        getReprintStationDisplayName(selectedLogForPrint, stations),
      );
      const printData = {
        qrCode: selectedLogForPrint.output_bag_qr,
        weight: selectedLogForPrint.weight,
        station: stationDisplay,
        line:
          String(
            selectedLogForPrint.sub_line ??
              selectedLogForPrint.subLine ??
              "",
          ).trim() || "N/A",
        date: new Date(selectedLogForPrint.created_at).toLocaleDateString(),
        qrImage: qrBase64,
      };
      const success = await printService.printQRLabel(printData);
      if (success) {
        setShowListPrintPreview(false);
        setSelectedLogForPrint(null);
      }
    } catch (error) {
      Alert.alert(t("common.error"), t("messages.printError"));
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
        selectedStation?.name?.toLowerCase().includes("crusher") &&
        selectedSubLine === "Betty" &&
        selectedSection === "input";

      if (isBettyCrusherInput) {
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        const response = await productionApi.searchLogs(
          text,
          selectedStation!.id, // same Crusher station
          selectedStation!.id, // current station = Crusher (to exclude already-in-use bags)
          "pending",
          ["3E", "Rapid"], // only 3E and Rapid sub-lines
          undefined,
          true,
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

      // Pellet Packing input: pending Final Packaging (PKG) + pending Extrusion (EXT) bags
      // (empty query = list up to limit each, like PET Boretech / Final Packing)
      if (
        isPelletPackingStation(selectedStation) &&
        selectedSection === "input"
      ) {
        const q =
          text && String(text).trim().length > 0 ? String(text).trim() : "";
        const pkgId = findStationIdByCode(stations, "PKG", "final");
        const extId = findStationIdByCode(stations, "EXT", "extrusion");
        const pltSid = selectedStation!.id;
        const [rPkg, rExt] = await Promise.all([
          pkgId != null
            ? productionApi.searchLogs(
                q,
                pkgId,
                pltSid,
                "pending",
                undefined,
                undefined,
                true,
              )
            : Promise.resolve({ data: { success: true, data: [] as any[] } }),
          extId != null
            ? productionApi.searchLogs(
                q,
                extId,
                pltSid,
                "pending",
                undefined,
                undefined,
                true,
              )
            : Promise.resolve({ data: { success: true, data: [] as any[] } }),
        ]);
        const merged = mergePelletPackingInputRows(
          rPkg.data.success ? rPkg.data.data || [] : [],
          rExt.data.success ? rExt.data.data || [] : [],
        );
        const list = normalizeSuggestedBags(merged);
        setSuggestedBags(list);
        setShowSuggestions(list.length > 0);
        return;
      }
      if (isPelletPackingStation(selectedStation)) {
        setSuggestedBags([]);
        setShowSuggestions(false);
        return;
      }

      if (
        selectedStation?.id === 3 ||
        selectedStation?.name?.toLowerCase().includes("washing")
      ) {
        // For washing, only search if user has typed something
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        targetStationId = 2; // Washing searches from Crusher (backend resolves CRS for WSH when needed)
        statusFilter = "pending"; // Only show pending crusher batches
        // PC: only 3E/Rapid/Betty crusher sub-lines. PE: no source_sub_lines so backend filters by material type (CRS flakes). PET: only 'Rapid' (PET Crusher bags).
        const washingSourceSubLines = isPE
          ? undefined
          : isPET
            ? [...PET_CRUSHER_RAPID_INPUT_SUB_LINES]
            : ["3E", "Rapid", "Betty"];
        const response = await productionApi.searchLogs(
          text,
          targetStationId,
          selectedStation.id,
          statusFilter,
          washingSourceSubLines,
          undefined,
          true,
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
      // Extrusion / Boretech / PE extruder row — use same helper as station grid (includes "Boretech" name)
      const isAtExtrusionPackaging =
        isExtrusionPackagingStation(selectedStation);

      if (isAtExtrusionPackaging) {
        if (!selectedStation) return;
        if (isPE) {
          if (!text || text.trim().length === 0) {
            setSuggestedBags([]);
            setShowSuggestions(false);
            return;
          }
          // PE Extrusion: input comes from Crusher-Washing (CRS) pending bags
          const crsStation = stations.find(
            (s) =>
              (s as any).code === "CRS" ||
              s.name?.toLowerCase().includes("crusher"),
          );
          targetStationId = crsStation?.id ?? 2;
          statusFilter = "pending";
          const response = await productionApi.searchLogs(
            text,
            targetStationId,
            selectedStation.id,
            statusFilter,
            undefined,
            undefined,
            true,
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
        if (isPET && selectedSection === "input") {
          // PET Boretech: show both Crusher (Rapid) and Washing pending bags (empty query = list up to limit each)
          const q =
            text && String(text).trim().length > 0 ? String(text).trim() : "";
          const crushId = findStationIdByCode(stations, "CRS", "crusher") ?? 2;
          const washId = findStationIdByCode(stations, "WSH", "washing") ?? 3;
          const sid = selectedStation.id;
          const [rCrush, rWash] = await Promise.all([
            productionApi.searchLogs(
              q,
              crushId,
              sid,
              "pending",
              PET_CRUSHER_RAPID_INPUT_SUB_LINES,
              undefined,
              true,
            ),
            productionApi.searchLogs(
              q,
              washId,
              sid,
              "pending",
              undefined,
              undefined,
              true,
            ),
          ]);
          const merged = mergePetBoretechInputRows(
            rCrush.data.success ? rCrush.data.data || [] : [],
            rWash.data.success ? rWash.data.data || [] : [],
          );
          const list = normalizeSuggestedBags(merged);
          setSuggestedBags(list);
          setShowSuggestions(list.length > 0);
          return;
        }
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        // PC Boretech: input comes from Washing (WSH) pending bags
        targetStationId = 3;
        statusFilter = "pending";
        const response = await productionApi.searchLogs(
          text,
          targetStationId,
          selectedStation.id,
          statusFilter,
          undefined,
          undefined,
          true,
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
      // Starlinger / legacy final: Extrusion/Boretech batches for PC/PET(Starlinger) flow, Washing batches for PE flow (no Extrusion station)
      const needsFinalStageInputSearch =
        selectedStation?.id === 5 ||
        selectedStation?.name?.toLowerCase().includes("final") ||
        selectedStation?.name?.toLowerCase().includes("re-packaging") ||
        (isPET && isPetStarlingerLine(selectedStation));
      if (needsFinalStageInputSearch) {
        // PET Final Packing: pending bags from Boretech (Flakes PET) and Starlinger (Pellet PET)
        if (
          isPET &&
          isPetFinalPackingLine(selectedStation) &&
          selectedSection === "input"
        ) {
          const q =
            text && String(text).trim().length > 0 ? String(text).trim() : "";
          const boreSt = stations.find((s) => isExtrusionPackagingStation(s));
          const stlId = getPetStarlingerBackendStationId(stations);
          const sid = selectedStation!.id;
          const [rBore, rStl] = await Promise.all([
            boreSt
              ? productionApi.searchLogs(
                  q,
                  boreSt.id,
                  sid,
                  "pending",
                  ["Flakes PET"],
                  undefined,
                  true,
                )
              : Promise.resolve({ data: { success: true, data: [] as any[] } }),
            stlId != null
              ? productionApi.searchLogs(
                  q,
                  stlId,
                  sid,
                  "pending",
                  ["Pellet PET"],
                  undefined,
                  true,
                )
              : Promise.resolve({ data: { success: true, data: [] as any[] } }),
          ]);
          const merged = mergePetFinalPackingInputRows(
            rBore.data.success ? rBore.data.data || [] : [],
            rStl.data.success ? rStl.data.data || [] : [],
          );
          const list = normalizeSuggestedBags(merged);
          setSuggestedBags(list);
          setShowSuggestions(list.length > 0);
          return;
        }
        if (
          isPET &&
          isPetFinalPackingLine(selectedStation) &&
          selectedSection !== "input"
        ) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        if (!text || text.trim().length === 0) {
          setSuggestedBags([]);
          setShowSuggestions(false);
          return;
        }
        const extStation = stations.find(
          (s: Station) =>
            s.name?.toLowerCase().includes("extrusion") ||
            (s as any).code === "EXT",
        );
        const washStation = stations.find(
          (s: Station) =>
            s.name?.toLowerCase().includes("washing") ||
            (s as any).code === "WSH",
        );
        // PET Starlinger: scan Boretech (Extrusion) bags with Flakes PET sub-line
        // PC: scan Extrusion bags; PE: scan Washing bags (no Extrusion station)
        targetStationId = extStation ? extStation.id : (washStation?.id ?? 3);
        const finalSourceSubLines = isPET ? ["Flakes PET"] : undefined;
        statusFilter = "pending";
        const response = await productionApi.searchLogs(
          text,
          targetStationId,
          selectedStation?.id,
          statusFilter,
          finalSourceSubLines,
          undefined,
          true,
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
      // For other stations, require at least 2 characters
      if (text.length < 2) {
        setSuggestedBags([]);
        setShowSuggestions(false);
        return;
      }
      const response = await productionApi.searchLogs(
        text,
        targetStationId,
        selectedStation?.id,
        undefined,
        undefined,
        undefined,
        true,
      );
      if (response.data.success) {
        const list = normalizeSuggestedBags(response.data.data || []);
        setSuggestedBags(list);
        setShowSuggestions(list.length > 0);
      } else {
        setSuggestedBags([]);
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error("Search error", error);
      setSuggestedBags([]);
      setShowSuggestions(false);
    }
  };

  const handleBagSearchFocus = async () => {
    // PET Boretech input: load merged Crusher + Washing pending bags on focus (including empty search)
    if (
      isPET &&
      selectedSection === "input" &&
      isExtrusionPackagingStation(selectedStation)
    ) {
      try {
        await onBagSearch(bagSearchQuery ?? "");
      } catch {
        setShowSuggestions(suggestedBags.length > 0);
      }
      return;
    }
    if (
      isPET &&
      selectedSection === "input" &&
      isPetFinalPackingLine(selectedStation)
    ) {
      try {
        await onBagSearch(bagSearchQuery ?? "");
      } catch {
        setShowSuggestions(suggestedBags.length > 0);
      }
      return;
    }
    // Pellet Packing input: load merged PKG (Completed) + EXT (pending) bags on focus (including empty search)
    if (
      selectedSection === "input" &&
      isPelletPackingStation(selectedStation)
    ) {
      try {
        await onBagSearch(bagSearchQuery ?? "");
      } catch {
        setShowSuggestions(suggestedBags.length > 0);
      }
      return;
    }
    setShowSuggestions(suggestedBags.length > 0);
  };

  const renderStationIcon = (name: string, color: string) => {
    const props = { color: "#FFF", size: 24 };
    switch (name) {
      case "Label Removal":
        return <Box {...props} />;
      case "Crusher":
        return <Package {...props} />;
      case "Washing":
        return <Droplets {...props} />;
      case "Extrusion":
        return <Zap {...props} />;
      case "Re-Packaging":
        return <Box {...props} />;
      case "Pellet Packing":
        return <Box {...props} />;
      default:
        return <Package {...props} />;
    }
  };

  /** Read-only shift label in header (no shift switching from dashboard) */
  const shiftHeaderText = (
    <Text style={styles.headerShiftText} numberOfLines={1}>
      {selectedShift?.name ?? "Shift 1"}
    </Text>
  );

  if (isLoading && !isShiftActive)
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#17a34a" />
      </View>
    );

  return (
    <SafeAreaView
      style={styles.container}
      edges={Platform.OS === "web" ? [] : ["top", "bottom"]}
    >
      {toastMessage ? (
        <View style={styles.toast}>
          <Text style={styles.toastText} numberOfLines={3}>
            {toastMessage}
          </Text>
          <TouchableOpacity
            onPress={() => setToastMessage(null)}
            style={styles.toastClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X color="#FFF" size={20} />
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!selectedStation && !showEndShiftSummary && !showShiftClosedView ? (
            isPPIC ? null : shiftHeaderText
          ) : showShiftClosedView && !isPPIC ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                <ArrowLeft color="#333" size={24} />
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.stationTitle}>
                    {viewingActiveShift ? "Active Shift" : "Shift closed"}
                  </Text>
                  <View style={styles.contextPills}>
                    <Text style={styles.smallPill}>{selectedShift?.name}</Text>
                  </View>
                </View>
              </TouchableOpacity>
              <View style={{ marginLeft: 8 }}>{shiftHeaderText}</View>
            </View>
          ) : (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                flex: 1,
                minWidth: 0,
              }}
            >
              <TouchableOpacity
                onPress={handleBack}
                style={[styles.backButton, { flex: 1, minWidth: 0 }]}
              >
                <ArrowLeft color="#333" size={24} />
                <View style={{ marginLeft: 10, flex: 1, minWidth: 0 }}>
                  <Text style={styles.stationTitle} numberOfLines={1}>
                    {showShiftClosedView
                      ? viewingActiveShift
                        ? "Active Shift"
                        : "Shift closed"
                      : showEndShiftSummary
                        ? "End Shift"
                        : isPET
                          ? (selectedStation as any).displayName ||
                            selectedStation?.name
                          : selectedStation?.name === "Washing"
                            ? selectedStation?.name
                            : selectedSubLine
                              ? `${selectedStation?.name} (${selectedSubLine})`
                              : selectedStation?.name}
                  </Text>
                </View>
              </TouchableOpacity>
              {!isPPIC && (
                <View style={{ marginLeft: 4, flexShrink: 0 }}>
                  {shiftHeaderText}
                </View>
              )}
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.userName}>{user?.name}</Text>
          {/* Excel export — visible to every role. PPIC also has a richer button
              on the Station Overview card with date/shift filters; this header
              button always exports today's transactions for the current user. */}
          {!isPPIC && (
            <TouchableOpacity
              onPress={() => exportTransactionsExcel()}
              disabled={ppicExportingExcel}
              style={styles.headerExportButton}
              accessibilityLabel={t("dashboard.ppicExportExcel")}
            >
              <Download
                color={ppicExportingExcel ? "#94a3b8" : "#0ea5e9"}
                size={22}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={logout} style={styles.logoutButton}>
            <LogOut color="#EB445A" size={24} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={true}
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled={true}
        scrollEnabled={true}
        bounces={Platform.OS !== "web"}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
        removeClippedSubviews={false}
        scrollEventThrottle={16}
        persistentScrollbar={Platform.OS === "web"}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustContentInsets={false}
        directionalLockEnabled={true}
        canCancelContentTouches={Platform.OS === "web"}
        decelerationRate="normal"
        pagingEnabled={false}
        scrollsToTop={true}
      >
        {showShiftClosedView ? (
          <View style={styles.summaryContainer}>
            {/* LIVE banner — shown when PPIC is viewing an ongoing shift */}
            {viewingActiveShift && (
              <View style={styles.ppicLiveBanner}>
                <View style={styles.ppicLiveDotBanner} />
                <Text style={styles.ppicLiveBannerText}>
                  Live data — this shift is still running. Refresh to see latest
                  outputs.
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    closedShiftId && handleSelectAnyShift(closedShiftId, true)
                  }
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "700",
                      color: "#15803D",
                    }}
                  >
                    Refresh
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.summaryStatsCard}>
              <Text style={styles.cardTitle}>
                {viewingActiveShift
                  ? "Active Shift — Live Data"
                  : t("dashboard.shiftClosedSuccessfully")}
              </Text>
              <View style={{ marginTop: 8 }}>
                <Text
                  style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}
                >
                  {t("dashboard.remark")}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      minHeight: 44,
                      backgroundColor: "#f8fafc",
                      borderRadius: 8,
                    },
                  ]}
                  placeholder={t("dashboard.remarkPlaceholder")}
                  placeholderTextColor="#94a3b8"
                  value={closedShiftRemarkEdit}
                  onChangeText={setClosedShiftRemarkEdit}
                  multiline
                  numberOfLines={2}
                />
                <TouchableOpacity
                  onPress={saveClosedShiftRemark}
                  style={[
                    styles.editByProductBtn,
                    { alignSelf: "flex-start", marginTop: 6 },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      color: "#0ea5e9",
                    }}
                  >
                    {t("common.save")} {t("dashboard.remark")}
                  </Text>
                </TouchableOpacity>
              </View>
              {/* ── Production Outputs: categorised + search + pagination ── */}
              {closedShiftLogsLoading ? (
                <View style={{ marginVertical: 12, alignItems: "center" }}>
                  <ActivityIndicator color="#333" />
                </View>
              ) : closedShiftLogs.length > 0 ? (
                (() => {
                  // Classify each log into a category
                  const categorise = (log: any) => {
                    const st = stations.find((s) => s.id === log.station_id);
                    const name = (st?.name ?? "").toLowerCase();
                    const code = ((st as any)?.code ?? "").toUpperCase();
                    if (code === "LBL" || name.includes("label"))
                      return "label";
                    if (code === "CRS" || name.includes("crusher"))
                      return "crusher";
                    if (code === "WSH" || name.includes("washing"))
                      return "washing";
                    if (
                      code === "EXT" ||
                      code === "EXTR" ||
                      name.includes("extrusion")
                    )
                      return "extrusion";
                    // Pellet Packing (PLT) before the generic "packing" check — name contains "packing"
                    if (code === "PLT" || name.includes("pellet"))
                      return "pellet_packing";
                    if (
                      code === "PKG" ||
                      name.includes("re-packaging") ||
                      name.includes("final") ||
                      name.includes("packing")
                    )
                      return "packing";
                    return "other";
                  };
                  const q = shiftLogsSearch.trim().toLowerCase();
                  const filtered = closedShiftLogs.filter((log: any) => {
                    if (!q) return true;
                    const qr = (
                      log.output_bag_qr ||
                      log.outputBagQr ||
                      ""
                    ).toLowerCase();
                    const st = stations.find((s) => s.id === log.station_id);
                    const sn = (st?.name ?? "").toLowerCase();
                    const sl = (log.sub_line ?? "").toLowerCase();
                    const rm = String(log.remark ?? "").toLowerCase();
                    return (
                      qr.includes(q) ||
                      sn.includes(q) ||
                      sl.includes(q) ||
                      rm.includes(q)
                    );
                  });
                  const cats: {
                    key: string;
                    label: string;
                    color: string;
                    accent: string;
                    page: number;
                    setPage: (p: number) => void;
                  }[] = [
                    {
                      key: "label",
                      label: "Label Removal",
                      color: "#FDF4FF",
                      accent: "#9333EA",
                      page: shiftLogsPageLabel,
                      setPage: setShiftLogsPageLabel,
                    },
                    {
                      key: "crusher",
                      label: "Crusher",
                      color: "#FFF7ED",
                      accent: "#EA580C",
                      page: shiftLogsPageCrusher,
                      setPage: setShiftLogsPageCrusher,
                    },
                    {
                      key: "washing",
                      label: "Washing",
                      color: "#EFF6FF",
                      accent: "#2563EB",
                      page: shiftLogsPageWashing,
                      setPage: setShiftLogsPageWashing,
                    },
                    {
                      key: "extrusion",
                      label: "Extrusion & Packaging",
                      color: "#F0FDF4",
                      accent: "#16A34A",
                      page: shiftLogsPageExtrusion,
                      setPage: setShiftLogsPageExtrusion,
                    },
                    {
                      key: "packing",
                      label: "Re-Packaging",
                      color: "#F0FDFA",
                      accent: "#0D9488",
                      page: shiftLogsPagePacking,
                      setPage: setShiftLogsPagePacking,
                    },
                    {
                      key: "pellet_packing",
                      label: "Pellet Packing",
                      color: "#F0FDFA",
                      accent: "#0D9488",
                      page: shiftLogsPagePelletPacking,
                      setPage: setShiftLogsPagePelletPacking,
                    },
                    {
                      key: "other",
                      label: "Other",
                      color: "#F8FAFC",
                      accent: "#64748B",
                      page: 1,
                      setPage: () => {},
                    },
                  ];
                  return (
                    <View style={{ marginTop: 16 }}>
                      <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>
                        {t("dashboard.productionOutputs")}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          color: "#64748b",
                          marginBottom: 10,
                        }}
                      >
                        {shiftClosedEditHint}
                      </Text>
                      {/* Search bar */}
                      <View style={styles.shiftLogsSearchBar}>
                        <Search size={16} color="#94a3b8" />
                        <TextInput
                          style={styles.shiftLogsSearchInput}
                          placeholder="Search QR code, station, sub-line…"
                          placeholderTextColor="#94a3b8"
                          value={shiftLogsSearch}
                          onChangeText={(t) => {
                            setShiftLogsSearch(t);
                            setShiftLogsPageCrusher(1);
                            setShiftLogsPageWashing(1);
                            setShiftLogsPageExtrusion(1);
                            setShiftLogsPageLabel(1);
                            setShiftLogsPagePacking(1);
                            setShiftLogsPagePelletPacking(1);
                          }}
                          returnKeyType="search"
                        />
                        {shiftLogsSearch !== "" && (
                          <TouchableOpacity
                            onPress={() => setShiftLogsSearch("")}
                          >
                            <X size={16} color="#94a3b8" />
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text
                        style={{
                          fontSize: 11,
                          color: "#94a3b8",
                          marginBottom: 12,
                        }}
                      >
                        {filtered.length} of {closedShiftLogs.length} entries
                      </Text>
                      {cats.map((cat) => {
                        const rows = filtered.filter(
                          (l: any) => categorise(l) === cat.key,
                        );
                        if (rows.length === 0) return null;
                        const totalPages = Math.ceil(
                          rows.length / SHIFT_LOGS_PAGE_SIZE,
                        );
                        const page = Math.min(cat.page, totalPages);
                        const pageRows = rows.slice(
                          (page - 1) * SHIFT_LOGS_PAGE_SIZE,
                          page * SHIFT_LOGS_PAGE_SIZE,
                        );
                        const catWeight = rows
                          .reduce(
                            (s: number, l: any) => s + Number(l.weight || 0),
                            0,
                          )
                          .toFixed(1);
                        return (
                          <View
                            key={cat.key}
                            style={[
                              styles.shiftLogCategory,
                              {
                                backgroundColor: cat.color,
                                borderColor: cat.accent + "55",
                              },
                            ]}
                          >
                            {/* Category header */}
                            <View style={styles.shiftLogCategoryHeader}>
                              <View
                                style={[
                                  styles.shiftLogCatDot,
                                  { backgroundColor: cat.accent },
                                ]}
                              />
                              <Text
                                style={[
                                  styles.shiftLogCatLabel,
                                  { color: cat.accent },
                                ]}
                              >
                                {cat.label}
                              </Text>
                              <View style={styles.shiftLogCatBadge}>
                                <Text
                                  style={[
                                    styles.shiftLogCatBadgeText,
                                    { color: cat.accent },
                                  ]}
                                >
                                  {rows.length} bags
                                </Text>
                              </View>
                              <Text
                                style={[
                                  styles.shiftLogCatWeight,
                                  { color: cat.accent },
                                ]}
                              >
                                {catWeight} kg
                              </Text>
                            </View>
                            {/* Rows */}
                            {pageRows.map((log: any) => {
                              const st = stations.find(
                                (s) => s.id === log.station_id,
                              );
                              const stationName =
                                st?.name ?? String(log.station_id);
                              const qr =
                                log.output_bag_qr || log.outputBagQr || "—";
                              const sl = log.sub_line
                                ? ` · ${log.sub_line}`
                                : "";
                              const statusColor =
                                log.status === "Cancelled"
                                  ? "#ef4444"
                                  : log.status === "pending"
                                    ? "#f59e0b"
                                    : "#22c55e";
                              return isPPIC ? (
                                <View
                                  key={log.id}
                                  style={styles.ppicShiftLogEntry}
                                >
                                  <View
                                    style={styles.ppicShiftLogEntryTopRow}
                                  >
                                    <View
                                      style={{ flex: 1, minWidth: 0 }}
                                    >
                                      <Text
                                        style={styles.shiftLogQr}
                                        numberOfLines={1}
                                      >
                                        {qr}
                                      </Text>
                                      <View
                                        style={{
                                          flexDirection: "row",
                                          alignItems: "center",
                                          flexWrap: "wrap",
                                        }}
                                      >
                                        <Text style={styles.shiftLogMeta}>
                                          {stationName}
                                          {sl}
                                        </Text>
                                        <View
                                          style={[
                                            styles.shiftLogStatusDot,
                                            {
                                              backgroundColor: statusColor,
                                            },
                                          ]}
                                        />
                                        <Text
                                          style={[
                                            styles.shiftLogMeta,
                                            { color: statusColor },
                                          ]}
                                        >
                                          {log.status}
                                        </Text>
                                      </View>
                                    </View>
                                    <Text style={styles.shiftLogWeight}>
                                      {Number(log.weight) || 0} kg
                                    </Text>
                                    <TouchableOpacity
                                      onPress={() => {
                                        setSelectedLogForPrint(log);
                                        setShowListPrintPreview(true);
                                      }}
                                      style={styles.shiftLogPrintBtn}
                                    >
                                      <PrinterIcon
                                        color="#475569"
                                        size={14}
                                      />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      onPress={() => openEditLogWeight(log)}
                                      style={styles.shiftLogEditBtn}
                                    >
                                      <Pencil color="#0ea5e9" size={14} />
                                      <Text style={styles.shiftLogEditText}>
                                        Edit
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                  <View
                                    style={styles.ppicShiftLogRemarkBlock}
                                  >
                                    <Text
                                      style={styles.ppicLogEntryRemark}
                                      numberOfLines={6}
                                    >
                                      {t("dashboard.remark")}:{" "}
                                      {String(log.remark ?? "").trim() || "—"}
                                    </Text>
                                  </View>
                                </View>
                              ) : (
                                <View key={log.id} style={styles.shiftLogRow}>
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text
                                      style={styles.shiftLogQr}
                                      numberOfLines={1}
                                    >
                                      {qr}
                                    </Text>
                                    <View
                                      style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <Text style={styles.shiftLogMeta}>
                                        {stationName}
                                        {sl}
                                      </Text>
                                      <View
                                        style={[
                                          styles.shiftLogStatusDot,
                                          { backgroundColor: statusColor },
                                        ]}
                                      />
                                      <Text
                                        style={[
                                          styles.shiftLogMeta,
                                          { color: statusColor },
                                        ]}
                                      >
                                        {log.status}
                                      </Text>
                                    </View>
                                  </View>
                                  <Text style={styles.shiftLogWeight}>
                                    {Number(log.weight) || 0} kg
                                  </Text>
                                  <TouchableOpacity
                                    onPress={() => {
                                      setSelectedLogForPrint(log);
                                      setShowListPrintPreview(true);
                                    }}
                                    style={styles.shiftLogPrintBtn}
                                  >
                                    <PrinterIcon color="#475569" size={14} />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() => openEditLogWeight(log)}
                                    style={styles.shiftLogEditBtn}
                                  >
                                    <Pencil color="#0ea5e9" size={14} />
                                    <Text style={styles.shiftLogEditText}>
                                      Edit
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              );
                            })}
                            {/* Pagination */}
                            {totalPages > 1 && (
                              <View style={styles.shiftLogPager}>
                                <TouchableOpacity
                                  style={[
                                    styles.shiftLogPagerBtn,
                                    page === 1 &&
                                      styles.shiftLogPagerBtnDisabled,
                                  ]}
                                  onPress={() =>
                                    cat.setPage(Math.max(1, page - 1))
                                  }
                                  disabled={page === 1}
                                >
                                  <ChevronLeft
                                    size={16}
                                    color={page === 1 ? "#cbd5e1" : cat.accent}
                                  />
                                </TouchableOpacity>
                                <Text
                                  style={[
                                    styles.shiftLogPagerText,
                                    { color: cat.accent },
                                  ]}
                                >
                                  {page} / {totalPages}
                                </Text>
                                <TouchableOpacity
                                  style={[
                                    styles.shiftLogPagerBtn,
                                    page === totalPages &&
                                      styles.shiftLogPagerBtnDisabled,
                                  ]}
                                  onPress={() =>
                                    cat.setPage(Math.min(totalPages, page + 1))
                                  }
                                  disabled={page === totalPages}
                                >
                                  <ChevronRight
                                    size={16}
                                    color={
                                      page === totalPages
                                        ? "#cbd5e1"
                                        : cat.accent
                                    }
                                  />
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  );
                })()
              ) : null}
              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
                {t("dashboard.wasteFromProcess")}
              </Text>
              <Text style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                {t("dashboard.tapEditToChangeAgain")}
              </Text>
              {closedByProductsLoading ? (
                <View style={{ marginVertical: 24, alignItems: "center" }}>
                  <ActivityIndicator color="#333" />
                </View>
              ) : closedShiftByProducts.length === 0 ? (
                <Text
                  style={{ fontSize: 14, color: "#666", marginVertical: 16 }}
                >
                  {t("dashboard.noByProducts")}
                </Text>
              ) : (
                (() => {
                  let lastProcess = "";
                  return closedShiftByProducts.map((item, index) => {
                    const pl =
                      item.processLabel ||
                      getProcessLabel(
                        item.stationName,
                        closedShiftMeta?.materialTypeName,
                      );
                    const showHeader = pl !== lastProcess;
                    if (showHeader) lastProcess = pl;
                    return (
                      <View key={index}>
                        {showHeader ? (
                          <Text
                            style={[
                              styles.processSectionHeader,
                              { marginTop: index > 0 ? 16 : 0 },
                            ]}
                          >
                            {getProcessTitle(pl)} :
                          </Text>
                        ) : null}
                        <View
                          style={[styles.byProductRow, { marginBottom: 8 }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.byProductName}>
                              {item.name}
                            </Text>
                            <Text style={styles.byProductStation}>
                              {item.stationName} — {item.category}
                            </Text>
                          </View>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                            }}
                          >
                            <Text
                              style={[
                                styles.byProductName,
                                { marginRight: 12 },
                              ]}
                            >
                              {Number(item.weight) || 0} kg
                            </Text>
                            <TouchableOpacity
                              onPress={() => openEditByProduct(index)}
                              style={styles.editByProductBtn}
                              accessibilityLabel="Edit weight"
                            >
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                }}
                              >
                                <Pencil color="#0ea5e9" size={16} />
                                <Text
                                  style={{
                                    fontSize: 14,
                                    fontWeight: "600",
                                    color: "#0ea5e9",
                                    marginLeft: 4,
                                  }}
                                >
                                  {t("common.edit")}
                                </Text>
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
              <TouchableOpacity
                style={[
                  styles.closeShiftBtn,
                  { marginBottom: 10, backgroundColor: "#16A34A" },
                ]}
                onPress={handleGeneratePdfAgain}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FileText color="#FFF" size={20} />
                  <Text style={[styles.closeShiftText, { marginLeft: 8 }]}>
                    {viewingActiveShift
                      ? "Print Live Report (PDF)"
                      : "Generate PDF Report"}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.closeShiftBtn, { backgroundColor: "#0ea5e9" }]}
                onPress={handleBackToShifts}
              >
                <Text style={styles.closeShiftText}>
                  {t("dashboard.backToShifts")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : showEndShiftSummary ? (
          <View style={styles.summaryContainer}>
            <View style={styles.summaryStatsCard}>
              <Text style={styles.cardTitle}>
                {t("dashboard.shiftSummary")}
              </Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{shiftDuration}</Text>
                  <Text style={styles.summaryLabel}>
                    {t("dashboard.duration")}
                  </Text>
                </View>
                {(() => {
                  const crusherSt = stations.find(
                    (s) =>
                      s.name?.toLowerCase().includes("crusher") ||
                      (s as any).code === "CRS",
                  );
                  const washingSt = stations.find(
                    (s) =>
                      s.name?.toLowerCase().includes("washing") ||
                      (s as any).code === "WSH",
                  );
                  const extrusionSt = stations.find(
                    (s) =>
                      s.name?.toLowerCase().includes("extrusion") ||
                      s.id === 4 ||
                      (s as any).code === "EXT",
                  );
                  const co = crusherSt
                    ? shiftLogs.filter(
                        (l: any) => l.station_id === crusherSt.id,
                      ).length
                    : 0;
                  const wo = washingSt
                    ? shiftLogs.filter(
                        (l: any) => l.station_id === washingSt.id,
                      ).length
                    : 0;
                  const eo = extrusionSt
                    ? shiftLogs.filter(
                        (l: any) => l.station_id === extrusionSt.id,
                      ).length
                    : 0;
                  const cw = crusherSt
                    ? shiftLogs
                        .filter((l: any) => l.station_id === crusherSt.id)
                        .reduce(
                          (a: number, l: any) => a + Number(l.weight || 0),
                          0,
                        )
                        .toFixed(1)
                    : "0.0";
                  const ww = washingSt
                    ? shiftLogs
                        .filter((l: any) => l.station_id === washingSt.id)
                        .reduce(
                          (a: number, l: any) => a + Number(l.weight || 0),
                          0,
                        )
                        .toFixed(1)
                    : "0.0";
                  const ew = extrusionSt
                    ? shiftLogs
                        .filter((l: any) => l.station_id === extrusionSt.id)
                        .reduce(
                          (a: number, l: any) => a + Number(l.weight || 0),
                          0,
                        )
                        .toFixed(1)
                    : "0.0";
                  const totalO = co + wo + eo;
                  const totalW = (Number(cw) + Number(ww) + Number(ew)).toFixed(
                    1,
                  );
                  return (
                    <>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>{co}</Text>
                        <Text style={styles.summaryLabel}>
                          {t("print.crusher")} {t("dashboard.totalOutputs")}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>{wo}</Text>
                        <Text style={styles.summaryLabel}>
                          {t("print.washing")} {t("dashboard.totalOutputs")}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>{eo}</Text>
                        <Text style={styles.summaryLabel}>
                          {t("print.extrusion")} {t("dashboard.totalOutputs")}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>{totalO}</Text>
                        <Text style={styles.summaryLabel}>
                          {t("print.total")} {t("dashboard.totalOutputs")}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>{cw} kg</Text>
                        <Text style={styles.summaryLabel}>
                          {t("print.crusher")} {t("dashboard.totalKg")}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>{ww} kg</Text>
                        <Text style={styles.summaryLabel}>
                          {t("print.washing")} {t("dashboard.totalKg")}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>{ew} kg</Text>
                        <Text style={styles.summaryLabel}>
                          {t("print.extrusion")} {t("dashboard.totalKg")}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>{totalW} kg</Text>
                        <Text style={styles.summaryLabel}>
                          {t("print.total")} {t("dashboard.totalKg")}
                        </Text>
                      </View>
                    </>
                  );
                })()}
              </View>
            </View>
            <Text style={styles.sectionTitle}>
              {t("dashboard.wasteFromProcess")}
            </Text>
            <Text
              style={[
                styles.sectionTitle,
                {
                  fontSize: 11,
                  color: "#64748b",
                  marginTop: -8,
                  marginBottom: 12,
                },
              ]}
            >
              {t("dashboard.wasteOptional")}
            </Text>
            {(() => {
              let lastProcess = "";
              return byProductsInputs.map((item, index) => {
                const pl =
                  item.processLabel ||
                  getProcessLabel(
                    item.stationName,
                    closedShiftMeta?.materialTypeName,
                  );
                const showHeader = pl !== lastProcess;
                if (showHeader) lastProcess = pl;
                return (
                  <View key={index}>
                    {showHeader ? (
                      <Text
                        style={[
                          styles.processSectionHeader,
                          { marginTop: index > 0 ? 16 : 0 },
                        ]}
                      >
                        {getProcessTitle(pl)} :
                      </Text>
                    ) : null}
                    <View style={styles.byProductRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.byProductName}>{item.name}</Text>
                      </View>
                      <View style={styles.byProductInputWrapper}>
                        <TextInput
                          style={styles.byProductInput}
                          keyboardType="decimal-pad"
                          value={
                            typeof item.weight === "number"
                              ? item.weight === 0
                                ? ""
                                : String(item.weight)
                              : String(item.weight ?? "")
                          }
                          onChangeText={(val) => {
                            const next = byProductsInputs.map((p, i) =>
                              i === index
                                ? { ...p, weight: filterNumericWeight(val) }
                                : p,
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
              <Text style={styles.label}>{t("dashboard.remark")}</Text>
              <TextInput
                style={[styles.input, { minHeight: 44 }]}
                placeholder={t("dashboard.remarkPlaceholder")}
                placeholderTextColor="#94a3b8"
                value={endShiftRemark}
                onChangeText={setEndShiftRemark}
                multiline
                numberOfLines={2}
              />
            </View>
            <Text style={styles.afterCloseHint}>
              {t("dashboard.afterCloseHint")}
            </Text>
            <TouchableOpacity
              style={styles.closeShiftBtn}
              onPress={handleCloseShift}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.closeShiftText}>
                  {t("dashboard.closeShift")}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : !isShiftActive && !isShiftEnded ? (
          <View style={styles.startShiftContainer}>
            {user?.role?.toLowerCase() === "ppic" ? (
              <View style={styles.ppicHomeContainer}>
                <Text style={styles.ppicHomeTitle}>
                  {t("login.appHeadline")}
                </Text>
                <Text style={styles.ppicHomeSubtitle}>
                  {t("dashboard.ppicAllLinesSubtitle")}
                </Text>

                {/* Global filters: date + line (PC/PE/PET) — applies to all sections below */}
                <View style={[styles.ppicHomeCard, { marginTop: 12 }]}>
                  <Text style={styles.ppicHomeLabel}>
                    {t("dashboard.ppicSelectDate")}
                  </Text>
                  <StationDatePicker
                    value={parseDateLocal(ppicOverviewDate)}
                    onChange={(date) => {
                      const d = formatDateLocal(date);
                      setPpicOverviewDate(d);
                      setPpicSelectedDate(d);
                      setPpicExpandedStation(null);
                      refreshPpicHomeData(d, ppicOverviewShiftId, ppicOverviewMaterialType);
                    }}
                    maximumDate={maxDate}
                  />
                  <Text style={[styles.ppicHomeLabel, { marginTop: 12 }]}>
                    {t("dashboard.ppicFilterMaterial")}
                  </Text>
                  <View style={styles.ppicShiftRow}>
                    <TouchableOpacity
                      style={[
                        styles.ppicShiftBtn,
                        ppicOverviewMaterialType === null &&
                          styles.ppicShiftBtnActive,
                      ]}
                      onPress={() => {
                        setPpicOverviewMaterialType(null);
                        setPpicExpandedStation(null);
                        refreshPpicHomeData(
                          ppicOverviewDate,
                          ppicOverviewShiftId,
                          null,
                        );
                      }}
                    >
                      <Text
                        style={[
                          styles.ppicShiftBtnText,
                          ppicOverviewMaterialType === null &&
                            styles.ppicShiftBtnTextActive,
                        ]}
                      >
                        {t("dashboard.all")}
                      </Text>
                    </TouchableOpacity>
                    {(ppicMaterialOptions.length > 0
                      ? ppicMaterialOptions
                      : ["PC", "PE", "PET"]
                    ).map((mat) => (
                      <TouchableOpacity
                        key={`ppic-mat-${mat}`}
                        style={[
                          styles.ppicShiftBtn,
                          ppicOverviewMaterialType === mat &&
                            styles.ppicShiftBtnActive,
                        ]}
                        onPress={() => {
                          setPpicOverviewMaterialType(mat);
                          setPpicExpandedStation(null);
                          refreshPpicHomeData(
                            ppicOverviewDate,
                            ppicOverviewShiftId,
                            mat,
                          );
                        }}
                      >
                        <Text
                          style={[
                            styles.ppicShiftBtnText,
                            ppicOverviewMaterialType === mat &&
                              styles.ppicShiftBtnTextActive,
                          ]}
                        >
                          {mat}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.ppicHomeLabel, { marginTop: 12 }]}>
                    {t("dashboard.ppicSelectShift")}
                  </Text>
                  <View style={styles.ppicShiftRow}>
                    <TouchableOpacity
                      style={[
                        styles.ppicShiftBtn,
                        ppicOverviewShiftId === null &&
                          styles.ppicShiftBtnActive,
                      ]}
                      onPress={() => {
                        setPpicOverviewShiftId(null);
                        setPpicSelectedShiftId(null);
                        refreshPpicHomeData(
                          ppicOverviewDate,
                          null,
                          ppicOverviewMaterialType,
                        );
                      }}
                    >
                      <Text
                        style={[
                          styles.ppicShiftBtnText,
                          ppicOverviewShiftId === null &&
                            styles.ppicShiftBtnTextActive,
                        ]}
                      >
                        {t("dashboard.all")}
                      </Text>
                    </TouchableOpacity>
                    {ppicShifts.map((s) => (
                      <TouchableOpacity
                        key={`ppic-sh-${s.id}`}
                        style={[
                          styles.ppicShiftBtn,
                          ppicOverviewShiftId === s.id &&
                            styles.ppicShiftBtnActive,
                        ]}
                        onPress={() => {
                          setPpicOverviewShiftId(s.id);
                          setPpicSelectedShiftId(s.id);
                          refreshPpicHomeData(
                            ppicOverviewDate,
                            s.id,
                            ppicOverviewMaterialType,
                          );
                        }}
                      >
                        <Text
                          style={[
                            styles.ppicShiftBtnText,
                            ppicOverviewShiftId === s.id &&
                              styles.ppicShiftBtnTextActive,
                          ]}
                        >
                          {s.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* ── Active / Ongoing Shifts ── */}
                <View style={styles.ppicSectionHeader}>
                  <View style={styles.ppicLiveDot} />
                  <Text style={styles.ppicSectionTitle}>Active Shifts</Text>
                  <TouchableOpacity
                    onPress={loadPpicActiveShifts}
                    style={{ marginLeft: "auto" }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: "#0ea5e9",
                        fontWeight: "600",
                      }}
                    >
                      Refresh
                    </Text>
                  </TouchableOpacity>
                </View>

                {ppicActiveShiftsLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 14 }}>
                    <ActivityIndicator size="small" color="#17a34a" />
                    <Text style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                      Loading active shifts…
                    </Text>
                  </View>
                ) : ppicActiveShifts.length === 0 ? (
                  <View style={styles.ppicEmptyActive}>
                    <Text style={styles.ppicEmptyActiveText}>
                      No shifts are currently running.
                    </Text>
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
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              marginBottom: 4,
                            }}
                          >
                            <View style={styles.ppicLivePill}>
                              <View style={styles.ppicLiveDotSmall} />
                              <Text style={styles.ppicLivePillText}>LIVE</Text>
                            </View>
                            <Text
                              style={styles.ppicActiveShiftName}
                              numberOfLines={1}
                            >
                              {s.shiftType}
                            </Text>
                          </View>
                          <Text style={styles.ppicActiveShiftOperator}>
                            Operator: {s.operatorName}
                            {s.materialType ? ` · ${s.materialType}` : ""}
                          </Text>
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
                  <Text
                    style={[
                      styles.ppicSectionTitle,
                      { marginLeft: 6, color: "#0ea5e9" },
                    ]}
                  >
                    Closed Reports
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      refreshPpicHomeData(
                        ppicOverviewDate,
                        ppicOverviewShiftId,
                        ppicOverviewMaterialType,
                      )
                    }
                    style={{ marginLeft: "auto" }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: "#0ea5e9",
                        fontWeight: "600",
                      }}
                    >
                      Refresh
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Inline list of closed shifts */}
                {closedShiftsLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 16 }}>
                    <ActivityIndicator size="small" color="#0ea5e9" />
                    <Text
                      style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}
                    >
                      Loading reports…
                    </Text>
                  </View>
                ) : closedShiftsList.length === 0 ? (
                  <View style={[styles.ppicEmptyActive, { marginTop: 4 }]}>
                    <Text style={styles.ppicEmptyActiveText}>
                      No closed shifts found for this date / shift.
                    </Text>
                  </View>
                ) : (
                  <View>
                    {closedShiftsList.map((item: any) => (
                      <TouchableOpacity
                        key={item.shiftId}
                        style={[
                          styles.ppicActiveShiftCard,
                          { marginBottom: 8, borderLeftColor: "#0ea5e9" },
                        ]}
                        onPress={() => handleSelectClosedShift(item.shiftId)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              fontSize: 14,
                              fontWeight: "700",
                              color: "#1e293b",
                            }}
                          >
                            {item.shiftName} — {item.date}
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              color: "#475569",
                              marginTop: 2,
                            }}
                          >
                            {item.operatorName}
                          </Text>
                          {item.materialTypeName ? (
                            <Text
                              style={{
                                fontSize: 11,
                                color: "#94a3b8",
                                marginTop: 1,
                              }}
                            >
                              {item.materialTypeName}
                            </Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "700",
                              color: "#0ea5e9",
                            }}
                          >
                            {item.totalOutputs} bags
                          </Text>
                          <Text
                            style={{
                              fontSize: 11,
                              color: "#64748b",
                              marginTop: 2,
                            }}
                          >
                            {item.totalWeight} kg
                          </Text>
                        </View>
                        <ChevronRight
                          color="#CBD5E1"
                          size={18}
                          style={{ marginLeft: 6 }}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* ── Export Report (station + date range) ── */}
                <View style={[styles.ppicHomeCard, { marginTop: 24 }]}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <Download color="#0ea5e9" size={16} />
                    <Text
                      style={[
                        styles.ppicHomeLabel,
                        { marginLeft: 6, marginBottom: 0 },
                      ]}
                    >
                      Export Report
                    </Text>
                  </View>

                  <Text style={[styles.ppicHomeLabel, { marginTop: 12 }]}>
                    Operator
                  </Text>
                  <View style={styles.ppicShiftRow}>
                    <TouchableOpacity
                      style={[
                        styles.ppicShiftBtn,
                        ppicExportOperatorId === "all" &&
                          styles.ppicShiftBtnActive,
                      ]}
                      onPress={() => setPpicExportOperatorId("all")}
                    >
                      <Text
                        style={[
                          styles.ppicShiftBtnText,
                          ppicExportOperatorId === "all" &&
                            styles.ppicShiftBtnTextActive,
                        ]}
                      >
                        {t("dashboard.all")}
                      </Text>
                    </TouchableOpacity>
                    {ppicOperators.map((op) => {
                      const active = ppicExportOperatorId === String(op.id);
                      return (
                        <TouchableOpacity
                          key={`ppic-exp-op-${op.id}`}
                          style={[
                            styles.ppicShiftBtn,
                            active && styles.ppicShiftBtnActive,
                          ]}
                          onPress={() =>
                            setPpicExportOperatorId(String(op.id))
                          }
                        >
                          <Text
                            style={[
                              styles.ppicShiftBtnText,
                              active && styles.ppicShiftBtnTextActive,
                            ]}
                          >
                            {op.name}
                            {op.material_type ? ` (${op.material_type})` : ""}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={[styles.ppicHomeLabel, { marginTop: 12 }]}>
                    Station
                  </Text>
                  <View style={styles.ppicShiftRow}>
                    <TouchableOpacity
                      style={[
                        styles.ppicShiftBtn,
                        ppicExportStationCode === "all" &&
                          styles.ppicShiftBtnActive,
                      ]}
                      onPress={() => setPpicExportStationCode("all")}
                    >
                      <Text
                        style={[
                          styles.ppicShiftBtnText,
                          ppicExportStationCode === "all" &&
                            styles.ppicShiftBtnTextActive,
                        ]}
                      >
                        {t("dashboard.all")}
                      </Text>
                    </TouchableOpacity>
                    {stations.map((s) => {
                      const code = String((s as any).code || "").toUpperCase();
                      if (!code) return null;
                      const active = ppicExportStationCode === code;
                      return (
                        <TouchableOpacity
                          key={`ppic-exp-st-${code}`}
                          style={[
                            styles.ppicShiftBtn,
                            active && styles.ppicShiftBtnActive,
                          ]}
                          onPress={() => setPpicExportStationCode(code)}
                        >
                          <Text
                            style={[
                              styles.ppicShiftBtnText,
                              active && styles.ppicShiftBtnTextActive,
                            ]}
                          >
                            {(s as any).displayName || s.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={[styles.ppicHomeLabel, { marginTop: 12 }]}>
                    From
                  </Text>
                  <StationDatePicker
                    value={parseDateLocal(ppicExportDateStart)}
                    onChange={(date) =>
                      setPpicExportDateStart(formatDateLocal(date))
                    }
                    maximumDate={maxDate}
                  />
                  <Text style={[styles.ppicHomeLabel, { marginTop: 12 }]}>
                    To
                  </Text>
                  <StationDatePicker
                    value={parseDateLocal(ppicExportDateEnd)}
                    onChange={(date) =>
                      setPpicExportDateEnd(formatDateLocal(date))
                    }
                    maximumDate={maxDate}
                  />

                  <TouchableOpacity
                    onPress={exportPpicByFilters}
                    disabled={ppicExportingExcel}
                    style={{
                      marginTop: 16,
                      backgroundColor: ppicExportingExcel
                        ? "#cbd5e1"
                        : "#0ea5e9",
                      borderRadius: 10,
                      paddingVertical: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <Download color="#fff" size={18} />
                    <Text
                      style={{
                        color: "#fff",
                        fontWeight: "700",
                        fontSize: 14,
                      }}
                    >
                      {ppicExportingExcel
                        ? t("dashboard.ppicExportExcelExporting")
                        : t("dashboard.ppicExportExcel")}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* ── Station Overview ── */}
                <View style={[styles.ppicSectionHeader, { marginTop: 24 }]}>
                  <Package color="#475569" size={14} />
                  <Text
                    style={[
                      styles.ppicSectionTitle,
                      { marginLeft: 6, color: "#475569" },
                    ]}
                  >
                    Station Overview
                  </Text>
                  <View
                    style={{
                      marginLeft: "auto",
                      flexDirection: "row",
                      alignItems: "center",
                    }}
                  >
                    <TouchableOpacity
                      onPress={exportPpicTransactionsExcel}
                      disabled={ppicExportingExcel || ppicOverviewLoading}
                      style={{ marginRight: 16 }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Download
                          size={14}
                          color={
                            ppicExportingExcel || ppicOverviewLoading
                              ? "#94a3b8"
                              : "#0ea5e9"
                          }
                        />
                        <Text
                          style={{
                            fontSize: 12,
                            color:
                              ppicExportingExcel || ppicOverviewLoading
                                ? "#94a3b8"
                                : "#0ea5e9",
                            fontWeight: "600",
                          }}
                        >
                          {ppicExportingExcel
                            ? t("dashboard.ppicExportExcelExporting")
                            : t("dashboard.ppicExportExcel")}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        loadPpicOverview(
                          ppicOverviewDate,
                          ppicOverviewShiftId,
                          ppicOverviewMaterialType,
                        )
                      }
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          color: "#0ea5e9",
                          fontWeight: "600",
                        }}
                      >
                        Refresh
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Search */}
                <View
                  style={[
                    styles.shiftLogsSearchBar,
                    { marginHorizontal: 0, marginBottom: 8 },
                  ]}
                >
                  <Search size={16} color="#94a3b8" />
                  <TextInput
                    style={styles.shiftLogsSearchInput}
                    placeholder="Search QR, station, sub-line…"
                    placeholderTextColor="#94a3b8"
                    value={ppicOverviewSearch}
                    onChangeText={setPpicOverviewSearch}
                    returnKeyType="search"
                  />
                  {ppicOverviewSearch !== "" && (
                    <TouchableOpacity onPress={() => setPpicOverviewSearch("")}>
                      <X size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>

                {ppicOverviewLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 20 }}>
                    <ActivityIndicator size="large" color="#17a34a" />
                    <Text style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
                      Loading station data…
                    </Text>
                  </View>
                ) : ppicOverviewData.length === 0 ? (
                  <View style={[styles.ppicEmptyActive, { marginTop: 4 }]}>
                    <Text style={styles.ppicEmptyActiveText}>
                      No data found for this date / shift.
                    </Text>
                  </View>
                ) : (
                  <View>
                    {ppicOverviewData.map((station: any) => {
                      const isExpanded =
                        ppicExpandedStation === String(station.station_id);
                      const q = ppicOverviewSearch.trim().toLowerCase();
                      const filteredLogs = q
                        ? station.logs.filter(
                            (l: any) =>
                              (l.output_bag_qr || "")
                                .toLowerCase()
                                .includes(q) ||
                              (l.sub_line || "").toLowerCase().includes(q) ||
                              (l.operator_name || "")
                                .toLowerCase()
                                .includes(q) ||
                              (l.shift_name || "").toLowerCase().includes(q) ||
                              (l.material_type_name || "")
                                .toLowerCase()
                                .includes(q) ||
                              String(l.remark || "")
                                .toLowerCase()
                                .includes(q),
                          )
                        : station.logs;
                      const stationColors: Record<
                        string,
                        { bg: string; accent: string }
                      > = {
                        label: { bg: "#FDF4FF", accent: "#9333EA" },
                        crusher: { bg: "#FFF7ED", accent: "#EA580C" },
                        washing: { bg: "#EFF6FF", accent: "#2563EB" },
                        extrusion: { bg: "#F0FDF4", accent: "#16A34A" },
                        packing: { bg: "#F0FDFA", accent: "#0D9488" },
                      };
                      const sname = (station.station_name || "").toLowerCase();
                      const colorKey = sname.includes("label")
                        ? "label"
                        : sname.includes("pellet")
                          ? "packing"
                        : sname.includes("boretech")
                          ? "extrusion"
                          : sname.includes("starlinger")
                            ? "packing"
                          : sname.includes("crush")
                          ? "crusher"
                          : sname.includes("wash")
                            ? "washing"
                            : sname.includes("extru")
                              ? "extrusion"
                              : sname.includes("re-pack") ||
                                  sname.includes("final")
                                ? "packing"
                                : "washing";
                      const { bg, accent } = stationColors[colorKey] || {
                        bg: "#F8FAFC",
                        accent: "#64748B",
                      };
                      return (
                        <View
                          key={station.station_id}
                          style={[
                            styles.shiftLogCategory,
                            {
                              backgroundColor: bg,
                              borderColor: accent + "55",
                              marginBottom: 10,
                            },
                          ]}
                        >
                          <TouchableOpacity
                            style={styles.shiftLogCategoryHeader}
                            onPress={() =>
                              setPpicExpandedStation(
                                isExpanded ? null : String(station.station_id),
                              )
                            }
                            activeOpacity={0.7}
                          >
                            <View
                              style={[
                                styles.shiftLogCatDot,
                                { backgroundColor: accent },
                              ]}
                            />
                            <Text
                              style={[
                                styles.shiftLogCatLabel,
                                { color: accent, flex: 1 },
                              ]}
                            >
                              {station.station_name}
                            </Text>
                            <View style={styles.shiftLogCatBadge}>
                              <Text
                                style={[
                                  styles.shiftLogCatBadgeText,
                                  { color: accent },
                                ]}
                              >
                                {station.total_bags} bags
                              </Text>
                            </View>
                            <Text
                              style={[
                                styles.shiftLogCatWeight,
                                { color: accent },
                              ]}
                            >
                              {station.total_weight} kg
                            </Text>
                            <ChevronRight
                              size={16}
                              color={accent}
                              style={{
                                marginLeft: 4,
                                transform: [
                                  { rotate: isExpanded ? "90deg" : "0deg" },
                                ],
                              }}
                            />
                          </TouchableOpacity>

                          {isExpanded && (
                            <View style={{ marginTop: 8 }}>
                              {filteredLogs.length === 0 ? (
                                <Text
                                  style={{
                                    fontSize: 12,
                                    color: "#94a3b8",
                                    paddingVertical: 8,
                                    textAlign: "center",
                                  }}
                                >
                                  No matching entries
                                </Text>
                              ) : (
                                filteredLogs.map((log: any, idx: number) => {
                                  const statusColor =
                                    log.status === "pending"
                                      ? "#f59e0b"
                                      : log.status === "Cancelled"
                                        ? "#ef4444"
                                        : "#22c55e";
                                  return (
                                    <View
                                      key={log.id}
                                      style={[
                                        styles.ppicShiftLogEntry,
                                        idx === 0 && {
                                          borderTopWidth: 1,
                                          borderTopColor: accent + "30",
                                        },
                                      ]}
                                    >
                                      <View style={styles.ppicShiftLogEntryTopRow}>
                                        <View
                                          style={{ flex: 1, minWidth: 0 }}
                                        >
                                          <Text
                                            style={styles.shiftLogQr}
                                            numberOfLines={1}
                                          >
                                            {log.output_bag_qr || "—"}
                                          </Text>
                                          <View
                                            style={{
                                              flexDirection: "row",
                                              alignItems: "center",
                                              flexWrap: "wrap",
                                              gap: 4,
                                            }}
                                          >
                                            {log.sub_line ? (
                                              <Text
                                                style={[
                                                  styles.shiftLogMeta,
                                                  { color: accent },
                                                ]}
                                              >
                                                {log.sub_line}
                                              </Text>
                                            ) : null}
                                            <View
                                              style={[
                                                styles.shiftLogStatusDot,
                                                {
                                                  backgroundColor: statusColor,
                                                },
                                              ]}
                                            />
                                            <Text
                                              style={[
                                                styles.shiftLogMeta,
                                                { color: statusColor },
                                              ]}
                                            >
                                              {log.status}
                                            </Text>
                                            {log.material_type_name ? (
                                              <Text
                                                style={[
                                                  styles.shiftLogMeta,
                                                  { color: "#64748b", fontWeight: "600" },
                                                ]}
                                              >
                                                {log.material_type_name}
                                              </Text>
                                            ) : null}
                                            {log.shift_name ? (
                                              <Text
                                                style={[
                                                  styles.shiftLogMeta,
                                                  { color: "#94a3b8" },
                                                ]}
                                              >
                                                · {log.shift_name}
                                              </Text>
                                            ) : null}
                                            {log.operator_name ? (
                                              <Text
                                                style={[
                                                  styles.shiftLogMeta,
                                                  { color: "#94a3b8" },
                                                ]}
                                              >
                                                · {log.operator_name}
                                              </Text>
                                            ) : null}
                                          </View>
                                        </View>
                                        <Text style={styles.shiftLogWeight}>
                                          {Number(log.weight) || 0} kg
                                        </Text>
                                        <TouchableOpacity
                                          onPress={() => {
                                            setSelectedLogForPrint(log);
                                            setShowListPrintPreview(true);
                                          }}
                                          style={styles.shiftLogPrintBtn}
                                        >
                                          <PrinterIcon
                                            color="#475569"
                                            size={14}
                                          />
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                          onPress={() =>
                                            openEditLogWeight(log)
                                          }
                                          style={styles.shiftLogEditBtn}
                                        >
                                          <Pencil color="#0ea5e9" size={14} />
                                          <Text style={styles.shiftLogEditText}>
                                            Edit
                                          </Text>
                                        </TouchableOpacity>
                                      </View>
                                      <View style={styles.ppicShiftLogRemarkBlock}>
                                        <Text
                                          style={styles.ppicLogEntryRemark}
                                          numberOfLines={6}
                                        >
                                          {t("dashboard.remark")}:{" "}
                                          {String(log.remark ?? "").trim() ||
                                            "—"}
                                        </Text>
                                      </View>
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
              <View style={{ width: "100%" }}>
                {/* Shift Ended — shown after shift is closed, hide start button */}
                {shiftEndedAt ? (
                  <View style={{ alignItems: "center", padding: 24 }}>
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        backgroundColor: "#FEF2F2",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 16,
                      }}
                    >
                      <Square color="#EF4444" size={28} fill="#EF4444" />
                    </View>
                    <Text
                      style={{
                        fontSize: 20,
                        fontWeight: "700",
                        color: "#DC2626",
                        marginBottom: 6,
                      }}
                    >
                      Shift Ended
                    </Text>
                    <Text
                      style={{
                        fontSize: 14,
                        color: "#7f1d1d",
                        textAlign: "center",
                        marginBottom: 8,
                      }}
                    >
                      Ended at{" "}
                      {new Date(shiftEndedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {shiftDuration}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        color: "#9ca3af",
                        textAlign: "center",
                      }}
                    >
                      This shift has been closed. Contact PPIC to start a new
                      shift.
                    </Text>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.startShiftCard}
                      onPress={handleStartShift}
                    >
                      <View style={styles.playIconCircle}>
                        <Play fill="#FFF" color="#FFF" size={24} />
                      </View>
                      <View style={styles.startShiftText}>
                        <Text style={styles.startShiftTitle}>
                          {t("dashboard.startShift")}
                        </Text>
                        <Text style={styles.startShiftSubtitle}>
                          {t("dashboard.tapToBegin")}
                        </Text>
                      </View>
                      <ChevronRight color="#FFF" size={24} />
                    </TouchableOpacity>
                    {savedByProductsOnStartPage.length > 0 && (
                      <View style={styles.summaryStatsCard}>
                        <Text style={styles.cardTitle}>
                          {t("dashboard.wasteFromProcess")}
                        </Text>
                        <Text
                          style={{
                            fontSize: 13,
                            color: "#666",
                            marginBottom: 12,
                          }}
                        >
                          {t("dashboard.tapEditToChange")}
                        </Text>
                        {(() => {
                          let lastProcess = "";
                          return savedByProductsOnStartPage.map(
                            (item, index) => {
                              const pl =
                                item.processLabel ||
                                getProcessLabel(
                                  item.stationName,
                                  savedByProductsMeta?.materialTypeName,
                                );
                              const showHeader = pl !== lastProcess;
                              if (showHeader) lastProcess = pl;
                              return (
                                <View key={index}>
                                  {showHeader ? (
                                    <Text
                                      style={[
                                        styles.processSectionHeader,
                                        { marginTop: index > 0 ? 16 : 0 },
                                      ]}
                                    >
                                      {getProcessTitle(pl)} :
                                    </Text>
                                  ) : null}
                                  <View
                                    style={[
                                      styles.byProductRow,
                                      { marginBottom: 8 },
                                    ]}
                                  >
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.byProductName}>
                                        {item.name}
                                      </Text>
                                      <Text style={styles.byProductStation}>
                                        {item.stationName} — {item.category}
                                      </Text>
                                    </View>
                                    <View
                                      style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                      }}
                                    >
                                      <Text
                                        style={[
                                          styles.byProductName,
                                          { marginRight: 12 },
                                        ]}
                                      >
                                        {Number(item.weight) || 0} kg
                                      </Text>
                                      <TouchableOpacity
                                        onPress={() => openEditByProduct(index)}
                                        style={styles.editByProductBtn}
                                        accessibilityLabel="Edit weight"
                                      >
                                        <View
                                          style={{
                                            flexDirection: "row",
                                            alignItems: "center",
                                          }}
                                        >
                                          <Pencil color="#0ea5e9" size={16} />
                                          <Text
                                            style={{
                                              fontSize: 14,
                                              fontWeight: "600",
                                              color: "#0ea5e9",
                                              marginLeft: 4,
                                            }}
                                          >
                                            {t("common.edit")}
                                          </Text>
                                        </View>
                                      </TouchableOpacity>
                                    </View>
                                  </View>
                                </View>
                              );
                            },
                          );
                        })()}
                        <TouchableOpacity
                          style={[styles.closeShiftBtn, { marginTop: 16 }]}
                          onPress={handleGeneratePdfAgain}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <FileText color="#FFF" size={20} />
                            <Text
                              style={[styles.closeShiftText, { marginLeft: 8 }]}
                            >
                              {t("dashboard.generatePDF")}
                            </Text>
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
            {!isPPIC ? (
              <Text style={styles.productionLineBanner}>
                {t(productionLineTitleKeyFromRole(user?.role))}
              </Text>
            ) : null}
            <View style={styles.statusRow}>
              {shiftEndedAt ? (
                <>
                  <View
                    style={[
                      styles.activeStatus,
                      { backgroundColor: "#FEF2F2" },
                    ]}
                  >
                    <View
                      style={[styles.statusDot, { backgroundColor: "#EF4444" }]}
                    />
                    <Text style={[styles.statusText, { color: "#DC2626" }]}>
                      Shift Closed
                    </Text>
                  </View>
                  <Text style={[styles.durationText, { color: "#DC2626" }]}>
                    Ended{" "}
                    {new Date(shiftEndedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {shiftDuration}
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.activeStatus}>
                    <View style={styles.statusDot} />
                    <Text style={styles.statusText}>
                      {t("dashboard.shiftActive")}
                    </Text>
                  </View>
                  <Text style={styles.durationText}>{shiftDuration}</Text>
                </>
              )}
            </View>
            <>
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {(() => {
                      if (isPET) {
                        // Same idea as PE: top summary = final packing only, not the whole line
                        const petFinalStation =
                          stations.find((s) => isPetFinalPackingLine(s)) ||
                          stations.find(
                            (s) =>
                              s.id === 5 ||
                              s.name?.toLowerCase().includes("final") ||
                              s.name?.toLowerCase().includes("re-packaging"),
                          );
                        if (!petFinalStation) return 0;
                        return shiftLogsToday.filter(
                          (l: any) => l.station_id === petFinalStation.id,
                        ).length;
                      }
                      const summaryStation = isPE
                        ? stations.find(
                            (s) =>
                              s.id === 5 ||
                              s.name?.toLowerCase().includes("final") ||
                              s.name?.toLowerCase().includes("re-packaging"),
                          )
                        : stations.find((s) =>
                            s.name?.toLowerCase().includes("extrusion"),
                          );
                      if (!summaryStation) return 0;
                      return shiftLogsToday.filter(
                        (l: any) => l.station_id === summaryStation.id,
                      ).length;
                    })()}
                  </Text>
                  <Text style={styles.statLabel}>Outputs</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {(() => {
                      if (isPET) {
                        const petFinalStation =
                          stations.find((s) => isPetFinalPackingLine(s)) ||
                          stations.find(
                            (s) =>
                              s.id === 5 ||
                              s.name?.toLowerCase().includes("final") ||
                              s.name?.toLowerCase().includes("re-packaging"),
                          );
                        if (!petFinalStation) return "0.0";
                        return shiftLogsToday
                          .filter(
                            (l: any) => l.station_id === petFinalStation.id,
                          )
                          .reduce(
                            (acc: number, l: any) =>
                              acc + Number(l.weight || 0),
                            0,
                          )
                          .toFixed(1);
                      }
                      const summaryStation = isPE
                        ? stations.find(
                            (s) =>
                              s.id === 5 ||
                              s.name?.toLowerCase().includes("final") ||
                              s.name?.toLowerCase().includes("re-packaging"),
                          )
                        : stations.find((s) =>
                            s.name?.toLowerCase().includes("extrusion"),
                          );
                      if (!summaryStation) return "0.0";
                      return shiftLogsToday
                        .filter((l: any) => l.station_id === summaryStation.id)
                        .reduce(
                          (acc: number, l: any) => acc + Number(l.weight || 0),
                          0,
                        )
                        .toFixed(1);
                    })()}
                  </Text>
                  <Text style={styles.statLabel}>Total kg</Text>
                </View>
              </View>
              {isPET && isShiftActive && !shiftEndedAt ? (
                <View style={{ marginBottom: 10, marginHorizontal: 12 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color: "#64748b",
                    }}
                  >
                    PET line: Crusher → Washing → Boretech (in / out) →
                    Starlinger (Boretech in / out) → Final Packing (Boretech or
                    Starlinger in / Final PET out)
                  </Text>
                </View>
              ) : null}
              {isPE && isShiftActive && !shiftEndedAt ? (
                <View style={{ marginBottom: 10, marginHorizontal: 12 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color: "#64748b",
                    }}
                  >
                    PE line: Crusher → Washing → Extrusion → Final Packaging
                  </Text>
                </View>
              ) : null}
              <Text style={styles.sectionTitle}>
                {t("dashboard.selectStation")}
              </Text>
              {(isPET
                ? petStationsForGrid
                : isPE
                  ? peStationsForGrid
                  : stations
              ).map((s) => (
                <TouchableOpacity
                  key={
                    isPET
                      ? `${s.id}-${(s as any).petUiSegment || "default"}`
                      : s.id
                  }
                  style={styles.stationCard}
                  onPress={() => handleStationSelect(s)}
                >
                  <View
                    style={[
                      styles.stationIconBox,
                      { backgroundColor: s.color },
                    ]}
                  >
                    {renderStationIcon(s.name, s.color)}
                  </View>
                  <View style={styles.stationInfo}>
                    <Text style={styles.stationName}>
                      {(s as any).displayName || s.name}
                    </Text>
                    <Text style={styles.stationDesc} numberOfLines={1}>
                      {s.description}
                    </Text>
                  </View>
                  <View style={styles.stationMiniStats}>
                    <Text style={styles.miniStat}>
                      {
                        shiftLogsToday.filter((l: any) =>
                          isPET
                            ? petLogMatchesStationDisplay(l, s)
                            : l.station_id === s.id,
                        ).length
                      }{" "}
                      bags
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: "#64748b",
                        textAlign: "right",
                      }}
                    >
                      {shiftLogsToday
                        .filter((l: any) =>
                          isPET
                            ? petLogMatchesStationDisplay(l, s)
                            : l.station_id === s.id,
                        )
                        .reduce(
                          (sum, l: any) => sum + (parseFloat(l.weight) || 0),
                          0,
                        )
                        .toFixed(1)}{" "}
                      kg
                    </Text>
                  </View>
                  <ChevronRight color="#CCC" size={20} />
                </TouchableOpacity>
              ))}
              {isShiftActive && !shiftEndedAt && (
                <TouchableOpacity
                  style={styles.endShiftButton}
                  onPress={handleEndShift}
                >
                  <Square color="#FFF" size={20} />
                  <Text style={styles.endShiftText}>
                    {t("dashboard.closeShift")}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          </View>
        ) : (
          <View style={styles.detailContainer}>
            {selectedStation.name === "Label Removal" ? (
              <View>
                <View
                  style={[
                    styles.stationHero,
                    { backgroundColor: selectedStation.color },
                  ]}
                >
                  <View style={styles.heroHeader}>
                    <View style={styles.heroIconCircle}>
                      {renderStationIcon(
                        selectedStation.name,
                        selectedStation.color,
                      )}
                    </View>
                    <View style={{ marginLeft: 15, flex: 1 }}>
                      <Text style={styles.heroTitle}>
                        {selectedStation.name}
                      </Text>
                      <Text style={styles.heroDesc}>Shift tracking only</Text>
                    </View>
                  </View>
                  <View style={styles.statusBox}>
                    <Text style={styles.statusLabel}>Status</Text>
                    <Text style={styles.statusValue}>Continuous Operation</Text>
                    <Text style={styles.statusDesc}>
                      No individual output tracking at this station. Material
                      flows continuously to Crusher.
                    </Text>
                  </View>
                </View>

                <View style={styles.byProductsCard}>
                  <View style={styles.byProductsHeader}>
                    <Trash2 size={24} color="#b45309" />
                    <View style={{ marginLeft: 12 }}>
                      <Text style={styles.byProductsTitle}>By-Products</Text>
                      <Text style={styles.byProductsSubtitle}>
                        Will be recorded at end of shift
                      </Text>
                    </View>
                  </View>
                  <View style={styles.bulletList}>
                    <Text style={styles.bulletItem}>• PP Cords (Sellable)</Text>
                    <Text style={styles.bulletItem}>• Dust (Landfill)</Text>
                    <Text style={styles.bulletItem}>
                      • Floor Sweep (Landfill)
                    </Text>
                  </View>
                </View>
              </View>
            ) : selectedStation.name === "Crusher" ? (
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
                    <View
                      style={[
                        styles.stationHero,
                        {
                          backgroundColor: selectedStation.color,
                          paddingBottom: 20,
                          marginBottom: 0,
                        },
                      ]}
                    >
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(
                            selectedStation.name,
                            selectedStation.color,
                          )}
                        </View>
                        <View style={{ marginLeft: 15, flex: 1 }}>
                          <Text style={styles.heroTitle}>Crusher</Text>
                          <Text style={styles.heroDesc}>
                            PE flakes production (wash at Washing station)
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Step 1: Select raw material */}
                    {!selectedSubLine &&
                      (() => {
                        const PE_RAW_MATERIALS = [
                          "PE SUPER",
                          "PE 1",
                          "EVA SUPER",
                          "EVA 1",
                        ] as const;
                        const q = peRawMaterialSearch.trim().toLowerCase();
                        const filtered = PE_RAW_MATERIALS.filter((mat) => {
                          const matchFilter =
                            peRawMaterialFilter === "all" ||
                            (peRawMaterialFilter === "PE" &&
                              (mat === "PE SUPER" || mat === "PE 1")) ||
                            (peRawMaterialFilter === "EVA" &&
                              (mat === "EVA SUPER" || mat === "EVA 1"));
                          if (!matchFilter) return false;
                          if (!q) return true;
                          const opts = getPeOutputOptions(mat)
                            .join(" ")
                            .toLowerCase();
                          return (
                            mat.toLowerCase().includes(q) || opts.includes(q)
                          );
                        });
                        return (
                          <View style={styles.selectionContainer}>
                            <Text style={styles.selectionTitle}>
                              Select Raw Material
                            </Text>
                            <View
                              style={[
                                styles.shiftLogsSearchBar,
                                { marginHorizontal: 0, marginBottom: 10 },
                              ]}
                            >
                              <Search size={16} color="#94a3b8" />
                              <TextInput
                                style={styles.shiftLogsSearchInput}
                                placeholder="Search raw material..."
                                placeholderTextColor="#94a3b8"
                                value={peRawMaterialSearch}
                                onChangeText={setPeRawMaterialSearch}
                                returnKeyType="search"
                              />
                              {peRawMaterialSearch !== "" && (
                                <TouchableOpacity
                                  onPress={() => setPeRawMaterialSearch("")}
                                >
                                  <X size={16} color="#94a3b8" />
                                </TouchableOpacity>
                              )}
                            </View>
                            <View style={styles.filterButtons}>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peRawMaterialFilter === "all" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => setPeRawMaterialFilter("all")}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peRawMaterialFilter === "all" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  All
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peRawMaterialFilter === "PE" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => setPeRawMaterialFilter("PE")}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peRawMaterialFilter === "PE" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  PE
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peRawMaterialFilter === "EVA" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => setPeRawMaterialFilter("EVA")}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peRawMaterialFilter === "EVA" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  EVA
                                </Text>
                              </TouchableOpacity>
                            </View>
                            {/* List below subline */}
                            <View style={styles.peRawMaterialListContainer}>
                              <Text style={styles.peRawMaterialListLabel}>
                                Raw materials
                              </Text>
                              {filtered.length === 0 ? (
                                <View
                                  style={[
                                    styles.grayEmptyBox,
                                    { marginTop: 8 },
                                  ]}
                                >
                                  <Text style={styles.grayEmptyText}>
                                    No raw material matches search or filter
                                  </Text>
                                </View>
                              ) : (
                                <ScrollView
                                  style={styles.peRawMaterialList}
                                  showsVerticalScrollIndicator={false}
                                  nestedScrollEnabled
                                >
                                  {filtered.map((mat, idx) => {
                                    const colors = [
                                      "#0d9488",
                                      "#0891b2",
                                      "#7c3aed",
                                      "#db2777",
                                    ];
                                    const colorIdx =
                                      PE_RAW_MATERIALS.indexOf(mat);
                                    return (
                                      <TouchableOpacity
                                        key={mat}
                                        style={styles.selectionCard}
                                        onPress={() => {
                                          setSelectedSubLine(mat);
                                          const opts = getPeOutputOptions(mat);
                                          if (opts.length === 1)
                                            setPeOutputType(opts[0]);
                                          else setPeOutputType(null);
                                        }}
                                      >
                                        <View
                                          style={[
                                            styles.selectionIconBox,
                                            {
                                              backgroundColor: colors[colorIdx],
                                            },
                                          ]}
                                        >
                                          <Package color="#FFF" size={28} />
                                        </View>
                                        <View style={styles.selectionText}>
                                          <Text
                                            style={styles.selectionCardTitle}
                                          >
                                            {mat}
                                          </Text>
                                          <Text style={styles.selectionCardSub}>
                                            {getPeOutputOptions(mat).join(
                                              " / ",
                                            )}
                                          </Text>
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
                    {selectedStation?.name === "Crusher" &&
                      !selectedSubLine && (
                        <View
                          style={[
                            styles.crusherLogsSection,
                            { marginHorizontal: 16, marginBottom: 24 },
                          ]}
                        >
                          <View style={styles.logsHeader}>
                            <Text style={styles.logsTitle}>Recent Entries</Text>
                          </View>
                          <View style={styles.datePickerContainer}>
                            <Text style={styles.datePickerLabel}>
                              Select Date:
                            </Text>
                            <StationDatePicker
                              value={parseDateLocal(peCrusherSelectedDate)}
                              onChange={(date) => {
                                setPeCrusherSelectedDate(formatDateLocal(date));
                                setPeCrusherCurrentPage(1);
                              }}
                              maximumDate={maxDate}
                            />
                          </View>
                          <View style={styles.searchBox}>
                            <Search size={18} color="#64748b" />
                            <TextInput
                              style={styles.searchInput}
                              placeholder="Search by QR code..."
                              value={peCrusherSearchQuery}
                              onChangeText={(text) => {
                                setPeCrusherSearchQuery(text);
                                setPeCrusherCurrentPage(1);
                              }}
                              placeholderTextColor="#94a3b8"
                              returnKeyType="search"
                              autoCorrect={false}
                              autoCapitalize="none"
                              spellCheck={false}
                            />
                            {peCrusherSearchQuery.length > 0 && (
                              <TouchableOpacity
                                onPress={() => {
                                  setPeCrusherSearchQuery("");
                                  setPeCrusherCurrentPage(1);
                                }}
                                style={styles.clearButton}
                              >
                                <X size={16} color="#64748b" />
                              </TouchableOpacity>
                            )}
                          </View>
                          <View style={styles.filtersContainer}>
                            <View style={styles.filterGroup}>
                              <Text style={styles.filterLabel}>Line:</Text>
                              <View style={styles.filterButtons}>
                                <TouchableOpacity
                                  style={[
                                    styles.filterButton,
                                    peCrusherLineFilter === "all" &&
                                      styles.filterButtonActive,
                                  ]}
                                  onPress={() => {
                                    setPeCrusherLineFilter("all");
                                    setPeCrusherCurrentPage(1);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.filterButtonText,
                                      peCrusherLineFilter === "all" &&
                                        styles.filterButtonTextActive,
                                    ]}
                                  >
                                    All
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.filterButton,
                                    peCrusherLineFilter === "PE SUPER" &&
                                      styles.filterButtonActive,
                                  ]}
                                  onPress={() => {
                                    setPeCrusherLineFilter("PE SUPER");
                                    setPeCrusherCurrentPage(1);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.filterButtonText,
                                      peCrusherLineFilter === "PE SUPER" &&
                                        styles.filterButtonTextActive,
                                    ]}
                                  >
                                    PE SUPER
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.filterButton,
                                    peCrusherLineFilter === "PE 1" &&
                                      styles.filterButtonActive,
                                  ]}
                                  onPress={() => {
                                    setPeCrusherLineFilter("PE 1");
                                    setPeCrusherCurrentPage(1);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.filterButtonText,
                                      peCrusherLineFilter === "PE 1" &&
                                        styles.filterButtonTextActive,
                                    ]}
                                  >
                                    PE 1
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.filterButton,
                                    peCrusherLineFilter === "EVA SUPER" &&
                                      styles.filterButtonActive,
                                  ]}
                                  onPress={() => {
                                    setPeCrusherLineFilter("EVA SUPER");
                                    setPeCrusherCurrentPage(1);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.filterButtonText,
                                      peCrusherLineFilter === "EVA SUPER" &&
                                        styles.filterButtonTextActive,
                                    ]}
                                  >
                                    EVA SUPER
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.filterButton,
                                    peCrusherLineFilter === "EVA 1" &&
                                      styles.filterButtonActive,
                                  ]}
                                  onPress={() => {
                                    setPeCrusherLineFilter("EVA 1");
                                    setPeCrusherCurrentPage(1);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.filterButtonText,
                                      peCrusherLineFilter === "EVA 1" &&
                                        styles.filterButtonTextActive,
                                    ]}
                                  >
                                    EVA 1
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                            <View style={styles.filterGroup}>
                              <Text style={styles.filterLabel}>Status:</Text>
                              <View style={styles.filterButtons}>
                                <TouchableOpacity
                                  style={[
                                    styles.filterButton,
                                    peCrusherStatusFilter === "all" &&
                                      styles.filterButtonActive,
                                  ]}
                                  onPress={() => {
                                    setPeCrusherStatusFilter("all");
                                    setPeCrusherCurrentPage(1);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.filterButtonText,
                                      peCrusherStatusFilter === "all" &&
                                        styles.filterButtonTextActive,
                                    ]}
                                  >
                                    All
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.filterButton,
                                    peCrusherStatusFilter === "pending" &&
                                      styles.filterButtonActive,
                                  ]}
                                  onPress={() => {
                                    setPeCrusherStatusFilter("pending");
                                    setPeCrusherCurrentPage(1);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.filterButtonText,
                                      peCrusherStatusFilter === "pending" &&
                                        styles.filterButtonTextActive,
                                    ]}
                                  >
                                    Pending
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.filterButton,
                                    peCrusherStatusFilter === "Completed" &&
                                      styles.filterButtonActive,
                                  ]}
                                  onPress={() => {
                                    setPeCrusherStatusFilter("Completed");
                                    setPeCrusherCurrentPage(1);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.filterButtonText,
                                      peCrusherStatusFilter === "Completed" &&
                                        styles.filterButtonTextActive,
                                    ]}
                                  >
                                    Complete
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                          {peCrusherLogsLoading ? (
                            <View style={styles.loadingState}>
                              <ActivityIndicator size="large" color="#17a34a" />
                              <Text style={styles.loadingText}>
                                Loading entries...
                              </Text>
                            </View>
                          ) : peCrusherLogs.length > 0 ? (
                            <View style={styles.logsList}>
                              {peCrusherLogs.map((log: any, index: number) => (
                                <View
                                  key={log.id || index}
                                  style={styles.logItem}
                                >
                                  <View style={styles.logMain}>
                                    <Text style={styles.logQr}>
                                      {log.output_bag_qr ||
                                        log.outputBagQr ||
                                        "—"}
                                    </Text>
                                    <View style={styles.logDetails}>
                                      <Text style={styles.logWeight}>
                                        {log.weight} kg
                                      </Text>
                                      <Text style={styles.logTime}>
                                        {new Date(
                                          log.created_at,
                                        ).toLocaleString()}
                                      </Text>
                                    </View>
                                    <View style={styles.logStatusRow}>
                                      <View
                                        style={[
                                          styles.statusBadge,
                                          {
                                            backgroundColor:
                                              log.status === "pending"
                                                ? "#FEF3C7"
                                                : log.status === "hold"
                                                ? "#FFEDD5"
                                                : log.status === "reject"
                                                ? "#FEE2E2"
                                                : "#DCFCE7",
                                          },
                                        ]}
                                      >
                                        <Text
                                          style={[
                                            styles.statusBadgeText,
                                            {
                                              color:
                                                log.status === "pending"
                                                  ? "#D97706"
                                                  : log.status === "hold"
                                                  ? "#92400E"
                                                  : log.status === "reject"
                                                  ? "#B91C1C"
                                                  : "#15803D",
                                            },
                                          ]}
                                        >
                                          {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                        </Text>
                                      </View>
                                    </View>
                                  </View>
                                  <View style={styles.logActions}>
                                    {(canEditAnyStatus ||
                                      log.status === "pending") && (
                                      <TouchableOpacity
                                        style={styles.editIconButton}
                                        onPress={() => openEditLogWeight(log)}
                                      >
                                        <Pencil color="#0ea5e9" size={18} />
                                      </TouchableOpacity>
                                    )}
                                    {isPE && log.status === "hold" && (
                                      <>
                                        <TouchableOpacity
                                          style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                          onPress={() => openPeResolveModal(log)}
                                        >
                                          <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                          style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                          onPress={() => openPeResolveModal(log)}
                                        >
                                          <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                        </TouchableOpacity>
                                      </>
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
                                    <View
                                      style={[
                                        styles.logBadge,
                                        { backgroundColor: "#CCFBF1" },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.logBadgeText,
                                          { color: "#0d9488" },
                                        ]}
                                      >
                                        {log.sub_line || "—"}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                              ))}
                            </View>
                          ) : (
                            <View style={styles.emptyState}>
                              <Package
                                size={48}
                                color="#94a3b8"
                                opacity={0.5}
                              />
                              <Text style={styles.emptyText}>
                                No entries found for this date
                              </Text>
                            </View>
                          )}
                          {peCrusherTotalPages > 1 && (
                            <View style={styles.pagination}>
                              <TouchableOpacity
                                style={[
                                  styles.pageBtn,
                                  peCrusherCurrentPage === 1 &&
                                    styles.pageBtnDisabled,
                                ]}
                                onPress={() =>
                                  setPeCrusherCurrentPage(
                                    Math.max(1, peCrusherCurrentPage - 1),
                                  )
                                }
                                disabled={peCrusherCurrentPage === 1}
                              >
                                <ChevronLeft
                                  color={
                                    peCrusherCurrentPage === 1
                                      ? "#cbd5e1"
                                      : "#475569"
                                  }
                                  size={18}
                                />
                              </TouchableOpacity>
                              <View style={styles.pageInfoBox}>
                                <Text style={styles.pageInfoMain}>
                                  {peCrusherCurrentPage} / {peCrusherTotalPages}
                                </Text>
                                <Text style={styles.pageInfoSub}>
                                  {peCrusherTotalLogs} total
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[
                                  styles.pageBtn,
                                  peCrusherCurrentPage ===
                                    peCrusherTotalPages &&
                                    styles.pageBtnDisabled,
                                ]}
                                onPress={() =>
                                  setPeCrusherCurrentPage(
                                    Math.min(
                                      peCrusherTotalPages,
                                      peCrusherCurrentPage + 1,
                                    ),
                                  )
                                }
                                disabled={
                                  peCrusherCurrentPage === peCrusherTotalPages
                                }
                              >
                                <ChevronRight
                                  color={
                                    peCrusherCurrentPage === peCrusherTotalPages
                                      ? "#cbd5e1"
                                      : "#475569"
                                  }
                                  size={18}
                                />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}

                    {/* Step 2: Select output type (only when multiple options exist) */}
                    {selectedSubLine &&
                      !peOutputType &&
                      getPeOutputOptions(selectedSubLine).length > 1 && (
                        <View style={styles.selectionContainer}>
                          <Text style={styles.selectionTitle}>
                            Select Output Type
                          </Text>
                          <View
                            style={[
                              styles.sublineBadgeWrapper,
                              { marginBottom: 8 },
                            ]}
                          >
                            <View
                              style={[
                                styles.sublineBadge,
                                {
                                  backgroundColor: "#CCFBF1",
                                  borderColor: "#99F6E4",
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.sublineBadgeText,
                                  { color: "#0d9488" },
                                ]}
                              >
                                Raw Material: {selectedSubLine}
                              </Text>
                            </View>
                          </View>
                          {getPeOutputOptions(selectedSubLine).map(
                            (opt, idx) => (
                              <TouchableOpacity
                                key={opt}
                                style={styles.selectionCard}
                                onPress={() => setPeOutputType(opt)}
                              >
                                <View
                                  style={[
                                    styles.selectionIconBox,
                                    {
                                      backgroundColor:
                                        idx === 0 ? "#0d9488" : "#64748b",
                                    },
                                  ]}
                                >
                                  <Package color="#FFF" size={28} />
                                </View>
                                <View style={styles.selectionText}>
                                  <Text style={styles.selectionCardTitle}>
                                    {opt}
                                  </Text>
                                  <Text style={styles.selectionCardSub}>
                                    {idx === 0
                                      ? "Primary output"
                                      : "Alternative output"}
                                  </Text>
                                </View>
                                <ChevronRight color="#CCC" size={24} />
                              </TouchableOpacity>
                            ),
                          )}
                          <TouchableOpacity
                            style={[
                              styles.secondaryButton,
                              { marginTop: 16, marginBottom: 8 },
                            ]}
                            onPress={handleBack}
                          >
                            <Text style={styles.secondaryButtonText}>
                              ← Back
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}

                    {/* Step 3: Weight entry + QR generation */}
                    {selectedSubLine && peOutputType && (
                      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                        <View
                          style={[
                            styles.sublineBadgeWrapper,
                            { paddingHorizontal: 0, marginBottom: 12 },
                          ]}
                        >
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#CCFBF1",
                                borderColor: "#99F6E4",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#0d9488" },
                              ]}
                            >
                              {selectedSubLine} → {peOutputType}
                            </Text>
                          </View>
                        </View>

                        {/* Input: continuous, no scanning */}
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View
                              style={[
                                styles.typePill,
                                { backgroundColor: "#E0F2FE" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.typePillText,
                                  { color: "#0369A1" },
                                ]}
                              >
                                INPUT
                              </Text>
                            </View>
                            <Text style={styles.sectionTitleText}>
                              Continuous — no scanning required
                            </Text>
                          </View>
                          <View style={styles.grayEmptyBox}>
                            <Text style={styles.grayEmptyText}>
                              Crusher-Washing is one combined process for PE
                            </Text>
                          </View>
                        </View>

                        {/* Output: weight + QR */}
                        {isShiftEnded ? (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              backgroundColor: "#FEF2F2",
                              borderRadius: 10,
                              padding: 12,
                              marginBottom: 8,
                              borderWidth: 1,
                              borderColor: "#FECACA",
                            }}
                          >
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: "#EF4444",
                                marginRight: 8,
                              }}
                            />
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#DC2626",
                              }}
                            >
                              Shift Ended — View Only
                            </Text>
                            <Text
                              style={{
                                fontSize: 12,
                                color: "#7f1d1d",
                                marginLeft: 6,
                              }}
                            >
                              New output is disabled.
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.sectionCard}>
                            <View style={styles.sectionHeaderRow}>
                              <View
                                style={[
                                  styles.typePill,
                                  { backgroundColor: "#DCFCE7" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.typePillText,
                                    { color: "#15803D" },
                                  ]}
                                >
                                  OUTPUT
                                </Text>
                              </View>
                              <Text style={styles.sectionTitleText}>
                                {peOutputType}
                              </Text>
                            </View>
                            <View style={styles.inputGroup}>
                              <Text style={styles.label}>Weight (kg)</Text>
                              <View style={styles.inputWithIcon}>
                                <TextInput
                                  style={[
                                    styles.input,
                                    styles.inputWithIconPadding,
                                    { flex: 1 },
                                  ]}
                                  placeholder="Enter weight"
                                  placeholderTextColor="#999"
                                  keyboardType="decimal-pad"
                                  value={weightInput}
                                  onChangeText={handleWeightInputChange}
                                />
                                <TouchableOpacity
                                  style={styles.iconInsideInput}
                                >
                                  <Scale size={20} color="#666" />
                                </TouchableOpacity>
                              </View>
                            </View>
                            <TouchableOpacity
                              style={styles.secondaryButton}
                              onPress={handleTakePhoto}
                            >
                              <CameraIcon size={20} color="#475569" />
                              <Text style={styles.secondaryButtonText}>
                                Take Photo
                              </Text>
                            </TouchableOpacity>
                            {capturedImages.length > 0 && (
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.photosPreviewContainer}
                                contentContainerStyle={
                                  styles.photosPreviewContent
                                }
                              >
                                {capturedImages.map((imageUri, index) => (
                                  <View
                                    key={index}
                                    style={styles.photoPreviewItem}
                                  >
                                    <Image
                                      source={{ uri: imageUri }}
                                      style={styles.photoPreviewThumbnail}
                                    />
                                    <TouchableOpacity
                                      style={styles.removePhotoButton}
                                      onPress={() =>
                                        setCapturedImages((prev) =>
                                          prev.filter((_, i) => i !== index),
                                        )
                                      }
                                    >
                                      <X size={16} color="#FFF" />
                                    </TouchableOpacity>
                                  </View>
                                ))}
                              </ScrollView>
                            )}
                            <TouchableOpacity
                              style={[
                                styles.primaryButton,
                                (!isValidProductionWeightInput(weightInput) ||
                                  isLoading) && {
                                  opacity: 0.5,
                                  backgroundColor: "#E2E8F0",
                                },
                              ]}
                              onPress={handleLogProduction}
                              disabled={
                                !isValidProductionWeightInput(weightInput) ||
                                isLoading
                              }
                            >
                              {isLoading ? (
                                <ActivityIndicator color="#666" />
                              ) : (
                                <PrinterIcon
                                  size={20}
                                  color={
                                    !isValidProductionWeightInput(weightInput)
                                      ? "#94A3B8"
                                      : "#FFF"
                                  }
                                />
                              )}
                              <Text
                                style={[
                                  styles.primaryButtonText,
                                  !isValidProductionWeightInput(
                                    weightInput,
                                  ) && { color: "#94A3B8" },
                                ]}
                              >
                                Generate QR & Print
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* Shift progress */}
                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>
                            Shift Progress — {peOutputType}
                          </Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Outputs this shift
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {
                                shiftLogs.filter(
                                  (l: any) =>
                                    l.station_id === selectedStation.id &&
                                    l.sub_line === peOutputType,
                                ).length
                              }{" "}
                              bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Total weight
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {shiftLogs
                                .filter(
                                  (l: any) =>
                                    l.station_id === selectedStation.id &&
                                    l.sub_line === peOutputType,
                                )
                                .reduce(
                                  (acc: number, l: any) =>
                                    acc + Number(l.weight || 0),
                                  0,
                                )
                                .toFixed(1)}{" "}
                              kg
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.secondaryButton,
                            { marginTop: 12, marginBottom: 28 },
                          ]}
                          onPress={handleBack}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                ) : isPET ? (
                  /* ══════════════════════════════════════════════════════════
                    PET CRUSHER RAPID FLOW
                    Sub-line is auto-set to 'Rapid' by handleStationSelect.
                    Show direct Output / Input entry UI.
                    ══════════════════════════════════════════════════════════ */
                  <>
                    {/* Hero header */}
                    <View
                      style={[
                        styles.stationHero,
                        {
                          backgroundColor: selectedStation.color,
                          paddingBottom: 20,
                          marginBottom: 0,
                        },
                      ]}
                    >
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(
                            selectedStation.name,
                            selectedStation.color,
                          )}
                        </View>
                        <View style={{ marginLeft: 15, flex: 1 }}>
                          <Text style={styles.heroTitle}>
                            Crusher Rapid PET
                          </Text>
                          <Text style={styles.heroDesc}>
                            PET — Raw material crushing
                          </Text>
                        </View>
                      </View>
                    </View>

                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginTop: 4,
                          marginBottom: 4,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}

                    {/* Station totals */}
                    {(() => {
                      const totalBags = shiftLogs.filter(
                        (l: any) => l.station_id === selectedStation.id,
                      ).length;
                      const totalKg = shiftLogs
                        .filter((l: any) => l.station_id === selectedStation.id)
                        .reduce(
                          (s: number, l: any) =>
                            s + (parseFloat(l.weight) || 0),
                          0,
                        );
                      return (
                        <View style={{ marginBottom: 12 }}>
                          <View
                            style={{
                              backgroundColor: "#1e293b",
                              borderRadius: 14,
                              padding: 14,
                              marginBottom: 10,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#94a3b8",
                              }}
                            >
                              Crusher Rapid PET — This Shift
                            </Text>
                            <View style={{ flexDirection: "row", gap: 16 }}>
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  bags
                                </Text>
                              </View>
                              <View
                                style={{ width: 1, backgroundColor: "#334155" }}
                              />
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  kg
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>
                      );
                    })()}

                    {/* Input / Output section selector */}
                    {!selectedSection && !isShiftEnded && (
                      <View style={styles.selectionContainer}>
                        <Text style={styles.selectionTitle}>Select Action</Text>
                        <TouchableOpacity
                          style={styles.selectionCard}
                          onPress={() => {
                            setSelectedSection("input");
                            setCrusherDnNoInput(crusherDnNo);
                          }}
                        >
                          <View
                            style={[
                              styles.selectionIconBox,
                              { backgroundColor: "#0369a1" },
                            ]}
                          >
                            <FileText color="#FFF" size={28} />
                          </View>
                          <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>Input</Text>
                            <Text style={styles.selectionCardSub}>
                              {crusherDnNo
                                ? `DN: ${crusherDnNo}`
                                : "Scan or enter Delivery Note No."}
                            </Text>
                          </View>
                          <ChevronRight color="#CCC" size={24} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.selectionCard}
                          onPress={() => setSelectedSection("output")}
                        >
                          <View
                            style={[
                              styles.selectionIconBox,
                              { backgroundColor: "#0369a1" },
                            ]}
                          >
                            <Package color="#FFF" size={28} />
                          </View>
                          <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>
                              Output
                            </Text>
                            <Text style={styles.selectionCardSub}>
                              Log crusher rapid output bag
                            </Text>
                          </View>
                          <ChevronRight color="#CCC" size={24} />
                        </TouchableOpacity>
                        {/* PE-only: Hold action — sets material aside for QC reprocess */}
                        {isPE && (
                          <TouchableOpacity
                            style={styles.selectionCard}
                            onPress={() => {
                              setSelectedSection("hold");
                              openPeHoldModal();
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: "#f59e0b" },
                              ]}
                            >
                              <PauseCircle color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>Hold</Text>
                              <Text style={styles.selectionCardSub}>
                                Set aside for QC reprocess
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {/* PET Crusher: DN No. Input screen */}
                    {selectedSection === "input" && (
                      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                        <View style={styles.sublineBadgeWrapper}>
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#E0F2FE",
                                borderColor: "#bae6fd",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#0369a1" },
                              ]}
                            >
                              Delivery Note Input
                            </Text>
                          </View>
                        </View>
                        {renderCrusherDnNoSection()}
                        <TouchableOpacity
                          style={[styles.secondaryButton, { marginTop: 8 }]}
                          onPress={handleBack}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Output: weight + QR + print (same pattern as PC Rapid line) */}
                    {selectedSection === "output" && (
                      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                        <View style={styles.sublineBadgeWrapper}>
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#F5F3FF",
                                borderColor: "#ddd6fe",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#7c3aed" },
                              ]}
                            >
                              Rapid line — Output
                            </Text>
                          </View>
                        </View>

                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View
                              style={[
                                styles.typePill,
                                { backgroundColor: "#E0F2FE" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.typePillText,
                                  { color: "#0369A1" },
                                ]}
                              >
                                INPUT
                              </Text>
                            </View>
                            <Text style={styles.sectionTitleText}>Raw PET</Text>
                          </View>
                          <View style={styles.grayEmptyBox}>
                            <Text style={styles.grayEmptyText}>
                              Continuous infeed — no scanning required
                            </Text>
                          </View>
                        </View>

                        {isShiftEnded ? (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              backgroundColor: "#FEF2F2",
                              borderRadius: 10,
                              padding: 12,
                              marginBottom: 8,
                              borderWidth: 1,
                              borderColor: "#FECACA",
                            }}
                          >
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: "#EF4444",
                                marginRight: 8,
                              }}
                            />
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#DC2626",
                              }}
                            >
                              Shift Ended — View Only
                            </Text>
                            <Text
                              style={{
                                fontSize: 12,
                                color: "#7f1d1d",
                                marginLeft: 6,
                              }}
                            >
                              New output is disabled.
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.sectionCard}>
                            <View style={styles.sectionHeaderRow}>
                              <View
                                style={[
                                  styles.typePill,
                                  { backgroundColor: "#DCFCE7" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.typePillText,
                                    { color: "#15803D" },
                                  ]}
                                >
                                  OUTPUT
                                </Text>
                              </View>
                              <Text style={styles.sectionTitleText}>
                                Crusher output bag
                              </Text>
                            </View>
                            {crusherDnNo ? (
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  backgroundColor: "#D1FAE5",
                                  borderRadius: 8,
                                  paddingHorizontal: 12,
                                  paddingVertical: 8,
                                  marginBottom: 10,
                                  borderWidth: 1,
                                  borderColor: "#6EE7B7",
                                }}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      color: "#065F46",
                                      fontWeight: "600",
                                    }}
                                  >
                                    Active DN No.
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 15,
                                      color: "#065F46",
                                      fontWeight: "700",
                                    }}
                                  >
                                    {crusherDnNo}
                                  </Text>
                                </View>
                              </View>
                            ) : (
                              <View
                                style={{
                                  backgroundColor: "#FEF9C3",
                                  borderRadius: 8,
                                  paddingHorizontal: 12,
                                  paddingVertical: 8,
                                  marginBottom: 10,
                                  borderWidth: 1,
                                  borderColor: "#FDE047",
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 12,
                                    color: "#92400E",
                                    fontWeight: "600",
                                  }}
                                >
                                  No DN No. set — tap INPUT to scan or enter
                                </Text>
                              </View>
                            )}
                            <View style={styles.inputGroup}>
                              <Text style={styles.label}>Weight (kg)</Text>
                              <View style={styles.inputWithIcon}>
                                <TextInput
                                  style={[
                                    styles.input,
                                    styles.inputWithIconPadding,
                                    { flex: 1 },
                                  ]}
                                  placeholder="Enter weight"
                                  placeholderTextColor="#999"
                                  keyboardType="decimal-pad"
                                  value={weightInput}
                                  onChangeText={handleWeightInputChange}
                                />
                                <TouchableOpacity
                                  style={styles.iconInsideInput}
                                >
                                  <Scale size={20} color="#666" />
                                </TouchableOpacity>
                              </View>
                            </View>
                            <TouchableOpacity
                              style={styles.secondaryButton}
                              onPress={handleTakePhoto}
                            >
                              <CameraIcon size={20} color="#475569" />
                              <Text style={styles.secondaryButtonText}>
                                Take Photo
                              </Text>
                            </TouchableOpacity>
                            {capturedImages.length > 0 && (
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.photosPreviewContainer}
                                contentContainerStyle={
                                  styles.photosPreviewContent
                                }
                              >
                                {capturedImages.map((imageUri, index) => (
                                  <View
                                    key={index}
                                    style={styles.photoPreviewItem}
                                  >
                                    <Image
                                      source={{ uri: imageUri }}
                                      style={styles.photoPreviewThumbnail}
                                    />
                                    <TouchableOpacity
                                      style={styles.removePhotoButton}
                                      onPress={() =>
                                        setCapturedImages((prev) =>
                                          prev.filter((_, i) => i !== index),
                                        )
                                      }
                                    >
                                      <X size={16} color="#FFF" />
                                    </TouchableOpacity>
                                  </View>
                                ))}
                              </ScrollView>
                            )}
                            <TouchableOpacity
                              style={[
                                styles.primaryButton,
                                (!isValidProductionWeightInput(weightInput) ||
                                  isLoading) && {
                                  opacity: 0.5,
                                  backgroundColor: "#E2E8F0",
                                },
                              ]}
                              onPress={handleLogProduction}
                              disabled={
                                !isValidProductionWeightInput(weightInput) ||
                                isLoading
                              }
                            >
                              {isLoading ? (
                                <ActivityIndicator color="#666" />
                              ) : (
                                <PrinterIcon
                                  size={20}
                                  color={
                                    !isValidProductionWeightInput(weightInput)
                                      ? "#94A3B8"
                                      : "#FFF"
                                  }
                                />
                              )}
                              <Text
                                style={[
                                  styles.primaryButtonText,
                                  !isValidProductionWeightInput(
                                    weightInput,
                                  ) && { color: "#94A3B8" },
                                ]}
                              >
                                Generate QR & Print
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>
                            Shift Progress (Rapid)
                          </Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Outputs this shift
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewBags} bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Total weight
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewWeight.toFixed(1)} kg
                            </Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          style={[styles.secondaryButton, { marginTop: 8 }]}
                          onPress={() => {
                            setSelectedSection(null);
                            setWeightInput("");
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Recent Entries: dashboard only — hidden on Output screen so the form is uncluttered */}
                    {selectedSection !== "output" && (
                      <View
                        style={[
                          styles.crusherLogsSection,
                          { marginHorizontal: 16, marginBottom: 24 },
                        ]}
                      >
                        <View style={styles.logsHeader}>
                          <Text style={styles.logsTitle}>Recent Entries</Text>
                        </View>
                        <View style={styles.datePickerContainer}>
                          <Text style={styles.datePickerLabel}>
                            Select Date:
                          </Text>
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
                            onChangeText={(text) => {
                              setSearchQuery(text);
                              setCurrentPage(1);
                            }}
                            placeholderTextColor="#94a3b8"
                            returnKeyType="search"
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                          />
                          {searchQuery.length > 0 && (
                            <TouchableOpacity
                              onPress={() => {
                                setSearchQuery("");
                                setCurrentPage(1);
                              }}
                              style={styles.clearButton}
                            >
                              <X size={16} color="#64748b" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.filtersContainer}>
                          <View style={styles.filterGroup}>
                            <Text style={styles.filterLabel}>Status:</Text>
                            <View style={styles.filterButtons}>
                              {(["all", "pending", "Completed"] as const).map(
                                (s) => (
                                  <TouchableOpacity
                                    key={s}
                                    style={[
                                      styles.filterButton,
                                      selectedStatusFilter === s &&
                                        styles.filterButtonActive,
                                    ]}
                                    onPress={() => {
                                      setSelectedStatusFilter(s);
                                      setCurrentPage(1);
                                    }}
                                  >
                                    <Text
                                      style={[
                                        styles.filterButtonText,
                                        selectedStatusFilter === s &&
                                          styles.filterButtonTextActive,
                                      ]}
                                    >
                                      {s === "all"
                                        ? "All"
                                        : s === "pending"
                                          ? "Pending"
                                          : "Complete"}
                                    </Text>
                                  </TouchableOpacity>
                                ),
                              )}
                            </View>
                          </View>
                        </View>
                        {crusherLogsLoading ? (
                          <View style={styles.loadingState}>
                            <ActivityIndicator size="large" color="#0369a1" />
                            <Text style={styles.loadingText}>
                              Loading entries...
                            </Text>
                          </View>
                        ) : crusherLogs.length > 0 ? (
                          <View style={styles.logsList}>
                            {crusherLogs.map((log: any, index: number) => (
                              <View
                                key={log.id || index}
                                style={styles.logItem}
                              >
                                <View style={styles.logMain}>
                                  <Text style={styles.logQr}>
                                    {log.output_bag_qr ||
                                      log.outputBagQr ||
                                      "—"}
                                  </Text>
                                  <View style={styles.logDetails}>
                                    <Text style={styles.logWeight}>
                                      {log.weight} kg
                                    </Text>
                                    <Text style={styles.logTime}>
                                      {new Date(
                                        log.created_at,
                                      ).toLocaleString()}
                                    </Text>
                                  </View>
                                  <View style={styles.logStatusRow}>
                                    <View
                                      style={[
                                        styles.statusBadge,
                                        {
                                          backgroundColor:
                                            log.status === "pending"
                                              ? "#FEF3C7"
                                              : log.status === "hold"
                                              ? "#FFEDD5"
                                              : log.status === "reject"
                                              ? "#FEE2E2"
                                              : "#DCFCE7",
                                        },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.statusBadgeText,
                                          {
                                            color:
                                              log.status === "pending"
                                                ? "#D97706"
                                                : log.status === "hold"
                                                ? "#92400E"
                                                : log.status === "reject"
                                                ? "#B91C1C"
                                                : "#15803D",
                                          },
                                        ]}
                                      >
                                        {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                                <View style={styles.logActions}>
                                  {(canEditAnyStatus ||
                                    log.status === "pending") && (
                                    <TouchableOpacity
                                      style={styles.editIconButton}
                                      onPress={() => openEditLogWeight(log)}
                                    >
                                      <Pencil color="#0ea5e9" size={18} />
                                    </TouchableOpacity>
                                  )}
                                  {isPE && log.status === "hold" && (
                                    <>
                                      <TouchableOpacity
                                        style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                        onPress={() => openPeResolveModal(log)}
                                      >
                                        <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                        onPress={() => openPeResolveModal(log)}
                                      >
                                        <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                      </TouchableOpacity>
                                    </>
                                  )}
                                  <TouchableOpacity
                                    style={styles.printIconButton}
                                    onPress={() => {
                                      setSelectedLogForPrint(log);
                                      setShowListPrintPreview(true);
                                    }}
                                  >
                                    <PrinterIcon color="#0369a1" size={20} />
                                  </TouchableOpacity>
                                  <View
                                    style={[
                                      styles.logBadge,
                                      { backgroundColor: "#DBEAFE" },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.logBadgeText,
                                        { color: "#0369a1" },
                                      ]}
                                    >
                                      Rapid
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <View style={styles.emptyState}>
                            <Package size={48} color="#94a3b8" opacity={0.5} />
                            <Text style={styles.emptyText}>
                              No entries found for this date
                            </Text>
                          </View>
                        )}
                        {totalPages > 1 && (
                          <View style={styles.pagination}>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                currentPage === 1 && styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                setCurrentPage(Math.max(1, currentPage - 1))
                              }
                              disabled={currentPage === 1}
                            >
                              <ChevronLeft
                                color={
                                  currentPage === 1 ? "#cbd5e1" : "#475569"
                                }
                                size={18}
                              />
                            </TouchableOpacity>
                            <View style={styles.pageInfoBox}>
                              <Text style={styles.pageInfoMain}>
                                {currentPage} / {totalPages}
                              </Text>
                              <Text style={styles.pageInfoSub}>
                                {totalLogs} total
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                currentPage === totalPages &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                setCurrentPage(
                                  Math.min(totalPages, currentPage + 1),
                                )
                              }
                              disabled={currentPage === totalPages}
                            >
                              <ChevronRight
                                color={
                                  currentPage === totalPages
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                                size={18}
                              />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                ) : /* ══════════════════════════════════════════════════════════
                    PC CRUSHER FLOW (unchanged)
                    ══════════════════════════════════════════════════════════ */
                !selectedSubLine ? (
                  <View style={styles.selectionContainer}>
                    <Text style={styles.selectionTitle}>
                      Select Crusher Line
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.selectionCard,
                        isShiftEnded && { opacity: 0.4 },
                      ]}
                      disabled={isShiftEnded}
                      onPress={() => setSelectedSubLine("3E")}
                    >
                      <View
                        style={[
                          styles.selectionIconBox,
                          { backgroundColor: "#3b82f6" },
                        ]}
                      >
                        <Package color="#FFF" size={28} />
                      </View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>3E</Text>
                        <Text style={styles.selectionCardSub}>
                          {t("dashboard.primaryCrusherLine")}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", marginRight: 8 }}>
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#1e293b",
                          }}
                        >
                          {
                            shiftLogs.filter(
                              (l: any) =>
                                l.station_id === selectedStation.id &&
                                l.sub_line === "3E",
                            ).length
                          }{" "}
                          bags
                        </Text>
                        <Text style={{ fontSize: 11, color: "#64748b" }}>
                          {shiftLogs
                            .filter(
                              (l: any) =>
                                l.station_id === selectedStation.id &&
                                l.sub_line === "3E",
                            )
                            .reduce(
                              (s: number, l: any) =>
                                s + (parseFloat(l.weight) || 0),
                              0,
                            )
                            .toFixed(1)}{" "}
                          kg
                        </Text>
                      </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.selectionCard,
                        isShiftEnded && { opacity: 0.4 },
                      ]}
                      disabled={isShiftEnded}
                      onPress={() => setSelectedSubLine("Rapid")}
                    >
                      <View
                        style={[
                          styles.selectionIconBox,
                          { backgroundColor: "#a855f7" },
                        ]}
                      >
                        <Zap color="#FFF" size={28} />
                      </View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>Rapid</Text>
                        <Text style={styles.selectionCardSub}>
                          {t("dashboard.fastProcessingLine")}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", marginRight: 8 }}>
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#1e293b",
                          }}
                        >
                          {
                            shiftLogs.filter(
                              (l: any) =>
                                l.station_id === selectedStation.id &&
                                l.sub_line === "Rapid",
                            ).length
                          }{" "}
                          bags
                        </Text>
                        <Text style={{ fontSize: 11, color: "#64748b" }}>
                          {shiftLogs
                            .filter(
                              (l: any) =>
                                l.station_id === selectedStation.id &&
                                l.sub_line === "Rapid",
                            )
                            .reduce(
                              (s: number, l: any) =>
                                s + (parseFloat(l.weight) || 0),
                              0,
                            )
                            .toFixed(1)}{" "}
                          kg
                        </Text>
                      </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.selectionCard,
                        isShiftEnded && { opacity: 0.4 },
                      ]}
                      disabled={isShiftEnded}
                      onPress={() => setSelectedSubLine("Betty")}
                    >
                      <View
                        style={[
                          styles.selectionIconBox,
                          { backgroundColor: "#10b981" },
                        ]}
                      >
                        <Box color="#FFF" size={28} />
                      </View>
                      <View style={styles.selectionText}>
                        <Text style={styles.selectionCardTitle}>Betty</Text>
                        <Text style={styles.selectionCardSub}>
                          {t("dashboard.bettyMachineLine")}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", marginRight: 8 }}>
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#1e293b",
                          }}
                        >
                          {
                            shiftLogs.filter(
                              (l: any) =>
                                l.station_id === selectedStation.id &&
                                l.sub_line === "Betty",
                            ).length
                          }{" "}
                          bags
                        </Text>
                        <Text style={{ fontSize: 11, color: "#64748b" }}>
                          {shiftLogs
                            .filter(
                              (l: any) =>
                                l.station_id === selectedStation.id &&
                                l.sub_line === "Betty",
                            )
                            .reduce(
                              (s: number, l: any) =>
                                s + (parseFloat(l.weight) || 0),
                              0,
                            )
                            .toFixed(1)}{" "}
                          kg
                        </Text>
                      </View>
                      <ChevronRight color="#CCC" size={24} />
                    </TouchableOpacity>

                    {/* Shift Ended banner for Crusher */}
                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginTop: 4,
                          marginBottom: 4,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}

                    {/* Crusher Station Totals */}
                    {(() => {
                      const lines = [
                        { label: "3E", color: "#3b82f6", icon: "⚙" },
                        { label: "Rapid", color: "#a855f7", icon: "⚡" },
                        { label: "Betty", color: "#10b981", icon: "📦" },
                      ];
                      const totalBags = shiftLogs.filter(
                        (l: any) => l.station_id === selectedStation.id,
                      ).length;
                      const totalKg = shiftLogs
                        .filter((l: any) => l.station_id === selectedStation.id)
                        .reduce(
                          (s: number, l: any) =>
                            s + (parseFloat(l.weight) || 0),
                          0,
                        );
                      return (
                        <View style={{ marginBottom: 12 }}>
                          {/* Station-wide summary bar */}
                          <View
                            style={{
                              backgroundColor: "#1e293b",
                              borderRadius: 14,
                              padding: 14,
                              marginBottom: 10,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#94a3b8",
                              }}
                            >
                              Crusher — This Shift
                            </Text>
                            <View style={{ flexDirection: "row", gap: 16 }}>
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  bags
                                </Text>
                              </View>
                              <View
                                style={{ width: 1, backgroundColor: "#334155" }}
                              />
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  kg
                                </Text>
                              </View>
                            </View>
                          </View>
                          {/* Per-line breakdown */}
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            {lines.map(({ label, color }) => {
                              const bags = shiftLogs.filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === label,
                              ).length;
                              const kg = shiftLogs
                                .filter(
                                  (l: any) =>
                                    l.station_id === selectedStation.id &&
                                    l.sub_line === label,
                                )
                                .reduce(
                                  (s: number, l: any) =>
                                    s + (parseFloat(l.weight) || 0),
                                  0,
                                );
                              return (
                                <View
                                  key={label}
                                  style={{
                                    flex: 1,
                                    backgroundColor: "#fff",
                                    borderRadius: 12,
                                    padding: 12,
                                    borderTopWidth: 3,
                                    borderTopColor: color,
                                    elevation: 2,
                                    shadowColor: "#000",
                                    shadowOpacity: 0.06,
                                    shadowRadius: 4,
                                    shadowOffset: { width: 0, height: 2 },
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      fontWeight: "700",
                                      color,
                                      marginBottom: 6,
                                    }}
                                  >
                                    {label}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 22,
                                      fontWeight: "800",
                                      color: "#1e293b",
                                    }}
                                  >
                                    {bags}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      color: "#64748b",
                                      marginTop: 1,
                                    }}
                                  >
                                    bags
                                  </Text>
                                  <View
                                    style={{
                                      marginTop: 6,
                                      borderTopWidth: 1,
                                      borderTopColor: "#f1f5f9",
                                      paddingTop: 6,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 13,
                                        fontWeight: "700",
                                        color: "#475569",
                                      }}
                                    >
                                      {kg.toFixed(1)} kg
                                    </Text>
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
                          onChangeText={(text) => {
                            setSearchQuery(text);
                            setCurrentPage(1);
                          }}
                          placeholderTextColor="#94a3b8"
                          clearButtonMode="while-editing"
                          returnKeyType="search"
                          autoCorrect={false}
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        {searchQuery.length > 0 && (
                          <TouchableOpacity
                            onPress={() => {
                              setSearchQuery("");
                              setCurrentPage(1);
                            }}
                            style={styles.clearButton}
                          >
                            <X size={16} color="#64748b" />
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Filters — Machine (3E / Rapid / Betty) and Status */}
                      <View style={styles.filtersContainer}>
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Machine:</Text>
                          <View style={styles.filterButtons}>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                selectedLineFilter === "all" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setSelectedLineFilter("all");
                                setCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  selectedLineFilter === "all" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                All
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                selectedLineFilter === "3E" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setSelectedLineFilter("3E");
                                setCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  selectedLineFilter === "3E" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                3E
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                selectedLineFilter === "Rapid" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setSelectedLineFilter("Rapid");
                                setCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  selectedLineFilter === "Rapid" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                Rapid
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                selectedLineFilter === "Betty" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setSelectedLineFilter("Betty");
                                setCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  selectedLineFilter === "Betty" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                Betty
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* Status Filter */}
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Status:</Text>
                          <View style={styles.filterButtons}>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                selectedStatusFilter === "all" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setSelectedStatusFilter("all");
                                setCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  selectedStatusFilter === "all" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                All
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                selectedStatusFilter === "pending" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setSelectedStatusFilter("pending");
                                setCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  selectedStatusFilter === "pending" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                Pending
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                selectedStatusFilter === "Completed" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setSelectedStatusFilter("Completed");
                                setCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  selectedStatusFilter === "Completed" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                Complete
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      {crusherLogsLoading ? (
                        <View style={styles.loadingState}>
                          <ActivityIndicator size="large" color="#17a34a" />
                          <Text style={styles.loadingText}>
                            Loading entries...
                          </Text>
                        </View>
                      ) : crusherLogs.length > 0 ? (
                        <View style={styles.logsList}>
                          {crusherLogs.map((log, index) => (
                            <View key={index} style={styles.logItem}>
                              <View style={styles.logMain}>
                                <Text style={styles.logQr}>
                                  {log.output_bag_qr}
                                </Text>
                                <View style={styles.logDetails}>
                                  <Text style={styles.logWeight}>
                                    {log.weight} kg
                                  </Text>
                                  <Text style={styles.logTime}>
                                    {new Date(log.created_at).toLocaleString()}
                                  </Text>
                                </View>
                                <View style={styles.logStatusRow}>
                                  <View
                                    style={[
                                      styles.statusBadge,
                                      {
                                        backgroundColor:
                                          log.status === "pending"
                                            ? "#FEF3C7"
                                            : log.status === "hold"
                                            ? "#FFEDD5"
                                            : log.status === "reject"
                                            ? "#FEE2E2"
                                            : "#DCFCE7",
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.statusBadgeText,
                                        {
                                          color:
                                            log.status === "pending"
                                              ? "#D97706"
                                              : log.status === "hold"
                                              ? "#92400E"
                                              : log.status === "reject"
                                              ? "#B91C1C"
                                              : "#15803D",
                                        },
                                      ]}
                                    >
                                      {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                              <View style={styles.logActions}>
                                {(canEditAnyStatus ||
                                  log.status === "pending") && (
                                  <TouchableOpacity
                                    style={styles.editIconButton}
                                    onPress={() => openEditLogWeight(log)}
                                  >
                                    <Pencil color="#0ea5e9" size={18} />
                                  </TouchableOpacity>
                                )}
                                {isPE && log.status === "hold" && (
                                  <>
                                    <TouchableOpacity
                                      style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                      onPress={() => openPeResolveModal(log)}
                                    >
                                      <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                      onPress={() => openPeResolveModal(log)}
                                    >
                                      <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                    </TouchableOpacity>
                                  </>
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
                                <View
                                  style={[
                                    styles.logBadge,
                                    {
                                      backgroundColor:
                                        log.sub_line === "3E"
                                          ? "#EBF5FF"
                                          : log.sub_line === "Rapid"
                                            ? "#F5F3FF"
                                            : "#D1FAE5",
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.logBadgeText,
                                      {
                                        color:
                                          log.sub_line === "3E"
                                            ? "#2563eb"
                                            : log.sub_line === "Rapid"
                                              ? "#7c3aed"
                                              : "#059669",
                                      },
                                    ]}
                                  >
                                    {log.sub_line}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <View style={styles.emptyState}>
                          <Package size={48} color="#94a3b8" opacity={0.5} />
                          <Text style={styles.emptyText}>
                            No entries found for this date
                          </Text>
                        </View>
                      )}

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <View style={styles.pagination}>
                          <TouchableOpacity
                            style={[
                              styles.pageBtn,
                              currentPage === 1 && styles.pageBtnDisabled,
                            ]}
                            onPress={() =>
                              setCurrentPage(Math.max(1, currentPage - 1))
                            }
                            disabled={currentPage === 1}
                          >
                            <ChevronLeft
                              color={currentPage === 1 ? "#cbd5e1" : "#475569"}
                              size={18}
                            />
                          </TouchableOpacity>
                          <View style={styles.pageInfoBox}>
                            <Text style={styles.pageInfoMain}>
                              {currentPage} / {totalPages}
                            </Text>
                            <Text style={styles.pageInfoSub}>
                              {totalLogs} total
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[
                              styles.pageBtn,
                              currentPage === totalPages &&
                                styles.pageBtnDisabled,
                            ]}
                            onPress={() =>
                              setCurrentPage(
                                Math.min(totalPages, currentPage + 1),
                              )
                            }
                            disabled={currentPage === totalPages}
                          >
                            <ChevronRight
                              color={
                                currentPage === totalPages
                                  ? "#cbd5e1"
                                  : "#475569"
                              }
                              size={18}
                            />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                ) : selectedSubLine === "Betty" ? (
                  /* ── Betty Crusher: input from 3E / Rapid bags ──────────────── */
                  <>
                    <View style={styles.sublineBadgeWrapper}>
                      <View
                        style={[
                          styles.sublineBadge,
                          {
                            backgroundColor: "#D1FAE5",
                            borderColor: "#a7f3d0",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sublineBadgeText,
                            { color: "#059669" },
                          ]}
                        >
                          Working on: Betty Line
                        </Text>
                      </View>
                    </View>

                    {/* Section picker — shown before choosing Input or Output */}
                    {isShiftEnded ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 16,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    ) : !selectedSection ? (
                      <View style={styles.sectionOptions}>
                        <TouchableOpacity
                          style={styles.sectionOption}
                          onPress={() => {
                            setSelectedSection("input");
                            setSelectedInputBag(null);
                            setBagSearchQuery("");
                          }}
                        >
                          <View
                            style={[
                              styles.optionIcon,
                              { backgroundColor: "#3b82f6" },
                            ]}
                          >
                            <Plus color="#FFF" size={24} />
                          </View>
                          <View>
                            <Text style={styles.optionTitle}>INPUT</Text>
                            <Text style={styles.optionSubtitle}>
                              Scan 3E / Rapid bag
                            </Text>
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.sectionOption}
                          onPress={() => {
                            setSelectedSection("output");
                          }}
                        >
                          <View
                            style={[
                              styles.optionIcon,
                              { backgroundColor: "#22c55e" },
                            ]}
                          >
                            <Minus color="#FFF" size={24} />
                          </View>
                          <View>
                            <Text style={styles.optionTitle}>OUTPUT</Text>
                            <Text style={styles.optionSubtitle}>
                              Generate Betty bag QR
                            </Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    ) : selectedSection === "input" ? (
                      /* ── Betty INPUT: scan a 3E / Rapid crusher bag ── */
                      <View style={styles.sectionCard}>
                        <View style={styles.sectionHeaderRow}>
                          <View
                            style={[
                              styles.typePill,
                              { backgroundColor: "#E0F2FE" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.typePillText,
                                { color: "#0369A1" },
                              ]}
                            >
                              INPUT
                            </Text>
                          </View>
                          <Text style={styles.sectionTitleText}>
                            From 3E / Rapid Crusher
                          </Text>
                        </View>

                        {/* Search */}
                        <View style={styles.searchContainer}>
                          <View style={styles.searchInputWrapper}>
                            <Search
                              size={20}
                              color="#666"
                              style={{ marginRight: 10 }}
                            />
                            <TextInput
                              style={styles.searchTextInput}
                              placeholder="Search QR code (3E / Rapid bag)…"
                              value={bagSearchQuery}
                              onChangeText={onBagSearch}
                              onFocus={() => {
                                if (suggestedBags.length > 0)
                                  setShowSuggestions(true);
                              }}
                            />
                          </View>
                          {showSuggestions && (
                            <ScrollView
                              style={styles.suggestionsList}
                              keyboardShouldPersistTaps="handled"
                              nestedScrollEnabled
                            >
                              {suggestedBags.map((bag, i) => (
                                <TouchableOpacity
                                  key={i}
                                  style={[
                                    styles.suggestionItem,
                                    i === suggestedBags.length - 1 && {
                                      borderBottomWidth: 0,
                                    },
                                  ]}
                                  onPress={() => {
                                    setSelectedInputBag(bag);
                                    setShowSuggestions(false);
                                    setBagSearchQuery("");
                                  }}
                                >
                                  <View style={styles.suggestionLeftCol}>
                                    <Text
                                      style={styles.suggestionQrLine}
                                      numberOfLines={2}
                                      selectable
                                    >
                                      {getBagDisplayId(bag)}
                                    </Text>
                                    {bag.sub_line ? (
                                      <Text style={styles.suggestionSubLine}>
                                        {bag.sub_line}
                                      </Text>
                                    ) : null}
                                  </View>
                                  <Text style={styles.suggestionDetail}>
                                    {bag.weight} kg
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          )}
                        </View>

                        {/* Scan */}
                        <TouchableOpacity
                          style={styles.scanButton}
                          onPress={() => {
                            setScanned(false);
                            setShowScanner(true);
                          }}
                        >
                          <CameraIcon color="#17a34a" size={20} />
                          <Text style={styles.scanButtonText}>
                            Scan QR Code
                          </Text>
                        </TouchableOpacity>

                        {/* Selected bag preview */}
                        {selectedInputBag && (
                          <View style={styles.selectedBagCard}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: "#64748b",
                                  marginBottom: 2,
                                }}
                              >
                                {t("dashboard.jumboId")}
                              </Text>
                              <Text
                                style={[styles.selectedBagId, { minWidth: 0 }]}
                                numberOfLines={2}
                                selectable
                              >
                                {getBagDisplayId(selectedInputBag)}
                              </Text>
                              {(selectedInputBag as any).sub_line ? (
                                <Text
                                  style={{
                                    fontSize: 12,
                                    color: "#64748b",
                                    marginTop: 4,
                                  }}
                                >
                                  {t("dashboard.lineLabel")}:{" "}
                                  {(selectedInputBag as any).sub_line}
                                </Text>
                              ) : null}
                              <Text style={styles.selectedBagWeight}>
                                {selectedInputBag.weight} kg
                              </Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => setSelectedInputBag(null)}
                            >
                              <X color="#EB445A" size={20} />
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* Confirm button */}
                        <TouchableOpacity
                          style={[
                            styles.primaryButton,
                            (!selectedInputBag || isLoading) && {
                              opacity: 0.5,
                            },
                          ]}
                          disabled={!selectedInputBag || isLoading}
                          onPress={async () => {
                            if (!selectedInputBag) return;
                            try {
                              setIsLoading(true);
                              const response =
                                await productionApi.updateLogStatus(
                                  selectedInputBag.output_bag_qr,
                                  "Completed",
                                  undefined,
                                  undefined,
                                  "Betty", // usedLine
                                );
                              if (response.data.success) {
                                Alert.alert(
                                  "Success",
                                  "Bag marked as received by Betty crusher.",
                                );
                                setSelectedInputBag(null);
                                setBagSearchQuery("");
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedSection(null);
                              } else {
                                Alert.alert(
                                  "Error",
                                  "Failed to update bag status.",
                                );
                              }
                            } catch (err) {
                              Alert.alert(
                                "Error",
                                "Could not update bag status.",
                              );
                            } finally {
                              setIsLoading(false);
                            }
                          }}
                        >
                          <Text style={styles.primaryButtonText}>
                            Confirm Input (Mark as Received)
                          </Text>
                        </TouchableOpacity>

                        {/* Back */}
                        <TouchableOpacity
                          style={[styles.secondaryButton, { marginTop: 8 }]}
                          onPress={() => {
                            setSelectedSection(null);
                            setSelectedInputBag(null);
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      /* ── Betty OUTPUT: same form as 3E / Rapid ── */
                      <>
                        {isShiftEnded ? (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              backgroundColor: "#FEF2F2",
                              borderRadius: 10,
                              padding: 12,
                              marginBottom: 8,
                              borderWidth: 1,
                              borderColor: "#FECACA",
                            }}
                          >
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: "#EF4444",
                                marginRight: 8,
                              }}
                            />
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#DC2626",
                              }}
                            >
                              Shift Ended — View Only
                            </Text>
                            <Text
                              style={{
                                fontSize: 12,
                                color: "#7f1d1d",
                                marginLeft: 6,
                              }}
                            >
                              New output is disabled.
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.sectionCard}>
                            <View style={styles.sectionHeaderRow}>
                              <View
                                style={[
                                  styles.typePill,
                                  { backgroundColor: "#DCFCE7" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.typePillText,
                                    { color: "#15803D" },
                                  ]}
                                >
                                  OUTPUT
                                </Text>
                              </View>
                              <Text style={styles.sectionTitleText}>
                                Jumbo Bag (Betty)
                              </Text>
                            </View>

                            <View style={styles.inputGroup}>
                              <Text style={styles.label}>Weight (kg)</Text>
                              <View style={styles.inputWithIcon}>
                                <TextInput
                                  style={[
                                    styles.input,
                                    styles.inputWithIconPadding,
                                    { flex: 1 },
                                  ]}
                                  placeholder="Enter weight"
                                  placeholderTextColor="#999"
                                  keyboardType="decimal-pad"
                                  value={weightInput}
                                  onChangeText={handleWeightInputChange}
                                />
                                <TouchableOpacity
                                  style={styles.iconInsideInput}
                                >
                                  <Scale size={20} color="#666" />
                                </TouchableOpacity>
                              </View>
                            </View>

                            <TouchableOpacity
                              style={styles.secondaryButton}
                              onPress={handleTakePhoto}
                            >
                              <CameraIcon size={20} color="#475569" />
                              <Text style={styles.secondaryButtonText}>
                                Take Photo
                              </Text>
                            </TouchableOpacity>

                            {capturedImages.length > 0 && (
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.photosPreviewContainer}
                                contentContainerStyle={
                                  styles.photosPreviewContent
                                }
                              >
                                {capturedImages.map((imageUri, index) => (
                                  <View
                                    key={index}
                                    style={styles.photoPreviewItem}
                                  >
                                    <Image
                                      source={{ uri: imageUri }}
                                      style={styles.photoPreviewThumbnail}
                                    />
                                    <TouchableOpacity
                                      style={styles.removePhotoButton}
                                      onPress={() =>
                                        setCapturedImages((prev) =>
                                          prev.filter((_, i) => i !== index),
                                        )
                                      }
                                    >
                                      <X size={16} color="#FFF" />
                                    </TouchableOpacity>
                                  </View>
                                ))}
                              </ScrollView>
                            )}

                            <TouchableOpacity
                              style={[
                                styles.primaryButton,
                                (!isValidProductionWeightInput(weightInput) ||
                                  isLoading) && {
                                  opacity: 0.5,
                                  backgroundColor: "#E2E8F0",
                                },
                              ]}
                              onPress={handleLogProduction}
                              disabled={
                                !isValidProductionWeightInput(weightInput) ||
                                isLoading
                              }
                            >
                              {isLoading ? (
                                <ActivityIndicator color="#666" />
                              ) : (
                                <PrinterIcon
                                  size={20}
                                  color={
                                    !isValidProductionWeightInput(weightInput)
                                      ? "#94A3B8"
                                      : "#FFF"
                                  }
                                />
                              )}
                              <Text
                                style={[
                                  styles.primaryButtonText,
                                  !isValidProductionWeightInput(
                                    weightInput,
                                  ) && { color: "#94A3B8" },
                                ]}
                              >
                                Generate QR & Print
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.secondaryButton, { marginTop: 8 }]}
                              onPress={() => setSelectedSection(null)}
                            >
                              <Text style={styles.secondaryButtonText}>
                                ← Back
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>
                            Shift Progress (Betty)
                          </Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Outputs this shift
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewBags} bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Total weight
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewWeight.toFixed(1)} kg
                            </Text>
                          </View>
                        </View>
                      </>
                    )}
                  </>
                ) : (
                  /* ── 3E / Rapid: no input scanning, direct output ───────────── */
                  <>
                    <View style={styles.sublineBadgeWrapper}>
                      <View
                        style={[
                          styles.sublineBadge,
                          {
                            backgroundColor:
                              selectedSubLine === "3E" ? "#EBF5FF" : "#F5F3FF",
                            borderColor:
                              selectedSubLine === "3E" ? "#bfdbfe" : "#ddd6fe",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sublineBadgeText,
                            {
                              color:
                                selectedSubLine === "3E"
                                  ? "#2563eb"
                                  : "#7c3aed",
                            },
                          ]}
                        >
                          Working on: {selectedSubLine} Line
                        </Text>
                      </View>
                    </View>

                    {/* Input Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View
                          style={[
                            styles.typePill,
                            { backgroundColor: "#E0F2FE" },
                          ]}
                        >
                          <Text
                            style={[styles.typePillText, { color: "#0369A1" }]}
                          >
                            INPUT
                          </Text>
                        </View>
                        <Text style={styles.sectionTitleText}>
                          Continuous from Label Removal
                        </Text>
                      </View>
                      <View style={styles.grayEmptyBox}>
                        <Text style={styles.grayEmptyText}>
                          Continuous flow - no scanning required
                        </Text>
                      </View>
                    </View>

                    {/* Output Section */}
                    {isShiftEnded ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New output is disabled.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.sectionCard}>
                        <View style={styles.sectionHeaderRow}>
                          <View
                            style={[
                              styles.typePill,
                              { backgroundColor: "#DCFCE7" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.typePillText,
                                { color: "#15803D" },
                              ]}
                            >
                              OUTPUT
                            </Text>
                          </View>
                          <Text style={styles.sectionTitleText}>Jumbo Bag</Text>
                        </View>

                        <View style={styles.inputGroup}>
                          <Text style={styles.label}>Weight (kg)</Text>
                          <View style={styles.inputWithIcon}>
                            <TextInput
                              style={[
                                styles.input,
                                styles.inputWithIconPadding,
                                { flex: 1 },
                              ]}
                              placeholder="Enter weight"
                              placeholderTextColor="#999"
                              keyboardType="decimal-pad"
                              value={weightInput}
                              onChangeText={handleWeightInputChange}
                            />
                            <TouchableOpacity style={styles.iconInsideInput}>
                              <Scale size={20} color="#666" />
                            </TouchableOpacity>
                          </View>
                        </View>

                        <TouchableOpacity
                          style={styles.secondaryButton}
                          onPress={handleTakePhoto}
                        >
                          <CameraIcon size={20} color="#475569" />
                          <Text style={styles.secondaryButtonText}>
                            Take Photo
                          </Text>
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
                                <Image
                                  source={{ uri: imageUri }}
                                  style={styles.photoPreviewThumbnail}
                                />
                                <TouchableOpacity
                                  style={styles.removePhotoButton}
                                  onPress={() => {
                                    setCapturedImages((prev) =>
                                      prev.filter((_, i) => i !== index),
                                    );
                                  }}
                                >
                                  <X size={16} color="#FFF" />
                                </TouchableOpacity>
                              </View>
                            ))}
                          </ScrollView>
                        )}

                        <TouchableOpacity
                          style={[
                            styles.primaryButton,
                            (!isValidProductionWeightInput(weightInput) ||
                              isLoading) && {
                              opacity: 0.5,
                              backgroundColor: "#E2E8F0",
                            },
                          ]}
                          onPress={handleLogProduction}
                          disabled={
                            !isValidProductionWeightInput(weightInput) ||
                            isLoading
                          }
                        >
                          {isLoading ? (
                            <ActivityIndicator color="#666" />
                          ) : (
                            <PrinterIcon
                              size={20}
                              color={
                                !isValidProductionWeightInput(weightInput)
                                  ? "#94A3B8"
                                  : "#FFF"
                              }
                            />
                          )}
                          <Text
                            style={[
                              styles.primaryButtonText,
                              !isValidProductionWeightInput(weightInput) && {
                                color: "#94A3B8",
                              },
                            ]}
                          >
                            Generate QR & Print
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Shift Progress Section */}
                    <View style={styles.progressCardRedesign}>
                      <Text style={styles.progressTitleRedesign}>
                        Shift Progress ({selectedSubLine})
                      </Text>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>
                          Outputs this shift
                        </Text>
                        <Text style={styles.progressDataValue}>
                          {currentViewBags} bags
                        </Text>
                      </View>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>
                          Total weight
                        </Text>
                        <Text style={styles.progressDataValue}>
                          {currentViewWeight.toFixed(1)} kg
                        </Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            ) : selectedStation.name === "Washing" ? (
              <View style={styles.crusherContainer}>
                {!selectedSubLine ? (
                  <React.Fragment>
                    <View style={styles.selectionContainer}>
                      <Text style={styles.selectionTitle}>
                        Select Washing Line
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.selectionCard,
                          isShiftEnded && { opacity: 0.4 },
                        ]}
                        disabled={isShiftEnded}
                        onPress={() => {
                          if (isPE) {
                            setSelectedSubLine("Washing 1");
                          } else {
                            setPendingWashingLine("Washing 1");
                            setShowWashingModal(true);
                          }
                        }}
                      >
                        <View
                          style={[
                            styles.selectionIconBox,
                            { backgroundColor: "#06b6d4" },
                          ]}
                        >
                          <Droplets color="#FFF" size={28} />
                        </View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>
                            Washing 1
                          </Text>
                          <Text style={styles.selectionCardSub}>
                            Primary Washing Line
                          </Text>
                        </View>
                        <View
                          style={{ alignItems: "flex-end", marginRight: 8 }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "700",
                              color: "#1e293b",
                            }}
                          >
                            {
                              shiftLogs.filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === "Washing 1",
                              ).length
                            }{" "}
                            bags
                          </Text>
                          <Text style={{ fontSize: 11, color: "#64748b" }}>
                            {shiftLogs
                              .filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === "Washing 1",
                              )
                              .reduce(
                                (s: number, l: any) =>
                                  s + (parseFloat(l.weight) || 0),
                                0,
                              )
                              .toFixed(1)}{" "}
                            kg
                          </Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.selectionCard,
                          isShiftEnded && { opacity: 0.4 },
                        ]}
                        disabled={isShiftEnded}
                        onPress={() => {
                          if (isPE) {
                            setSelectedSubLine("Washing 2");
                          } else {
                            setPendingWashingLine("Washing 2");
                            setShowWashingModal(true);
                          }
                        }}
                      >
                        <View
                          style={[
                            styles.selectionIconBox,
                            { backgroundColor: "#0891b2" },
                          ]}
                        >
                          <Droplets color="#FFF" size={28} />
                        </View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>
                            Washing 2
                          </Text>
                          <Text style={styles.selectionCardSub}>
                            Secondary Washing Line
                          </Text>
                        </View>
                        <View
                          style={{ alignItems: "flex-end", marginRight: 8 }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "700",
                              color: "#1e293b",
                            }}
                          >
                            {
                              shiftLogs.filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === "Washing 2",
                              ).length
                            }{" "}
                            bags
                          </Text>
                          <Text style={{ fontSize: 11, color: "#64748b" }}>
                            {shiftLogs
                              .filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === "Washing 2",
                              )
                              .reduce(
                                (s: number, l: any) =>
                                  s + (parseFloat(l.weight) || 0),
                                0,
                              )
                              .toFixed(1)}{" "}
                            kg
                          </Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.selectionCard,
                          isShiftEnded && { opacity: 0.4 },
                        ]}
                        disabled={isShiftEnded}
                        onPress={() => {
                          if (isPE) {
                            setSelectedSubLine("Washing 3");
                          } else {
                            setPendingWashingLine("Washing 3");
                            setShowWashingModal(true);
                          }
                        }}
                      >
                        <View
                          style={[
                            styles.selectionIconBox,
                            { backgroundColor: "#0e7490" },
                          ]}
                        >
                          <Droplets color="#FFF" size={28} />
                        </View>
                        <View style={styles.selectionText}>
                          <Text style={styles.selectionCardTitle}>
                            Washing 3
                          </Text>
                          <Text style={styles.selectionCardSub}>
                            Tertiary Washing Line
                          </Text>
                        </View>
                        <View
                          style={{ alignItems: "flex-end", marginRight: 8 }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "700",
                              color: "#1e293b",
                            }}
                          >
                            {
                              shiftLogs.filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === "Washing 3",
                              ).length
                            }{" "}
                            bags
                          </Text>
                          <Text style={{ fontSize: 11, color: "#64748b" }}>
                            {shiftLogs
                              .filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === "Washing 3",
                              )
                              .reduce(
                                (s: number, l: any) =>
                                  s + (parseFloat(l.weight) || 0),
                                0,
                              )
                              .toFixed(1)}{" "}
                            kg
                          </Text>
                        </View>
                        <ChevronRight color="#CCC" size={24} />
                      </TouchableOpacity>
                    </View>

                    {/* Logs List Section */}
                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 12,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}
                    {/* Washing Station Totals */}
                    {(() => {
                      const lines = [
                        {
                          label: "Washing 1",
                          short: "Line 1",
                          color: "#06b6d4",
                        },
                        {
                          label: "Washing 2",
                          short: "Line 2",
                          color: "#0891b2",
                        },
                        {
                          label: "Washing 3",
                          short: "Line 3",
                          color: "#0e7490",
                        },
                      ];
                      const totalBags = shiftLogs.filter(
                        (l: any) => l.station_id === selectedStation.id,
                      ).length;
                      const totalKg = shiftLogs
                        .filter((l: any) => l.station_id === selectedStation.id)
                        .reduce(
                          (s: number, l: any) =>
                            s + (parseFloat(l.weight) || 0),
                          0,
                        );
                      return (
                        <View style={{ marginBottom: 12 }}>
                          <View
                            style={{
                              backgroundColor: "#1e293b",
                              borderRadius: 14,
                              padding: 14,
                              marginBottom: 10,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#94a3b8",
                              }}
                            >
                              Washing — This Shift
                            </Text>
                            <View style={{ flexDirection: "row", gap: 16 }}>
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  bags
                                </Text>
                              </View>
                              <View
                                style={{ width: 1, backgroundColor: "#334155" }}
                              />
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  kg
                                </Text>
                              </View>
                            </View>
                          </View>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            {lines.map(({ label, short, color }) => {
                              const bags = shiftLogs.filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === label,
                              ).length;
                              const kg = shiftLogs
                                .filter(
                                  (l: any) =>
                                    l.station_id === selectedStation.id &&
                                    l.sub_line === label,
                                )
                                .reduce(
                                  (s: number, l: any) =>
                                    s + (parseFloat(l.weight) || 0),
                                  0,
                                );
                              return (
                                <View
                                  key={label}
                                  style={{
                                    flex: 1,
                                    backgroundColor: "#fff",
                                    borderRadius: 12,
                                    padding: 12,
                                    borderTopWidth: 3,
                                    borderTopColor: color,
                                    elevation: 2,
                                    shadowColor: "#000",
                                    shadowOpacity: 0.06,
                                    shadowRadius: 4,
                                    shadowOffset: { width: 0, height: 2 },
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      fontWeight: "700",
                                      color,
                                      marginBottom: 6,
                                    }}
                                  >
                                    {short}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 22,
                                      fontWeight: "800",
                                      color: "#1e293b",
                                    }}
                                  >
                                    {bags}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      color: "#64748b",
                                      marginTop: 1,
                                    }}
                                  >
                                    bags
                                  </Text>
                                  <View
                                    style={{
                                      marginTop: 6,
                                      borderTopWidth: 1,
                                      borderTopColor: "#f1f5f9",
                                      paddingTop: 6,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 13,
                                        fontWeight: "700",
                                        color: "#475569",
                                      }}
                                    >
                                      {kg.toFixed(1)} kg
                                    </Text>
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })()}
                    {/* Recent Entries on line picker — visible to every role,
                        including PE (was hidden for PE pre-Hold; now shown so
                        PE can see Pending/Hold/Completed/Reject in one list,
                        matching the Extrusion flow). */}
                    
                      <View
                        style={[styles.crusherLogsSection, { marginTop: 8 }]}
                      >
                        <View style={styles.logsHeader}>
                          <Text style={styles.logsTitle}>Recent Entries</Text>
                        </View>

                        {/* Date Picker */}
                        <View style={styles.datePickerContainer}>
                          <Text style={styles.datePickerLabel}>
                            Select Date:
                          </Text>
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
                            onChangeText={(text) => {
                              setWashingSearchQuery(text);
                              setWashingCurrentPage(1);
                            }}
                            placeholderTextColor="#94a3b8"
                            clearButtonMode="while-editing"
                            returnKeyType="search"
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                          />
                          {washingSearchQuery.length > 0 && (
                            <TouchableOpacity
                              onPress={() => {
                                setWashingSearchQuery("");
                                setWashingCurrentPage(1);
                              }}
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
                                style={[
                                  styles.filterButton,
                                  washingSelectedLineFilter === "all" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedLineFilter("all");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedLineFilter === "all" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  All
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedLineFilter === "Washing 1" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedLineFilter("Washing 1");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedLineFilter === "Washing 1" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  W1
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedLineFilter === "Washing 2" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedLineFilter("Washing 2");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedLineFilter === "Washing 2" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  W2
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedLineFilter === "Washing 3" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedLineFilter("Washing 3");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedLineFilter === "Washing 3" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  W3
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>

                          {/* Status Filter */}
                          <View style={styles.filterGroup}>
                            <Text style={styles.filterLabel}>Status:</Text>
                            <View style={styles.filterButtons}>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedStatusFilter === "all" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedStatusFilter("all");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedStatusFilter === "all" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  All
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedStatusFilter === "pending" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedStatusFilter("pending");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedStatusFilter === "pending" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Pending
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedStatusFilter === "Completed" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedStatusFilter("Completed");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedStatusFilter ===
                                      "Completed" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Complete
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>

                        {washingLogsLoading ? (
                          <View style={styles.loadingState}>
                            <ActivityIndicator size="large" color="#17a34a" />
                            <Text style={styles.loadingText}>
                              Loading entries...
                            </Text>
                          </View>
                        ) : washingLogs.length > 0 ? (
                          <View style={styles.logsList}>
                            {washingLogs.map((log, index) => (
                              <View key={index} style={styles.logItem}>
                                <View style={styles.logMain}>
                                  <Text style={styles.logQr}>
                                    {log.output_bag_qr}
                                  </Text>
                                  <View style={styles.logDetails}>
                                    <Text style={styles.logWeight}>
                                      {log.weight} kg
                                    </Text>
                                    <Text style={styles.logTime}>
                                      {new Date(
                                        log.created_at,
                                      ).toLocaleString()}
                                    </Text>
                                  </View>
                                  <View style={styles.logStatusRow}>
                                    <View
                                      style={[
                                        styles.statusBadge,
                                        {
                                          backgroundColor:
                                            log.status === "pending"
                                              ? "#FEF3C7"
                                              : log.status === "hold"
                                              ? "#FFEDD5"
                                              : log.status === "reject"
                                              ? "#FEE2E2"
                                              : "#DCFCE7",
                                        },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.statusBadgeText,
                                          {
                                            color:
                                              log.status === "pending"
                                                ? "#D97706"
                                                : log.status === "hold"
                                                ? "#92400E"
                                                : log.status === "reject"
                                                ? "#B91C1C"
                                                : "#15803D",
                                          },
                                        ]}
                                      >
                                        {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                                <View style={styles.logActions}>
                                  {(canEditAnyStatus ||
                                    log.status === "pending") && (
                                    <TouchableOpacity
                                      style={styles.editIconButton}
                                      onPress={() => openEditLogWeight(log)}
                                    >
                                      <Pencil color="#0ea5e9" size={18} />
                                    </TouchableOpacity>
                                  )}
                                  {isPE && log.status === "hold" && (
                                    <>
                                      <TouchableOpacity
                                        style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                        onPress={() => openPeResolveModal(log)}
                                      >
                                        <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                        onPress={() => openPeResolveModal(log)}
                                      >
                                        <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                      </TouchableOpacity>
                                    </>
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
                                  <View
                                    style={[
                                      styles.logBadge,
                                      log.sub_line === "Washing 1" && {
                                        backgroundColor: "#06b6d4",
                                      },
                                      log.sub_line === "Washing 2" && {
                                        backgroundColor: "#0891b2",
                                      },
                                      log.sub_line === "Washing 3" && {
                                        backgroundColor: "#0e7490",
                                      },
                                    ]}
                                  >
                                    <Text style={styles.logBadgeText}>
                                      {log.sub_line}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <View style={styles.emptyState}>
                            <Package size={48} color="#94a3b8" opacity={0.5} />
                            <Text style={styles.emptyText}>
                              No entries found for this date
                            </Text>
                          </View>
                        )}

                        {/* Pagination */}
                        {washingTotalPages > 1 && (
                          <View style={styles.pagination}>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                washingCurrentPage === 1 &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                washingCurrentPage > 1 &&
                                setWashingCurrentPage(washingCurrentPage - 1)
                              }
                              disabled={washingCurrentPage === 1}
                            >
                              <ChevronLeft
                                size={18}
                                color={
                                  washingCurrentPage === 1
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                              />
                            </TouchableOpacity>
                            <View style={styles.pageInfoBox}>
                              <Text style={styles.pageInfoMain}>
                                {washingCurrentPage} / {washingTotalPages}
                              </Text>
                              <Text style={styles.pageInfoSub}>
                                {washingTotalLogs} total
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                washingCurrentPage === washingTotalPages &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                washingCurrentPage < washingTotalPages &&
                                setWashingCurrentPage(washingCurrentPage + 1)
                              }
                              disabled={
                                washingCurrentPage === washingTotalPages
                              }
                            >
                              <ChevronRight
                                size={18}
                                color={
                                  washingCurrentPage === washingTotalPages
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                              />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    
                  </React.Fragment>
                ) : selectedSection === "input" ? (
                  <React.Fragment>
                    <View style={styles.sublineBadgeWrapper}>
                      <View
                        style={[
                          styles.sublineBadge,
                          {
                            backgroundColor: "#CFFAFE",
                            borderColor: "#67e8f9",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sublineBadgeText,
                            { color: "#0e7490" },
                          ]}
                        >
                          Working on: {selectedSubLine}
                        </Text>
                      </View>
                    </View>

                    {/* Input Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View
                          style={[
                            styles.typePill,
                            { backgroundColor: "#E0F2FE" },
                          ]}
                        >
                          <Text
                            style={[styles.typePillText, { color: "#0369A1" }]}
                          >
                            INPUT
                          </Text>
                        </View>
                        <Text style={styles.sectionTitleText}>
                          From Previous Station
                        </Text>
                      </View>
                      <View style={styles.searchContainer}>
                        <View style={styles.searchInputWrapper}>
                          <Search
                            size={20}
                            color="#666"
                            style={{ marginRight: 10 }}
                          />
                          <TextInput
                            style={styles.searchTextInput}
                            placeholder="Search QR code..."
                            value={bagSearchQuery}
                            onChangeText={onBagSearch}
                            onFocus={handleBagSearchFocus}
                          />
                        </View>
                        {showSuggestions && (
                          <ScrollView
                            style={styles.suggestionsList}
                            keyboardShouldPersistTaps="handled"
                            nestedScrollEnabled
                          >
                            {suggestedBags.map((bag, i) => (
                              <TouchableOpacity
                                key={i}
                                style={[
                                  styles.suggestionItem,
                                  i === suggestedBags.length - 1 && {
                                    borderBottomWidth: 0,
                                  },
                                ]}
                                onPress={() => {
                                  setSelectedInputBag(bag);
                                  setShowSuggestions(false);
                                  setBagSearchQuery("");
                                }}
                              >
                                <View style={styles.suggestionLeftCol}>
                                  <Text
                                    style={styles.suggestionQrLine}
                                    numberOfLines={2}
                                    selectable
                                  >
                                    {getBagDisplayId(bag)}
                                  </Text>
                                  {bag.sub_line ? (
                                    <Text style={styles.suggestionSubLine}>
                                      {bag.sub_line}
                                    </Text>
                                  ) : null}
                                </View>
                                <Text style={styles.suggestionDetail}>
                                  {bag.weight} kg
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                      <TouchableOpacity
                        style={styles.scanButton}
                        onPress={() => {
                          setScanned(false);
                          setShowScanner(true);
                        }}
                      >
                        <CameraIcon color="#17a34a" size={20} />
                        <Text style={styles.scanButtonText}>Scan QR Code</Text>
                      </TouchableOpacity>
                      {selectedInputBag && (
                        <View style={styles.selectedBagCard}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                marginBottom: 2,
                              }}
                            >
                              {t("dashboard.jumboId")}
                            </Text>
                            <Text
                              style={[styles.selectedBagId, { minWidth: 0 }]}
                              numberOfLines={2}
                              selectable
                            >
                              {getBagDisplayId(selectedInputBag)}
                            </Text>
                            {(selectedInputBag as any).sub_line ? (
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: "#64748b",
                                  marginTop: 4,
                                }}
                              >
                                {t("dashboard.lineLabel")}:{" "}
                                {(selectedInputBag as any).sub_line}
                              </Text>
                            ) : null}
                            <Text style={styles.selectedBagWeight}>
                              {selectedInputBag.weight} kg
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => setSelectedInputBag(null)}
                          >
                            <X color="#EB445A" size={20} />
                          </TouchableOpacity>
                        </View>
                      )}
                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          !selectedInputBag && { opacity: 0.5 },
                        ]}
                        disabled={!selectedInputBag || isLoading}
                        onPress={async () => {
                          if (!selectedInputBag || !selectedStation) return;
                          try {
                            setIsLoading(true);
                            // Check if this is washing station by name or code (more robust than ID)
                            const isWashingStation =
                              selectedStation.name
                                ?.toLowerCase()
                                .includes("washing") ||
                              selectedStation.code === "WSH" ||
                              selectedStation.id === 3;

                            // If this is washing station, ONLY update the existing crusher batch (NO new entry)
                            if (
                              isWashingStation &&
                              selectedInputBag.output_bag_qr
                            ) {
                              // Pass the selected washing line name (e.g., "Washing 1", "Washing 2", "Washing 3")
                              const washingLine = selectedSubLine || undefined;
                              const response =
                                await productionApi.updateLogStatus(
                                  selectedInputBag.output_bag_qr,
                                  "Completed",
                                  washingLine,
                                );
                              if (response.data.success) {
                                Alert.alert(
                                  t("common.success"),
                                  t("messages.materialProcessingStarted"),
                                );
                                setSelectedInputBag(null);
                                setBagSearchQuery("");
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              } else {
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.failedToUpdateBatchStatus"),
                                );
                              }
                            } else {
                              // For other stations (NOT washing), create a new processing log entry
                              if (!backendShiftId) {
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.noActiveShift"),
                                );
                                return;
                              }
                              const logData = {
                                shiftId: backendShiftId,
                                stationId: selectedStation.id,
                                inputBagQr: selectedInputBag.output_bag_qr,
                                weight: selectedInputBag.weight,
                                status: "Processing",
                              };
                              const response =
                                await productionApi.logProduction(logData);
                              if (response.data.success) {
                                Alert.alert(
                                  t("common.success"),
                                  t("messages.materialProcessingStarted"),
                                );
                                setSelectedInputBag(null);
                                setBagSearchQuery("");
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              }
                            }
                          } catch (error) {
                            console.error("Save input error:", error);
                            Alert.alert(
                              t("common.error"),
                              t("messages.failedToStartProcessing"),
                            );
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                      >
                        <Text style={styles.primaryButtonText}>
                          Save & Start Processing
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.secondaryButton, { marginTop: 8 }]}
                        onPress={handleBack}
                      >
                        <Text style={styles.secondaryButtonText}>← Back</Text>
                      </TouchableOpacity>
                    </View>
                  </React.Fragment>
                ) : selectedSection === "output" ? (
                  <React.Fragment>
                    <View style={styles.sublineBadgeWrapper}>
                      <View
                        style={[
                          styles.sublineBadge,
                          {
                            backgroundColor: "#CFFAFE",
                            borderColor: "#67e8f9",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sublineBadgeText,
                            { color: "#0e7490" },
                          ]}
                        >
                          Working on: {selectedSubLine}
                        </Text>
                      </View>
                    </View>

                    {/* Output Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View
                          style={[
                            styles.typePill,
                            { backgroundColor: "#DCFCE7" },
                          ]}
                        >
                          <Text
                            style={[styles.typePillText, { color: "#15803D" }]}
                          >
                            OUTPUT
                          </Text>
                        </View>
                        <Text style={styles.sectionTitleText}>Jumbo Bag</Text>
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Weight (kg)</Text>
                        <View style={styles.inputWithIcon}>
                          <TextInput
                            style={[
                              styles.input,
                              styles.inputWithIconPadding,
                              { flex: 1 },
                            ]}
                            placeholder="Enter weight"
                            placeholderTextColor="#999"
                            keyboardType="decimal-pad"
                            value={weightInput}
                            onChangeText={handleWeightInputChange}
                          />
                          <TouchableOpacity style={styles.iconInsideInput}>
                            <Scale size={20} color="#666" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={handleTakePhoto}
                      >
                        <CameraIcon size={20} color="#475569" />
                        <Text style={styles.secondaryButtonText}>
                          Take Photo
                        </Text>
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
                              <Image
                                source={{ uri: imageUri }}
                                style={styles.photoPreviewThumbnail}
                              />
                              <TouchableOpacity
                                style={styles.removePhotoButton}
                                onPress={() => {
                                  setCapturedImages((prev) =>
                                    prev.filter((_, i) => i !== index),
                                  );
                                }}
                              >
                                <X size={16} color="#FFF" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </ScrollView>
                      )}

                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          (!isValidProductionWeightInput(weightInput) ||
                            isLoading) && {
                            opacity: 0.5,
                            backgroundColor: "#E2E8F0",
                          },
                        ]}
                        onPress={handleLogProduction}
                        disabled={
                          !isValidProductionWeightInput(weightInput) ||
                          isLoading
                        }
                      >
                        {isLoading ? (
                          <ActivityIndicator color="#666" />
                        ) : (
                          <PrinterIcon
                            size={20}
                            color={
                              !isValidProductionWeightInput(weightInput)
                                ? "#94A3B8"
                                : "#FFF"
                            }
                          />
                        )}
                        <Text
                          style={[
                            styles.primaryButtonText,
                            !isValidProductionWeightInput(weightInput) && {
                              color: "#94A3B8",
                            },
                          ]}
                        >
                          Generate QR & Print
                        </Text>
                      </TouchableOpacity>
                      {!isPE ? (
                        <TouchableOpacity
                          style={[styles.secondaryButton, { marginTop: 8 }]}
                          onPress={handleBack}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {/* Stats Cards Section */}
                    <View style={styles.statsRow}>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{currentViewBags}</Text>
                        <Text style={styles.statLabel}>Outputs</Text>
                      </View>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>
                          {currentViewWeight.toFixed(1)}
                        </Text>
                        <Text style={styles.statLabel}>Total kg</Text>
                      </View>
                    </View>

                    {/* Shift Progress Section */}
                    <View style={styles.progressCardRedesign}>
                      <Text style={styles.progressTitleRedesign}>
                        Shift Progress ({selectedSubLine})
                      </Text>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>
                          Outputs this shift
                        </Text>
                        <Text style={styles.progressDataValue}>
                          {currentViewBags} bags
                        </Text>
                      </View>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>
                          Total weight
                        </Text>
                        <Text style={styles.progressDataValue}>
                          {currentViewWeight.toFixed(1)} kg
                        </Text>
                      </View>
                    </View>
                    {isPE ? (
                      <TouchableOpacity
                        style={[
                          styles.secondaryButton,
                          {
                            marginTop: 12,
                            marginHorizontal: 16,
                            marginBottom: 28,
                          },
                        ]}
                        onPress={handleBack}
                      >
                        <Text style={styles.secondaryButtonText}>← Back</Text>
                      </TouchableOpacity>
                    ) : null}
                  </React.Fragment>
                ) : selectedStation?.name === "Washing" &&
                  selectedSubLine &&
                  !selectedSection ? (
                  <React.Fragment>
                    <View
                      style={[
                        styles.stationHero,
                        {
                          backgroundColor: selectedStation.color,
                          paddingBottom: 20,
                          marginBottom: 0,
                        },
                      ]}
                    >
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(
                            selectedStation.name,
                            selectedStation.color,
                          )}
                        </View>
                        <View style={{ marginLeft: 15, flex: 1 }}>
                          <Text style={styles.heroTitle}>Washing</Text>
                          <Text style={styles.heroDesc}>
                            {isPET
                              ? `PET — After Crusher Rapid PET (${selectedSubLine})`
                              : isPE
                                ? `PE — After Crusher (${selectedSubLine})`
                                : `${selectedSubLine}`}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginTop: 4,
                          marginBottom: 4,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}
                    {!isShiftEnded && (
                      <View style={styles.selectionContainer}>
                        <Text style={styles.selectionTitle}>Select Action</Text>
                        <TouchableOpacity
                          style={styles.selectionCard}
                          onPress={() => {
                            setSelectedSection("input");
                            setSelectedInputBag(null);
                            setBagSearchQuery("");
                            setSuggestedBags([]);
                            setShowSuggestions(false);
                          }}
                        >
                          <View
                            style={[
                              styles.selectionIconBox,
                              { backgroundColor: "#06b6d4" },
                            ]}
                          >
                            <Droplets color="#FFF" size={28} />
                          </View>
                          <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>Input</Text>
                            <Text style={styles.selectionCardSub}>
                              {isPET
                                ? "Scan Crusher Rapid PET bag"
                                : isPE
                                  ? "Scan bag from Crusher (flakes)"
                                  : "Scan bag from previous station"}
                            </Text>
                          </View>
                          <ChevronRight color="#CCC" size={24} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.selectionCard}
                          onPress={() => setSelectedSection("output")}
                        >
                          <View
                            style={[
                              styles.selectionIconBox,
                              { backgroundColor: "#0891b2" },
                            ]}
                          >
                            <Package color="#FFF" size={28} />
                          </View>
                          <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>
                              Output
                            </Text>
                            <Text style={styles.selectionCardSub}>
                              Log washed flake bag (QR)
                            </Text>
                          </View>
                          <ChevronRight color="#CCC" size={24} />
                        </TouchableOpacity>
                        {/* PE-only: Hold action — sets material aside for QC reprocess */}
                        {isPE && (
                          <TouchableOpacity
                            style={styles.selectionCard}
                            onPress={() => {
                              setSelectedSection("hold");
                              openPeHoldModal();
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: "#f59e0b" },
                              ]}
                            >
                              <PauseCircle color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>Hold</Text>
                              <Text style={styles.selectionCardSub}>
                                Set aside for QC reprocess
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {/* Recent Entries: PET/PC when line chosen but Input/Output not — hidden for PE (direct line → action screen) */}
                    {!isPE && (
                      <View
                        style={[
                          styles.crusherLogsSection,
                          {
                            marginHorizontal: 16,
                            marginTop: 8,
                            marginBottom: 24,
                          },
                        ]}
                      >
                        <View style={styles.logsHeader}>
                          <Text style={styles.logsTitle}>Recent Entries</Text>
                        </View>
                        <View style={styles.datePickerContainer}>
                          <Text style={styles.datePickerLabel}>
                            Select Date:
                          </Text>
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
                            onChangeText={(text) => {
                              setWashingSearchQuery(text);
                              setWashingCurrentPage(1);
                            }}
                            placeholderTextColor="#94a3b8"
                            returnKeyType="search"
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                          />
                          {washingSearchQuery.length > 0 && (
                            <TouchableOpacity
                              onPress={() => {
                                setWashingSearchQuery("");
                                setWashingCurrentPage(1);
                              }}
                              style={styles.clearButton}
                            >
                              <X size={16} color="#64748b" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.filtersContainer}>
                          <View style={styles.filterGroup}>
                            <Text style={styles.filterLabel}>Status:</Text>
                            <View style={styles.filterButtons}>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedStatusFilter === "all" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedStatusFilter("all");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedStatusFilter === "all" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  All
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedStatusFilter === "pending" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedStatusFilter("pending");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedStatusFilter === "pending" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Pending
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  washingSelectedStatusFilter === "Completed" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setWashingSelectedStatusFilter("Completed");
                                  setWashingCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    washingSelectedStatusFilter ===
                                      "Completed" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Complete
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                        {washingLogsLoading ? (
                          <View style={styles.loadingState}>
                            <ActivityIndicator size="large" color="#06b6d4" />
                            <Text style={styles.loadingText}>
                              Loading entries...
                            </Text>
                          </View>
                        ) : washingLogs.length > 0 ? (
                          <View style={styles.logsList}>
                            {washingLogs.map((log: any, index: number) => (
                              <View
                                key={log.id ?? index}
                                style={styles.logItem}
                              >
                                <View style={styles.logMain}>
                                  <Text style={styles.logQr}>
                                    {log.output_bag_qr ||
                                      log.outputBagQr ||
                                      "—"}
                                  </Text>
                                  <View style={styles.logDetails}>
                                    <Text style={styles.logWeight}>
                                      {log.weight} kg
                                    </Text>
                                    <Text style={styles.logTime}>
                                      {new Date(
                                        log.created_at,
                                      ).toLocaleString()}
                                    </Text>
                                  </View>
                                  <View style={styles.logStatusRow}>
                                    <View
                                      style={[
                                        styles.statusBadge,
                                        {
                                          backgroundColor:
                                            log.status === "pending"
                                              ? "#FEF3C7"
                                              : log.status === "hold"
                                              ? "#FFEDD5"
                                              : log.status === "reject"
                                              ? "#FEE2E2"
                                              : "#DCFCE7",
                                        },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.statusBadgeText,
                                          {
                                            color:
                                              log.status === "pending"
                                                ? "#D97706"
                                                : log.status === "hold"
                                                ? "#92400E"
                                                : log.status === "reject"
                                                ? "#B91C1C"
                                                : "#15803D",
                                          },
                                        ]}
                                      >
                                        {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                                <View style={styles.logActions}>
                                  {(canEditAnyStatus ||
                                    log.status === "pending") && (
                                    <TouchableOpacity
                                      style={styles.editIconButton}
                                      onPress={() => openEditLogWeight(log)}
                                    >
                                      <Pencil color="#0ea5e9" size={18} />
                                    </TouchableOpacity>
                                  )}
                                  {isPE && log.status === "hold" && (
                                    <>
                                      <TouchableOpacity
                                        style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                        onPress={() => openPeResolveModal(log)}
                                      >
                                        <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                        onPress={() => openPeResolveModal(log)}
                                      >
                                        <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                      </TouchableOpacity>
                                    </>
                                  )}
                                  <TouchableOpacity
                                    style={styles.printIconButton}
                                    onPress={() => {
                                      setSelectedLogForPrint(log);
                                      setShowListPrintPreview(true);
                                    }}
                                  >
                                    <Printer size={18} color="#06b6d4" />
                                  </TouchableOpacity>
                                  <View
                                    style={[
                                      styles.logBadge,
                                      log.sub_line === "Washing 1" && {
                                        backgroundColor: "#06b6d4",
                                      },
                                      log.sub_line === "Washing 2" && {
                                        backgroundColor: "#0891b2",
                                      },
                                      log.sub_line === "Washing 3" && {
                                        backgroundColor: "#0e7490",
                                      },
                                    ]}
                                  >
                                    <Text style={styles.logBadgeText}>
                                      {log.sub_line || "—"}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <View style={styles.emptyState}>
                            <Package size={48} color="#94a3b8" opacity={0.5} />
                            <Text style={styles.emptyText}>
                              No entries found for this date
                            </Text>
                          </View>
                        )}
                        {washingTotalPages > 1 && (
                          <View style={styles.pagination}>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                washingCurrentPage === 1 &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                washingCurrentPage > 1 &&
                                setWashingCurrentPage(washingCurrentPage - 1)
                              }
                              disabled={washingCurrentPage === 1}
                            >
                              <ChevronLeft
                                size={18}
                                color={
                                  washingCurrentPage === 1
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                              />
                            </TouchableOpacity>
                            <View style={styles.pageInfoBox}>
                              <Text style={styles.pageInfoMain}>
                                {washingCurrentPage} / {washingTotalPages}
                              </Text>
                              <Text style={styles.pageInfoSub}>
                                {washingTotalLogs} total
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                washingCurrentPage === washingTotalPages &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                washingCurrentPage < washingTotalPages &&
                                setWashingCurrentPage(washingCurrentPage + 1)
                              }
                              disabled={
                                washingCurrentPage === washingTotalPages
                              }
                            >
                              <ChevronRight
                                size={18}
                                color={
                                  washingCurrentPage === washingTotalPages
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                              />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}
                  </React.Fragment>
                ) : null}
              </View>
            ) : isExtrusionPackagingStation(selectedStation) ? (
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
                    <View
                      style={[
                        styles.stationHero,
                        {
                          backgroundColor: selectedStation.color,
                          paddingBottom: 20,
                          marginBottom: 0,
                        },
                      ]}
                    >
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(
                            selectedStation.name,
                            selectedStation.color,
                          )}
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
                        <Text style={styles.selectionTitle}>
                          Select Output Product Line
                        </Text>
                        {(
                          [
                            {
                              line: "Pellet PE SUPER",
                              primary: "Flakes PE SUPER",
                              color: "#f97316",
                              sellable: true,
                            },
                            {
                              line: "Pellet PE 1",
                              primary: "Flakes PE 1",
                              color: "#ea580c",
                              sellable: false,
                            },
                            {
                              line: "Pellet EVA SUPER",
                              primary: "Flakes EVA SUPER",
                              color: "#9333ea",
                              sellable: true,
                            },
                            {
                              line: "Pellet EVA 1",
                              primary: "Flakes EVA 1",
                              color: "#7c3aed",
                              sellable: false,
                            },
                          ] as const
                        ).map(({ line, primary, color, sellable }) => (
                          <TouchableOpacity
                            key={line}
                            style={[
                              styles.selectionCard,
                              isShiftEnded && { opacity: 0.4 },
                            ]}
                            disabled={isShiftEnded}
                            onPress={() => {
                              setSelectedSubLine(line as any);
                              setSelectedSection(null);
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: color },
                              ]}
                            >
                              <Zap color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <Text style={styles.selectionCardTitle}>
                                  {line}
                                </Text>
                                {sellable && (
                                  <View
                                    style={{
                                      backgroundColor: "#dcfce7",
                                      borderRadius: 4,
                                      paddingHorizontal: 5,
                                      paddingVertical: 1,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 10,
                                        color: "#166534",
                                        fontWeight: "700",
                                      }}
                                    >
                                      SELLABLE
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.selectionCardSub}>
                                Primary input: {primary}
                              </Text>
                            </View>
                            <View
                              style={{ alignItems: "flex-end", marginRight: 8 }}
                            >
                              <Text
                                style={{
                                  fontSize: 13,
                                  fontWeight: "700",
                                  color: "#1e293b",
                                }}
                              >
                                {
                                  shiftLogs.filter(
                                    (l: any) =>
                                      l.station_id === selectedStation.id &&
                                      l.sub_line === line,
                                  ).length
                                }{" "}
                                bags
                              </Text>
                              <Text style={{ fontSize: 11, color: "#64748b" }}>
                                {shiftLogs
                                  .filter(
                                    (l: any) =>
                                      l.station_id === selectedStation.id &&
                                      l.sub_line === line,
                                  )
                                  .reduce(
                                    (s: number, l: any) =>
                                      s + (parseFloat(l.weight) || 0),
                                    0,
                                  )
                                  .toFixed(1)}{" "}
                                kg
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {/* Recent Entries list for PE Extrusion (only when no product line selected) */}
                    {!selectedSubLine && (
                      <View
                        style={[
                          styles.crusherLogsSection,
                          { marginHorizontal: 16, marginBottom: 24 },
                        ]}
                      >
                        <View style={styles.logsHeader}>
                          <Text style={styles.logsTitle}>Recent Entries</Text>
                        </View>
                        <View style={styles.datePickerContainer}>
                          <Text style={styles.datePickerLabel}>
                            Select Date:
                          </Text>
                          <StationDatePicker
                            value={parseDateLocal(peExtrusionSelectedDate)}
                            onChange={(date) => {
                              setPeExtrusionSelectedDate(formatDateLocal(date));
                              setPeExtrusionCurrentPage(1);
                            }}
                            maximumDate={maxDate}
                          />
                        </View>
                        <View style={styles.searchBox}>
                          <Search size={18} color="#64748b" />
                          <TextInput
                            style={styles.searchInput}
                            placeholder="Search by QR code..."
                            value={peExtrusionSearchQuery}
                            onChangeText={(text) => {
                              setPeExtrusionSearchQuery(text);
                              setPeExtrusionCurrentPage(1);
                            }}
                            placeholderTextColor="#94a3b8"
                            returnKeyType="search"
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                          />
                          {peExtrusionSearchQuery.length > 0 && (
                            <TouchableOpacity
                              onPress={() => {
                                setPeExtrusionSearchQuery("");
                                setPeExtrusionCurrentPage(1);
                              }}
                              style={styles.clearButton}
                            >
                              <X size={16} color="#64748b" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.filtersContainer}>
                          <View style={styles.filterGroup}>
                            <Text style={styles.filterLabel}>Line:</Text>
                            <View style={styles.filterButtons}>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peExtrusionLineFilter === "all" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setPeExtrusionLineFilter("all");
                                  setPeExtrusionCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peExtrusionLineFilter === "all" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  All
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peExtrusionLineFilter === "Pellet PE SUPER" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setPeExtrusionLineFilter("Pellet PE SUPER");
                                  setPeExtrusionCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peExtrusionLineFilter ===
                                      "Pellet PE SUPER" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Pellet PE SUPER
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peExtrusionLineFilter === "Pellet PE 1" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setPeExtrusionLineFilter("Pellet PE 1");
                                  setPeExtrusionCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peExtrusionLineFilter === "Pellet PE 1" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Pellet PE 1
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peExtrusionLineFilter ===
                                    "Pellet EVA SUPER" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setPeExtrusionLineFilter("Pellet EVA SUPER");
                                  setPeExtrusionCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peExtrusionLineFilter ===
                                      "Pellet EVA SUPER" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Pellet EVA SUPER
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peExtrusionLineFilter === "Pellet EVA 1" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setPeExtrusionLineFilter("Pellet EVA 1");
                                  setPeExtrusionCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peExtrusionLineFilter === "Pellet EVA 1" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Pellet EVA 1
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                          <View style={styles.filterGroup}>
                            <Text style={styles.filterLabel}>Status:</Text>
                            <View style={styles.filterButtons}>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peExtrusionStatusFilter === "all" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setPeExtrusionStatusFilter("all");
                                  setPeExtrusionCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peExtrusionStatusFilter === "all" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  All
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peExtrusionStatusFilter === "pending" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setPeExtrusionStatusFilter("pending");
                                  setPeExtrusionCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peExtrusionStatusFilter === "pending" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Pending
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.filterButton,
                                  peExtrusionStatusFilter === "Completed" &&
                                    styles.filterButtonActive,
                                ]}
                                onPress={() => {
                                  setPeExtrusionStatusFilter("Completed");
                                  setPeExtrusionCurrentPage(1);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.filterButtonText,
                                    peExtrusionStatusFilter === "Completed" &&
                                      styles.filterButtonTextActive,
                                  ]}
                                >
                                  Complete
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                        {peExtrusionLogsLoading ? (
                          <View style={styles.loadingState}>
                            <ActivityIndicator size="large" color="#17a34a" />
                            <Text style={styles.loadingText}>
                              Loading entries...
                            </Text>
                          </View>
                        ) : peExtrusionLogs.length > 0 ? (
                          <View style={styles.logsList}>
                            {peExtrusionLogs.map((log: any, index: number) => (
                              <View
                                key={log.id || index}
                                style={styles.logItem}
                              >
                                <View style={styles.logMain}>
                                  <Text style={styles.logQr}>
                                    {log.output_bag_qr ||
                                      log.outputBagQr ||
                                      "—"}
                                  </Text>
                                  <View style={styles.logDetails}>
                                    <Text style={styles.logWeight}>
                                      {log.weight} kg
                                    </Text>
                                    <Text style={styles.logTime}>
                                      {new Date(
                                        log.created_at,
                                      ).toLocaleString()}
                                    </Text>
                                  </View>
                                  <View style={styles.logStatusRow}>
                                    <View
                                      style={[
                                        styles.statusBadge,
                                        {
                                          backgroundColor:
                                            log.status === "pending"
                                              ? "#FEF3C7"
                                              : log.status === "hold"
                                              ? "#FFEDD5"
                                              : log.status === "reject"
                                              ? "#FEE2E2"
                                              : "#DCFCE7",
                                        },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.statusBadgeText,
                                          {
                                            color:
                                              log.status === "pending"
                                                ? "#D97706"
                                                : log.status === "hold"
                                                ? "#92400E"
                                                : log.status === "reject"
                                                ? "#B91C1C"
                                                : "#15803D",
                                          },
                                        ]}
                                      >
                                        {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                                <View style={styles.logActions}>
                                  {(canEditAnyStatus ||
                                    log.status === "pending") && (
                                    <TouchableOpacity
                                      style={styles.editIconButton}
                                      onPress={() => openEditLogWeight(log)}
                                    >
                                      <Pencil color="#0ea5e9" size={18} />
                                    </TouchableOpacity>
                                  )}
                                  {isPE && log.status === "hold" && (
                                    <>
                                      <TouchableOpacity
                                        style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                        onPress={() => openPeResolveModal(log)}
                                      >
                                        <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                        onPress={() => openPeResolveModal(log)}
                                      >
                                        <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                      </TouchableOpacity>
                                    </>
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
                                  <View
                                    style={[
                                      styles.logBadge,
                                      { backgroundColor: "#FFF7ED" },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.logBadgeText,
                                        { color: "#ea580c" },
                                      ]}
                                    >
                                      {log.sub_line || "—"}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <View style={styles.emptyState}>
                            <Package size={48} color="#94a3b8" opacity={0.5} />
                            <Text style={styles.emptyText}>
                              No entries found for this date
                            </Text>
                          </View>
                        )}
                        {peExtrusionTotalPages > 1 && (
                          <View style={styles.pagination}>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                peExtrusionCurrentPage === 1 &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                setPeExtrusionCurrentPage(
                                  Math.max(1, peExtrusionCurrentPage - 1),
                                )
                              }
                              disabled={peExtrusionCurrentPage === 1}
                            >
                              <ChevronLeft
                                color={
                                  peExtrusionCurrentPage === 1
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                                size={18}
                              />
                            </TouchableOpacity>
                            <View style={styles.pageInfoBox}>
                              <Text style={styles.pageInfoMain}>
                                {peExtrusionCurrentPage} /{" "}
                                {peExtrusionTotalPages}
                              </Text>
                              <Text style={styles.pageInfoSub}>
                                {peExtrusionTotalLogs} total
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                peExtrusionCurrentPage ===
                                  peExtrusionTotalPages &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                setPeExtrusionCurrentPage(
                                  Math.min(
                                    peExtrusionTotalPages,
                                    peExtrusionCurrentPage + 1,
                                  ),
                                )
                              }
                              disabled={
                                peExtrusionCurrentPage === peExtrusionTotalPages
                              }
                            >
                              <ChevronRight
                                color={
                                  peExtrusionCurrentPage ===
                                  peExtrusionTotalPages
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                                size={18}
                              />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Step 2: Input / Output section picker */}
                    {selectedSubLine && !selectedSection && (
                      <View style={styles.selectionContainer}>
                        <View
                          style={[
                            styles.sublineBadgeWrapper,
                            { marginBottom: 8 },
                          ]}
                        >
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#FFF7ED",
                                borderColor: "#FED7AA",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#f97316" },
                              ]}
                            >
                              {selectedSubLine}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.selectionTitle}>
                          Select Section
                        </Text>
                        <TouchableOpacity
                          style={styles.selectionCard}
                          onPress={() => setSelectedSection("input")}
                        >
                          <View
                            style={[
                              styles.selectionIconBox,
                              { backgroundColor: "#0ea5e9" },
                            ]}
                          >
                            <Package color="#FFF" size={28} />
                          </View>
                          <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>Input</Text>
                            <Text style={styles.selectionCardSub}>
                              Scan primary flakes bag
                            </Text>
                          </View>
                          <ChevronRight color="#CCC" size={24} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.selectionCard}
                          onPress={() => setSelectedSection("output")}
                        >
                          <View
                            style={[
                              styles.selectionIconBox,
                              { backgroundColor: "#22c55e" },
                            ]}
                          >
                            <Box color="#FFF" size={28} />
                          </View>
                          <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>
                              Output
                            </Text>
                            <Text style={styles.selectionCardSub}>
                              Enter weight & generate QR
                            </Text>
                          </View>
                          <ChevronRight color="#CCC" size={24} />
                        </TouchableOpacity>
                        {/* PE-only: Hold action — sets material aside for QC reprocess */}
                        {isPE && (
                          <TouchableOpacity
                            style={styles.selectionCard}
                            onPress={() => {
                              setSelectedSection("hold");
                              openPeHoldModal();
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: "#f59e0b" },
                              ]}
                            >
                              <PauseCircle color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>
                                Hold
                              </Text>
                              <Text style={styles.selectionCardSub}>
                                Set aside for QC reprocess
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {/* Step 3a: Input — scan PRIMARY flakes bag + show additional materials (always 0) */}
                    {selectedSubLine && selectedSection === "input" && (
                      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                        <View
                          style={[
                            styles.sublineBadgeWrapper,
                            { paddingHorizontal: 0, marginBottom: 12 },
                          ]}
                        >
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#FFF7ED",
                                borderColor: "#FED7AA",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#f97316" },
                              ]}
                            >
                              {selectedSubLine} — Input
                            </Text>
                          </View>
                        </View>

                        {/* Primary material: scan QR bag */}
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View
                              style={[
                                styles.typePill,
                                { backgroundColor: "#DCFCE7" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.typePillText,
                                  { color: "#15803D" },
                                ]}
                              >
                                PRIMARY
                              </Text>
                            </View>
                            <Text style={styles.sectionTitleText}>
                              {PE_EXTRUDER_PRIMARY[selectedSubLine] ||
                                "Flakes bag"}
                            </Text>
                          </View>
                          {selectedInputBag ? (
                            <View style={styles.selectedBagCard}>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: "#64748b",
                                    marginBottom: 2,
                                  }}
                                >
                                  {t("dashboard.jumboId")}
                                </Text>
                                <Text
                                  style={[
                                    styles.selectedBagId,
                                    { minWidth: 0 },
                                  ]}
                                  numberOfLines={2}
                                  selectable
                                >
                                  {getBagDisplayId(selectedInputBag)}
                                </Text>
                                {(selectedInputBag as any).sub_line ? (
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      color: "#64748b",
                                      marginTop: 4,
                                    }}
                                  >
                                    {t("dashboard.lineLabel")}:{" "}
                                    {(selectedInputBag as any).sub_line}
                                  </Text>
                                ) : null}
                                <Text style={styles.selectedBagWeight}>
                                  {selectedInputBag.weight} kg
                                </Text>
                              </View>
                              <TouchableOpacity
                                onPress={() => setSelectedInputBag(null)}
                              >
                                <X size={20} color="#ef4444" />
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <>
                              <TextInput
                                style={styles.input}
                                placeholder={`Search or scan ${PE_EXTRUDER_PRIMARY[selectedSubLine] || "flakes"} QR...`}
                                placeholderTextColor="#999"
                                value={bagSearchQuery}
                                onChangeText={(text) => {
                                  setBagSearchQuery(text);
                                  onBagSearch(text);
                                }}
                              />
                              {showSuggestions && suggestedBags.length > 0 && (
                                <ScrollView
                                  style={styles.suggestionsContainer}
                                  keyboardShouldPersistTaps="handled"
                                  nestedScrollEnabled
                                >
                                  {suggestedBags.map(
                                    (bag: any, idx: number) => (
                                      <TouchableOpacity
                                        key={idx}
                                        style={[
                                          styles.suggestionItem,
                                          idx === suggestedBags.length - 1 && {
                                            borderBottomWidth: 0,
                                          },
                                        ]}
                                        onPress={() => {
                                          setSelectedInputBag({
                                            ...bag,
                                            output_bag_qr:
                                              bag.output_bag_qr ??
                                              bag.outputBagQr,
                                            weight: bag.weight,
                                          });
                                          setSuggestedBags([]);
                                          setShowSuggestions(false);
                                          setBagSearchQuery("");
                                        }}
                                      >
                                        <View style={styles.suggestionLeftCol}>
                                          <Text
                                            style={styles.suggestionQrLine}
                                            numberOfLines={2}
                                            selectable
                                          >
                                            {getBagDisplayId(bag)}
                                          </Text>
                                          {bag.sub_line ? (
                                            <Text
                                              style={styles.suggestionSubLine}
                                            >
                                              {bag.sub_line}
                                            </Text>
                                          ) : null}
                                        </View>
                                        <Text style={styles.suggestionDetail}>
                                          {bag.weight} kg
                                        </Text>
                                      </TouchableOpacity>
                                    ),
                                  )}
                                </ScrollView>
                              )}
                              <TouchableOpacity
                                style={[
                                  styles.scanButton,
                                  { marginBottom: 0, marginTop: 10 },
                                ]}
                                onPress={() => {
                                  setShowScanner(true);
                                  setScanned(false);
                                }}
                              >
                                <CameraIcon color="#17a34a" size={20} />
                                <Text style={styles.scanButtonText}>
                                  Scan QR Code
                                </Text>
                              </TouchableOpacity>
                            </>
                          )}
                        </View>

                        {/* Additional materials — always 0 (weighed at shift-end by PPIC) */}
                        {(PE_EXTRUDER_ADDITIONAL[selectedSubLine] || [])
                          .length > 0 && (
                          <View style={[styles.sectionCard, { marginTop: 8 }]}>
                            <View style={styles.sectionHeaderRow}>
                              <View
                                style={[
                                  styles.typePill,
                                  { backgroundColor: "#F1F5F9" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.typePillText,
                                    { color: "#64748b" },
                                  ]}
                                >
                                  ADDITIONAL
                                </Text>
                              </View>
                              <Text style={styles.sectionTitleText}>
                                Input = 0 (weighed at shift end)
                              </Text>
                            </View>
                            <View
                              style={{
                                backgroundColor: "#F8FAFC",
                                borderRadius: 8,
                                padding: 10,
                                marginTop: 6,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: "#94a3b8",
                                  marginBottom: 6,
                                }}
                              >
                                These materials are added unmeasured during
                                production.{"\n"}
                                PPIC weighs remaining stock at shift end to
                                calculate usage.
                              </Text>
                              {(
                                PE_EXTRUDER_ADDITIONAL[selectedSubLine] || []
                              ).map((mat: string) => (
                                <View
                                  key={mat}
                                  style={{
                                    flexDirection: "row",
                                    justifyContent: "space-between",
                                    paddingVertical: 4,
                                    borderBottomWidth: 1,
                                    borderBottomColor: "#f1f5f9",
                                  }}
                                >
                                  <Text
                                    style={{ fontSize: 13, color: "#475569" }}
                                  >
                                    {mat}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 13,
                                      color: "#94a3b8",
                                      fontWeight: "600",
                                    }}
                                  >
                                    0 kg
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}

                        {/* Save & Start Processing — marks the primary flakes bag as consumed */}
                        <TouchableOpacity
                          style={[
                            styles.primaryButton,
                            { marginTop: 16 },
                            !selectedInputBag && { opacity: 0.5 },
                          ]}
                          disabled={!selectedInputBag || isLoading}
                          onPress={async () => {
                            if (!selectedInputBag || !selectedStation) return;
                            try {
                              setIsLoading(true);
                              // Mark the scanned CRS flakes bag as Completed (consumed by extruder)
                              if (selectedInputBag.output_bag_qr) {
                                const response =
                                  await productionApi.updateLogStatus(
                                    selectedInputBag.output_bag_qr,
                                    "Completed",
                                    undefined,
                                    selectedSubLine ?? undefined,
                                  );
                                if (response.data.success) {
                                  Alert.alert(
                                    t("common.success"),
                                    t("messages.materialProcessingStarted"),
                                  );
                                  setSelectedInputBag(null);
                                  setBagSearchQuery("");
                                  setSuggestedBags([]);
                                  setShowSuggestions(false);
                                  setSelectedSection(null);
                                } else {
                                  Alert.alert(
                                    t("common.error"),
                                    t("messages.failedToUpdateBatchStatus"),
                                  );
                                }
                              } else {
                                Alert.alert(
                                  t("common.error"),
                                  "No QR found on selected bag.",
                                );
                              }
                            } catch (error) {
                              console.error(
                                "PE extruder input save error:",
                                error,
                              );
                              Alert.alert(
                                t("common.error"),
                                t("messages.failedToStartProcessing"),
                              );
                            } finally {
                              setIsLoading(false);
                            }
                          }}
                        >
                          {isLoading ? (
                            <ActivityIndicator color="#FFF" />
                          ) : (
                            <Play
                              size={20}
                              color={!selectedInputBag ? "#94A3B8" : "#FFF"}
                            />
                          )}
                          <Text
                            style={[
                              styles.primaryButtonText,
                              !selectedInputBag && { color: "#94A3B8" },
                            ]}
                          >
                            Save & Start Processing
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.secondaryButton, { marginTop: 8 }]}
                          onPress={handleBack}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Step 3b: Output — enter weight, generate QR, print */}
                    {selectedSubLine && selectedSection === "output" && (
                      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                        <View
                          style={[
                            styles.sublineBadgeWrapper,
                            { paddingHorizontal: 0, marginBottom: 12 },
                          ]}
                        >
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#FFF7ED",
                                borderColor: "#FED7AA",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#f97316" },
                              ]}
                            >
                              {selectedSubLine} — Output
                            </Text>
                          </View>
                        </View>
                        {isShiftEnded ? (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              backgroundColor: "#FEF2F2",
                              borderRadius: 10,
                              padding: 12,
                              marginBottom: 8,
                              borderWidth: 1,
                              borderColor: "#FECACA",
                            }}
                          >
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: "#EF4444",
                                marginRight: 8,
                              }}
                            />
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#DC2626",
                              }}
                            >
                              Shift Ended — View Only
                            </Text>
                            <Text
                              style={{
                                fontSize: 12,
                                color: "#7f1d1d",
                                marginLeft: 6,
                              }}
                            >
                              New output is disabled.
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.sectionCard}>
                            <View style={styles.sectionHeaderRow}>
                              <View
                                style={[
                                  styles.typePill,
                                  { backgroundColor: "#DCFCE7" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.typePillText,
                                    { color: "#15803D" },
                                  ]}
                                >
                                  OUTPUT
                                </Text>
                              </View>
                              <Text style={styles.sectionTitleText}>
                                {selectedSubLine}
                              </Text>
                            </View>
                            <View style={styles.inputGroup}>
                              <Text style={styles.label}>Weight (kg)</Text>
                              <View style={styles.inputWithIcon}>
                                <TextInput
                                  style={[
                                    styles.input,
                                    styles.inputWithIconPadding,
                                    { flex: 1 },
                                  ]}
                                  placeholder="Enter output weight"
                                  placeholderTextColor="#999"
                                  keyboardType="decimal-pad"
                                  value={weightInput}
                                  onChangeText={handleWeightInputChange}
                                />
                                <TouchableOpacity
                                  style={styles.iconInsideInput}
                                >
                                  <Scale size={20} color="#666" />
                                </TouchableOpacity>
                              </View>
                            </View>
                            <TouchableOpacity
                              style={styles.secondaryButton}
                              onPress={handleTakePhoto}
                            >
                              <CameraIcon size={20} color="#475569" />
                              <Text style={styles.secondaryButtonText}>
                                Take Photo
                              </Text>
                            </TouchableOpacity>
                            {capturedImages.length > 0 && (
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.photosPreviewContainer}
                                contentContainerStyle={
                                  styles.photosPreviewContent
                                }
                              >
                                {capturedImages.map((imageUri, index) => (
                                  <View
                                    key={index}
                                    style={styles.photoPreviewItem}
                                  >
                                    <Image
                                      source={{ uri: imageUri }}
                                      style={styles.photoPreviewThumbnail}
                                    />
                                    <TouchableOpacity
                                      style={styles.removePhotoButton}
                                      onPress={() =>
                                        setCapturedImages((prev) =>
                                          prev.filter((_, i) => i !== index),
                                        )
                                      }
                                    >
                                      <X size={16} color="#FFF" />
                                    </TouchableOpacity>
                                  </View>
                                ))}
                              </ScrollView>
                            )}
                            <TouchableOpacity
                              style={[
                                styles.primaryButton,
                                (!isValidProductionWeightInput(weightInput) ||
                                  isLoading) && {
                                  opacity: 0.5,
                                  backgroundColor: "#E2E8F0",
                                },
                              ]}
                              onPress={handleLogProduction}
                              disabled={
                                !isValidProductionWeightInput(weightInput) ||
                                isLoading
                              }
                            >
                              {isLoading ? (
                                <ActivityIndicator color="#666" />
                              ) : (
                                <PrinterIcon
                                  size={20}
                                  color={
                                    !isValidProductionWeightInput(weightInput)
                                      ? "#94A3B8"
                                      : "#FFF"
                                  }
                                />
                              )}
                              <Text
                                style={[
                                  styles.primaryButtonText,
                                  !isValidProductionWeightInput(
                                    weightInput,
                                  ) && { color: "#94A3B8" },
                                ]}
                              >
                                Generate QR & Print
                              </Text>
                            </TouchableOpacity>
                            {!isPE ? (
                              <TouchableOpacity
                                style={[
                                  styles.secondaryButton,
                                  { marginTop: 8 },
                                ]}
                                onPress={handleBack}
                              >
                                <Text style={styles.secondaryButtonText}>
                                  ← Back
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        )}

                        {/* Shift progress */}
                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>
                            Shift Progress — {selectedSubLine}
                          </Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Outputs this shift
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {
                                shiftLogs.filter(
                                  (l: any) =>
                                    l.station_id === selectedStation.id &&
                                    l.sub_line === selectedSubLine,
                                ).length
                              }{" "}
                              bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Total weight
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {shiftLogs
                                .filter(
                                  (l: any) =>
                                    l.station_id === selectedStation.id &&
                                    l.sub_line === selectedSubLine,
                                )
                                .reduce(
                                  (acc: number, l: any) =>
                                    acc + Number(l.weight || 0),
                                  0,
                                )
                                .toFixed(1)}{" "}
                              kg
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.secondaryButton,
                            { marginTop: 12, marginBottom: 28 },
                          ]}
                          onPress={handleBack}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                ) : isPET ? (
                  /* ══════════════════════════════════════════════════════════
                    PET BORETECH FLOW
                    Sub-line auto-set to 'Flakes PET' by handleStationSelect.
                    Input  → scan Crusher (Rapid) or Washing pending bags
                    Output → enter weight, generate QR (Flakes PET)
                    ══════════════════════════════════════════════════════════ */
                  <View>
                    {/* Hero header */}
                    <View
                      style={[
                        styles.stationHero,
                        {
                          backgroundColor: selectedStation.color,
                          paddingBottom: 20,
                          marginBottom: 0,
                        },
                      ]}
                    >
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(
                            selectedStation.name,
                            selectedStation.color,
                          )}
                        </View>
                        <View style={{ marginLeft: 15, flex: 1 }}>
                          <Text style={styles.heroTitle}>Boretech</Text>
                          <Text style={styles.heroDesc}>
                            PET — Flakes production
                          </Text>
                        </View>
                      </View>
                    </View>

                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginTop: 4,
                          marginBottom: 4,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}

                    {/* Station totals — same scope as Recent Entries: Flakes PET only (excludes Processing/input rows with no sub_line) */}
                    {(() => {
                      const boretechFlakesLogs = shiftLogs.filter((l: any) => {
                        if (l.station_id !== selectedStation.id) return false;
                        if (
                          backendShiftId != null &&
                          l.shift_id !== backendShiftId
                        )
                          return false;
                        return l.sub_line === "Flakes PET";
                      });
                      const totalBags = boretechFlakesLogs.length;
                      const totalKg = boretechFlakesLogs.reduce(
                        (s: number, l: any) => s + (parseFloat(l.weight) || 0),
                        0,
                      );
                      return (
                        <View style={{ marginBottom: 12 }}>
                          <View
                            style={{
                              backgroundColor: "#1e293b",
                              borderRadius: 14,
                              padding: 14,
                              marginBottom: 10,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#94a3b8",
                              }}
                            >
                              Boretech — This Shift
                            </Text>
                            <View style={{ flexDirection: "row", gap: 16 }}>
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  bags
                                </Text>
                              </View>
                              <View
                                style={{ width: 1, backgroundColor: "#334155" }}
                              />
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  kg
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>
                      );
                    })()}

                    {/* Input / Output section selector */}
                    {!selectedSection && !isShiftEnded && (
                      <View style={styles.selectionContainer}>
                        <Text style={styles.selectionTitle}>Select Action</Text>
                        <TouchableOpacity
                          style={styles.selectionCard}
                          onPress={() => {
                            setSelectedSection("input");
                            setSelectedInputBag(null);
                            setBagSearchQuery("");
                            setSuggestedBags([]);
                            setShowSuggestions(false);
                          }}
                        >
                          <View
                            style={[
                              styles.selectionIconBox,
                              { backgroundColor: "#16a34a" },
                            ]}
                          >
                            <Droplets color="#FFF" size={28} />
                          </View>
                          <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>Input</Text>
                            <Text style={styles.selectionCardSub}>
                              Scan Crusher (Rapid) or Washing bag
                            </Text>
                          </View>
                          <ChevronRight color="#CCC" size={24} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.selectionCard}
                          onPress={() => setSelectedSection("output")}
                        >
                          <View
                            style={[
                              styles.selectionIconBox,
                              { backgroundColor: "#15803d" },
                            ]}
                          >
                            <Package color="#FFF" size={28} />
                          </View>
                          <View style={styles.selectionText}>
                            <Text style={styles.selectionCardTitle}>
                              Output
                            </Text>
                            <Text style={styles.selectionCardSub}>
                              Log Flakes PET output bag
                            </Text>
                          </View>
                          <ChevronRight color="#CCC" size={24} />
                        </TouchableOpacity>
                        {/* PE-only: Hold action — sets material aside for QC reprocess */}
                        {isPE && (
                          <TouchableOpacity
                            style={styles.selectionCard}
                            onPress={() => {
                              setSelectedSection("hold");
                              openPeHoldModal();
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: "#f59e0b" },
                              ]}
                            >
                              <PauseCircle color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>Hold</Text>
                              <Text style={styles.selectionCardSub}>
                                Set aside for QC reprocess
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {/* Input — same layout as PET Washing (search, scan, save → Processing; stay on station) */}
                    {selectedSection === "input" && !isShiftEnded && (
                      <View style={{ paddingHorizontal: 16 }}>
                        <View style={styles.sublineBadgeWrapper}>
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#DCFCE7",
                                borderColor: "#86efac",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#15803d" },
                              ]}
                            >
                              Working on: {selectedSubLine}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View
                              style={[
                                styles.typePill,
                                { backgroundColor: "#E0F2FE" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.typePillText,
                                  { color: "#0369A1" },
                                ]}
                              >
                                INPUT
                              </Text>
                            </View>
                            <Text style={styles.sectionTitleText}>
                              From Previous Station
                            </Text>
                          </View>
                          <View style={styles.searchContainer}>
                            <View style={styles.searchInputWrapper}>
                              <Search
                                size={20}
                                color="#666"
                                style={{ marginRight: 10 }}
                              />
                              <TextInput
                                style={styles.searchTextInput}
                                placeholder="Search Crusher (Rapid) or Washing…"
                                value={bagSearchQuery}
                                onChangeText={onBagSearch}
                                onFocus={handleBagSearchFocus}
                              />
                            </View>
                            {showSuggestions && (
                              <ScrollView
                                style={styles.suggestionsList}
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled
                              >
                                {suggestedBags.map((bag, i) => (
                                  <TouchableOpacity
                                    key={i}
                                    style={[
                                      styles.suggestionItem,
                                      i === suggestedBags.length - 1 && {
                                        borderBottomWidth: 0,
                                      },
                                    ]}
                                    onPress={() => {
                                      setSelectedInputBag(bag);
                                      setShowSuggestions(false);
                                      setBagSearchQuery("");
                                    }}
                                  >
                                    <View style={styles.suggestionLeftCol}>
                                      <Text
                                        style={styles.suggestionQrLine}
                                        numberOfLines={2}
                                        selectable
                                      >
                                        {getBagDisplayId(bag)}
                                      </Text>
                                      {(bag as any).pet_upstream_source ? (
                                        <Text style={styles.suggestionSubLine}>
                                          {(bag as any).pet_upstream_source}
                                          {bag.sub_line
                                            ? ` · ${bag.sub_line}`
                                            : ""}
                                        </Text>
                                      ) : bag.sub_line ? (
                                        <Text style={styles.suggestionSubLine}>
                                          {bag.sub_line}
                                        </Text>
                                      ) : null}
                                    </View>
                                    <Text style={styles.suggestionDetail}>
                                      {bag.weight} kg
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </ScrollView>
                            )}
                          </View>
                          <TouchableOpacity
                            style={styles.scanButton}
                            onPress={() => {
                              setScanned(false);
                              setShowScanner(true);
                            }}
                          >
                            <CameraIcon color="#17a34a" size={20} />
                            <Text style={styles.scanButtonText}>
                              Scan QR Code
                            </Text>
                          </TouchableOpacity>
                          {selectedInputBag && (
                            <View style={styles.selectedBagCard}>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: "#64748b",
                                    marginBottom: 2,
                                  }}
                                >
                                  {t("dashboard.jumboId")}
                                </Text>
                                <Text
                                  style={[
                                    styles.selectedBagId,
                                    { minWidth: 0 },
                                  ]}
                                  numberOfLines={2}
                                  selectable
                                >
                                  {getBagDisplayId(selectedInputBag)}
                                </Text>
                                {(selectedInputBag as any)
                                  .pet_upstream_source ? (
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      color: "#64748b",
                                      marginTop: 4,
                                    }}
                                  >
                                    From:{" "}
                                    {
                                      (selectedInputBag as any)
                                        .pet_upstream_source
                                    }
                                    {(selectedInputBag as any).sub_line
                                      ? ` · ${(selectedInputBag as any).sub_line}`
                                      : ""}
                                  </Text>
                                ) : (selectedInputBag as any).sub_line ? (
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      color: "#64748b",
                                      marginTop: 4,
                                    }}
                                  >
                                    {t("dashboard.lineLabel")}:{" "}
                                    {(selectedInputBag as any).sub_line}
                                  </Text>
                                ) : null}
                                <Text style={styles.selectedBagWeight}>
                                  {selectedInputBag.weight} kg
                                </Text>
                              </View>
                              <TouchableOpacity
                                onPress={() => setSelectedInputBag(null)}
                              >
                                <X color="#EB445A" size={20} />
                              </TouchableOpacity>
                            </View>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.primaryButton,
                              !selectedInputBag && { opacity: 0.5 },
                            ]}
                            disabled={!selectedInputBag || isLoading}
                            onPress={async () => {
                              if (
                                !selectedInputBag ||
                                !selectedStation ||
                                !backendShiftId
                              ) {
                                if (!backendShiftId)
                                  Alert.alert(
                                    t("common.error"),
                                    t("messages.noActiveShift"),
                                  );
                                return;
                              }
                              try {
                                setIsLoading(true);
                                const response =
                                  await productionApi.logProduction({
                                    shiftId: backendShiftId,
                                    stationId: selectedStation.id,
                                    inputBagQr: selectedInputBag.output_bag_qr,
                                    weight: selectedInputBag.weight,
                                    status: "Processing",
                                  });
                                if (response.data.success) {
                                  Alert.alert(
                                    t("common.success"),
                                    t("messages.materialProcessingStarted"),
                                  );
                                  setSelectedInputBag(null);
                                  setBagSearchQuery("");
                                  setSuggestedBags([]);
                                  setShowSuggestions(false);
                                  setSelectedSection(null);
                                  try {
                                    const logsRes =
                                      await productionApi.getShiftLogs(
                                        backendShiftId,
                                      );
                                    if (logsRes.data.success)
                                      setShiftLogs(logsRes.data.data);
                                  } catch (e) {
                                    console.error(
                                      "Error reloading shift logs:",
                                      e,
                                    );
                                  }
                                  loadPetBoretechLogs();
                                } else {
                                  Alert.alert(
                                    t("common.error"),
                                    response.data?.message ||
                                      t("messages.failedToStartProcessing"),
                                  );
                                }
                              } catch (error) {
                                console.error(
                                  "PET Boretech save input error:",
                                  error,
                                );
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.failedToStartProcessing"),
                                );
                              } finally {
                                setIsLoading(false);
                              }
                            }}
                          >
                            <Text style={styles.primaryButtonText}>
                              Save & Start Processing
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.secondaryButton,
                            { marginTop: 8, marginBottom: 8 },
                          ]}
                          onPress={() => {
                            setSelectedSection(null);
                            setSelectedInputBag(null);
                            setBagSearchQuery("");
                            setSuggestedBags([]);
                            setShowSuggestions(false);
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Output — same layout as PET Washing output */}
                    {selectedSection === "output" && (
                      <View style={{ paddingHorizontal: 16 }}>
                        <View style={styles.sublineBadgeWrapper}>
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#DCFCE7",
                                borderColor: "#86efac",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#15803d" },
                              ]}
                            >
                              Working on: {selectedSubLine}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View
                              style={[
                                styles.typePill,
                                { backgroundColor: "#DCFCE7" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.typePillText,
                                  { color: "#15803D" },
                                ]}
                              >
                                OUTPUT
                              </Text>
                            </View>
                            <Text style={styles.sectionTitleText}>
                              Jumbo Bag
                            </Text>
                          </View>
                          <View style={styles.inputGroup}>
                            <Text style={styles.label}>Weight (kg)</Text>
                            <View style={styles.inputWithIcon}>
                              <TextInput
                                style={[
                                  styles.input,
                                  styles.inputWithIconPadding,
                                  { flex: 1 },
                                ]}
                                placeholder="Enter weight"
                                placeholderTextColor="#999"
                                keyboardType="decimal-pad"
                                value={weightInput}
                                onChangeText={handleWeightInputChange}
                              />
                              <TouchableOpacity style={styles.iconInsideInput}>
                                <Scale size={20} color="#666" />
                              </TouchableOpacity>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={handleTakePhoto}
                          >
                            <CameraIcon size={20} color="#475569" />
                            <Text style={styles.secondaryButtonText}>
                              Take Photo
                            </Text>
                          </TouchableOpacity>
                          {capturedImages.length > 0 && (
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              style={styles.photosPreviewContainer}
                              contentContainerStyle={
                                styles.photosPreviewContent
                              }
                            >
                              {capturedImages.map((imageUri, index) => (
                                <View
                                  key={index}
                                  style={styles.photoPreviewItem}
                                >
                                  <Image
                                    source={{ uri: imageUri }}
                                    style={styles.photoPreviewThumbnail}
                                  />
                                  <TouchableOpacity
                                    style={styles.removePhotoButton}
                                    onPress={() =>
                                      setCapturedImages((prev) =>
                                        prev.filter((_, i) => i !== index),
                                      )
                                    }
                                  >
                                    <X size={16} color="#FFF" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </ScrollView>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.primaryButton,
                              (!isValidProductionWeightInput(weightInput) ||
                                isLoading ||
                                isShiftEnded) && {
                                opacity: 0.5,
                                backgroundColor: "#E2E8F0",
                              },
                            ]}
                            onPress={handleLogProduction}
                            disabled={
                              !isValidProductionWeightInput(weightInput) ||
                              isLoading ||
                              isShiftEnded
                            }
                          >
                            {isLoading ? (
                              <ActivityIndicator color="#666" />
                            ) : (
                              <PrinterIcon
                                size={20}
                                color={
                                  !isValidProductionWeightInput(weightInput) ||
                                  isShiftEnded
                                    ? "#94A3B8"
                                    : "#FFF"
                                }
                              />
                            )}
                            <Text
                              style={[
                                styles.primaryButtonText,
                                (!isValidProductionWeightInput(weightInput) ||
                                  isShiftEnded) && { color: "#94A3B8" },
                              ]}
                            >
                              Generate QR & Print
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.statsRow}>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {currentViewBags}
                            </Text>
                            <Text style={styles.statLabel}>Outputs</Text>
                          </View>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {currentViewWeight.toFixed(1)}
                            </Text>
                            <Text style={styles.statLabel}>Total kg</Text>
                          </View>
                        </View>
                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>
                            Shift Progress ({selectedSubLine})
                          </Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Outputs this shift
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewBags} bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Total weight
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewWeight.toFixed(1)} kg
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.secondaryButton,
                            { marginTop: 8, marginBottom: 8 },
                          ]}
                          onPress={() => {
                            setSelectedSection(null);
                            setWeightInput("");
                            setCapturedImages([]);
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Recent Entries (Boretech logs) — dashboard only, hidden on Input/Output */}
                    {selectedSection !== "input" &&
                      selectedSection !== "output" && (
                        <View
                          style={[
                            styles.crusherLogsSection,
                            { marginHorizontal: 16, marginBottom: 24 },
                          ]}
                        >
                          <View style={styles.logsHeader}>
                            <Text style={styles.logsTitle}>Recent Entries</Text>
                          </View>
                          <View style={styles.datePickerContainer}>
                            <Text style={styles.datePickerLabel}>
                              Select Date:
                            </Text>
                            <StationDatePicker
                              value={parseDateLocal(petBoretechSelectedDate)}
                              onChange={(date) => {
                                setPetBoretechSelectedDate(
                                  formatDateLocal(date),
                                );
                                setPetBoretechCurrentPage(1);
                              }}
                              maximumDate={maxDate}
                            />
                          </View>
                          <View style={styles.searchBox}>
                            <Search size={18} color="#64748b" />
                            <TextInput
                              style={styles.searchInput}
                              placeholder="Search by QR code..."
                              value={petBoretechSearchQuery}
                              onChangeText={(text) => {
                                setPetBoretechSearchQuery(text);
                                setPetBoretechCurrentPage(1);
                              }}
                              placeholderTextColor="#94a3b8"
                              returnKeyType="search"
                              autoCorrect={false}
                              autoCapitalize="none"
                              spellCheck={false}
                            />
                            {petBoretechSearchQuery.length > 0 && (
                              <TouchableOpacity
                                onPress={() => {
                                  setPetBoretechSearchQuery("");
                                  setPetBoretechCurrentPage(1);
                                }}
                                style={styles.clearButton}
                              >
                                <X size={16} color="#64748b" />
                              </TouchableOpacity>
                            )}
                          </View>
                          <View style={styles.filtersContainer}>
                            <View style={styles.filterGroup}>
                              <Text style={styles.filterLabel}>Status:</Text>
                              <View style={styles.filterButtons}>
                                {(["all", "pending", "Completed"] as const).map(
                                  (s) => (
                                    <TouchableOpacity
                                      key={s}
                                      style={[
                                        styles.filterButton,
                                        petBoretechStatusFilter === s &&
                                          styles.filterButtonActive,
                                      ]}
                                      onPress={() => {
                                        setPetBoretechStatusFilter(s);
                                        setPetBoretechCurrentPage(1);
                                      }}
                                    >
                                      <Text
                                        style={[
                                          styles.filterButtonText,
                                          petBoretechStatusFilter === s &&
                                            styles.filterButtonTextActive,
                                        ]}
                                      >
                                        {s === "all"
                                          ? "All"
                                          : s === "pending"
                                            ? "Pending"
                                            : "Complete"}
                                      </Text>
                                    </TouchableOpacity>
                                  ),
                                )}
                              </View>
                            </View>
                          </View>
                          {petBoretechLogsLoading ? (
                            <View style={styles.loadingState}>
                              <ActivityIndicator size="large" color="#16a34a" />
                              <Text style={styles.loadingText}>
                                Loading entries...
                              </Text>
                            </View>
                          ) : petBoretechLogs.length > 0 ? (
                            <View style={styles.logsList}>
                              {petBoretechLogs.map(
                                (log: any, index: number) => (
                                  <View
                                    key={log.id || index}
                                    style={styles.logItem}
                                  >
                                    <View style={styles.logMain}>
                                      <Text style={styles.logQr}>
                                        {log.output_bag_qr ||
                                          log.outputBagQr ||
                                          "—"}
                                      </Text>
                                      <View style={styles.logDetails}>
                                        <Text style={styles.logWeight}>
                                          {log.weight} kg
                                        </Text>
                                        <Text style={styles.logTime}>
                                          {new Date(
                                            log.created_at,
                                          ).toLocaleString()}
                                        </Text>
                                      </View>
                                      <View style={styles.logStatusRow}>
                                        <View
                                          style={[
                                            styles.statusBadge,
                                            {
                                              backgroundColor:
                                                log.status === "pending"
                                                  ? "#FEF3C7"
                                                  : log.status === "hold"
                                                  ? "#FFEDD5"
                                                  : log.status === "reject"
                                                  ? "#FEE2E2"
                                                  : "#DCFCE7",
                                            },
                                          ]}
                                        >
                                          <Text
                                            style={[
                                              styles.statusBadgeText,
                                              {
                                                color:
                                                  log.status === "pending"
                                                    ? "#D97706"
                                                    : log.status === "hold"
                                                    ? "#92400E"
                                                    : log.status === "reject"
                                                    ? "#B91C1C"
                                                    : "#15803D",
                                              },
                                            ]}
                                          >
                                            {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                          </Text>
                                        </View>
                                      </View>
                                    </View>
                                    <View style={styles.logActions}>
                                      {(canEditAnyStatus ||
                                        log.status === "pending") && (
                                        <TouchableOpacity
                                          style={styles.editIconButton}
                                          onPress={() => openEditLogWeight(log)}
                                        >
                                          <Pencil color="#0ea5e9" size={18} />
                                        </TouchableOpacity>
                                      )}
                                      {isPE && log.status === "hold" && (
                                        <>
                                          <TouchableOpacity
                                            style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                            onPress={() => openPeResolveModal(log)}
                                          >
                                            <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                          </TouchableOpacity>
                                          <TouchableOpacity
                                            style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                            onPress={() => openPeResolveModal(log)}
                                          >
                                            <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                          </TouchableOpacity>
                                        </>
                                      )}
                                      <TouchableOpacity
                                        style={styles.printIconButton}
                                        onPress={() => {
                                          setSelectedLogForPrint(log);
                                          setShowListPrintPreview(true);
                                        }}
                                      >
                                        <PrinterIcon
                                          color="#16a34a"
                                          size={20}
                                        />
                                      </TouchableOpacity>
                                      <View
                                        style={[
                                          styles.logBadge,
                                          { backgroundColor: "#DCFCE7" },
                                        ]}
                                      >
                                        <Text
                                          style={[
                                            styles.logBadgeText,
                                            { color: "#16a34a" },
                                          ]}
                                        >
                                          Flakes PET
                                        </Text>
                                      </View>
                                    </View>
                                  </View>
                                ),
                              )}
                            </View>
                          ) : (
                            <View style={styles.emptyState}>
                              <Package
                                size={48}
                                color="#94a3b8"
                                opacity={0.5}
                              />
                              <Text style={styles.emptyText}>
                                No entries found for this date
                              </Text>
                            </View>
                          )}
                          {petBoretechTotalPages > 1 && (
                            <View style={styles.pagination}>
                              <TouchableOpacity
                                style={[
                                  styles.pageBtn,
                                  petBoretechCurrentPage === 1 &&
                                    styles.pageBtnDisabled,
                                ]}
                                onPress={() =>
                                  setPetBoretechCurrentPage(
                                    Math.max(1, petBoretechCurrentPage - 1),
                                  )
                                }
                                disabled={petBoretechCurrentPage === 1}
                              >
                                <ChevronLeft
                                  color={
                                    petBoretechCurrentPage === 1
                                      ? "#cbd5e1"
                                      : "#475569"
                                  }
                                  size={18}
                                />
                              </TouchableOpacity>
                              <View style={styles.pageInfoBox}>
                                <Text style={styles.pageInfoMain}>
                                  {petBoretechCurrentPage} /{" "}
                                  {petBoretechTotalPages}
                                </Text>
                                <Text style={styles.pageInfoSub}>
                                  {petBoretechTotalLogs} total
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[
                                  styles.pageBtn,
                                  petBoretechCurrentPage ===
                                    petBoretechTotalPages &&
                                    styles.pageBtnDisabled,
                                ]}
                                onPress={() =>
                                  setPetBoretechCurrentPage(
                                    Math.min(
                                      petBoretechTotalPages,
                                      petBoretechCurrentPage + 1,
                                    ),
                                  )
                                }
                                disabled={
                                  petBoretechCurrentPage ===
                                  petBoretechTotalPages
                                }
                              >
                                <ChevronRight
                                  color={
                                    petBoretechCurrentPage ===
                                    petBoretechTotalPages
                                      ? "#cbd5e1"
                                      : "#475569"
                                  }
                                  size={18}
                                />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                  </View>
                ) : /* ══════════════════════════════════════════════════════════
                    PC EXTRUSION FLOW (unchanged)
                    ══════════════════════════════════════════════════════════ */
                !selectedSubLine ? (
                  <React.Fragment>
                    <View style={styles.selectionContainer}>
                      <Text style={styles.selectionTitle}>
                        Select Extrusion Line
                      </Text>
                      {(
                        [
                          {
                            line: "Extrusion 1",
                            sub: t("dashboard.primaryExtrusionLine"),
                            color: "#f97316",
                          },
                          {
                            line: "Extrusion 2",
                            sub: t("dashboard.secondaryExtrusionLine"),
                            color: "#ea580c",
                          },
                          {
                            line: "Extrusion 3",
                            sub: t("dashboard.tertiaryExtrusionLine"),
                            color: "#c2410c",
                          },
                          {
                            line: "Mixture",
                            sub: t("dashboard.mixtureLine"),
                            color: "#dc2626",
                          },
                        ] as const
                      ).map(({ line, sub, color }) => {
                        const bags = shiftLogs.filter(
                          (l: any) =>
                            l.station_id === selectedStation.id &&
                            l.sub_line === line,
                        ).length;
                        const kg = shiftLogs
                          .filter(
                            (l: any) =>
                              l.station_id === selectedStation.id &&
                              l.sub_line === line,
                          )
                          .reduce(
                            (s: number, l: any) =>
                              s + (parseFloat(l.weight) || 0),
                            0,
                          );
                        return (
                          <TouchableOpacity
                            key={line}
                            style={[
                              styles.selectionCard,
                              isShiftEnded && { opacity: 0.4 },
                            ]}
                            disabled={isShiftEnded}
                            onPress={() => {
                              setPendingExtrusionLine(line as any);
                              setShowExtrusionModal(true);
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: color },
                              ]}
                            >
                              <Zap color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>
                                {line}
                              </Text>
                              <Text style={styles.selectionCardSub}>{sub}</Text>
                            </View>
                            <View
                              style={{ alignItems: "flex-end", marginRight: 8 }}
                            >
                              <Text
                                style={{
                                  fontSize: 13,
                                  fontWeight: "700",
                                  color: "#1e293b",
                                }}
                              >
                                {bags} bags
                              </Text>
                              <Text style={{ fontSize: 11, color: "#64748b" }}>
                                {kg.toFixed(1)} kg
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Shift Ended banner for Extrusion */}
                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}

                    {/* Extrusion Station Totals */}
                    {(() => {
                      const lines = [
                        { label: "Extrusion 1", short: "E1", color: "#f97316" },
                        { label: "Extrusion 2", short: "E2", color: "#ea580c" },
                        { label: "Extrusion 3", short: "E3", color: "#c2410c" },
                        { label: "Mixture", short: "Mix", color: "#dc2626" },
                      ];
                      const totalBags = shiftLogs.filter(
                        (l: any) => l.station_id === selectedStation.id,
                      ).length;
                      const totalKg = shiftLogs
                        .filter((l: any) => l.station_id === selectedStation.id)
                        .reduce(
                          (s: number, l: any) =>
                            s + (parseFloat(l.weight) || 0),
                          0,
                        );
                      return (
                        <View style={{ marginBottom: 12 }}>
                          <View
                            style={{
                              backgroundColor: "#1e293b",
                              borderRadius: 14,
                              padding: 14,
                              marginBottom: 10,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#94a3b8",
                              }}
                            >
                              Extrusion — This Shift
                            </Text>
                            <View style={{ flexDirection: "row", gap: 16 }}>
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  bags
                                </Text>
                              </View>
                              <View
                                style={{ width: 1, backgroundColor: "#334155" }}
                              />
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 20,
                                    fontWeight: "800",
                                    color: "#fff",
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  kg
                                </Text>
                              </View>
                            </View>
                          </View>
                          <View
                            style={{
                              flexDirection: "row",
                              flexWrap: "wrap",
                              gap: 8,
                            }}
                          >
                            {lines.map(({ label, short, color }) => {
                              const bags = shiftLogs.filter(
                                (l: any) =>
                                  l.station_id === selectedStation.id &&
                                  l.sub_line === label,
                              ).length;
                              const kg = shiftLogs
                                .filter(
                                  (l: any) =>
                                    l.station_id === selectedStation.id &&
                                    l.sub_line === label,
                                )
                                .reduce(
                                  (s: number, l: any) =>
                                    s + (parseFloat(l.weight) || 0),
                                  0,
                                );
                              return (
                                <View
                                  key={label}
                                  style={{
                                    width: "48%",
                                    backgroundColor: "#fff",
                                    borderRadius: 12,
                                    padding: 12,
                                    borderTopWidth: 3,
                                    borderTopColor: color,
                                    elevation: 2,
                                    shadowColor: "#000",
                                    shadowOpacity: 0.06,
                                    shadowRadius: 4,
                                    shadowOffset: { width: 0, height: 2 },
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      fontWeight: "700",
                                      color,
                                      marginBottom: 6,
                                    }}
                                  >
                                    {short}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 22,
                                      fontWeight: "800",
                                      color: "#1e293b",
                                    }}
                                  >
                                    {bags}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      color: "#64748b",
                                      marginTop: 1,
                                    }}
                                  >
                                    bags
                                  </Text>
                                  <View
                                    style={{
                                      marginTop: 6,
                                      borderTopWidth: 1,
                                      borderTopColor: "#f1f5f9",
                                      paddingTop: 6,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 13,
                                        fontWeight: "700",
                                        color: "#475569",
                                      }}
                                    >
                                      {kg.toFixed(1)} kg
                                    </Text>
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
                          onChangeText={(text) => {
                            setExtrusionSearchQuery(text);
                            setExtrusionCurrentPage(1);
                          }}
                          placeholderTextColor="#94a3b8"
                          clearButtonMode="while-editing"
                          returnKeyType="search"
                          autoCorrect={false}
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        {extrusionSearchQuery.length > 0 && (
                          <TouchableOpacity
                            onPress={() => {
                              setExtrusionSearchQuery("");
                              setExtrusionCurrentPage(1);
                            }}
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
                              style={[
                                styles.filterButton,
                                extrusionSelectedLineFilter === "all" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setExtrusionSelectedLineFilter("all");
                                setExtrusionCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  extrusionSelectedLineFilter === "all" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                All
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                extrusionSelectedLineFilter === "Extrusion 1" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setExtrusionSelectedLineFilter("Extrusion 1");
                                setExtrusionCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  extrusionSelectedLineFilter ===
                                    "Extrusion 1" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                E1
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                extrusionSelectedLineFilter === "Extrusion 2" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setExtrusionSelectedLineFilter("Extrusion 2");
                                setExtrusionCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  extrusionSelectedLineFilter ===
                                    "Extrusion 2" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                E2
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                extrusionSelectedLineFilter === "Extrusion 3" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setExtrusionSelectedLineFilter("Extrusion 3");
                                setExtrusionCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  extrusionSelectedLineFilter ===
                                    "Extrusion 3" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                E3
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                extrusionSelectedLineFilter === "Mixture" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setExtrusionSelectedLineFilter("Mixture");
                                setExtrusionCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  extrusionSelectedLineFilter === "Mixture" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                MIX
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* Status Filter */}
                        <View style={styles.filterGroup}>
                          <Text style={styles.filterLabel}>Status:</Text>
                          <View style={styles.filterButtons}>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                extrusionSelectedStatusFilter === "all" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setExtrusionSelectedStatusFilter("all");
                                setExtrusionCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  extrusionSelectedStatusFilter === "all" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                All
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                extrusionSelectedStatusFilter === "pending" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setExtrusionSelectedStatusFilter("pending");
                                setExtrusionCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  extrusionSelectedStatusFilter === "pending" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                Pending
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                extrusionSelectedStatusFilter === "Completed" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setExtrusionSelectedStatusFilter("Completed");
                                setExtrusionCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  extrusionSelectedStatusFilter ===
                                    "Completed" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                Complete
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      {extrusionLogsLoading ? (
                        <View style={styles.loadingState}>
                          <ActivityIndicator size="large" color="#17a34a" />
                          <Text style={styles.loadingText}>
                            Loading entries...
                          </Text>
                        </View>
                      ) : extrusionLogs.length > 0 ? (
                        <View style={styles.logsList}>
                          {extrusionLogs.map((log, index) => (
                            <View key={index} style={styles.logItem}>
                              <View style={styles.logMain}>
                                <Text style={styles.logQr}>
                                  {log.output_bag_qr}
                                </Text>
                                <View style={styles.logDetails}>
                                  <Text style={styles.logWeight}>
                                    {log.weight} kg
                                  </Text>
                                  <Text style={styles.logTime}>
                                    {new Date(log.created_at).toLocaleString()}
                                  </Text>
                                </View>
                                <View style={styles.logStatusRow}>
                                  <View
                                    style={[
                                      styles.statusBadge,
                                      {
                                        backgroundColor:
                                          log.status === "pending"
                                            ? "#FEF3C7"
                                            : log.status === "hold"
                                            ? "#FFEDD5"
                                            : log.status === "reject"
                                            ? "#FEE2E2"
                                            : "#DCFCE7",
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.statusBadgeText,
                                        {
                                          color:
                                            log.status === "pending"
                                              ? "#D97706"
                                              : log.status === "hold"
                                              ? "#92400E"
                                              : log.status === "reject"
                                              ? "#B91C1C"
                                              : "#15803D",
                                        },
                                      ]}
                                    >
                                      {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                              <View style={styles.logActions}>
                                {(canEditAnyStatus ||
                                  log.status === "pending") && (
                                  <TouchableOpacity
                                    style={styles.editIconButton}
                                    onPress={() => openEditLogWeight(log)}
                                  >
                                    <Pencil color="#0ea5e9" size={18} />
                                  </TouchableOpacity>
                                )}
                                {isPE && log.status === "hold" && (
                                  <>
                                    <TouchableOpacity
                                      style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                      onPress={() => openPeResolveModal(log)}
                                    >
                                      <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                      onPress={() => openPeResolveModal(log)}
                                    >
                                      <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                    </TouchableOpacity>
                                  </>
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
                                <View
                                  style={[
                                    styles.logBadge,
                                    log.sub_line === "Extrusion 1" && {
                                      backgroundColor: "#f97316",
                                    },
                                    log.sub_line === "Extrusion 2" && {
                                      backgroundColor: "#ea580c",
                                    },
                                    log.sub_line === "Extrusion 3" && {
                                      backgroundColor: "#c2410c",
                                    },
                                    log.sub_line === "Mixture" && {
                                      backgroundColor: "#dc2626",
                                    },
                                  ]}
                                >
                                  <Text style={styles.logBadgeText}>
                                    {log.sub_line}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <View style={styles.emptyState}>
                          <Package size={48} color="#94a3b8" opacity={0.5} />
                          <Text style={styles.emptyText}>
                            No entries found for this date
                          </Text>
                        </View>
                      )}

                      {/* Pagination */}
                      {extrusionTotalPages > 1 && (
                        <View style={styles.pagination}>
                          <TouchableOpacity
                            style={[
                              styles.pageBtn,
                              extrusionCurrentPage === 1 &&
                                styles.pageBtnDisabled,
                            ]}
                            onPress={() =>
                              extrusionCurrentPage > 1 &&
                              setExtrusionCurrentPage(extrusionCurrentPage - 1)
                            }
                            disabled={extrusionCurrentPage === 1}
                          >
                            <ChevronLeft
                              size={18}
                              color={
                                extrusionCurrentPage === 1
                                  ? "#cbd5e1"
                                  : "#475569"
                              }
                            />
                          </TouchableOpacity>
                          <View style={styles.pageInfoBox}>
                            <Text style={styles.pageInfoMain}>
                              {extrusionCurrentPage} / {extrusionTotalPages}
                            </Text>
                            <Text style={styles.pageInfoSub}>
                              {extrusionTotalLogs} total
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[
                              styles.pageBtn,
                              extrusionCurrentPage === extrusionTotalPages &&
                                styles.pageBtnDisabled,
                            ]}
                            onPress={() =>
                              extrusionCurrentPage < extrusionTotalPages &&
                              setExtrusionCurrentPage(extrusionCurrentPage + 1)
                            }
                            disabled={
                              extrusionCurrentPage === extrusionTotalPages
                            }
                          >
                            <ChevronRight
                              size={18}
                              color={
                                extrusionCurrentPage === extrusionTotalPages
                                  ? "#cbd5e1"
                                  : "#475569"
                              }
                            />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </React.Fragment>
                ) : !selectedSection ? (
                  /* Sub-line chosen but section not yet selected — show the picker inline */
                  <View style={styles.sectionOptions}>
                    <View style={styles.sublineBadgeWrapper}>
                      <View
                        style={[
                          styles.sublineBadge,
                          {
                            backgroundColor: "#FEF3C7",
                            borderColor: "#FCD34D",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sublineBadgeText,
                            { color: "#D97706" },
                          ]}
                        >
                          Line: {selectedSubLine}
                        </Text>
                      </View>
                    </View>
                    {isShiftEnded ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.sectionOption}
                          onPress={() => setSelectedSection("input")}
                        >
                          <View
                            style={[
                              styles.optionIcon,
                              { backgroundColor: "#f97316" },
                            ]}
                          >
                            <Plus color="#FFF" size={24} />
                          </View>
                          <View>
                            <Text style={styles.optionTitle}>INPUT</Text>
                            <Text style={styles.optionSubtitle}>
                              Scan washing bag
                            </Text>
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.sectionOption}
                          onPress={() => setSelectedSection("output")}
                        >
                          <View
                            style={[
                              styles.optionIcon,
                              { backgroundColor: "#17a34a" },
                            ]}
                          >
                            <Box color="#FFF" size={24} />
                          </View>
                          <View>
                            <Text style={styles.optionTitle}>OUTPUT</Text>
                            <Text style={styles.optionSubtitle}>
                              Generate bag QR
                            </Text>
                          </View>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                ) : selectedSection === "input" ? (
                  <React.Fragment>
                    <View style={styles.sublineBadgeWrapper}>
                      <View
                        style={[
                          styles.sublineBadge,
                          {
                            backgroundColor: "#FEF3C7",
                            borderColor: "#FCD34D",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sublineBadgeText,
                            { color: "#D97706" },
                          ]}
                        >
                          Working on: {selectedSubLine}
                        </Text>
                      </View>
                    </View>

                    {/* Input Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View
                          style={[
                            styles.typePill,
                            { backgroundColor: "#E0F2FE" },
                          ]}
                        >
                          <Text
                            style={[styles.typePillText, { color: "#0369A1" }]}
                          >
                            INPUT
                          </Text>
                        </View>
                        <Text style={styles.sectionTitleText}>
                          From Previous Station
                        </Text>
                      </View>
                      <View style={styles.searchContainer}>
                        <View style={styles.searchInputWrapper}>
                          <Search
                            size={20}
                            color="#666"
                            style={{ marginRight: 10 }}
                          />
                          <TextInput
                            style={styles.searchTextInput}
                            placeholder="Search QR code..."
                            value={bagSearchQuery}
                            onChangeText={onBagSearch}
                            onFocus={handleBagSearchFocus}
                          />
                        </View>
                        {showSuggestions && (
                          <ScrollView
                            style={styles.suggestionsList}
                            keyboardShouldPersistTaps="handled"
                            nestedScrollEnabled
                          >
                            {suggestedBags.map((bag, i) => (
                              <TouchableOpacity
                                key={i}
                                style={[
                                  styles.suggestionItem,
                                  i === suggestedBags.length - 1 && {
                                    borderBottomWidth: 0,
                                  },
                                ]}
                                onPress={() => {
                                  setSelectedInputBag(bag);
                                  setShowSuggestions(false);
                                  setBagSearchQuery("");
                                }}
                              >
                                <View style={styles.suggestionLeftCol}>
                                  <Text
                                    style={styles.suggestionQrLine}
                                    numberOfLines={2}
                                    selectable
                                  >
                                    {getBagDisplayId(bag)}
                                  </Text>
                                  {bag.sub_line ? (
                                    <Text style={styles.suggestionSubLine}>
                                      {bag.sub_line}
                                    </Text>
                                  ) : null}
                                </View>
                                <Text style={styles.suggestionDetail}>
                                  {bag.weight} kg
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                      <TouchableOpacity
                        style={styles.scanButton}
                        onPress={() => {
                          setScanned(false);
                          setShowScanner(true);
                        }}
                      >
                        <CameraIcon color="#17a34a" size={20} />
                        <Text style={styles.scanButtonText}>Scan QR Code</Text>
                      </TouchableOpacity>
                      {selectedInputBag && (
                        <View style={styles.selectedBagCard}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                marginBottom: 2,
                              }}
                            >
                              {t("dashboard.jumboId")}
                            </Text>
                            <Text
                              style={[styles.selectedBagId, { minWidth: 0 }]}
                              numberOfLines={2}
                              selectable
                            >
                              {getBagDisplayId(selectedInputBag)}
                            </Text>
                            {(selectedInputBag as any).sub_line ? (
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: "#64748b",
                                  marginTop: 4,
                                }}
                              >
                                {t("dashboard.lineLabel")}:{" "}
                                {(selectedInputBag as any).sub_line}
                              </Text>
                            ) : null}
                            <Text style={styles.selectedBagWeight}>
                              {selectedInputBag.weight} kg
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => setSelectedInputBag(null)}
                          >
                            <X color="#EB445A" size={20} />
                          </TouchableOpacity>
                        </View>
                      )}
                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          !selectedInputBag && { opacity: 0.5 },
                        ]}
                        disabled={!selectedInputBag || isLoading}
                        onPress={async () => {
                          if (!selectedInputBag || !selectedStation) return;
                          try {
                            setIsLoading(true);
                            // Check if this is extrusion station
                            const isExtrusionStation =
                              selectedStation.name
                                ?.toLowerCase()
                                .includes("extrusion") ||
                              selectedStation.code === "EXT" ||
                              selectedStation.id === 4;

                            // If this is extrusion station, ONLY update the existing washing batch (NO new entry)
                            if (
                              isExtrusionStation &&
                              selectedInputBag.output_bag_qr
                            ) {
                              // Ensure we have an extrusion line selected
                              if (!selectedSubLine) {
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.pleaseSelectExtrusionLine"),
                                );
                                setIsLoading(false);
                                return;
                              }
                              // Pass the selected extrusion line name (e.g., "Extrusion 1", "Extrusion 2", "Extrusion 3")
                              // This will update the washing batch status to 'Completed' and set used_line to the extrusion line
                              const extrusionLine = selectedSubLine;
                              const response =
                                await productionApi.updateLogStatus(
                                  selectedInputBag.output_bag_qr,
                                  "Completed",
                                  undefined,
                                  extrusionLine,
                                );
                              if (response.data.success) {
                                Alert.alert(
                                  t("common.success"),
                                  t("messages.materialProcessingStarted"),
                                );
                                setSelectedInputBag(null);
                                setBagSearchQuery("");
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              } else {
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.failedToUpdateBatchStatus"),
                                );
                              }
                            } else {
                              // For other stations (NOT extrusion), create a new processing log entry
                              if (!backendShiftId) {
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.noActiveShift"),
                                );
                                return;
                              }
                              const logData = {
                                shiftId: backendShiftId,
                                stationId: selectedStation.id,
                                inputBagQr: selectedInputBag.output_bag_qr,
                                weight: selectedInputBag.weight,
                                status: "Processing",
                              };
                              const response =
                                await productionApi.logProduction(logData);
                              if (response.data.success) {
                                Alert.alert(
                                  t("common.success"),
                                  t("messages.materialProcessingStarted"),
                                );
                                setSelectedInputBag(null);
                                setBagSearchQuery("");
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedStation(null);
                                setSelectedSubLine(null);
                                setSelectedSection(null);
                              }
                            }
                          } catch (error) {
                            console.error("Save input error:", error);
                            Alert.alert(
                              t("common.error"),
                              t("messages.failedToStartProcessing"),
                            );
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                      >
                        <Text style={styles.primaryButtonText}>
                          Save & Start Processing
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </React.Fragment>
                ) : selectedSection === "output" ? (
                  <React.Fragment>
                    <View style={styles.sublineBadgeWrapper}>
                      <View
                        style={[
                          styles.sublineBadge,
                          {
                            backgroundColor: "#FEF3C7",
                            borderColor: "#FCD34D",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sublineBadgeText,
                            { color: "#D97706" },
                          ]}
                        >
                          Working on: {selectedSubLine}
                        </Text>
                      </View>
                    </View>

                    {/* Output Section */}
                    <View style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <View
                          style={[
                            styles.typePill,
                            { backgroundColor: "#DCFCE7" },
                          ]}
                        >
                          <Text
                            style={[styles.typePillText, { color: "#15803D" }]}
                          >
                            OUTPUT
                          </Text>
                        </View>
                        <Text style={styles.sectionTitleText}>Jumbo Bag</Text>
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Weight (kg)</Text>
                        <View style={styles.inputWithIcon}>
                          <TextInput
                            style={[
                              styles.input,
                              styles.inputWithIconPadding,
                              { flex: 1 },
                            ]}
                            placeholder="Enter weight"
                            placeholderTextColor="#999"
                            keyboardType="decimal-pad"
                            value={weightInput}
                            onChangeText={handleWeightInputChange}
                          />
                          <TouchableOpacity style={styles.iconInsideInput}>
                            <Scale size={20} color="#666" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={handleTakePhoto}
                      >
                        <CameraIcon size={20} color="#475569" />
                        <Text style={styles.secondaryButtonText}>
                          Take Photo
                        </Text>
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
                              <Image
                                source={{ uri: imageUri }}
                                style={styles.photoPreviewThumbnail}
                              />
                              <TouchableOpacity
                                style={styles.removePhotoButton}
                                onPress={() => {
                                  setCapturedImages((prev) =>
                                    prev.filter((_, i) => i !== index),
                                  );
                                }}
                              >
                                <X size={16} color="#FFF" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </ScrollView>
                      )}

                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          (!isValidProductionWeightInput(weightInput) ||
                            isLoading) && {
                            opacity: 0.5,
                            backgroundColor: "#E2E8F0",
                          },
                        ]}
                        onPress={handleLogProduction}
                        disabled={
                          !isValidProductionWeightInput(weightInput) ||
                          isLoading
                        }
                      >
                        {isLoading ? (
                          <ActivityIndicator color="#666" />
                        ) : (
                          <PrinterIcon
                            size={20}
                            color={
                              !isValidProductionWeightInput(weightInput)
                                ? "#94A3B8"
                                : "#FFF"
                            }
                          />
                        )}
                        <Text
                          style={[
                            styles.primaryButtonText,
                            !isValidProductionWeightInput(weightInput) && {
                              color: "#94A3B8",
                            },
                          ]}
                        >
                          Generate QR & Print
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Shift Progress Section */}
                    <View style={styles.progressCardRedesign}>
                      <Text style={styles.progressTitleRedesign}>
                        Shift Progress ({selectedSubLine})
                      </Text>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>
                          Outputs this shift
                        </Text>
                        <Text style={styles.progressDataValue}>
                          {currentViewBags} bags
                        </Text>
                      </View>
                      <View style={styles.progressDataRow}>
                        <Text style={styles.progressDataLabel}>
                          Total weight
                        </Text>
                        <Text style={styles.progressDataValue}>
                          {currentViewWeight.toFixed(1)} kg
                        </Text>
                      </View>
                    </View>
                  </React.Fragment>
                ) : null}
              </View>
            ) : (
              <>
                {/* ── PET Starlinger — input (Boretech) + output (Pellet PET) ── */}
                {isPET && isPetStarlingerLine(selectedStation) ? (
                  <>
                    {/* Hero header */}
                    <View
                      style={[
                        styles.stationHero,
                        {
                          backgroundColor: selectedStation.color,
                          paddingVertical: 28,
                          paddingHorizontal: 24,
                          marginBottom: 0,
                        },
                      ]}
                    >
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(
                            selectedStation.name,
                            selectedStation.color,
                          )}
                        </View>
                        <View
                          style={{
                            marginLeft: 15,
                            flex: 1,
                            justifyContent: "center",
                          }}
                        >
                          <Text style={styles.heroTitle}>Starlinger</Text>
                          <Text style={[styles.heroDesc, { marginTop: 6 }]}>
                            PET — Pellet production
                          </Text>
                        </View>
                      </View>
                    </View>

                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginTop: 4,
                          marginBottom: 4,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}

                    {/* Station totals — Pellet PET only; coerce ids so shift/station rows always match */}
                    {(() => {
                      const starLogs = shiftLogs.filter(
                        (l: any) =>
                          shiftLogMatchesStationShiftMaterial(
                            l,
                            selectedStation.id,
                            backendShiftId,
                            user?.materialTypeId ?? null,
                          ) && l.sub_line === "Pellet PET",
                      );
                      const totalBags = starLogs.length;
                      const totalKg = starLogs.reduce(
                        (s: number, l: any) => s + (parseFloat(l.weight) || 0),
                        0,
                      );
                      return (
                        <View
                          style={{
                            marginHorizontal: 16,
                            marginTop: 12,
                            marginBottom: 16,
                          }}
                        >
                          <View
                            style={{
                              backgroundColor: "#1e293b",
                              borderRadius: 14,
                              paddingVertical: 14,
                              paddingHorizontal: 18,
                              marginBottom: 10,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#94a3b8",
                                letterSpacing: 0.3,
                              }}
                            >
                              Starlinger — This Shift
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 16,
                              }}
                            >
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 22,
                                    fontWeight: "800",
                                    color: "#fff",
                                    lineHeight: 26,
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  bags
                                </Text>
                              </View>
                              <View
                                style={{
                                  width: 1,
                                  height: 32,
                                  backgroundColor: "#334155",
                                }}
                              />
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 22,
                                    fontWeight: "800",
                                    color: "#fff",
                                    lineHeight: 26,
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  kg
                                </Text>
                              </View>
                            </View>
                          </View>
                          {!selectedSection ? (
                            <View style={{ flexDirection: "row", gap: 10 }}>
                              <View
                                style={{
                                  flex: 1,
                                  backgroundColor: "#fff",
                                  borderRadius: 14,
                                  paddingVertical: 18,
                                  paddingHorizontal: 14,
                                  borderTopWidth: 3,
                                  borderTopColor: "#7c3aed",
                                  elevation: 2,
                                  alignItems: "center",
                                  shadowColor: "#000",
                                  shadowOpacity: 0.06,
                                  shadowRadius: 6,
                                  shadowOffset: { width: 0, height: 2 },
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 11,
                                    fontWeight: "700",
                                    color: "#7c3aed",
                                    letterSpacing: 0.5,
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                  }}
                                >
                                  Total Bags
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 32,
                                    fontWeight: "800",
                                    color: "#1e293b",
                                    lineHeight: 36,
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: "#64748b",
                                    marginTop: 4,
                                  }}
                                >
                                  bags this shift
                                </Text>
                              </View>
                              <View
                                style={{
                                  flex: 1,
                                  backgroundColor: "#fff",
                                  borderRadius: 14,
                                  paddingVertical: 18,
                                  paddingHorizontal: 14,
                                  borderTopWidth: 3,
                                  borderTopColor: "#6d28d9",
                                  elevation: 2,
                                  alignItems: "center",
                                  shadowColor: "#000",
                                  shadowOpacity: 0.06,
                                  shadowRadius: 6,
                                  shadowOffset: { width: 0, height: 2 },
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 11,
                                    fontWeight: "700",
                                    color: "#6d28d9",
                                    letterSpacing: 0.5,
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                  }}
                                >
                                  Total Weight
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 32,
                                    fontWeight: "800",
                                    color: "#1e293b",
                                    lineHeight: 36,
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: "#64748b",
                                    marginTop: 4,
                                  }}
                                >
                                  kg this shift
                                </Text>
                              </View>
                            </View>
                          ) : null}
                        </View>
                      );
                    })()}

                    {/* Input / Output section selector — positive marginTop so formCard does not overlap shift summary cards (formCard default marginTop: -20 is for hero overlap only) */}
                    {!selectedSection && !isShiftEnded && (
                      <View
                        style={[
                          styles.formCard,
                          { display: "flex", marginTop: 16 },
                        ]}
                      >
                        <View style={styles.selectionContainer}>
                          <Text style={styles.selectionTitle}>
                            Select Action
                          </Text>
                          <TouchableOpacity
                            style={styles.selectionCard}
                            onPress={() => setSelectedSection("input")}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: "#7c3aed" },
                              ]}
                            >
                              <Package color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>
                                Input
                              </Text>
                              <Text style={styles.selectionCardSub}>
                                Scan Boretech (Flakes PET) bag
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.selectionCard}
                            onPress={() => {
                              setWeightInput("");
                              setCapturedImages([]);
                              setSelectedSection("output");
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: "#7c3aed" },
                              ]}
                            >
                              <Package color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>
                                Output
                              </Text>
                              <Text style={styles.selectionCardSub}>
                                Log Pellet PET output bag
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {/* Input form — scan Boretech Flakes PET bag (Save/Back outside formCard) */}
                    {selectedSection === "input" && !isShiftEnded && (
                      <>
                        <View
                          style={[
                            styles.formCard,
                            { display: "flex", marginTop: 16 },
                          ]}
                        >
                          <Text style={styles.formTitle}>
                            Input — Scan Boretech Bag
                          </Text>
                          <View style={styles.searchContainer}>
                            <View style={styles.searchInputWrapper}>
                              <Search
                                size={20}
                                color="#666"
                                style={{ marginRight: 10 }}
                              />
                              <TextInput
                                style={styles.searchTextInput}
                                placeholder="Search Boretech bag ID..."
                                value={bagSearchQuery}
                                onChangeText={onBagSearch}
                                onFocus={handleBagSearchFocus}
                              />
                            </View>
                            {showSuggestions && (
                              <ScrollView
                                style={styles.suggestionsList}
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled
                              >
                                {suggestedBags.map((bag, i) => (
                                  <TouchableOpacity
                                    key={i}
                                    style={[
                                      styles.suggestionItem,
                                      i === suggestedBags.length - 1 && {
                                        borderBottomWidth: 0,
                                      },
                                    ]}
                                    onPress={() => {
                                      setSelectedInputBag(bag);
                                      setShowSuggestions(false);
                                      setBagSearchQuery("");
                                    }}
                                  >
                                    <View style={styles.suggestionLeftCol}>
                                      <Text
                                        style={styles.suggestionQrLine}
                                        numberOfLines={2}
                                        selectable
                                      >
                                        {getBagDisplayId(bag)}
                                      </Text>
                                      {bag.sub_line ? (
                                        <Text style={styles.suggestionSubLine}>
                                          {bag.sub_line}
                                        </Text>
                                      ) : null}
                                    </View>
                                    <Text style={styles.suggestionDetail}>
                                      {bag.weight} kg
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </ScrollView>
                            )}
                          </View>
                          <TouchableOpacity
                            style={[styles.scanButton, { marginBottom: 12 }]}
                            onPress={() => {
                              setScanned(false);
                              setShowScanner(true);
                            }}
                          >
                            <CameraIcon color="#17a34a" size={20} />
                            <Text style={styles.scanButtonText}>
                              Scan QR Code
                            </Text>
                          </TouchableOpacity>
                          {selectedInputBag && (
                            <View style={styles.petInputSelectedBagPanel}>
                              <View style={styles.petInputSelectedBagHeader}>
                                <Text style={styles.petInputSelectedBagLabel}>
                                  Selected bag
                                </Text>
                                <TouchableOpacity
                                  onPress={() => setSelectedInputBag(null)}
                                  accessibilityLabel="Clear selected bag"
                                  hitSlop={{
                                    top: 10,
                                    bottom: 10,
                                    left: 10,
                                    right: 10,
                                  }}
                                >
                                  <X color="#EB445A" size={22} />
                                </TouchableOpacity>
                              </View>
                              <View
                                style={styles.petInputSelectedBagFieldBlock}
                              >
                                <Text style={styles.petInputFieldCaption}>
                                  Bag ID (QR)
                                </Text>
                                <Text
                                  style={styles.petInputSelectedBagQr}
                                  selectable
                                >
                                  {getBagDisplayId(selectedInputBag)}
                                </Text>
                              </View>
                              <View
                                style={styles.petInputSelectedBagFieldBlock}
                              >
                                <Text style={styles.petInputFieldCaption}>
                                  Weight
                                </Text>
                                <Text style={styles.petInputSelectedBagWeight}>
                                  {(() => {
                                    const w = selectedInputBag.weight;
                                    const n =
                                      typeof w === "number"
                                        ? w
                                        : parseFloat(String(w));
                                    return Number.isFinite(n)
                                      ? n.toFixed(2)
                                      : String(w ?? "—");
                                  })()}{" "}
                                  kg
                                </Text>
                              </View>
                              <View style={styles.petInputSourceBadgeRow}>
                                <View
                                  style={[
                                    styles.logBadge,
                                    styles.petInputSourceBadgeWrap,
                                    { backgroundColor: "#EDE9FE" },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.logBadgeText,
                                      { color: "#7c3aed" },
                                    ]}
                                  >
                                    Flakes PET
                                  </Text>
                                </View>
                              </View>
                            </View>
                          )}
                        </View>
                        <View
                          style={{
                            marginHorizontal: 16,
                            marginTop: 4,
                            marginBottom: 12,
                            zIndex: 20,
                            elevation: 6,
                          }}
                        >
                          <TouchableOpacity
                            style={[
                              styles.primaryButton,
                              { marginTop: 0 },
                              !selectedInputBag && { opacity: 0.5 },
                            ]}
                            disabled={!selectedInputBag || isLoading}
                            onPress={async () => {
                              if (!selectedInputBag) return;
                              try {
                                setIsLoading(true);
                                if (!backendShiftId) {
                                  Alert.alert(
                                    t("common.error"),
                                    t("messages.noActiveShift"),
                                  );
                                  return;
                                }
                                const inputBagQr =
                                  selectedInputBag.output_bag_qr ??
                                  selectedInputBag.outputBagQr;
                                if (!inputBagQr) {
                                  Alert.alert(
                                    t("common.error"),
                                    "No QR found on selected bag.",
                                  );
                                  return;
                                }
                                // Starlinger input should consume upstream Boretech bag, not create a new PKG log row.
                                const response =
                                  await productionApi.updateLogStatus(
                                    inputBagQr,
                                    "Completed",
                                    undefined,
                                    undefined,
                                    selectedSubLine || "Pellet PET",
                                  );
                                if (response.data.success) {
                                  Alert.alert(
                                    t("common.success"),
                                    t("messages.materialProcessingStarted"),
                                  );
                                  setSelectedInputBag(null);
                                  setBagSearchQuery("");
                                  setSuggestedBags([]);
                                  setShowSuggestions(false);
                                  setSelectedSection(null);
                                  try {
                                    const logsRes =
                                      await productionApi.getShiftLogs(
                                        backendShiftId,
                                      );
                                    if (logsRes.data.success)
                                      setShiftLogs(logsRes.data.data);
                                  } catch (e) {
                                    console.error(e);
                                  }
                                  loadPetStarlingerLogs();
                                } else {
                                  Alert.alert(
                                    t("common.error"),
                                    response.data?.message ||
                                      t("messages.failedToStartProcessing"),
                                  );
                                }
                              } catch (error) {
                                console.error(
                                  "Starlinger input save error:",
                                  error,
                                );
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.failedToStartProcessing"),
                                );
                              } finally {
                                setIsLoading(false);
                              }
                            }}
                          >
                            <Text style={styles.primaryButtonText}>
                              Save & Start Processing
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.secondaryButton,
                              { marginTop: 8, marginBottom: 0 },
                            ]}
                            onPress={() => {
                              setSelectedSection(null);
                              setSelectedInputBag(null);
                              setBagSearchQuery("");
                              setSuggestedBags([]);
                              setShowSuggestions(false);
                            }}
                          >
                            <Text style={styles.secondaryButtonText}>
                              ← Back
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    )}

                    {/* Output — same layout as PET Boretech output */}
                    {selectedSection === "output" && (
                      <View
                        style={{ paddingHorizontal: 16, paddingBottom: 40 }}
                      >
                        <View style={styles.sublineBadgeWrapper}>
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#DCFCE7",
                                borderColor: "#86efac",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#15803d" },
                              ]}
                            >
                              Working on: {selectedSubLine || "Pellet PET"}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View
                              style={[
                                styles.typePill,
                                { backgroundColor: "#DCFCE7" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.typePillText,
                                  { color: "#15803D" },
                                ]}
                              >
                                OUTPUT
                              </Text>
                            </View>
                            <Text style={styles.sectionTitleText}>
                              Jumbo Bag
                            </Text>
                          </View>
                          <View style={styles.inputGroup}>
                            <Text style={styles.label}>Weight (kg)</Text>
                            <View style={styles.inputWithIcon}>
                              <TextInput
                                style={[
                                  styles.input,
                                  styles.inputWithIconPadding,
                                  { flex: 1 },
                                ]}
                                placeholder="Enter weight"
                                placeholderTextColor="#999"
                                keyboardType="decimal-pad"
                                value={weightInput}
                                onChangeText={handleWeightInputChange}
                              />
                              <TouchableOpacity style={styles.iconInsideInput}>
                                <Scale size={20} color="#666" />
                              </TouchableOpacity>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={handleTakePhoto}
                            accessibilityLabel="Take photo"
                          >
                            <CameraIcon size={20} color="#475569" />
                            <Text style={styles.secondaryButtonText}>
                              Take Photo
                            </Text>
                          </TouchableOpacity>
                          {capturedImages.length > 0 && (
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              style={styles.photosPreviewContainer}
                              contentContainerStyle={
                                styles.photosPreviewContent
                              }
                            >
                              {capturedImages.map((imageUri, index) => (
                                <View
                                  key={index}
                                  style={styles.photoPreviewItem}
                                >
                                  <Image
                                    source={{ uri: imageUri }}
                                    style={styles.photoPreviewThumbnail}
                                  />
                                  <TouchableOpacity
                                    style={styles.removePhotoButton}
                                    onPress={() =>
                                      setCapturedImages((prev) =>
                                        prev.filter((_, i) => i !== index),
                                      )
                                    }
                                  >
                                    <X size={16} color="#FFF" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </ScrollView>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.primaryButton,
                              (!isValidProductionWeightInput(weightInput) ||
                                isLoading ||
                                isShiftEnded) && {
                                opacity: 0.5,
                                backgroundColor: "#E2E8F0",
                              },
                            ]}
                            onPress={handleLogProduction}
                            disabled={
                              !isValidProductionWeightInput(weightInput) ||
                              isLoading ||
                              isShiftEnded
                            }
                          >
                            {isLoading ? (
                              <ActivityIndicator color="#666" />
                            ) : (
                              <PrinterIcon
                                size={20}
                                color={
                                  !isValidProductionWeightInput(weightInput) ||
                                  isShiftEnded
                                    ? "#94A3B8"
                                    : "#FFF"
                                }
                              />
                            )}
                            <Text
                              style={[
                                styles.primaryButtonText,
                                (!isValidProductionWeightInput(weightInput) ||
                                  isShiftEnded) && { color: "#94A3B8" },
                              ]}
                            >
                              Generate QR & Print
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.statsRow}>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {currentViewBags}
                            </Text>
                            <Text style={styles.statLabel}>Outputs</Text>
                          </View>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {currentViewWeight.toFixed(1)}
                            </Text>
                            <Text style={styles.statLabel}>Total kg</Text>
                          </View>
                        </View>
                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>
                            Shift Progress ({selectedSubLine || "Pellet PET"})
                          </Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Outputs this shift
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewBags} bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Total weight
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewWeight.toFixed(1)} kg
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.secondaryButton,
                            { marginTop: 8, marginBottom: 8 },
                          ]}
                          onPress={() => {
                            setSelectedSection(null);
                            setWeightInput("");
                            setCapturedImages([]);
                          }}
                          accessibilityLabel="Back to select action"
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Recent Entries — only on Select Action (no Input/Output drill-down) */}
                    {!selectedSection && (
                      <View
                        style={[
                          styles.crusherLogsSection,
                          { marginTop: 16, marginHorizontal: 16 },
                        ]}
                      >
                        <View style={styles.logsHeader}>
                          <Text style={styles.logsTitle}>Recent Entries</Text>
                        </View>
                        <View style={styles.datePickerContainer}>
                          <Text style={styles.datePickerLabel}>
                            Select Date:
                          </Text>
                          <StationDatePicker
                            value={parseDateLocal(petStarlingerSelectedDate)}
                            onChange={(date) => {
                              setPetStarlingerSelectedDate(
                                formatDateLocal(date),
                              );
                              setPetStarlingerCurrentPage(1);
                            }}
                            maximumDate={maxDate}
                          />
                        </View>
                        <View style={styles.searchBox}>
                          <Search size={18} color="#64748b" />
                          <TextInput
                            style={styles.searchInput}
                            placeholder="Search by QR code..."
                            value={petStarlingerSearchQuery}
                            onChangeText={(text) => {
                              setPetStarlingerSearchQuery(text);
                              setPetStarlingerCurrentPage(1);
                            }}
                            placeholderTextColor="#94a3b8"
                            returnKeyType="search"
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                          />
                          {petStarlingerSearchQuery.length > 0 && (
                            <TouchableOpacity
                              onPress={() => {
                                setPetStarlingerSearchQuery("");
                                setPetStarlingerCurrentPage(1);
                              }}
                              style={styles.clearButton}
                            >
                              <X size={16} color="#64748b" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.filtersContainer}>
                          <View style={styles.filterGroup}>
                            <Text style={styles.filterLabel}>Status:</Text>
                            <View style={styles.filterButtons}>
                              {(["all", "pending", "Completed"] as const).map(
                                (s) => (
                                  <TouchableOpacity
                                    key={s}
                                    style={[
                                      styles.filterButton,
                                      petStarlingerStatusFilter === s &&
                                        styles.filterButtonActive,
                                    ]}
                                    onPress={() => {
                                      setPetStarlingerStatusFilter(s);
                                      setPetStarlingerCurrentPage(1);
                                    }}
                                  >
                                    <Text
                                      style={[
                                        styles.filterButtonText,
                                        petStarlingerStatusFilter === s &&
                                          styles.filterButtonTextActive,
                                      ]}
                                    >
                                      {s === "all"
                                        ? "All"
                                        : s === "pending"
                                          ? "Pending"
                                          : "Complete"}
                                    </Text>
                                  </TouchableOpacity>
                                ),
                              )}
                            </View>
                          </View>
                        </View>
                        {petStarlingerLogsLoading ? (
                          <View style={styles.loadingState}>
                            <ActivityIndicator size="large" color="#7c3aed" />
                            <Text style={styles.loadingText}>
                              Loading entries...
                            </Text>
                          </View>
                        ) : petStarlingerLogs.length > 0 ? (
                          <View style={styles.logsList}>
                            {petStarlingerLogs.map(
                              (log: any, index: number) => (
                                <View
                                  key={log.id || index}
                                  style={styles.logItem}
                                >
                                  <View style={styles.logMain}>
                                    <Text style={styles.logQr}>
                                      {log.output_bag_qr ||
                                        log.outputBagQr ||
                                        "—"}
                                    </Text>
                                    <View style={styles.logDetails}>
                                      <Text style={styles.logWeight}>
                                        {log.weight} kg
                                      </Text>
                                      <Text style={styles.logTime}>
                                        {new Date(
                                          log.created_at,
                                        ).toLocaleString()}
                                      </Text>
                                    </View>
                                    <View style={styles.logStatusRow}>
                                      <View
                                        style={[
                                          styles.statusBadge,
                                          {
                                            backgroundColor:
                                              log.status === "pending"
                                                ? "#FEF3C7"
                                                : log.status === "hold"
                                                ? "#FFEDD5"
                                                : log.status === "reject"
                                                ? "#FEE2E2"
                                                : "#DCFCE7",
                                          },
                                        ]}
                                      >
                                        <Text
                                          style={[
                                            styles.statusBadgeText,
                                            {
                                              color:
                                                log.status === "pending"
                                                  ? "#D97706"
                                                  : log.status === "hold"
                                                  ? "#92400E"
                                                  : log.status === "reject"
                                                  ? "#B91C1C"
                                                  : "#15803D",
                                            },
                                          ]}
                                        >
                                          {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                        </Text>
                                      </View>
                                    </View>
                                  </View>
                                  <View style={styles.logActions}>
                                    {(canEditAnyStatus ||
                                      log.status === "pending") && (
                                      <TouchableOpacity
                                        style={styles.editIconButton}
                                        onPress={() => openEditLogWeight(log)}
                                      >
                                        <Pencil color="#0ea5e9" size={18} />
                                      </TouchableOpacity>
                                    )}
                                    {isPE && log.status === "hold" && (
                                      <>
                                        <TouchableOpacity
                                          style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                          onPress={() => openPeResolveModal(log)}
                                        >
                                          <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                          style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                          onPress={() => openPeResolveModal(log)}
                                        >
                                          <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                        </TouchableOpacity>
                                      </>
                                    )}
                                    <TouchableOpacity
                                      style={styles.printIconButton}
                                      onPress={() => {
                                        setSelectedLogForPrint(log);
                                        setShowListPrintPreview(true);
                                      }}
                                    >
                                      <PrinterIcon color="#7c3aed" size={20} />
                                    </TouchableOpacity>
                                    <View
                                      style={[
                                        styles.logBadge,
                                        { backgroundColor: "#EDE9FE" },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.logBadgeText,
                                          { color: "#7c3aed" },
                                        ]}
                                      >
                                        Pellet PET
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                              ),
                            )}
                          </View>
                        ) : (
                          <View style={styles.emptyState}>
                            <Package size={48} color="#94a3b8" opacity={0.5} />
                            <Text style={styles.emptyText}>
                              No entries found for this date
                            </Text>
                          </View>
                        )}
                        {petStarlingerTotalPages > 1 && (
                          <View style={styles.pagination}>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                petStarlingerCurrentPage === 1 &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                setPetStarlingerCurrentPage(
                                  Math.max(1, petStarlingerCurrentPage - 1),
                                )
                              }
                              disabled={petStarlingerCurrentPage === 1}
                            >
                              <ChevronLeft
                                color={
                                  petStarlingerCurrentPage === 1
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                                size={18}
                              />
                            </TouchableOpacity>
                            <View style={styles.pageInfoBox}>
                              <Text style={styles.pageInfoMain}>
                                {petStarlingerCurrentPage} /{" "}
                                {petStarlingerTotalPages}
                              </Text>
                              <Text style={styles.pageInfoSub}>
                                {petStarlingerTotalLogs} total
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.pageBtn,
                                petStarlingerCurrentPage ===
                                  petStarlingerTotalPages &&
                                  styles.pageBtnDisabled,
                              ]}
                              onPress={() =>
                                setPetStarlingerCurrentPage(
                                  Math.min(
                                    petStarlingerTotalPages,
                                    petStarlingerCurrentPage + 1,
                                  ),
                                )
                              }
                              disabled={
                                petStarlingerCurrentPage ===
                                petStarlingerTotalPages
                              }
                            >
                              <ChevronRight
                                color={
                                  petStarlingerCurrentPage ===
                                  petStarlingerTotalPages
                                    ? "#cbd5e1"
                                    : "#475569"
                                }
                                size={18}
                              />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                ) : isPET && isPetFinalPackingLine(selectedStation) ? (
                  <>
                    <View
                      style={[
                        styles.stationHero,
                        {
                          backgroundColor: selectedStation.color,
                          paddingBottom: 20,
                          marginBottom: 0,
                        },
                      ]}
                    >
                      <View style={styles.heroHeader}>
                        <View style={styles.heroIconCircle}>
                          {renderStationIcon(
                            selectedStation.name,
                            selectedStation.color,
                          )}
                        </View>
                        <View style={{ marginLeft: 15, flex: 1 }}>
                          <Text style={styles.heroTitle}>
                            {(selectedStation as any).displayName ||
                              "Final Packing"}
                          </Text>
                          <Text style={styles.heroDesc}>
                            PET — Input from Boretech (flakes) or Starlinger
                            (pellets), then Final PET output
                          </Text>
                        </View>
                      </View>
                    </View>

                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginTop: 4,
                          marginBottom: 4,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}

                    {(() => {
                      const finalLogs = shiftLogs.filter(
                        (l: any) =>
                          shiftLogMatchesStationShiftMaterial(
                            l,
                            selectedStation.id,
                            backendShiftId,
                            user?.materialTypeId ?? null,
                          ) && l.sub_line === "Final PET",
                      );
                      const totalBags = finalLogs.length;
                      const totalKg = finalLogs.reduce(
                        (s: number, l: any) => s + (parseFloat(l.weight) || 0),
                        0,
                      );
                      return (
                        <View
                          style={{
                            marginHorizontal: 16,
                            marginTop: 12,
                            marginBottom: 4,
                          }}
                        >
                          <View
                            style={{
                              backgroundColor: "#1e293b",
                              borderRadius: 14,
                              paddingVertical: 14,
                              paddingHorizontal: 18,
                              marginBottom: 10,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#94a3b8",
                                letterSpacing: 0.3,
                              }}
                            >
                              Final Packing — This Shift (Final PET)
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 16,
                              }}
                            >
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 22,
                                    fontWeight: "800",
                                    color: "#fff",
                                    lineHeight: 26,
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  bags
                                </Text>
                              </View>
                              <View
                                style={{
                                  width: 1,
                                  height: 32,
                                  backgroundColor: "#334155",
                                }}
                              />
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 22,
                                    fontWeight: "800",
                                    color: "#fff",
                                    lineHeight: 26,
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  kg
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>
                      );
                    })()}

                    {!selectedSection && !isShiftEnded && (
                      <View style={[styles.formCard, { display: "flex" }]}>
                        <View style={styles.selectionContainer}>
                          <Text style={styles.selectionTitle}>
                            Select Action
                          </Text>
                          <TouchableOpacity
                            style={styles.selectionCard}
                            onPress={() => {
                              setSelectedSection("input");
                              setSelectedInputBag(null);
                              setBagSearchQuery("");
                              setSuggestedBags([]);
                              setShowSuggestions(false);
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: "#059669" },
                              ]}
                            >
                              <Package color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>
                                Input
                              </Text>
                              <Text style={styles.selectionCardSub}>
                                Scan Boretech (Flakes PET) or Starlinger (Pellet
                                PET) bag
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.selectionCard}
                            onPress={() => {
                              setWeightInput("");
                              setCapturedImages([]);
                              setSelectedSection("output");
                            }}
                          >
                            <View
                              style={[
                                styles.selectionIconBox,
                                { backgroundColor: "#047857" },
                              ]}
                            >
                              <Package color="#FFF" size={28} />
                            </View>
                            <View style={styles.selectionText}>
                              <Text style={styles.selectionCardTitle}>
                                Output
                              </Text>
                              <Text style={styles.selectionCardSub}>
                                Log Final PET output bag
                              </Text>
                            </View>
                            <ChevronRight color="#CCC" size={24} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {selectedSection === "input" && !isShiftEnded && (
                      <View style={[styles.formCard, { display: "flex" }]}>
                        <Text style={styles.formTitle}>
                          Input — Boretech or Starlinger bag
                        </Text>
                        <View style={styles.searchContainer}>
                          <View style={styles.searchInputWrapper}>
                            <Search
                              size={20}
                              color="#666"
                              style={{ marginRight: 10 }}
                            />
                            <TextInput
                              style={styles.searchTextInput}
                              placeholder="Search Flakes PET or Pellet PET bag…"
                              value={bagSearchQuery}
                              onChangeText={onBagSearch}
                              onFocus={handleBagSearchFocus}
                            />
                          </View>
                          {showSuggestions && (
                            <ScrollView
                              style={styles.suggestionsList}
                              keyboardShouldPersistTaps="handled"
                              nestedScrollEnabled
                            >
                              {suggestedBags.map((bag, i) => (
                                <TouchableOpacity
                                  key={i}
                                  style={[
                                    styles.suggestionItem,
                                    i === suggestedBags.length - 1 && {
                                      borderBottomWidth: 0,
                                    },
                                  ]}
                                  onPress={() => {
                                    setSelectedInputBag(bag);
                                    setShowSuggestions(false);
                                    setBagSearchQuery("");
                                  }}
                                >
                                  <View style={styles.suggestionLeftCol}>
                                    <Text
                                      style={styles.suggestionQrLine}
                                      numberOfLines={2}
                                      selectable
                                    >
                                      {getBagDisplayId(bag)}
                                    </Text>
                                    {(bag as any).pet_upstream_source ? (
                                      <Text style={styles.suggestionSubLine}>
                                        {(bag as any).pet_upstream_source}
                                        {bag.sub_line
                                          ? ` · ${bag.sub_line}`
                                          : ""}
                                      </Text>
                                    ) : bag.sub_line ? (
                                      <Text style={styles.suggestionSubLine}>
                                        {bag.sub_line}
                                      </Text>
                                    ) : null}
                                  </View>
                                  <Text style={styles.suggestionDetail}>
                                    {bag.weight} kg
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          )}
                        </View>
                        <TouchableOpacity
                          style={[styles.scanButton, { marginBottom: 12 }]}
                          onPress={() => {
                            setScanned(false);
                            setShowScanner(true);
                          }}
                        >
                          <CameraIcon color="#17a34a" size={20} />
                          <Text style={styles.scanButtonText}>
                            Scan QR Code
                          </Text>
                        </TouchableOpacity>
                        {selectedInputBag && (
                          <View style={styles.petInputSelectedBagPanel}>
                            <View style={styles.petInputSelectedBagHeader}>
                              <Text style={styles.petInputSelectedBagLabel}>
                                Selected bag
                              </Text>
                              <TouchableOpacity
                                onPress={() => setSelectedInputBag(null)}
                                accessibilityLabel="Clear selected bag"
                                hitSlop={{
                                  top: 10,
                                  bottom: 10,
                                  left: 10,
                                  right: 10,
                                }}
                              >
                                <X color="#EB445A" size={22} />
                              </TouchableOpacity>
                            </View>
                            <View style={styles.petInputSelectedBagFieldBlock}>
                              <Text style={styles.petInputFieldCaption}>
                                Bag ID (QR)
                              </Text>
                              <Text
                                style={styles.petInputSelectedBagQr}
                                selectable
                              >
                                {getBagDisplayId(selectedInputBag)}
                              </Text>
                            </View>
                            <View style={styles.petInputSelectedBagFieldBlock}>
                              <Text style={styles.petInputFieldCaption}>
                                Weight
                              </Text>
                              <Text style={styles.petInputSelectedBagWeight}>
                                {(() => {
                                  const w = selectedInputBag.weight;
                                  const n =
                                    typeof w === "number"
                                      ? w
                                      : parseFloat(String(w));
                                  return Number.isFinite(n)
                                    ? n.toFixed(2)
                                    : String(w ?? "—");
                                })()}{" "}
                                kg
                              </Text>
                            </View>
                            {(selectedInputBag as any).pet_upstream_source ? (
                              <View style={styles.petInputSourceBadgeRow}>
                                <View
                                  style={[
                                    styles.logBadge,
                                    styles.petInputSourceBadgeWrap,
                                    { backgroundColor: "#D1FAE5" },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.logBadgeText,
                                      { color: "#047857" },
                                    ]}
                                  >
                                    {
                                      (selectedInputBag as any)
                                        .pet_upstream_source
                                    }
                                    {(selectedInputBag as any).sub_line
                                      ? ` · ${(selectedInputBag as any).sub_line}`
                                      : ""}
                                  </Text>
                                </View>
                              </View>
                            ) : (selectedInputBag as any).sub_line ? (
                              <View style={styles.petInputSourceBadgeRow}>
                                <View
                                  style={[
                                    styles.logBadge,
                                    styles.petInputSourceBadgeWrap,
                                    { backgroundColor: "#D1FAE5" },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.logBadgeText,
                                      { color: "#047857" },
                                    ]}
                                  >
                                    {(selectedInputBag as any).sub_line}
                                  </Text>
                                </View>
                              </View>
                            ) : null}
                          </View>
                        )}
                        <TouchableOpacity
                          style={[
                            styles.primaryButton,
                            { marginTop: selectedInputBag ? 12 : 4 },
                            !selectedInputBag && { opacity: 0.5 },
                          ]}
                          disabled={!selectedInputBag || isLoading}
                          onPress={async () => {
                            if (!selectedInputBag) return;
                            try {
                              setIsLoading(true);
                              if (!backendShiftId) {
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.noActiveShift"),
                                );
                                return;
                              }
                              const inputBagQr =
                                selectedInputBag.output_bag_qr ??
                                selectedInputBag.outputBagQr;
                              if (!inputBagQr) {
                                Alert.alert(
                                  t("common.error"),
                                  "No QR found on selected bag.",
                                );
                                return;
                              }
                              // Final Packing input should consume upstream bag, not create a new PKG "Processing" output row.
                              const response =
                                await productionApi.updateLogStatus(
                                  inputBagQr,
                                  "Completed",
                                  undefined,
                                  undefined,
                                  selectedSubLine || "Final PET",
                                );
                              if (response.data.success) {
                                Alert.alert(
                                  t("common.success"),
                                  t("messages.materialProcessingStarted"),
                                );
                                setSelectedInputBag(null);
                                setBagSearchQuery("");
                                setSuggestedBags([]);
                                setShowSuggestions(false);
                                setSelectedSection(null);
                                try {
                                  const logsRes =
                                    await productionApi.getShiftLogs(
                                      backendShiftId,
                                    );
                                  if (logsRes.data.success)
                                    setShiftLogs(logsRes.data.data);
                                } catch (e) {
                                  console.error(e);
                                }
                                loadPetFinalPackingLogs();
                              } else {
                                Alert.alert(
                                  t("common.error"),
                                  response.data?.message ||
                                    t("messages.failedToStartProcessing"),
                                );
                              }
                            } catch (error) {
                              console.error(
                                "Final Packing input save error:",
                                error,
                              );
                              Alert.alert(
                                t("common.error"),
                                t("messages.failedToStartProcessing"),
                              );
                            } finally {
                              setIsLoading(false);
                            }
                          }}
                        >
                          <Text style={styles.primaryButtonText}>
                            Save & Start Processing
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.secondaryButton, { marginTop: 8 }]}
                          onPress={() => {
                            setSelectedSection(null);
                            setSelectedInputBag(null);
                            setBagSearchQuery("");
                            setSuggestedBags([]);
                            setShowSuggestions(false);
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {selectedSection === "output" && (
                      <View
                        style={{ paddingHorizontal: 16, paddingBottom: 24 }}
                      >
                        <View style={styles.sublineBadgeWrapper}>
                          <View
                            style={[
                              styles.sublineBadge,
                              {
                                backgroundColor: "#DCFCE7",
                                borderColor: "#86efac",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sublineBadgeText,
                                { color: "#15803d" },
                              ]}
                            >
                              Working on: {selectedSubLine || "Final PET"}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.sectionCard}>
                          <View style={styles.sectionHeaderRow}>
                            <View
                              style={[
                                styles.typePill,
                                { backgroundColor: "#DCFCE7" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.typePillText,
                                  { color: "#15803D" },
                                ]}
                              >
                                OUTPUT
                              </Text>
                            </View>
                            <Text style={styles.sectionTitleText}>
                              Jumbo Bag
                            </Text>
                          </View>
                          <View style={styles.inputGroup}>
                            <Text style={styles.label}>Weight (kg)</Text>
                            <View style={styles.inputWithIcon}>
                              <TextInput
                                style={[
                                  styles.input,
                                  styles.inputWithIconPadding,
                                  { flex: 1 },
                                ]}
                                placeholder="Enter weight"
                                placeholderTextColor="#999"
                                keyboardType="decimal-pad"
                                value={weightInput}
                                onChangeText={handleWeightInputChange}
                              />
                              <TouchableOpacity style={styles.iconInsideInput}>
                                <Scale size={20} color="#666" />
                              </TouchableOpacity>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={handleTakePhoto}
                          >
                            <CameraIcon size={20} color="#475569" />
                            <Text style={styles.secondaryButtonText}>
                              Take Photo
                            </Text>
                          </TouchableOpacity>
                          {capturedImages.length > 0 && (
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              style={styles.photosPreviewContainer}
                              contentContainerStyle={
                                styles.photosPreviewContent
                              }
                            >
                              {capturedImages.map((imageUri, index) => (
                                <View
                                  key={index}
                                  style={styles.photoPreviewItem}
                                >
                                  <Image
                                    source={{ uri: imageUri }}
                                    style={styles.photoPreviewThumbnail}
                                  />
                                  <TouchableOpacity
                                    style={styles.removePhotoButton}
                                    onPress={() =>
                                      setCapturedImages((prev) =>
                                        prev.filter((_, i) => i !== index),
                                      )
                                    }
                                  >
                                    <X size={16} color="#FFF" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </ScrollView>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.primaryButton,
                              (!isValidProductionWeightInput(weightInput) ||
                                isLoading ||
                                isShiftEnded) && {
                                opacity: 0.5,
                                backgroundColor: "#E2E8F0",
                              },
                            ]}
                            onPress={handleLogProduction}
                            disabled={
                              !isValidProductionWeightInput(weightInput) ||
                              isLoading ||
                              isShiftEnded
                            }
                          >
                            {isLoading ? (
                              <ActivityIndicator color="#666" />
                            ) : (
                              <PrinterIcon
                                size={20}
                                color={
                                  !isValidProductionWeightInput(weightInput) ||
                                  isShiftEnded
                                    ? "#94A3B8"
                                    : "#FFF"
                                }
                              />
                            )}
                            <Text
                              style={[
                                styles.primaryButtonText,
                                (!isValidProductionWeightInput(weightInput) ||
                                  isShiftEnded) && { color: "#94A3B8" },
                              ]}
                            >
                              Generate QR & Print
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.statsRow}>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {currentViewBags}
                            </Text>
                            <Text style={styles.statLabel}>Outputs</Text>
                          </View>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {currentViewWeight.toFixed(1)}
                            </Text>
                            <Text style={styles.statLabel}>Total kg</Text>
                          </View>
                        </View>
                        <View style={styles.progressCardRedesign}>
                          <Text style={styles.progressTitleRedesign}>
                            Shift Progress ({selectedSubLine || "Final PET"})
                          </Text>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Outputs this shift
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewBags} bags
                            </Text>
                          </View>
                          <View style={styles.progressDataRow}>
                            <Text style={styles.progressDataLabel}>
                              Total weight
                            </Text>
                            <Text style={styles.progressDataValue}>
                              {currentViewWeight.toFixed(1)} kg
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.secondaryButton,
                            { marginTop: 8, marginBottom: 8 },
                          ]}
                          onPress={() => {
                            setSelectedSection(null);
                            setWeightInput("");
                            setCapturedImages([]);
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {selectedSection !== "input" &&
                      selectedSection !== "output" && (
                        <View
                          style={[
                            styles.crusherLogsSection,
                            { marginTop: 16, marginHorizontal: 16 },
                          ]}
                        >
                          <View style={styles.logsHeader}>
                            <Text style={styles.logsTitle}>Recent Entries</Text>
                          </View>
                          <View style={styles.datePickerContainer}>
                            <Text style={styles.datePickerLabel}>
                              Select Date:
                            </Text>
                            <StationDatePicker
                              value={parseDateLocal(
                                petFinalPackingSelectedDate,
                              )}
                              onChange={(date) => {
                                setPetFinalPackingSelectedDate(
                                  formatDateLocal(date),
                                );
                                setPetFinalPackingCurrentPage(1);
                              }}
                              maximumDate={maxDate}
                            />
                          </View>
                          <View style={styles.searchBox}>
                            <Search size={18} color="#64748b" />
                            <TextInput
                              style={styles.searchInput}
                              placeholder="Search by QR code..."
                              value={petFinalPackingSearchQuery}
                              onChangeText={(text) => {
                                setPetFinalPackingSearchQuery(text);
                                setPetFinalPackingCurrentPage(1);
                              }}
                              placeholderTextColor="#94a3b8"
                              returnKeyType="search"
                              autoCorrect={false}
                              autoCapitalize="none"
                              spellCheck={false}
                            />
                            {petFinalPackingSearchQuery.length > 0 && (
                              <TouchableOpacity
                                onPress={() => {
                                  setPetFinalPackingSearchQuery("");
                                  setPetFinalPackingCurrentPage(1);
                                }}
                                style={styles.clearButton}
                              >
                                <X size={16} color="#64748b" />
                              </TouchableOpacity>
                            )}
                          </View>
                          <View style={styles.filtersContainer}>
                            <View style={styles.filterGroup}>
                              <Text style={styles.filterLabel}>Status:</Text>
                              <View style={styles.filterButtons}>
                                {(["all", "pending", "Completed"] as const).map(
                                  (s) => (
                                    <TouchableOpacity
                                      key={s}
                                      style={[
                                        styles.filterButton,
                                        petFinalPackingStatusFilter === s &&
                                          styles.filterButtonActive,
                                      ]}
                                      onPress={() => {
                                        setPetFinalPackingStatusFilter(s);
                                        setPetFinalPackingCurrentPage(1);
                                      }}
                                    >
                                      <Text
                                        style={[
                                          styles.filterButtonText,
                                          petFinalPackingStatusFilter === s &&
                                            styles.filterButtonTextActive,
                                        ]}
                                      >
                                        {s === "all"
                                          ? "All"
                                          : s === "pending"
                                            ? "Pending"
                                            : "Complete"}
                                      </Text>
                                    </TouchableOpacity>
                                  ),
                                )}
                              </View>
                            </View>
                          </View>
                          {petFinalPackingLogsLoading ? (
                            <View style={styles.loadingState}>
                              <ActivityIndicator size="large" color="#059669" />
                              <Text style={styles.loadingText}>
                                Loading entries...
                              </Text>
                            </View>
                          ) : petFinalPackingLogs.length > 0 ? (
                            <View style={styles.logsList}>
                              {petFinalPackingLogs.map(
                                (log: any, index: number) => (
                                  <View
                                    key={log.id || index}
                                    style={styles.logItem}
                                  >
                                    <View style={styles.logMain}>
                                      <Text style={styles.logQr}>
                                        {log.output_bag_qr ||
                                          log.outputBagQr ||
                                          "—"}
                                      </Text>
                                      <View style={styles.logDetails}>
                                        <Text style={styles.logWeight}>
                                          {log.weight} kg
                                        </Text>
                                        <Text style={styles.logTime}>
                                          {new Date(
                                            log.created_at,
                                          ).toLocaleString()}
                                        </Text>
                                      </View>
                                      <View style={styles.logStatusRow}>
                                        <View
                                          style={[
                                            styles.statusBadge,
                                            {
                                              backgroundColor:
                                                log.status === "pending"
                                                  ? "#FEF3C7"
                                                  : log.status === "hold"
                                                  ? "#FFEDD5"
                                                  : log.status === "reject"
                                                  ? "#FEE2E2"
                                                  : "#DCFCE7",
                                            },
                                          ]}
                                        >
                                          <Text
                                            style={[
                                              styles.statusBadgeText,
                                              {
                                                color:
                                                  log.status === "pending"
                                                    ? "#D97706"
                                                    : log.status === "hold"
                                                    ? "#92400E"
                                                    : log.status === "reject"
                                                    ? "#B91C1C"
                                                    : "#15803D",
                                              },
                                            ]}
                                          >
                                            {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                          </Text>
                                        </View>
                                      </View>
                                    </View>
                                    <View style={styles.logActions}>
                                      {(canEditAnyStatus ||
                                        log.status === "pending") && (
                                        <TouchableOpacity
                                          style={styles.editIconButton}
                                          onPress={() => openEditLogWeight(log)}
                                        >
                                          <Pencil color="#0ea5e9" size={18} />
                                        </TouchableOpacity>
                                      )}
                                      {isPE && log.status === "hold" && (
                                        <>
                                          <TouchableOpacity
                                            style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                            onPress={() => openPeResolveModal(log)}
                                          >
                                            <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                          </TouchableOpacity>
                                          <TouchableOpacity
                                            style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                            onPress={() => openPeResolveModal(log)}
                                          >
                                            <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                          </TouchableOpacity>
                                        </>
                                      )}
                                      <TouchableOpacity
                                        style={styles.printIconButton}
                                        onPress={() => {
                                          setSelectedLogForPrint(log);
                                          setShowListPrintPreview(true);
                                        }}
                                      >
                                        <PrinterIcon
                                          color="#059669"
                                          size={20}
                                        />
                                      </TouchableOpacity>
                                      <View
                                        style={[
                                          styles.logBadge,
                                          { backgroundColor: "#D1FAE5" },
                                        ]}
                                      >
                                        <Text
                                          style={[
                                            styles.logBadgeText,
                                            { color: "#047857" },
                                          ]}
                                        >
                                          Final PET
                                        </Text>
                                      </View>
                                    </View>
                                  </View>
                                ),
                              )}
                            </View>
                          ) : (
                            <View style={styles.emptyState}>
                              <Package
                                size={48}
                                color="#94a3b8"
                                opacity={0.5}
                              />
                              <Text style={styles.emptyText}>
                                No entries found for this date
                              </Text>
                            </View>
                          )}
                          {petFinalPackingTotalPages > 1 && (
                            <View style={styles.pagination}>
                              <TouchableOpacity
                                style={[
                                  styles.pageBtn,
                                  petFinalPackingCurrentPage === 1 &&
                                    styles.pageBtnDisabled,
                                ]}
                                onPress={() =>
                                  setPetFinalPackingCurrentPage(
                                    Math.max(1, petFinalPackingCurrentPage - 1),
                                  )
                                }
                                disabled={petFinalPackingCurrentPage === 1}
                              >
                                <ChevronLeft
                                  color={
                                    petFinalPackingCurrentPage === 1
                                      ? "#cbd5e1"
                                      : "#475569"
                                  }
                                  size={18}
                                />
                              </TouchableOpacity>
                              <View style={styles.pageInfoBox}>
                                <Text style={styles.pageInfoMain}>
                                  {petFinalPackingCurrentPage} /{" "}
                                  {petFinalPackingTotalPages}
                                </Text>
                                <Text style={styles.pageInfoSub}>
                                  {petFinalPackingTotalLogs} total
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[
                                  styles.pageBtn,
                                  petFinalPackingCurrentPage ===
                                    petFinalPackingTotalPages &&
                                    styles.pageBtnDisabled,
                                ]}
                                onPress={() =>
                                  setPetFinalPackingCurrentPage(
                                    Math.min(
                                      petFinalPackingTotalPages,
                                      petFinalPackingCurrentPage + 1,
                                    ),
                                  )
                                }
                                disabled={
                                  petFinalPackingCurrentPage ===
                                  petFinalPackingTotalPages
                                }
                              >
                                <ChevronRight
                                  color={
                                    petFinalPackingCurrentPage ===
                                    petFinalPackingTotalPages
                                      ? "#cbd5e1"
                                      : "#475569"
                                  }
                                  size={18}
                                />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                  </>
                ) : (
                  /* ── Generic rendering: PC/PE Washing, Re-Packaging, and all other stations ── */
                  <>
                    <View
                      style={[
                        styles.stationHero,
                        { backgroundColor: selectedStation.color },
                      ]}
                    >
                      <View style={styles.heroHeader}>
                        {renderStationIcon(
                          selectedStation.name,
                          selectedStation.color,
                        )}
                        <View style={{ marginLeft: 15, flex: 1 }}>
                          <Text style={styles.heroTitle}>
                            {selectedStation.name}
                          </Text>
                          <Text style={styles.heroDesc}>
                            {selectedStation.description}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {isShiftEnded && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FEF2F2",
                          borderRadius: 10,
                          padding: 12,
                          marginHorizontal: 16,
                          marginTop: 12,
                          marginBottom: 4,
                          borderWidth: 1,
                          borderColor: "#FECACA",
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: "#EF4444",
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#DC2626",
                          }}
                        >
                          Shift Ended — View Only
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#7f1d1d",
                            marginLeft: 6,
                          }}
                        >
                          New input/output is disabled.
                        </Text>
                      </View>
                    )}
                    <View
                      style={[
                        styles.formCard,
                        { display: isShiftEnded ? "none" : "flex" },
                      ]}
                    >
                      {selectedSection === "input" ? (
                        <View>
                          <Text style={styles.formTitle}>
                            {isPelletPackingStation(selectedStation)
                              ? "Input — Scan Final Packing or Extrusion Bag"
                              : isPET
                                ? "Input — Scan Crusher Rapid PET Bag"
                                : "Input Material"}
                          </Text>
                          <View style={styles.searchContainer}>
                            <View style={styles.searchInputWrapper}>
                              <Search
                                size={20}
                                color="#666"
                                style={{ marginRight: 10 }}
                              />
                              <TextInput
                                style={styles.searchTextInput}
                                placeholder="Search ID..."
                                value={bagSearchQuery}
                                onChangeText={onBagSearch}
                                onFocus={handleBagSearchFocus}
                              />
                            </View>
                            {showSuggestions && (
                              <ScrollView
                                style={styles.suggestionsList}
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled
                              >
                                {suggestedBags.map((bag, i) => (
                                  <TouchableOpacity
                                    key={i}
                                    style={[
                                      styles.suggestionItem,
                                      i === suggestedBags.length - 1 && {
                                        borderBottomWidth: 0,
                                      },
                                    ]}
                                    onPress={() => {
                                      setSelectedInputBag(bag);
                                      setShowSuggestions(false);
                                      setBagSearchQuery("");
                                    }}
                                  >
                                    <View style={styles.suggestionLeftCol}>
                                      <Text
                                        style={styles.suggestionQrLine}
                                        numberOfLines={2}
                                        selectable
                                      >
                                        {getBagDisplayId(bag)}
                                      </Text>
                                      {bag.sub_line ? (
                                        <Text style={styles.suggestionSubLine}>
                                          {bag.sub_line}
                                        </Text>
                                      ) : null}
                                    </View>
                                    <Text style={styles.suggestionDetail}>
                                      {bag.weight} kg
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </ScrollView>
                            )}
                          </View>
                          <TouchableOpacity
                            style={styles.scanButton}
                            onPress={() => {
                              setScanned(false);
                              setShowScanner(true);
                            }}
                          >
                            <CameraIcon color="#17a34a" size={20} />
                            <Text style={styles.scanButtonText}>
                              Scan QR Code
                            </Text>
                          </TouchableOpacity>
                          {selectedInputBag && (
                            <View style={styles.selectedBagCard}>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: "#64748b",
                                    marginBottom: 2,
                                  }}
                                >
                                  {t("dashboard.jumboId")}
                                </Text>
                                <Text
                                  style={[
                                    styles.selectedBagId,
                                    { minWidth: 0 },
                                  ]}
                                  numberOfLines={2}
                                  selectable
                                >
                                  {getBagDisplayId(selectedInputBag)}
                                </Text>
                                {(selectedInputBag as any).sub_line ? (
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      color: "#64748b",
                                      marginTop: 4,
                                    }}
                                  >
                                    {t("dashboard.lineLabel")}:{" "}
                                    {(selectedInputBag as any).sub_line}
                                  </Text>
                                ) : null}
                                <Text style={styles.selectedBagWeight}>
                                  {selectedInputBag.weight} kg
                                </Text>
                              </View>
                              <TouchableOpacity
                                onPress={() => setSelectedInputBag(null)}
                              >
                                <X color="#EB445A" size={20} />
                              </TouchableOpacity>
                            </View>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.primaryButton,
                              !selectedInputBag && { opacity: 0.5 },
                            ]}
                            disabled={!selectedInputBag || isLoading}
                            onPress={async () => {
                              if (!selectedInputBag || !selectedStation) return;
                              try {
                                setIsLoading(true);
                                // Check if this is washing station by name or code (more robust than ID)
                                const isWashingStation =
                                  selectedStation.name
                                    ?.toLowerCase()
                                    .includes("washing") ||
                                  selectedStation.code === "WSH" ||
                                  selectedStation.id === 3;

                                // Check if this is Final Packaging station
                                const isFinalPackaging =
                                  selectedStation?.id === 5 ||
                                  selectedStation?.name
                                    ?.toLowerCase()
                                    .includes("final") ||
                                  selectedStation?.name
                                    ?.toLowerCase()
                                    .includes("re-packaging");

                                // If this is washing station, ONLY update the existing crusher batch (NO new entry)
                                if (
                                  isWashingStation &&
                                  selectedInputBag.output_bag_qr
                                ) {
                                  // Pass the selected washing line name (e.g., "Washing 1", "Washing 2", "Washing 3")
                                  const washingLine =
                                    selectedSubLine || undefined;
                                  const response =
                                    await productionApi.updateLogStatus(
                                      selectedInputBag.output_bag_qr,
                                      "Completed",
                                      washingLine,
                                    );
                                  if (response.data.success) {
                                    Alert.alert(
                                      t("common.success"),
                                      t("messages.materialProcessingStarted"),
                                    );
                                    setSelectedInputBag(null);
                                    setBagSearchQuery("");
                                    setSuggestedBags([]);
                                    setShowSuggestions(false);
                                    setSelectedStation(null);
                                  } else {
                                    Alert.alert(
                                      t("common.error"),
                                      t("messages.failedToUpdateBatchStatus"),
                                    );
                                  }
                                } else if (
                                  isFinalPackaging &&
                                  selectedInputBag.output_bag_qr
                                ) {
                                  // Final Packaging: ONLY update the existing extrusion batch (NO new entry)
                                  // Update status to 'Completed' and set used_line (Final Packaging line/subline if available)
                                  const finalPackagingLine =
                                    selectedSubLine ||
                                    selectedStation.name ||
                                    undefined;
                                  const response =
                                    await productionApi.updateLogStatus(
                                      selectedInputBag.output_bag_qr,
                                      "Completed",
                                      undefined,
                                      undefined,
                                      finalPackagingLine,
                                    );
                                  if (response.data.success) {
                                    Alert.alert(
                                      t("common.success"),
                                      t("messages.materialProcessingStarted"),
                                    );
                                    setSelectedInputBag(null);
                                    setBagSearchQuery("");
                                    setSuggestedBags([]);
                                    setShowSuggestions(false);
                                    setSelectedStation(null);
                                    setSelectedSubLine(null);
                                    setSelectedSection(null);
                                  } else {
                                    Alert.alert(
                                      t("common.error"),
                                      t("messages.failedToUpdateBatchStatus"),
                                    );
                                  }
                                } else {
                                  // For other stations (NOT washing, NOT Final Packaging), create a new processing log entry
                                  if (!backendShiftId) {
                                    Alert.alert(
                                      t("common.error"),
                                      t("messages.noActiveShift"),
                                    );
                                    return;
                                  }
                                  const logData = {
                                    shiftId: backendShiftId,
                                    stationId: selectedStation.id,
                                    inputBagQr: selectedInputBag.output_bag_qr,
                                    weight: selectedInputBag.weight,
                                    status: "Processing",
                                  };
                                  const response =
                                    await productionApi.logProduction(logData);
                                  if (response.data.success) {
                                    Alert.alert(
                                      t("common.success"),
                                      t("messages.materialProcessingStarted"),
                                    );
                                    setSelectedInputBag(null);
                                    setBagSearchQuery("");
                                    setSuggestedBags([]);
                                    setShowSuggestions(false);
                                    setSelectedStation(null);
                                  }
                                }
                              } catch (error) {
                                console.error("Save input error:", error);
                                Alert.alert(
                                  t("common.error"),
                                  t("messages.failedToStartProcessing"),
                                );
                              } finally {
                                setIsLoading(false);
                              }
                            }}
                          >
                            <Text style={styles.primaryButtonText}>
                              Save & Start Processing
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View>
                          <Text style={styles.formTitle}>
                            {t("dashboard.outputRecording")}
                          </Text>
                          <View style={styles.inputGroup}>
                            <Text style={styles.label}>
                              {t("dashboard.weightKg")}
                            </Text>
                            <TextInput
                              style={styles.input}
                              keyboardType="decimal-pad"
                              placeholder="0.00"
                              value={weightInput}
                              onChangeText={handleWeightInputChange}
                            />
                          </View>

                          {(() => {
                            const hasValidWeight =
                              isValidProductionWeightInput(weightInput);
                            const isFinalPackagingStation =
                              selectedStation?.id === 5 ||
                              selectedStation?.name
                                ?.toLowerCase()
                                .includes("final") ||
                              selectedStation?.name
                                ?.toLowerCase()
                                .includes("re-packaging");
                            const shouldShowGenerateButton =
                              isFinalPackagingStation
                                ? hasValidWeight || isLoading
                                : true;

                            if (!shouldShowGenerateButton) return null;

                            return (
                              <TouchableOpacity
                                style={[
                                  styles.primaryButton,
                                  (!hasValidWeight || isLoading) && {
                                    opacity: 0.5,
                                    backgroundColor: "#E2E8F0",
                                  },
                                ]}
                                disabled={!hasValidWeight || isLoading}
                                onPress={handleLogProduction}
                              >
                                <PrinterIcon
                                  color={hasValidWeight ? "#FFF" : "#94A3B8"}
                                  size={20}
                                />
                                <Text
                                  style={[
                                    styles.primaryButtonText,
                                    !hasValidWeight && { color: "#94A3B8" },
                                  ]}
                                >
                                  {t("dashboard.generateQRPrint")}
                                </Text>
                              </TouchableOpacity>
                            );
                          })()}
                        </View>
                      )}
                    </View>

                    {/* Re-Packaging / Final Packaging station totals (PC + PE generic PKG; uses numeric id match + shift + material) */}
                    {(() => {
                      const logs = shiftLogs.filter((l: any) =>
                        shiftLogMatchesStationShiftMaterial(
                          l,
                          selectedStation.id,
                          backendShiftId,
                          user?.materialTypeId ?? null,
                        ),
                      );
                      const totalBags = logs.length;
                      const totalKg = logs.reduce(
                        (s: number, l: any) => s + (parseFloat(l.weight) || 0),
                        0,
                      );
                      return (
                        <View
                          style={{
                            marginHorizontal: 16,
                            marginTop: 12,
                            marginBottom: 4,
                          }}
                        >
                          {/* Dark header bar */}
                          <View
                            style={{
                              backgroundColor: "#1e293b",
                              borderRadius: 14,
                              paddingVertical: 14,
                              paddingHorizontal: 18,
                              marginBottom: 10,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: "700",
                                color: "#94a3b8",
                                letterSpacing: 0.3,
                              }}
                            >
                              Re-Packaging — This Shift
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 16,
                              }}
                            >
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 22,
                                    fontWeight: "800",
                                    color: "#fff",
                                    lineHeight: 26,
                                  }}
                                >
                                  {totalBags}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  bags
                                </Text>
                              </View>
                              <View
                                style={{
                                  width: 1,
                                  height: 32,
                                  backgroundColor: "#334155",
                                }}
                              />
                              <View style={{ alignItems: "center" }}>
                                <Text
                                  style={{
                                    fontSize: 22,
                                    fontWeight: "800",
                                    color: "#fff",
                                    lineHeight: 26,
                                  }}
                                >
                                  {totalKg.toFixed(1)}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    marginTop: 1,
                                  }}
                                >
                                  kg
                                </Text>
                              </View>
                            </View>
                          </View>
                          {/* Two stat cards */}
                          <View style={{ flexDirection: "row", gap: 10 }}>
                            <View
                              style={{
                                flex: 1,
                                backgroundColor: "#fff",
                                borderRadius: 14,
                                paddingVertical: 18,
                                paddingHorizontal: 14,
                                borderTopWidth: 3,
                                borderTopColor: "#22c55e",
                                elevation: 2,
                                alignItems: "center",
                                shadowColor: "#000",
                                shadowOpacity: 0.06,
                                shadowRadius: 6,
                                shadowOffset: { width: 0, height: 2 },
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: "700",
                                  color: "#22c55e",
                                  letterSpacing: 0.5,
                                  textTransform: "uppercase",
                                  marginBottom: 6,
                                }}
                              >
                                Total Bags
                              </Text>
                              <Text
                                style={{
                                  fontSize: 32,
                                  fontWeight: "800",
                                  color: "#1e293b",
                                  lineHeight: 36,
                                }}
                              >
                                {totalBags}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: "#64748b",
                                  marginTop: 4,
                                }}
                              >
                                bags this shift
                              </Text>
                            </View>
                            <View
                              style={{
                                flex: 1,
                                backgroundColor: "#fff",
                                borderRadius: 14,
                                paddingVertical: 18,
                                paddingHorizontal: 14,
                                borderTopWidth: 3,
                                borderTopColor: "#10b981",
                                elevation: 2,
                                alignItems: "center",
                                shadowColor: "#000",
                                shadowOpacity: 0.06,
                                shadowRadius: 6,
                                shadowOffset: { width: 0, height: 2 },
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: "700",
                                  color: "#10b981",
                                  letterSpacing: 0.5,
                                  textTransform: "uppercase",
                                  marginBottom: 6,
                                }}
                              >
                                Total Weight
                              </Text>
                              <Text
                                style={{
                                  fontSize: 32,
                                  fontWeight: "800",
                                  color: "#1e293b",
                                  lineHeight: 36,
                                }}
                              >
                                {totalKg.toFixed(1)}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: "#64748b",
                                  marginTop: 4,
                                }}
                              >
                                kg this shift
                              </Text>
                            </View>
                          </View>
                        </View>
                      );
                    })()}

                    {isPE &&
                      (selectedStation?.id === 5 ||
                        selectedStation?.name
                          ?.toLowerCase()
                          .includes("final") ||
                        selectedStation?.name
                          ?.toLowerCase()
                          .includes("re-packaging")) && (
                        <TouchableOpacity
                          style={[
                            styles.secondaryButton,
                            {
                              marginTop: 8,
                              marginHorizontal: 16,
                              marginBottom: 8,
                            },
                          ]}
                          onPress={handleBack}
                        >
                          <Text style={styles.secondaryButtonText}>← Back</Text>
                        </TouchableOpacity>
                      )}

                    <View
                      style={[
                        styles.crusherLogsSection,
                        { marginTop: 16, marginHorizontal: 16 },
                      ]}
                    >
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
                          onChangeText={(text) => {
                            setPackingSearchQuery(text);
                            setPackingCurrentPage(1);
                          }}
                          placeholderTextColor="#94a3b8"
                          clearButtonMode="while-editing"
                          returnKeyType="search"
                          autoCorrect={false}
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        {packingSearchQuery.length > 0 && (
                          <TouchableOpacity
                            onPress={() => {
                              setPackingSearchQuery("");
                              setPackingCurrentPage(1);
                            }}
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
                              style={[
                                styles.filterButton,
                                packingSelectedStatusFilter === "all" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setPackingSelectedStatusFilter("all");
                                setPackingCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  packingSelectedStatusFilter === "all" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                All
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                packingSelectedStatusFilter === "pending" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setPackingSelectedStatusFilter("pending");
                                setPackingCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  packingSelectedStatusFilter === "pending" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                Pending
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.filterButton,
                                packingSelectedStatusFilter === "Completed" &&
                                  styles.filterButtonActive,
                              ]}
                              onPress={() => {
                                setPackingSelectedStatusFilter("Completed");
                                setPackingCurrentPage(1);
                              }}
                            >
                              <Text
                                style={[
                                  styles.filterButtonText,
                                  packingSelectedStatusFilter === "Completed" &&
                                    styles.filterButtonTextActive,
                                ]}
                              >
                                Complete
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      {packingLogsLoading ? (
                        <View style={styles.loadingState}>
                          <ActivityIndicator size="large" color="#17a34a" />
                          <Text style={styles.loadingText}>
                            Loading entries...
                          </Text>
                        </View>
                      ) : packingLogs.length > 0 ? (
                        <View style={styles.logsList}>
                          {packingLogs.map((log, index) => (
                            <View key={index} style={styles.logItem}>
                              <View style={styles.logMain}>
                                <Text style={styles.logQr}>
                                  {log.output_bag_qr}
                                </Text>
                                <View style={styles.logDetails}>
                                  <Text style={styles.logWeight}>
                                    {log.weight} kg
                                  </Text>
                                  <Text style={styles.logTime}>
                                    {(() => {
                                      const ts =
                                        log.created_at ??
                                        log.createdAt ??
                                        log.updated_at ??
                                        log.updatedAt;
                                      return ts
                                        ? new Date(ts).toLocaleString()
                                        : "—";
                                    })()}
                                  </Text>
                                </View>
                                <View style={styles.logStatusRow}>
                                  <View
                                    style={[
                                      styles.statusBadge,
                                      {
                                        backgroundColor:
                                          log.status === "pending"
                                            ? "#FEF3C7"
                                            : log.status === "hold"
                                            ? "#FFEDD5"
                                            : log.status === "reject"
                                            ? "#FEE2E2"
                                            : "#DCFCE7",
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.statusBadgeText,
                                        {
                                          color:
                                            log.status === "pending"
                                              ? "#D97706"
                                              : log.status === "hold"
                                              ? "#92400E"
                                              : log.status === "reject"
                                              ? "#B91C1C"
                                              : "#15803D",
                                        },
                                      ]}
                                    >
                                      {log.status === "hold"
                                            ? "Hold"
                                            : log.status === "reject"
                                            ? "Reject"
                                            : log.status === "pending"
                                            ? "Pending"
                                            : "Completed"}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                              <View style={styles.logActions}>
                                {(canEditAnyStatus ||
                                  log.status === "pending") && (
                                  <TouchableOpacity
                                    style={styles.editIconButton}
                                    onPress={() => openEditLogWeight(log)}
                                  >
                                    <Pencil color="#0ea5e9" size={18} />
                                  </TouchableOpacity>
                                )}
                                {isPE && log.status === "hold" && (
                                  <>
                                    <TouchableOpacity
                                      style={[styles.editIconButton, { backgroundColor: "#dcfce7" }]}
                                      onPress={() => openPeResolveModal(log)}
                                    >
                                      <Text style={{ color: "#15803d", fontWeight: "700", fontSize: 11 }}>OK</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.editIconButton, { backgroundColor: "#fee2e2" }]}
                                      onPress={() => openPeResolveModal(log)}
                                    >
                                      <Text style={{ color: "#b91c1c", fontWeight: "700", fontSize: 11 }}>Reject</Text>
                                    </TouchableOpacity>
                                  </>
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
                          <Text style={styles.emptyText}>
                            No entries found for this date
                          </Text>
                        </View>
                      )}

                      {/* Pagination */}
                      {packingTotalPages > 1 && (
                        <View style={styles.pagination}>
                          <TouchableOpacity
                            style={[
                              styles.pageBtn,
                              packingCurrentPage === 1 &&
                                styles.pageBtnDisabled,
                            ]}
                            onPress={() =>
                              packingCurrentPage > 1 &&
                              setPackingCurrentPage(packingCurrentPage - 1)
                            }
                            disabled={packingCurrentPage === 1}
                          >
                            <ChevronLeft
                              size={18}
                              color={
                                packingCurrentPage === 1 ? "#cbd5e1" : "#475569"
                              }
                            />
                          </TouchableOpacity>
                          <View style={styles.pageInfoBox}>
                            <Text style={styles.pageInfoMain}>
                              {packingCurrentPage} / {packingTotalPages}
                            </Text>
                            <Text style={styles.pageInfoSub}>
                              {packingTotalLogs} total
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[
                              styles.pageBtn,
                              packingCurrentPage === packingTotalPages &&
                                styles.pageBtnDisabled,
                            ]}
                            onPress={() =>
                              packingCurrentPage < packingTotalPages &&
                              setPackingCurrentPage(packingCurrentPage + 1)
                            }
                            disabled={packingCurrentPage === packingTotalPages}
                          >
                            <ChevronRight
                              size={18}
                              color={
                                packingCurrentPage === packingTotalPages
                                  ? "#cbd5e1"
                                  : "#475569"
                              }
                            />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={showScanner} animationType="fade">
        <View style={styles.scannerContainer}>
          <CameraView
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerText}>{t("dashboard.scanBagQR")}</Text>
            <TouchableOpacity
              style={styles.closeScanner}
              onPress={() => setShowScanner(false)}
            >
              <X color="#FFF" size={32} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
              <TouchableOpacity
                style={styles.cameraCloseButton}
                onPress={handleCancelPhoto}
              >
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
              <Text style={styles.photoPreviewTitle}>
                {t("dashboard.photoPreview")}
              </Text>
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
                <Text style={styles.retakeButtonText}>
                  {t("dashboard.retake")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.photoPreviewButton, styles.acceptButton]}
                onPress={handleAcceptPhoto}
              >
                <Text style={styles.acceptButtonText}>
                  {t("dashboard.usePhoto")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={showPrintPreview} transparent animationType="fade">
        <View style={styles.previewOverlay}>
          <View style={styles.previewContent}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>
                {t("dashboard.labelPreview")}
              </Text>
              <TouchableOpacity
                onPress={handleClosePreview}
                disabled={isPrinting || isLoading}
              >
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              style={{ maxHeight: Dimensions.get("window").height * 0.58 }}
              contentContainerStyle={{ flexGrow: 1, paddingBottom: 8 }}
            >
              <View style={styles.previewLabelBox}>
                <View style={styles.previewLabelTop}>
                  <Text style={styles.previewCompany}>Greencore Resources</Text>
                  <View style={styles.qrContainer}>
                    {previewData?.qrCode && (
                      <QRCode
                        value={previewData.qrCode}
                        size={120}
                        getRef={(c) => (qrRef.current = c)}
                      />
                    )}
                  </View>
                  <View style={styles.previewQRIdBox}>
                    <Text style={styles.previewQRIdText}>
                      {previewData?.qrCode}
                    </Text>
                  </View>
                </View>
                <View style={styles.previewGrid}>
                  <View style={styles.previewItem}>
                    <Text style={styles.previewLabel}>Weight</Text>
                    <Text style={styles.previewValue}>
                      {(() => {
                        const d = formatWeightKgDisplay(previewData?.weight);
                        return d === "—" ? "—" : `${d} kg`;
                      })()}
                    </Text>
                  </View>
                  <View style={styles.previewItemRight}>
                    <Text style={styles.previewLabel}>Station</Text>
                    <Text
                      style={[styles.previewValue, styles.previewValueRight]}
                    >
                      {formatCompactStationLabel(previewData?.station)}
                    </Text>
                  </View>
                  <View style={styles.previewItem}>
                    <Text style={styles.previewLabel}>Shift</Text>
                    <Text style={styles.previewValue}>
                      {selectedShift?.name}
                    </Text>
                  </View>
                  <View style={styles.previewItemRight}>
                    <Text style={styles.previewLabel}>Date</Text>
                    <Text
                      style={[styles.previewValue, styles.previewValueRight]}
                    >
                      {previewData?.date}
                    </Text>
                  </View>
                </View>

                {/* Jumbo bag type — full-width column so long labels (e.g. ID) never overlap Remark */}
                {!isCurrentLogSaved &&
                  !selectedStation?.name?.toLowerCase().includes("crusher") &&
                  !selectedStation?.name
                    ?.toLowerCase()
                    .includes("re-packaging") && (
                    <View style={styles.previewModalFieldBlock}>
                      <Text
                        style={[styles.label, styles.previewModalFieldLabel]}
                      >
                        {t("dashboard.jumboBagType")}
                      </Text>
                      <View style={styles.previewModalBagTypeRow}>
                        <TouchableOpacity
                          style={[
                            styles.previewModalBagTypeBtn,
                            previewBagStatus === "pending" &&
                              styles.filterButtonActive,
                          ]}
                          onPress={() => {
                            previewBagStatusRef.current = "pending";
                            setPreviewBagStatus("pending");
                            setPreviewData((prev: any) =>
                              prev
                                ? { ...prev, bagStatus: "pending" as const }
                                : prev,
                            );
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.previewModalBagTypeBtnText,
                              previewBagStatus === "pending" &&
                                styles.filterButtonTextActive,
                            ]}
                            numberOfLines={2}
                          >
                            {t("dashboard.temporaryJumboBag")}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.previewModalBagTypeBtn,
                            previewBagStatus === "Completed" &&
                              styles.filterButtonActive,
                          ]}
                          onPress={() => {
                            previewBagStatusRef.current = "Completed";
                            setPreviewBagStatus("Completed");
                            setPreviewData((prev: any) =>
                              prev
                                ? { ...prev, bagStatus: "Completed" as const }
                                : prev,
                            );
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.previewModalBagTypeBtnText,
                              previewBagStatus === "Completed" &&
                                styles.filterButtonTextActive,
                            ]}
                            numberOfLines={2}
                          >
                            {t("dashboard.finalJumboBag")}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                {!isCurrentLogSaved && (
                  <View style={styles.previewModalFieldBlock}>
                    <Text style={[styles.label, styles.previewModalFieldLabel]}>
                      {t("dashboard.remark")}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.previewModalRemarkInput]}
                      placeholder={t("dashboard.remarkPlaceholder")}
                      placeholderTextColor="#94a3b8"
                      value={remarkInput}
                      onChangeText={setRemarkInput}
                      multiline
                      numberOfLines={2}
                    />
                  </View>
                )}
              </View>
            </ScrollView>

            {/* STEP 1: SAVE Button (Initially visible) */}
            {!isCurrentLogSaved && (
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { backgroundColor: "#17a34a", marginBottom: 0, height: 56 },
                ]}
                onPress={() => {
                  const isRepack = selectedStation?.name
                    ?.toLowerCase()
                    .includes("re-packaging");
                  // Re-packaging is final product (PC): always Completed — no temporary WIP bags
                  if (isRepack) {
                    handleSaveProduction("Completed");
                    return;
                  }
                  const fromRef = previewBagStatusRef.current;
                  const fromState = previewBagStatus;
                  const statusToSend =
                    fromRef === "Completed" || fromState === "Completed"
                      ? "Completed"
                      : "pending";
                  handleSaveProduction(statusToSend);
                }}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Package
                      color="#FFF"
                      size={24}
                      style={{ marginRight: 10 }}
                    />
                    <Text
                      style={[
                        styles.primaryButtonText,
                        { fontSize: 18, fontWeight: "700" },
                      ]}
                    >
                      SAVE
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* STEP 2: PRINT Button (Shown after saving) */}
            {isCurrentLogSaved && (
              <>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: "#17a34a", marginBottom: 8, height: 56 },
                  ]}
                  onPress={executePrint}
                  disabled={isPrinting}
                >
                  {isPrinting ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <PrinterIcon
                        color="#FFF"
                        size={24}
                        style={{ marginRight: 10 }}
                      />
                      <Text
                        style={[
                          styles.primaryButtonText,
                          { fontSize: 18, fontWeight: "700" },
                        ]}
                      >
                        Print Label
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                {/* Printer-down hint: close preview and reprint from the logs list */}
                <View
                  style={{
                    backgroundColor: "#FEF3C7",
                    borderRadius: 8,
                    padding: 10,
                    marginTop: 4,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Text style={{ fontSize: 13, color: "#92400e", flex: 1 }}>
                    Printer not responding? Close this preview — your QR is
                    saved. Go to the station logs list and tap the 🖨️ icon to
                    reprint any time.
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
              <Text style={styles.previewTitle}>
                {t("dashboard.labelPreview")}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowListPrintPreview(false);
                  setSelectedLogForPrint(null);
                }}
                disabled={isPrinting}
              >
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <View style={styles.previewLabelBox}>
              <View style={styles.previewLabelTop}>
                <Text style={styles.previewCompany}>Greencore Resources</Text>
                <View style={styles.qrContainer}>
                  {selectedLogForPrint?.output_bag_qr && (
                    <QRCode
                      value={selectedLogForPrint.output_bag_qr}
                      size={120}
                      getRef={(c) => (listQrRef.current = c)}
                    />
                  )}
                </View>
                <View style={styles.previewQRIdBox}>
                  <Text style={styles.previewQRIdText}>
                    {selectedLogForPrint?.output_bag_qr}
                  </Text>
                </View>
              </View>
              <View style={styles.previewGrid}>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>Weight</Text>
                  <Text style={styles.previewValue}>
                    {(() => {
                      const d = formatWeightKgDisplay(
                        selectedLogForPrint?.weight,
                      );
                      return d === "—" ? "—" : `${d} kg`;
                    })()}
                  </Text>
                </View>
                <View style={styles.previewItemRight}>
                  <Text style={styles.previewLabel}>Station</Text>
                  <Text style={[styles.previewValue, styles.previewValueRight]}>
                    {formatCompactStationLabel(
                      getReprintStationDisplayName(
                        selectedLogForPrint,
                        stations,
                      ),
                    )}
                  </Text>
                </View>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>Shift</Text>
                  <Text style={styles.previewValue}>{selectedShift?.name}</Text>
                </View>
                <View style={styles.previewItemRight}>
                  <Text style={styles.previewLabel}>Date</Text>
                  <Text style={[styles.previewValue, styles.previewValueRight]}>
                    {selectedLogForPrint
                      ? new Date(
                          selectedLogForPrint.created_at,
                        ).toLocaleDateString()
                      : ""}
                  </Text>
                </View>
              </View>
            </View>

            {/* REPRINT Button */}
            <View
              style={{
                backgroundColor: "#DCFCE7",
                borderRadius: 8,
                padding: 8,
                marginBottom: 10,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 12, color: "#15803D", flex: 1 }}>
                Re-printing saved label — QR already recorded in the system.
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: "#17a34a", marginBottom: 0, height: 56 },
              ]}
              onPress={executeListPrint}
              disabled={isPrinting}
            >
              {isPrinting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <PrinterIcon
                    color="#FFF"
                    size={24}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    style={[
                      styles.primaryButtonText,
                      { fontSize: 18, fontWeight: "700" },
                    ]}
                  >
                    Reprint Label
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showStationModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pendingStation?.name}</Text>
              <TouchableOpacity onPress={() => setShowStationModal(false)}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select section:</Text>
            <View style={styles.sectionOptions}>
              <TouchableOpacity
                style={styles.sectionOption}
                onPress={() => {
                  if (pendingStation) {
                    setSelectedStation(pendingStation);
                    setSelectedSection("input");
                    setShowStationModal(false);
                  }
                }}
              >
                <View
                  style={[styles.optionIcon, { backgroundColor: "#3b82f6" }]}
                >
                  <Plus color="#FFF" size={24} />
                </View>
                <View>
                  <Text style={styles.optionTitle}>INPUT</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sectionOption}
                onPress={() => {
                  if (pendingStation) {
                    setSelectedStation(pendingStation);
                    setSelectedSection("output");
                    setShowStationModal(false);
                  }
                }}
              >
                <View
                  style={[styles.optionIcon, { backgroundColor: "#22c55e" }]}
                >
                  <Minus color="#FFF" size={24} />
                </View>
                <View>
                  <Text style={styles.optionTitle}>OUTPUT</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showWashingModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pendingWashingLine}</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowWashingModal(false);
                  setPendingWashingLine(null);
                }}
              >
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
                    setSelectedSection("input");
                    setShowWashingModal(false);
                    setPendingWashingLine(null);
                  }
                }}
              >
                <View
                  style={[styles.optionIcon, { backgroundColor: "#3b82f6" }]}
                >
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
                    setSelectedSection("output");
                    setShowWashingModal(false);
                    setPendingWashingLine(null);
                  }
                }}
              >
                <View
                  style={[styles.optionIcon, { backgroundColor: "#17a34a" }]}
                >
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
              <TouchableOpacity
                onPress={() => {
                  setShowExtrusionModal(false);
                  setPendingExtrusionLine(null);
                }}
              >
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
                    setSelectedSection("input");
                    setShowExtrusionModal(false);
                    setPendingExtrusionLine(null);
                  }
                }}
              >
                <View
                  style={[styles.optionIcon, { backgroundColor: "#f97316" }]}
                >
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
                    setSelectedSection("output");
                    setShowExtrusionModal(false);
                    setPendingExtrusionLine(null);
                  }
                }}
              >
                <View
                  style={[styles.optionIcon, { backgroundColor: "#17a34a" }]}
                >
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

      <Modal
        visible={editingLogWeight != null}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("dashboard.editWeight")}</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditingLogWeight(null);
                  setEditWeightValue("");
                  setEditRemarkValue("");
                }}
              >
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("dashboard.weightKg")}</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder="0.00"
                value={editWeightValue}
                onChangeText={(v) => setEditWeightValue(filterNumericWeight(v))}
              />
            </View>
            {isPPIC ? (
              <View style={[styles.inputGroup, { marginTop: 12 }]}>
                <Text style={styles.label}>{t("dashboard.remark")}</Text>
                <TextInput
                  style={[
                    styles.input,
                    { minHeight: 88, textAlignVertical: "top" },
                  ]}
                  placeholder={t("dashboard.remarkPlaceholder")}
                  placeholderTextColor="#94a3b8"
                  value={editRemarkValue}
                  onChangeText={setEditRemarkValue}
                  multiline
                  numberOfLines={4}
                />
              </View>
            ) : null}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { flex: 1, backgroundColor: "#64748b" },
                ]}
                onPress={() => {
                  setEditingLogWeight(null);
                  setEditWeightValue("");
                  setEditRemarkValue("");
                }}
              >
                <Text style={styles.primaryButtonText}>
                  {t("common.cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1 }]}
                onPress={saveEditedLogWeight}
                disabled={
                  isLoading || !isValidProductionWeightInput(editWeightValue)
                }
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {t("common.save")}
                  </Text>
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
              <Text style={styles.modalTitle}>
                {t("dashboard.closedReports")}
              </Text>
              <TouchableOpacity
                onPress={() => setShowClosedReportsModal(false)}
              >
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {t("dashboard.selectShiftToEditPrint")}
            </Text>
            {closedShiftsLoading ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <ActivityIndicator color="#333" />
              </View>
            ) : closedShiftsList.length === 0 ? (
              <Text style={{ padding: 16, color: "#666" }}>
                {t("dashboard.noClosedShifts")}
              </Text>
            ) : (
              <ScrollView
                style={{ maxHeight: 400 }}
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                {closedShiftsList.map((item: any) => (
                  <TouchableOpacity
                    key={item.shiftId}
                    style={[styles.selectionCard, { marginBottom: 8 }]}
                    onPress={() => handleSelectClosedShift(item.shiftId)}
                  >
                    <Text style={styles.cardTitle}>
                      {item.shiftName} — {item.date}
                    </Text>
                    <Text style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                      {item.operatorName}
                    </Text>
                    <Text
                      style={{ fontSize: 12, color: "#17a34a", marginTop: 4 }}
                    >
                      {item.totalOutputs} outputs · {item.totalWeight} kg
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={editingByProductIndex != null}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit weight</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditingByProductIndex(null);
                  setEditByProductWeight("");
                }}
              >
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            {editingByProductIndex != null &&
              (() => {
                const byProductsList = showShiftClosedView
                  ? closedShiftByProducts
                  : savedByProductsOnStartPage;
                const product = byProductsList[editingByProductIndex];
                return product ? (
                  <>
                    <Text style={styles.modalSubtitle}>
                      {product.name} — {product.stationName}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginTop: 12,
                        marginBottom: 20,
                      }}
                    >
                      <TextInput
                        style={[
                          styles.byProductInput,
                          { flex: 1, marginRight: 8 },
                        ]}
                        keyboardType="decimal-pad"
                        value={editByProductWeight}
                        onChangeText={(v) =>
                          setEditByProductWeight(filterNumericWeight(v))
                        }
                        placeholder="Weight (kg)"
                      />
                      <Text style={{ fontSize: 16 }}>kg</Text>
                    </View>
                    <View style={{ flexDirection: "row" }}>
                      <TouchableOpacity
                        style={[
                          styles.closeShiftBtn,
                          {
                            flex: 1,
                            backgroundColor: "#6b7280",
                            marginRight: 6,
                          },
                        ]}
                        onPress={() => {
                          setEditingByProductIndex(null);
                          setEditByProductWeight("");
                        }}
                      >
                        <Text style={styles.closeShiftText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.closeShiftBtn,
                          { flex: 1, marginLeft: 6 },
                        ]}
                        onPress={saveEditedByProduct}
                      >
                        <Text style={styles.closeShiftText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null;
              })()}
          </View>
        </View>
      </Modal>

      {/* PE Hold creation modal — captures weight + remark, status='hold' */}
      <Modal
        visible={peHoldModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPeHoldModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Hold material for QC</Text>
              <TouchableOpacity onPress={() => setPeHoldModalVisible(false)}>
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            <Text
              style={{
                fontSize: 12,
                color: "#64748b",
                marginBottom: 8,
                paddingHorizontal: 4,
              }}
            >
              Sub-line: {selectedSubLine || "—"}    Station:{" "}
              {selectedStation?.name || "—"}
            </Text>
            <Text style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>
              Weight (kg)
            </Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#94a3b8"
              value={peHoldWeight}
              onChangeText={setPeHoldWeight}
            />
            <Text
              style={{ fontSize: 12, color: "#475569", marginTop: 12, marginBottom: 4 }}
            >
              Reason / remark (optional)
            </Text>
            <TextInput
              style={[styles.input, { minHeight: 60 }]}
              placeholder="Why is this on hold?"
              placeholderTextColor="#94a3b8"
              value={peHoldRemark}
              onChangeText={setPeHoldRemark}
              multiline
            />
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                marginTop: 16,
                justifyContent: "flex-end",
              }}
            >
              <TouchableOpacity
                style={[
                  styles.editByProductBtn,
                  { backgroundColor: "#e2e8f0" },
                ]}
                onPress={() => setPeHoldModalVisible(false)}
                disabled={peHoldSubmitting}
              >
                <Text style={{ color: "#334155", fontWeight: "600" }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.editByProductBtn,
                  {
                    backgroundColor: peHoldSubmitting ? "#94a3b8" : "#f59e0b",
                  },
                ]}
                onPress={submitPeHold}
                disabled={peHoldSubmitting}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  {peHoldSubmitting ? "Saving…" : "Place Hold"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PE Hold resolve modal — Reprocess OK (new weight + Completed) or Reject */}
      <Modal
        visible={peResolvingLog != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPeResolvingLog(null);
          setPeResolveWeight("");
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Resolve Hold</Text>
              <TouchableOpacity
                onPress={() => {
                  setPeResolvingLog(null);
                  setPeResolveWeight("");
                }}
              >
                <X color="#333" size={24} />
              </TouchableOpacity>
            </View>
            {peResolvingLog && (
              <>
                <Text
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    marginBottom: 8,
                    paddingHorizontal: 4,
                  }}
                >
                  Original weight: {peResolvingLog.weight ?? "—"} kg{"  "}·{"  "}
                  Sub-line: {peResolvingLog.sub_line || peResolvingLog.subLine || "—"}
                </Text>
                <Text
                  style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}
                >
                  Reprocessed weight (kg) — required for Reprocess OK
                </Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder={String(peResolvingLog.weight ?? "0.00")}
                  placeholderTextColor="#94a3b8"
                  value={peResolveWeight}
                  onChangeText={setPeResolveWeight}
                />
                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    marginTop: 16,
                    justifyContent: "space-between",
                  }}
                >
                  <TouchableOpacity
                    style={[
                      styles.editByProductBtn,
                      {
                        backgroundColor: peResolveSubmitting
                          ? "#fca5a5"
                          : "#ef4444",
                      },
                    ]}
                    onPress={submitPeResolveReject}
                    disabled={peResolveSubmitting}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>
                      Reject
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.editByProductBtn,
                      {
                        backgroundColor: peResolveSubmitting
                          ? "#86efac"
                          : "#16a34a",
                      },
                    ]}
                    onPress={submitPeResolveOk}
                    disabled={peResolveSubmitting}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>
                      Reprocess OK
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// Define consistent font family
const fontFamily = Platform.select({
  ios: "System",
  android: "Roboto",
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: "System",
});

const styles = StyleSheet.create({
  container:
    Platform.OS === "web"
      ? {
          flex: 1,
          backgroundColor: "#F8F9FA",
          height: "100vh" as any,
          width: "100vw" as any,
          overflow: "hidden" as any,
          display: "flex" as any,
          flexDirection: "column" as any,
        }
      : { flex: 1, backgroundColor: "#F8F9FA" },
  toast: {
    position: "absolute",
    top: Platform.OS === "web" ? 12 : 56,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#C62828",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    zIndex: 9999,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  toastText: { color: "#FFF", fontSize: 14, flex: 1, marginRight: 12 },
  toastClose: { padding: 4 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EEE",
    overflow: "hidden",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  headerRight: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  headerShiftText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
    marginRight: 8,
  },
  userName: { fontSize: 14, fontWeight: "600", color: "#333", marginRight: 8 },
  logoutButton: { padding: 8 },
  headerExportButton: { padding: 8, marginRight: 4 },
  printerHeaderButton: {
    padding: 8,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: "#F5F5F5",
  },
  printerActive: { backgroundColor: "#DCFCE7" },
  backButton: { flexDirection: "row", alignItems: "center" },
  stationTitle: { fontSize: 18, fontWeight: "700", color: "#333" },
  contextPills: { flexDirection: "row" },
  smallPill: {
    fontSize: 10,
    color: "#666",
    backgroundColor: "#EEE",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
  },
  timerPill: {
    backgroundColor: "#232938",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  timerText: { color: "#FFF", fontSize: 12, fontWeight: "700" },
  content:
    Platform.OS === "web"
      ? {
          flex: 1,
          height: "calc(100vh - 70px)" as any,
          maxHeight: "calc(100vh - 70px)" as any,
          overflowY: "scroll" as any,
          overflowX: "hidden" as any,
          WebkitOverflowScrolling: "touch" as any,
          position: "relative" as any,
          "-webkit-overflow-scrolling": "touch" as any,
        }
      : { flex: 1 },
  contentContainer:
    Platform.OS === "web"
      ? {
          paddingBottom: 40,
          minHeight: "100%" as any,
        }
      : { paddingBottom: 40 },
  startShiftContainer: { padding: 20, marginTop: 20 },
  ppicHomeContainer: { paddingVertical: 8 },
  ppicHomeTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0ea5e9",
    marginBottom: 8,
    textAlign: "center",
  },
  ppicHomeSubtitle: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 16,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  ppicHomeCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  ppicHomeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  ppicShiftRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -5,
  },
  ppicShiftBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    borderWidth: 2,
    borderColor: "transparent",
    marginRight: 10,
    marginBottom: 10,
  },
  ppicShiftBtnActive: { backgroundColor: "#E0F2FE", borderColor: "#0ea5e9" },
  ppicShiftBtnText: { fontSize: 14, fontWeight: "600", color: "#64748b" },
  ppicShiftBtnTextActive: { color: "#0ea5e9" },
  /* PPIC section headers */
  ppicSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  ppicSectionTitle: { fontSize: 15, fontWeight: "700", color: "#111" },
  /* Pulsing live dot */
  ppicLiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#22c55e",
    marginRight: 8,
  },
  ppicLiveDotSmall: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#22c55e",
    marginRight: 4,
  },
  /* Active shift cards on PPIC home */
  ppicActiveShiftCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF4",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#86EFAC",
    padding: 14,
    marginBottom: 10,
  },
  ppicActiveShiftName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#166534",
    flex: 1,
  },
  ppicActiveShiftOperator: { fontSize: 12, color: "#4b7a57", marginTop: 2 },
  ppicActiveShiftMeta: { fontSize: 12, color: "#4b7a57", marginTop: 1 },
  ppicLivePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  ppicLivePillText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#15803D",
    letterSpacing: 0.5,
  },
  /* Empty state */
  ppicEmptyActive: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "dashed",
  },
  ppicEmptyActiveText: { fontSize: 13, color: "#94a3b8" },
  /* LIVE banner on the shift detail view */
  ppicLiveBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  ppicLiveDotBanner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#22c55e",
    marginRight: 10,
  },
  ppicLiveBannerText: {
    flex: 1,
    fontSize: 12,
    color: "#15803D",
    lineHeight: 18,
  },
  /* ── Shift logs: category view ── */
  shiftLogsSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  shiftLogsSearchInput: {
    flex: 1,
    fontSize: 14,
    color: "#111",
    marginHorizontal: 8,
    paddingVertical: 0,
  },
  shiftLogCategory: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    overflow: "hidden",
  },
  shiftLogCategoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  shiftLogCatDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  shiftLogCatLabel: { fontSize: 14, fontWeight: "700", flex: 1 },
  shiftLogCatBadge: {
    backgroundColor: "rgba(0,0,0,0.07)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
  },
  shiftLogCatBadgeText: { fontSize: 11, fontWeight: "700" },
  shiftLogCatWeight: { fontSize: 13, fontWeight: "700" },
  shiftLogRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.04)",
  },
  /** PPIC: column layout — weight row first, remark below (matches operator list pattern) */
  ppicShiftLogEntry: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.04)",
  },
  ppicShiftLogEntryTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  ppicShiftLogRemarkBlock: {
    marginTop: 8,
    width: "100%",
  },
  shiftLogQr: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 2,
  },
  shiftLogMeta: { fontSize: 11, color: "#64748b", marginRight: 4 },
  /** PPIC: per-output remark under list rows */
  ppicLogEntryRemark: {
    fontSize: 11,
    color: "#475569",
    marginTop: 0,
    lineHeight: 15,
    width: "100%",
  },
  shiftLogStatusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  shiftLogWeight: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1e293b",
    marginRight: 10,
    minWidth: 52,
    textAlign: "right",
  },
  shiftLogPrintBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  shiftLogEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  shiftLogEditText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0ea5e9",
    marginLeft: 3,
  },
  shiftLogPager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  shiftLogPagerBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.05)",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 12,
  },
  shiftLogPagerBtnDisabled: { backgroundColor: "transparent" },
  shiftLogPagerText: {
    fontSize: 13,
    fontWeight: "700",
    minWidth: 50,
    textAlign: "center",
  },
  startShiftCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#17a34a",
    borderRadius: 16,
    padding: 20,
    elevation: 6,
  },
  playIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  startShiftText: { flex: 1, marginLeft: 15 },
  startShiftTitle: { color: "#FFF", fontSize: 20, fontWeight: "700" },
  startShiftSubtitle: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  dashboardGrid: { padding: 16 },
  productionLineBanner: {
    fontSize: 13,
    fontWeight: "800",
    color: "#15803d",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  activeStatus: { flexDirection: "row", alignItems: "center" },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#17a34a",
    marginRight: 8,
  },
  statusText: { fontSize: 14, fontWeight: "600", color: "#17a34a" },
  durationText: { fontSize: 14, color: "#666" },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    width: "48%",
    alignItems: "center",
    borderWidth: 1,
    borderBottomWidth: 3,
    borderColor: "#EEE",
  },
  statValue: { fontSize: 24, fontWeight: "700", color: "#333" },
  statLabel: { fontSize: 12, color: "#666", marginTop: 4 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#999",
    marginBottom: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  processSectionHeader: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    marginBottom: 8,
  },
  stationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  stationIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  stationInfo: { flex: 1, marginLeft: 12 },
  stationName: { fontSize: 16, fontWeight: "700", color: "#333" },
  stationDesc: { fontSize: 12, color: "#666" },
  stationMiniStats: { marginRight: 10 },
  miniStat: { fontSize: 12, fontWeight: "600", color: "#333" },
  endShiftButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#232938",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    marginBottom: 30,
  },
  endShiftText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },
  detailContainer: {},
  stationHero: { padding: 24, paddingBottom: 40 },
  heroHeader: { flexDirection: "row", alignItems: "center" },
  heroTitle: { color: "#FFF", fontSize: 22, fontWeight: "700" },
  heroDesc: { color: "rgba(255,255,255,0.8)", fontSize: 14, marginTop: 2 },
  statusBox: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  statusLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statusValue: { color: "#FFF", fontSize: 18, fontWeight: "700", marginTop: 4 },
  statusDesc: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    marginTop: 8,
    lineHeight: 18,
  },
  heroIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  byProductsCard: {
    backgroundColor: "#fffbeb",
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: -20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#fef3c7",
    elevation: 3,
  },
  byProductsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  byProductsTitle: { fontSize: 18, fontWeight: "700", color: "#92400e" },
  byProductsSubtitle: { fontSize: 14, color: "#b45309", opacity: 0.8 },
  bulletList: { gap: 8 },
  bulletItem: { fontSize: 15, fontWeight: "500", color: "#b45309" },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  secondaryButtonText: {
    color: "#475569",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },
  progressCardRedesign: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  progressTitleRedesign: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1e293b",
    marginBottom: 16,
  },
  progressDataRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  progressDataLabel: { fontSize: 14, color: "#64748b", fontWeight: "500" },
  progressDataValue: { fontSize: 15, fontWeight: "800", color: "#1e293b" },
  selectionContainer: { padding: 16 },
  selectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#1e293b",
    marginBottom: 24,
    textAlign: "center",
  },
  peRawMaterialListContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 16,
  },
  peRawMaterialListLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    marginBottom: 12,
  },
  peRawMaterialList: { maxHeight: 360 },
  selectionCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#EEE",
    elevation: 2,
  },
  selectionIconBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  selectionText: { flex: 1 },
  selectionCardTitle: { fontSize: 18, fontWeight: "700", color: "#1e293b" },
  selectionCardSub: { fontSize: 13, color: "#64748b", marginTop: 2 },
  sublineBadgeWrapper: { paddingHorizontal: 16, marginBottom: 8 },
  sublineBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  sublineBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  crusherLogsSection: {
    marginTop: 24,
    padding: 16,
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  logsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  logsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    fontFamily,
  },
  datePickerContainer: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  datePickerLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#475569",
    marginBottom: 8,
    fontFamily,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#1e293b",
    padding: 0,
    fontWeight: "400",
    minHeight: 20,
    outline: "none",
    borderWidth: 0,
    border: "none",
    outlineWidth: 0,
    outlineStyle: "none",
    outlineColor: "transparent",
    fontFamily,
  },
  clearButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
  },
  logsList: { marginBottom: 16 },
  logItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 10,
  },
  logMain: { flex: 1, marginRight: 8 },
  logQr: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1e293b",
    marginBottom: 4,
    fontFamily: "monospace",
  },
  logDetails: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  logWeight: { fontSize: 12, fontWeight: "700", color: "#17a34a" },
  logTime: { fontSize: 12, color: "#64748b" },
  logStatusRow: { marginTop: 6 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
    minHeight: 20,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    fontFamily,
  },
  filtersContainer: { marginBottom: 16, gap: 14 },
  filterGroup: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 2,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
    minWidth: 55,
    paddingTop: 6,
    fontFamily,
  },
  filterButtons: {
    flexDirection: "row",
    gap: 6,
    flex: 1,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  filterButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  filterButtonActive: {
    backgroundColor: "#17a34a",
    borderColor: "#17a34a",
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    fontFamily,
  },
  filterButtonTextActive: {
    color: "#ffffff",
    fontFamily,
  },
  logActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    justifyContent: "flex-end",
  },
  editIconButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#E0F2FE",
  },
  printIconButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#F0FDF4",
  },
  logBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  logBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyText: { marginTop: 12, fontSize: 14, color: "#94a3b8" },
  loadingState: { alignItems: "center", paddingVertical: 40 },
  loadingText: { marginTop: 12, fontSize: 14, color: "#94a3b8" },
  pagination: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 14,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  pageBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  pageBtnDisabled: { opacity: 0.35 },
  pageInfo: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  pageInfoBox: { alignItems: "center" },
  pageInfoMain: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  pageInfoSub: { fontSize: 11, color: "#94a3b8", marginTop: 1 },
  formCard: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    marginHorizontal: 16,
    marginTop: -20,
    padding: 24,
    elevation: 3,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    marginBottom: 20,
  },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, color: "#666", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    outline: "none",
    outlineWidth: 0,
    outlineStyle: "none",
    outlineColor: "transparent",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17a34a",
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
  },
  primaryButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },
  searchContainer: { marginBottom: 20, position: "relative", zIndex: 1000 },
  searchInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
  },
  searchTextInput: {
    flex: 1,
    fontSize: 16,
    color: "#333",
    outline: "none",
    outlineWidth: 0,
    outlineStyle: "none",
    outlineColor: "transparent",
  },
  suggestionsList: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    marginTop: 6,
    maxHeight: 280,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  suggestionsContainer: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    marginTop: 6,
    maxHeight: 280,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  suggestionLeftCol: { flex: 1, minWidth: 120, marginRight: 8 },
  suggestionId: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  suggestionQrLine: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f766e",
    marginBottom: 2,
  },
  suggestionSubLine: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  suggestionDetail: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "500",
    marginLeft: 8,
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#17a34a",
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  scanButtonText: {
    color: "#17a34a",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },
  selectedBagCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F9FF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  /** PET input (Starlinger / Final Packing): strict column layout (web + native) so ID / weight / badge never share one line */
  petInputSelectedBagPanel: {
    width: "100%",
    alignSelf: "stretch",
    flexDirection: "column",
    alignItems: "stretch",
    backgroundColor: "#F0F9FF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  petInputSelectedBagHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    width: "100%",
  },
  petInputSelectedBagLabel: {
    flex: 1,
    marginRight: 12,
    fontSize: 11,
    color: "#64748b",
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  petInputSelectedBagFieldBlock: {
    width: "100%",
    marginBottom: 10,
  },
  petInputFieldCaption: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: "600",
    marginBottom: 4,
  },
  petInputSelectedBagQr: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0369A1",
    lineHeight: 22,
    width: "100%",
    flexShrink: 1,
  },
  petInputSelectedBagWeight: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0369A1",
    width: "100%",
  },
  petInputSourceBadgeRow: {
    width: "100%",
    marginTop: 4,
    flexDirection: "column",
    alignItems: "flex-start",
  },
  petInputSourceBadgeWrap: {
    maxWidth: "100%",
    flexShrink: 1,
  },
  selectedBagId: { fontSize: 14, fontWeight: "700", color: "#0369A1" },
  selectedBagWeight: { fontSize: 12, color: "#0369A1" },
  stationProgressCard: { padding: 24 },
  progressTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  progressLabel: { color: "#666" },
  progressValue: { fontWeight: "600", color: "#333" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#333" },
  modalSubtitle: { fontSize: 14, color: "#666", marginBottom: 24 },
  sectionOptions: { gap: 12 },
  sectionOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#F8F9FA",
    borderWidth: 1,
    borderColor: "#EEE",
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  optionTitle: { fontSize: 16, fontWeight: "700", color: "#333" },
  scannerContainer: { flex: 1, backgroundColor: "#000" },
  scannerOverlay: {
    position: "absolute",
    top: 50,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  scannerText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  closeScanner: { marginTop: 20 },
  cameraContainer: { flex: 1, backgroundColor: "#000" },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
  },
  cameraHeader: {
    paddingTop: 50,
    paddingHorizontal: 20,
    alignItems: "flex-start",
  },
  cameraCloseButton: {
    padding: 8,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
  },
  cameraControls: { paddingBottom: 50, alignItems: "center" },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: "#17a34a",
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#17a34a",
  },
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  photoPreviewContent: {
    backgroundColor: "#FFF",
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 500,
  },
  photoPreviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  photoPreviewTitle: { fontSize: 20, fontWeight: "700", color: "#333" },
  photoPreviewImage: {
    width: "100%",
    height: 400,
    borderRadius: 16,
    marginBottom: 20,
    backgroundColor: "#F9FAFB",
  },
  photoPreviewActions: { flexDirection: "row", gap: 12 },
  photoPreviewButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  retakeButton: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  retakeButtonText: { color: "#64748B", fontSize: 16, fontWeight: "700" },
  acceptButton: { backgroundColor: "#17a34a" },
  acceptButtonText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  photosPreviewContainer: { marginTop: 12, marginBottom: 12, maxHeight: 140 },
  photosPreviewContent: { paddingRight: 12, gap: 12 },
  photoPreviewItem: { position: "relative", marginRight: 12 },
  photoPreviewThumbnail: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: "#F9FAFB",
  },
  removePhotoButton: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#EF4444",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  summaryContainer: { padding: 16 },
  summaryStatsCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    marginBottom: 16,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  summaryItem: {
    alignItems: "center",
    width: "48%",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  summaryValue: { fontSize: 20, fontWeight: "700", color: "#17a34a" },
  summaryLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
    textAlign: "center",
    width: "100%",
  },
  byProductRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  editByProductBtn: { padding: 8 },
  byProductName: { fontSize: 16, fontWeight: "700", color: "#333" },
  byProductStation: { fontSize: 12, color: "#666" },
  byProductInputWrapper: { flexDirection: "row", alignItems: "center" },
  byProductInput: {
    width: 60,
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 8,
    padding: 8,
    textAlign: "right",
    fontSize: 16,
    fontWeight: "600",
  },
  unitLabel: { marginLeft: 6, color: "#666", fontWeight: "600" },
  crusherContainer:
    Platform.OS === "web"
      ? {
          padding: 16,
          minHeight: "100%" as any,
        }
      : { padding: 16 },
  sectionCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    elevation: 2,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 10,
  },
  typePillText: { fontSize: 10, fontWeight: "800" },
  sectionTitleText: { fontSize: 16, fontWeight: "700", color: "#333" },
  grayEmptyBox: {
    backgroundColor: "#F8F9FA",
    borderRadius: 10,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#EEE",
    borderStyle: "dashed",
  },
  grayEmptyText: { color: "#999", fontSize: 14 },
  inputWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
  },
  iconInsideInput: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    zIndex: 1,
  },
  inputWithIconPadding: { paddingRight: 44 },
  afterCloseHint: {
    fontSize: 13,
    color: "#666",
    marginTop: 12,
    marginBottom: 4,
    lineHeight: 18,
  },
  closeShiftBtn: {
    backgroundColor: "#232938",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 40,
  },
  closeShiftText: { color: "#FFF", fontSize: 18, fontWeight: "700" },
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  previewContent: {
    backgroundColor: "#FFF",
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    elevation: 10,
  },
  previewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  previewTitle: { fontSize: 20, fontWeight: "700", color: "#333" },
  previewLabelBox: {
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "stretch",
    marginBottom: 12,
  },
  previewLabelTop: { alignItems: "center", width: "100%" },
  previewModalFieldBlock: { width: "100%", marginTop: 16 },
  previewModalFieldLabel: { marginBottom: 8, alignSelf: "flex-start" },
  previewModalBagTypeRow: { flexDirection: "column", width: "100%", gap: 10 },
  previewModalBagTypeBtn: {
    width: "100%",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    justifyContent: "center",
    alignItems: "center",
  },
  previewModalBagTypeBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    textAlign: "center",
  },
  previewModalRemarkInput: {
    minHeight: 48,
    marginTop: 0,
    textAlignVertical: "top",
  },
  previewCompany: {
    fontSize: 14,
    fontWeight: "700",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  qrContainer: {
    padding: 10,
    backgroundColor: "#FFF",
    borderRadius: 10,
    marginBottom: 15,
    elevation: 2,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  previewQRIdBox: {
    backgroundColor: "#000",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginBottom: 15,
  },
  previewQRIdText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 1,
  },
  previewGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: 2,
  },
  previewItem: {
    width: "48%",
    marginBottom: 10,
    minHeight: 38,
    paddingRight: 6,
  },
  previewItemRight: {
    width: "48%",
    marginBottom: 10,
    minHeight: 38,
    alignItems: "flex-end",
    paddingLeft: 6,
  },
  previewLabel: {
    fontSize: 10,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  previewValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
    lineHeight: 18,
    width: "100%",
  },
  previewValueRight: { textAlign: "right" },
  printActionBtn: {
    flexDirection: "row",
    backgroundColor: "#17a34a",
    padding: 18,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  printActionText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
});

export default DashboardScreen;
