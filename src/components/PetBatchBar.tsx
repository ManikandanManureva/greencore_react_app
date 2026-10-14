import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { X, Plus, Clock, Square, Search } from "lucide-react-native";
import { t } from "../utils/i18n";
import {
  petBatchesApi,
  PET_REGIONS,
  type PetStationKey,
  type PetBatchSession,
  type PetBatch,
  type DeliveryNoteOption,
} from "../api/petbatches";

const STATION_I18N: Record<PetStationKey, string> = {
  crushing: "petBatch.crushing",
  washing: "petBatch.washing",
  flakes_sorting: "petBatch.flakesSorting",
  extrusion: "petBatch.extrusion",
};

export const petStationLabel = (s: PetStationKey) => t(STATION_I18N[s]);

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface SelectedDn {
  deliveryNote: string;
  /** false when typed manually and not found in Incoming Material (raw_material). */
  verified: boolean;
}

interface Props {
  station: PetStationKey | null;
  /** Fires whenever the active batch for this station changes — pass batch_no into bag saves. */
  onActiveBatchChange?: (batchNo: string | null) => void;
}

const PetBatchBar: React.FC<Props> = ({ station, onActiveBatchChange }) => {
  const [session, setSession] = useState<PetBatchSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Start-new-batch modal (Crushing only)
  const [newVisible, setNewVisible] = useState(false);
  const [region, setRegion] = useState<string | null>(null);
  const [regionAutoFilled, setRegionAutoFilled] = useState(false);
  const [dnQuery, setDnQuery] = useState("");
  const [dnResults, setDnResults] = useState<DeliveryNoteOption[]>([]);
  const [dnSearching, setDnSearching] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState<SelectedDn[]>([]);
  const [creating, setCreating] = useState(false);
  const dnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Select-existing-batch modal (Washing / Flakes Sorting / Extrusion)
  const [selectVisible, setSelectVisible] = useState(false);
  const [selectable, setSelectable] = useState<PetBatch[]>([]);
  const [selectLoading, setSelectLoading] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);

  const [ending, setEnding] = useState(false);

  const stationRef = useRef(station);
  stationRef.current = station;

  const loadRunning = useCallback(async () => {
    if (!station) {
      setSession(null);
      return;
    }
    setLoading(true);
    try {
      const res = await petBatchesApi.myRunning(station);
      if (stationRef.current !== station) return; // station changed while request was in flight
      setSession(res.data?.data || null);
    } catch {
      if (stationRef.current === station) setSession(null);
    } finally {
      setLoading(false);
    }
  }, [station]);

  useEffect(() => {
    loadRunning();
  }, [loadRunning]);

  useEffect(() => {
    onActiveBatchChange?.(session?.batch_no ?? null);
  }, [session, onActiveBatchChange]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  const runDnSearch = useCallback(async (q: string) => {
    setDnSearching(true);
    try {
      const res = await petBatchesApi.searchDeliveryNotes(q || undefined);
      setDnResults(res.data?.data || []);
    } catch {
      setDnResults([]);
    } finally {
      setDnSearching(false);
    }
  }, []);

  const onDnQueryChange = (text: string) => {
    setDnQuery(text);
    if (dnTimer.current) clearTimeout(dnTimer.current);
    dnTimer.current = setTimeout(() => runDnSearch(text.trim()), 350);
  };

  const openStart = () => {
    if (!station) return;
    if (station === "crushing") {
      setRegion(null);
      setRegionAutoFilled(false);
      setDnQuery("");
      setDnResults([]);
      setDeliveryNotes([]);
      setNewVisible(true);
      runDnSearch("");
    } else {
      setSelectVisible(true);
      setSelectLoading(true);
      petBatchesApi
        .selectable(station)
        .then((res) => setSelectable(res.data?.data || []))
        .catch(() => setSelectable([]))
        .finally(() => setSelectLoading(false));
    }
  };

  const addDn = (dn: string, verified: boolean, dnRegion?: string | null) => {
    const v = dn.trim();
    if (!v || deliveryNotes.some((d) => d.deliveryNote === v)) return;
    setDeliveryNotes((prev) => [...prev, { deliveryNote: v, verified }]);
    setDnQuery("");
    // Pre-fill region from the gate entry so it matches Incoming Material; operator can change it.
    if (!region && dnRegion && (PET_REGIONS as readonly string[]).includes(dnRegion)) {
      setRegion(dnRegion);
      setRegionAutoFilled(true);
    }
  };

  const createBatch = async () => {
    if (!region) {
      Alert.alert(t("common.error"), t("petBatch.selectRegion"));
      return;
    }
    if (deliveryNotes.length === 0) {
      Alert.alert(t("common.error"), t("petBatch.addDnRequired"));
      return;
    }
    setCreating(true);
    try {
      const res = await petBatchesApi.create(
        region,
        deliveryNotes.map((d) => d.deliveryNote),
      );
      const data = res.data?.data;
      if (data?.session) {
        setSession({
          ...data.session,
          batch_no: data.batch_no,
          region: data.region,
          region_code: data.region_code,
        });
      }
      setNewVisible(false);
      Alert.alert(
        t("petBatch.batchStartedTitle"),
        t("petBatch.batchStartedMsg", { batchNo: data?.batch_no ?? "" }),
      );
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.response?.data?.message || t("petBatch.failedCreate"));
    } finally {
      setCreating(false);
    }
  };

  const startExisting = async (batch: PetBatch) => {
    if (!station) return;
    setStarting(batch.id);
    try {
      const res = await petBatchesApi.start(batch.id, station);
      const s = res.data?.data;
      setSession({ ...s, batch_no: batch.batch_no, region: batch.region, region_code: batch.region_code });
      setSelectVisible(false);
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.response?.data?.message || t("petBatch.failedStart"));
    } finally {
      setStarting(null);
    }
  };

  const endBatch = () => {
    if (!session || !station) return;
    Alert.alert(
      t("petBatch.endBatch"),
      t("petBatch.endConfirm", { station: petStationLabel(station), batchNo: session.batch_no ?? "" }),
      [
        { text: t("petBatch.cancel"), style: "cancel" },
        {
          text: t("petBatch.end"),
          style: "destructive",
          onPress: async () => {
            setEnding(true);
            try {
              await petBatchesApi.end(session.batch_id, station);
              setSession(null);
            } catch (e: any) {
              Alert.alert(t("common.error"), e?.response?.data?.message || t("petBatch.failedEnd"));
            } finally {
              setEnding(false);
            }
          },
        },
      ],
    );
  };

  if (!station) return null;

  const trimmedQuery = dnQuery.trim();
  const exactMatch = dnResults.some((r) => r.deliveryNote.toLowerCase() === trimmedQuery.toLowerCase());

  return (
    <View style={styles.wrap}>
      {loading ? (
        <View style={styles.loadingBar}>
          <ActivityIndicator size="small" color="#0ea5e9" />
        </View>
      ) : session ? (
        <View style={styles.runningBar}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.runningLabel} numberOfLines={1}>
              {t("petBatch.runningTitle", {
                station: petStationLabel(station),
                batchNo: session.batch_no ?? "",
              })}
            </Text>
            <Text style={styles.runningSub} numberOfLines={1}>
              {t("petBatch.runningSub", {
                region: session.region ?? "",
                time: new Date(session.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              })}
            </Text>
          </View>
          <View style={styles.timerPill}>
            <Clock size={14} color="#fff" />
            <Text style={styles.timerText}>
              {formatElapsed(now - new Date(session.started_at).getTime())}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.endBtn}
            onPress={endBatch}
            disabled={ending}
            accessibilityLabel={t("petBatch.endBatch")}
          >
            {ending ? <ActivityIndicator size="small" color="#fff" /> : <Square size={14} color="#fff" fill="#fff" />}
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.startBar} onPress={openStart}>
          <Text style={styles.startBarText}>
            ▶ {t("petBatch.startBatchFor", { station: petStationLabel(station) })}
          </Text>
          <Text style={styles.startBarHint}>
            {station === "crushing" ? t("petBatch.startHintCrushing") : t("petBatch.startHintOther")}
          </Text>
        </TouchableOpacity>
      )}

      {/* Start new batch (Crushing) */}
      <Modal visible={newVisible} animationType="slide" transparent onRequestClose={() => setNewVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("petBatch.startNewBatch")}</Text>
              <TouchableOpacity onPress={() => setNewVisible(false)}>
                <X size={22} color="#333" />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>{t("petBatch.deliveryNotes")}</Text>
              {deliveryNotes.map((dn, idx) => (
                <View key={dn.deliveryNote} style={[styles.dnRow, !dn.verified && styles.dnRowWarn]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dnText}>{dn.deliveryNote}</Text>
                    {!dn.verified && <Text style={styles.dnWarnText}>⚠ {t("petBatch.manualWarning")}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => setDeliveryNotes((prev) => prev.filter((_, i) => i !== idx))}>
                    <X size={16} color="#dc2626" />
                  </TouchableOpacity>
                </View>
              ))}
              <View style={styles.searchBox}>
                <Search size={16} color="#94a3b8" />
                <TextInput
                  style={styles.searchInput}
                  placeholder={t("petBatch.searchDn")}
                  placeholderTextColor="#9ca3af"
                  value={dnQuery}
                  onChangeText={onDnQueryChange}
                  autoCapitalize="characters"
                  returnKeyType="search"
                />
                {dnSearching && <ActivityIndicator size="small" color="#0369a1" />}
              </View>
              <View style={styles.dnResults}>
                {dnResults
                  .filter((r) => !deliveryNotes.some((d) => d.deliveryNote === r.deliveryNote))
                  .slice(0, 8)
                  .map((r) => (
                    <TouchableOpacity
                      key={r.id}
                      style={styles.dnOption}
                      onPress={() => addDn(r.deliveryNote, true, r.region)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dnOptionTitle}>{r.deliveryNote}</Text>
                        <Text style={styles.dnOptionSub} numberOfLines={1}>
                          {[
                            r.netWeight != null ? `${Number(r.netWeight).toLocaleString()} kg` : null,
                            r.supplier,
                            r.region,
                            r.entrydate ? String(r.entrydate).slice(0, 10) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                        {r.used_in_batches ? (
                          <Text style={styles.dnUsedText}>
                            {t("petBatch.alreadyInBatch", { batches: r.used_in_batches })}
                          </Text>
                        ) : null}
                      </View>
                      <Plus size={18} color="#17a34a" />
                    </TouchableOpacity>
                  ))}
                {!dnSearching && trimmedQuery.length > 0 && !exactMatch && (
                  <>
                    {dnResults.length === 0 && <Text style={styles.emptyText}>{t("petBatch.dnNoResults")}</Text>}
                    <TouchableOpacity style={styles.manualBtn} onPress={() => addDn(trimmedQuery, false)}>
                      <Text style={styles.manualBtnText}>{t("petBatch.addManual", { dn: trimmedQuery })}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>{t("petBatch.region")}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                {PET_REGIONS.map((r) => {
                  const active = region === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      onPress={() => {
                        setRegion(r);
                        setRegionAutoFilled(false);
                      }}
                      style={[styles.regionChip, active && styles.regionChipActive]}
                    >
                      <Text style={[styles.regionChipText, active && styles.regionChipTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {regionAutoFilled && <Text style={styles.hintText}>{t("petBatch.regionFromDn")}</Text>}

              <TouchableOpacity
                style={[styles.primaryBtn, creating && { opacity: 0.6 }]}
                onPress={createBatch}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t("petBatch.generateBatch")}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Select existing batch (Washing / Flakes Sorting / Extrusion) */}
      <Modal visible={selectVisible} animationType="slide" transparent onRequestClose={() => setSelectVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("petBatch.selectBatch")}</Text>
              <TouchableOpacity onPress={() => setSelectVisible(false)}>
                <X size={22} color="#333" />
              </TouchableOpacity>
            </View>
            {selectLoading ? (
              <ActivityIndicator color="#17a34a" style={{ marginTop: 20 }} />
            ) : selectable.length === 0 ? (
              <Text style={styles.emptyText}>{t("petBatch.noBatchesReady")}</Text>
            ) : (
              <ScrollView>
                {selectable.map((b) => (
                  <TouchableOpacity
                    key={b.id}
                    style={styles.batchOption}
                    onPress={() => startExisting(b)}
                    disabled={starting === b.id}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.batchOptionTitle}>{b.batch_no}</Text>
                      <Text style={styles.batchOptionSub}>{b.region}</Text>
                    </View>
                    {starting === b.id && <ActivityIndicator size="small" color="#0ea5e9" />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8 },
  loadingBar: { paddingVertical: 10, alignItems: "center" },
  runningBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0c4a6e",
    borderRadius: 12,
    padding: 10,
    gap: 10,
  },
  runningLabel: { color: "#fff", fontWeight: "700", fontSize: 13 },
  runningSub: { color: "#bae6fd", fontSize: 11, marginTop: 2 },
  timerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#0369a1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  timerText: { color: "#fff", fontWeight: "700", fontSize: 12, fontVariant: ["tabular-nums"] },
  endBtn: {
    backgroundColor: "#dc2626",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  startBar: {
    backgroundColor: "#17a34a",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  startBarText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  startBarHint: { color: "#dcfce7", fontSize: 11, marginTop: 4, textAlign: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: "88%",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: "800", color: "#1f2937" },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#6b7280", marginBottom: 6 },
  hintText: { fontSize: 11, color: "#0369a1", marginBottom: 4 },
  regionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  regionChipActive: { backgroundColor: "#17a34a", borderColor: "#17a34a" },
  regionChipText: { fontSize: 13, color: "#4b5563", fontWeight: "600" },
  regionChipTextActive: { color: "#fff" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: "#fff",
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: "#1f2937" },
  dnResults: { marginTop: 6 },
  dnOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    gap: 8,
  },
  dnOptionTitle: { fontSize: 14, fontWeight: "700", color: "#1f2937" },
  dnOptionSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  dnUsedText: { fontSize: 11, color: "#b45309", marginTop: 2 },
  dnRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
  },
  dnRowWarn: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  dnText: { fontSize: 13, color: "#1f2937", fontWeight: "700" },
  dnWarnText: { fontSize: 11, color: "#b45309", marginTop: 2 },
  manualBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d97706",
    alignItems: "center",
  },
  manualBtnText: { color: "#b45309", fontWeight: "700", fontSize: 13 },
  primaryBtn: { backgroundColor: "#17a34a", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 20, marginBottom: 20 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  emptyText: { textAlign: "center", color: "#6b7280", paddingVertical: 14 },
  batchOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  batchOptionTitle: { fontSize: 14, fontWeight: "700", color: "#1f2937" },
  batchOptionSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
});

export default PetBatchBar;
