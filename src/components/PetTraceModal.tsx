import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, Camera } from "expo-camera";
import { X, ScanLine, Search, ChevronRight } from "lucide-react-native";
import { t } from "../utils/i18n";
import {
  petBatchesApi,
  type TraceResult,
  type TraceBag,
  type PetStationKey,
} from "../api/petbatches";
import { petStationLabel } from "./PetBatchBar";

const STATION_ORDER: PetStationKey[] = ["crushing", "washing", "flakes_sorting", "extrusion"];

/** Bag number = the running number at the end of the bag QR, shown 4-digit like the PET label. */
export function bagNumberFromQr(qr?: string | null): string {
  const last = String(qr || "").split("-").pop() || "";
  return /^\d+$/.test(last) ? last.padStart(4, "0") : last;
}

function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(
    d.getHours(),
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function bagStationLabel(b: TraceBag): string {
  if (b.sub_line === "Flakes PET") return "Boretech (Flakes Sorting)";
  if (b.sub_line === "Pellet PET") return "Starlinger (Extrusion)";
  if (b.sub_line === "Final PET") return "Final Packing";
  return b.station_name || "—";
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

const PetTraceModal: React.FC<Props> = ({ visible, onClose }) => {
  const isWeb = Platform.OS === "web";
  const [mode, setMode] = useState<"scan" | "result">("scan");
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanLocked, setScanLocked] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceResult | null>(null);

  useEffect(() => {
    if (!visible) return;
    setMode("scan");
    setScanLocked(false);
    setCode("");
    setError(null);
    setResult(null);
    if (!isWeb) {
      Camera.requestCameraPermissionsAsync()
        .then(({ status }) => setHasPermission(status === "granted"))
        .catch(() => setHasPermission(false));
    }
  }, [visible, isWeb]);

  const lookup = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    try {
      const res = await petBatchesApi.trace(value);
      setResult(res.data?.data || null);
      setMode("result");
    } catch (e: any) {
      setError(e?.response?.status === 404 ? t("petBatch.notFound") : e?.response?.data?.message || t("petBatch.notFound"));
      setScanLocked(false);
    } finally {
      setLoading(false);
    }
  };

  const onScanned = ({ data }: { data: string }) => {
    if (scanLocked || loading) return;
    setScanLocked(true);
    setCode(data);
    lookup(data);
  };

  const scanAgain = () => {
    setMode("scan");
    setResult(null);
    setError(null);
    setCode("");
    setScanLocked(false);
  };

  const batch = result?.batch || null;
  const bag = result?.bag || null;

  const sessionFor = (key: PetStationKey) => {
    const list = (batch?.sessions || []).filter((s) => s.station_key === key);
    return list.length ? list[list.length - 1] : null;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={{ padding: 6 }} accessibilityLabel={t("petBatch.close")}>
            <X size={24} color="#1f2937" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {mode === "scan" ? t("petBatch.scanTitle") : t("petBatch.traceTitle")}
          </Text>
        </View>

        {mode === "scan" ? (
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {!isWeb && hasPermission ? (
              <View style={styles.cameraBox}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  onBarcodeScanned={scanLocked ? undefined : onScanned}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                />
                <View style={styles.cameraOverlay}>
                  <ScanLine size={48} color="#fff" />
                  <Text style={styles.cameraHint}>{t("petBatch.scanHint")}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.noCamera}>
                <Text style={styles.noCameraText}>{t("petBatch.cameraUnavailable")}</Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>{t("petBatch.orEnterCode")}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="20261014-PET-S1-EXT-0024 / GPET/261014/JB/01"
                placeholderTextColor="#9ca3af"
                autoCapitalize="characters"
                onSubmitEditing={() => lookup(code)}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.lookupBtn} onPress={() => lookup(code)} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Search size={20} color="#fff" />}
              </TouchableOpacity>
            </View>
            {error && <Text style={styles.errorText}>{error}</Text>}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {/* Bag */}
            {bag && (
              <View style={styles.card}>
                <Text style={styles.cardKicker}>{t("petBatch.bagNumber")}</Text>
                <Text style={styles.bigValue}>{bagNumberFromQr(bag.output_bag_qr)}</Text>
                <Text style={styles.mono}>{bag.output_bag_qr}</Text>
                <Row label={t("petBatch.station")} value={bagStationLabel(bag)} />
                <Row label={t("petBatch.weight")} value={`${Number(bag.weight) || 0} kg`} />
                <Row label={t("petBatch.status")} value={bag.status || "—"} />
                <Row label={t("petBatch.produced")} value={fmtDateTime(bag.created_at)} />
                {bag.operator_name ? <Row label={t("petBatch.operator")} value={bag.operator_name} /> : null}
              </View>
            )}

            {/* Batch */}
            {batch ? (
              <View style={[styles.card, { borderColor: "#7dd3fc", backgroundColor: "#f0f9ff" }]}>
                <Text style={styles.cardKicker}>{t("petBatch.batchNumber")}</Text>
                <Text style={[styles.bigValue, { fontSize: 22 }]}>{batch.batch_no}</Text>
                <Row label={t("petBatch.region")} value={batch.region} />
                <Row label={t("petBatch.deliveryNotes")} value={batch.delivery_notes.join(", ") || "—"} />
                <Text style={styles.smallMuted}>
                  {t("petBatch.bagsInBatch", { count: String(batch.bags.length) })}
                </Text>
              </View>
            ) : (
              <View style={[styles.card, { borderColor: "#fde68a", backgroundColor: "#fffbeb" }]}>
                <Text style={{ color: "#92400e", fontSize: 13 }}>{result?.message || t("petBatch.noBatchForBag")}</Text>
              </View>
            )}

            {/* Raw material */}
            {batch && batch.raw_material.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t("petBatch.rawMaterial")}</Text>
                {batch.raw_material.map((rm: any) => (
                  <View key={rm.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{rm.deliveryNote}</Text>
                    <Row label={t("petBatch.supplier")} value={rm.supplier || "—"} />
                    <Row label={t("petBatch.truck")} value={rm.truckId || "—"} />
                    <Row label={t("petBatch.entryDate")} value={rm.entrydate ? String(rm.entrydate).slice(0, 10) : "—"} />
                    <Row
                      label={t("petBatch.netWeight")}
                      value={rm.netWeight != null ? `${Number(rm.netWeight).toLocaleString()} kg` : "—"}
                    />
                    {rm.region ? <Row label={t("petBatch.region")} value={rm.region} /> : null}
                  </View>
                ))}
              </>
            )}

            {/* Station timeline */}
            {batch && (
              <>
                <Text style={styles.sectionTitle}>{t("petBatch.stationTimeline")}</Text>
                <View style={styles.card}>
                  {STATION_ORDER.map((key) => {
                    const s = sessionFor(key);
                    return (
                      <View key={key} style={styles.timelineRow}>
                        <View
                          style={[
                            styles.timelineDot,
                            { backgroundColor: !s ? "#cbd5e1" : s.ended_at ? "#16a34a" : "#0ea5e9" },
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.timelineStation}>{petStationLabel(key)}</Text>
                          <Text style={styles.timelineTime}>
                            {!s
                              ? t("petBatch.notStarted")
                              : `${fmtDateTime(s.started_at)} → ${s.ended_at ? fmtDateTime(s.ended_at) : t("petBatch.running")}`}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {/* Lineage */}
            {result && result.lineage.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t("petBatch.lineage")}</Text>
                {result.lineage.map((b) => (
                  <BagRow key={b.id} bag={b} />
                ))}
              </>
            )}

            {/* Downstream */}
            {result && result.downstream.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t("petBatch.downstream")}</Text>
                {result.downstream.map((b) => (
                  <BagRow key={b.id} bag={b} />
                ))}
              </>
            )}

            <TouchableOpacity style={styles.primaryBtn} onPress={scanAgain}>
              <Text style={styles.primaryBtnText}>{t("petBatch.scanAgain")}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue}>{value}</Text>
  </View>
);

const BagRow = ({ bag }: { bag: TraceBag }) => (
  <View style={styles.bagRow}>
    <View style={{ flex: 1 }}>
      <Text style={styles.bagRowTitle}>
        {bagStationLabel(bag)} · #{bagNumberFromQr(bag.output_bag_qr)}
      </Text>
      <Text style={styles.bagRowSub}>
        {bag.output_bag_qr} · {Number(bag.weight) || 0} kg · {fmtDateTime(bag.created_at)}
      </Text>
    </View>
    <ChevronRight size={16} color="#cbd5e1" />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1f2937" },
  cameraBox: {
    height: 300,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
    marginBottom: 16,
  },
  cameraOverlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  cameraHint: { color: "#fff", marginTop: 8, fontSize: 13, fontWeight: "600" },
  noCamera: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  noCameraText: { color: "#64748b", fontSize: 13, textAlign: "center" },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#6b7280", marginBottom: 6 },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#1f2937",
  },
  lookupBtn: {
    backgroundColor: "#0ea5e9",
    borderRadius: 8,
    width: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: { color: "#dc2626", marginTop: 10, fontSize: 13 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 14,
    marginBottom: 10,
  },
  cardKicker: { fontSize: 11, fontWeight: "700", color: "#64748b", textTransform: "uppercase" },
  cardTitle: { fontSize: 14, fontWeight: "800", color: "#1f2937", marginBottom: 6 },
  bigValue: { fontSize: 32, fontWeight: "900", color: "#0f172a", marginTop: 2 },
  mono: { fontSize: 12, color: "#475569", marginBottom: 8 },
  smallMuted: { fontSize: 12, color: "#64748b", marginTop: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 12 },
  rowLabel: { fontSize: 13, color: "#64748b" },
  rowValue: { fontSize: 13, color: "#1f2937", fontWeight: "600", flexShrink: 1, textAlign: "right" },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "#17a34a", marginTop: 8, marginBottom: 8 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  timelineDot: { width: 12, height: 12, borderRadius: 6 },
  timelineStation: { fontSize: 13, fontWeight: "700", color: "#1f2937" },
  timelineTime: { fontSize: 12, color: "#64748b", marginTop: 1 },
  bagRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 12,
    marginBottom: 8,
  },
  bagRowTitle: { fontSize: 13, fontWeight: "700", color: "#1f2937" },
  bagRowSub: { fontSize: 11, color: "#64748b", marginTop: 2 },
  primaryBtn: { backgroundColor: "#0ea5e9", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

export default PetTraceModal;
