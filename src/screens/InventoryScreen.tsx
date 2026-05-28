import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Plus,
  Search,
  X,
  Package,
  RefreshCw,
} from "lucide-react-native";
import {
  inventoryApi,
  INVENTORY_STATUSES,
  type RawMaterial,
  type InventorySummary,
} from "../api/inventory";

type FieldType = "text" | "number" | "date" | "time" | "multiline";

interface FieldDef {
  key: keyof RawMaterial;
  label: string;
  type: FieldType;
}

interface SectionDef {
  title: string;
  fields: FieldDef[];
}

// Form layout — every editable raw_material column, grouped into sections.
const FORM_SECTIONS: SectionDef[] = [
  {
    title: "Entry Details",
    fields: [
      { key: "refId", label: "Reference ID", type: "text" },
      { key: "entrydate", label: "Entry Date", type: "date" },
      { key: "entrytime", label: "Entry Time", type: "time" },
      { key: "truckId", label: "Truck ID", type: "text" },
      { key: "supplier", label: "Supplier", type: "text" },
      { key: "materialType", label: "Material Type", type: "text" },
      {
        key: "materialDescription",
        label: "Material Description",
        type: "multiline",
      },
    ],
  },
  {
    title: "Weights & Quantity",
    fields: [
      { key: "entryWeight", label: "Entry Weight (kg)", type: "number" },
      { key: "exitWeight", label: "Exit Weight (kg)", type: "number" },
      { key: "netWeight", label: "Net Weight (kg)", type: "number" },
      { key: "quantity", label: "Quantity", type: "number" },
    ],
  },
  {
    title: "Exit Details",
    fields: [
      { key: "exitdate", label: "Exit Date", type: "date" },
      { key: "exittime", label: "Exit Time", type: "time" },
      { key: "deliveryNote", label: "Delivery Note", type: "text" },
    ],
  },
  {
    title: "Return Trip",
    fields: [
      { key: "returnentrydate", label: "Return Entry Date", type: "date" },
      { key: "returnentrytime", label: "Return Entry Time", type: "time" },
      { key: "returnExitDate", label: "Return Exit Date", type: "date" },
      { key: "returnExitTime", label: "Return Exit Time", type: "time" },
      {
        key: "returnEntryWeight",
        label: "Return Entry Weight (kg)",
        type: "number",
      },
      {
        key: "returnExitWeight",
        label: "Return Exit Weight (kg)",
        type: "number",
      },
      {
        key: "returnNetWeight",
        label: "Return Net Weight (kg)",
        type: "number",
      },
    ],
  },
  {
    title: "Other",
    fields: [
      { key: "recordNoWBS", label: "WBS Record No.", type: "text" },
      { key: "plant", label: "Plant", type: "text" },
      { key: "notes", label: "Notes", type: "multiline" },
    ],
  },
];

const ALL_KEYS: (keyof RawMaterial)[] = FORM_SECTIONS.flatMap((s) =>
  s.fields.map((f) => f.key),
);

type FormState = Record<string, string>;

function emptyForm(): FormState {
  const f: FormState = {};
  ALL_KEYS.forEach((k) => {
    f[k as string] = "";
  });
  return f;
}

function recordToForm(r: RawMaterial): FormState {
  const f = emptyForm();
  ALL_KEYS.forEach((k) => {
    const v = (r as any)[k];
    f[k as string] = v === null || v === undefined ? "" : String(v);
  });
  return f;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  Pending: { bg: "#FEF3C7", fg: "#B45309" },
  Accepted: { bg: "#DCFCE7", fg: "#15803D" },
  Rejected: { bg: "#FEE2E2", fg: "#B91C1C" },
};

const PAGE_SIZE = 25;

const InventoryScreen = ({ navigation }: any) => {
  const [records, setRecords] = useState<RawMaterial[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Add / edit modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formStatus, setFormStatus] = useState<string>("Pending");
  const [saving, setSaving] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const res = await inventoryApi.summary();
      if (res.data?.success) setSummary(res.data.data);
    } catch {
      // Summary is non-critical — ignore failures.
    }
  }, []);

  const loadPage = useCallback(
    async (pageToLoad: number, append: boolean) => {
      try {
        setError(null);
        const res = await inventoryApi.list({
          search: search.trim() || undefined,
          status: statusFilter || undefined,
          page: pageToLoad,
          limit: PAGE_SIZE,
        });
        const body = res.data;
        if (!body?.success) throw new Error("Request failed");
        setRecords((prev) =>
          append ? [...prev, ...body.data] : body.data,
        );
        setPage(body.page);
        setTotalPages(body.totalPages);
        setTotal(body.total);
      } catch (e: any) {
        const msg =
          e?.response?.data?.message ||
          e?.message ||
          "Failed to load inventory";
        setError(msg);
        if (!append) setRecords([]);
      }
    },
    [search, statusFilter],
  );

  // Initial load + reload whenever the status filter changes.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await Promise.all([loadPage(1, false), loadSummary()]);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const runSearch = async () => {
    setLoading(true);
    await loadPage(1, false);
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadPage(1, false), loadSummary()]);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    await loadPage(page + 1, true);
    setLoadingMore(false);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormStatus("Pending");
    setModalVisible(true);
  };

  const openEdit = (r: RawMaterial) => {
    setEditingId(r.id);
    setForm(recordToForm(r));
    setFormStatus(r.status || "Pending");
    setModalVisible(true);
  };

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = { status: formStatus };
      ALL_KEYS.forEach((k) => {
        payload[k as string] = form[k as string] ?? "";
      });
      if (editingId == null) {
        await inventoryApi.create(payload);
      } else {
        await inventoryApi.update(editingId, payload);
      }
      setModalVisible(false);
      await Promise.all([loadPage(1, false), loadSummary()]);
    } catch (e: any) {
      const msg =
        e?.response?.data?.message || e?.message || "Failed to save record";
      Alert.alert("Save failed", msg);
    } finally {
      setSaving(false);
    }
  };

  const renderCard = ({ item }: { item: RawMaterial }) => {
    const sc = STATUS_COLORS[item.status || "Pending"] || STATUS_COLORS.Pending;
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => openEdit(item)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardRef} numberOfLines={1}>
            {fmt(item.refId)}
          </Text>
          <View style={[styles.badge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.badgeText, { color: sc.fg }]}>
              {item.status || "Pending"}
            </Text>
          </View>
        </View>
        <View style={styles.cardGrid}>
          <Field label="Supplier" value={fmt(item.supplier)} />
          <Field label="Material" value={fmt(item.materialType)} />
          <Field label="Truck ID" value={fmt(item.truckId)} />
          <Field label="Entry Date" value={fmt(item.entrydate)} />
          <Field label="Net Weight" value={fmt(item.netWeight)} />
          <Field label="Plant" value={fmt(item.plant)} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={Platform.OS === "web" ? [] : ["top", "bottom"]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
        >
          <ArrowLeft color="#1f2937" size={24} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Package color="#17a34a" size={20} />
          <Text style={styles.headerTitle}>Inventory</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.iconBtn}>
          <RefreshCw color="#1f2937" size={20} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openAdd} style={styles.addBtn}>
          <Plus color="#fff" size={20} />
        </TouchableOpacity>
      </View>

      {/* Summary cards */}
      {summary && (
        <View style={styles.summaryRow}>
          <SummaryCard label="Total" value={summary.total} color="#0ea5e9" />
          <SummaryCard
            label="Pending"
            value={summary.pending}
            color="#d97706"
          />
          <SummaryCard
            label="Accepted"
            value={summary.accepted}
            color="#16a34a"
          />
          <SummaryCard
            label="Rejected"
            value={summary.rejected}
            color="#dc2626"
          />
        </View>
      )}

      {/* Search + status filter */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search color="#9ca3af" size={18} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search ref, supplier, truck…"
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={runSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setSearch("");
              }}
            >
              <X color="#9ca3af" size={18} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.searchBtn} onPress={runSearch}>
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {["", ...INVENTORY_STATUSES].map((s) => (
          <TouchableOpacity
            key={s || "all"}
            style={[
              styles.filterChip,
              statusFilter === s && styles.filterChipActive,
            ]}
            onPress={() => setStatusFilter(s)}
          >
            <Text
              style={[
                styles.filterChipText,
                statusFilter === s && styles.filterChipTextActive,
              ]}
            >
              {s || "All"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#17a34a" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={runSearch}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderCard}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListHeaderComponent={
            <Text style={styles.countText}>
              {total} record{total === 1 ? "" : "s"}
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No gate entries found</Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                style={{ marginVertical: 16 }}
                color="#17a34a"
              />
            ) : page < totalPages ? (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore}>
                <Text style={styles.loadMoreText}>Load more</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* Add / Edit modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => setModalVisible(false)}
              style={styles.iconBtn}
            >
              <X color="#1f2937" size={24} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>
                {editingId == null ? "New Gate Entry" : "Edit Gate Entry"}
              </Text>
            </View>
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* Status selector */}
              <Text style={styles.sectionTitle}>Status</Text>
              <View style={styles.filterRow}>
                {INVENTORY_STATUSES.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.filterChip,
                      formStatus === s && styles.filterChipActive,
                    ]}
                    onPress={() => setFormStatus(s)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        formStatus === s && styles.filterChipTextActive,
                      ]}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {FORM_SECTIONS.map((section) => (
                <View key={section.title}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.fields.map((f) => (
                    <View key={f.key as string} style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>{f.label}</Text>
                      <TextInput
                        style={[
                          styles.input,
                          f.type === "multiline" && styles.inputMultiline,
                        ]}
                        value={form[f.key as string]}
                        onChangeText={(v) => updateField(f.key as string, v)}
                        placeholder={
                          f.type === "date"
                            ? "YYYY-MM-DD"
                            : f.type === "time"
                              ? "HH:MM"
                              : ""
                        }
                        placeholderTextColor="#9ca3af"
                        keyboardType={
                          f.type === "number" ? "numeric" : "default"
                        }
                        multiline={f.type === "multiline"}
                      />
                    </View>
                  ))}
                </View>
              ))}

              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {editingId == null ? "Create Entry" : "Save Changes"}
                  </Text>
                )}
              </TouchableOpacity>
              <View style={{ height: 32 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldCaption}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={styles.summaryCard}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    gap: 8,
  },
  iconBtn: { padding: 6 },
  headerTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1f2937" },
  addBtn: {
    backgroundColor: "#17a34a",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  summaryValue: { fontSize: 20, fontWeight: "800" },
  summaryLabel: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  searchRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    gap: 6,
  },
  searchInput: { flex: 1, paddingVertical: 8, fontSize: 14, color: "#1f2937" },
  searchBtn: {
    backgroundColor: "#17a34a",
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: "center",
  },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  filterChipActive: { backgroundColor: "#17a34a", borderColor: "#17a34a" },
  filterChipText: { fontSize: 13, color: "#4b5563", fontWeight: "600" },
  filterChipTextActive: { color: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  errorText: { color: "#dc2626", fontSize: 14, textAlign: "center" },
  emptyText: { color: "#6b7280", fontSize: 14 },
  retryBtn: {
    marginTop: 12,
    backgroundColor: "#17a34a",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryBtnText: { color: "#fff", fontWeight: "700" },
  listContent: { padding: 12, paddingBottom: 40 },
  countText: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 8,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardRef: { fontSize: 15, fontWeight: "700", color: "#1f2937", flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  cardGrid: { flexDirection: "row", flexWrap: "wrap" },
  field: { width: "33.33%", paddingVertical: 4, paddingRight: 6 },
  fieldCaption: { fontSize: 10, color: "#9ca3af", marginBottom: 1 },
  fieldValue: { fontSize: 13, color: "#374151", fontWeight: "600" },
  loadMoreBtn: {
    backgroundColor: "#e5e7eb",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  loadMoreText: { color: "#374151", fontWeight: "700" },
  formContent: { padding: 16 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#17a34a",
    marginTop: 18,
    marginBottom: 6,
  },
  fieldWrap: { marginBottom: 10 },
  fieldLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
    fontWeight: "600",
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#1f2937",
  },
  inputMultiline: { minHeight: 70, textAlignVertical: "top" },
  saveBtn: {
    backgroundColor: "#17a34a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

export default InventoryScreen;
