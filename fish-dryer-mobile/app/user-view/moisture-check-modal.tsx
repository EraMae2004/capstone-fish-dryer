import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { resolveMoisturePercent, formatMoisturePercent } from "@/lib/duration-format";
import { isMoistureProbeWorking } from "@/lib/hardware-status-rtdb";
import {
  newMoistureBatchLabel,
  nextFishLabel,
  totalMoistureCheckCount,
  type MoistureBatchDraft,
  type MoistureFishReading,
} from "@/lib/moisture-checks";
import { userTypography } from "@/lib/user-typography";

type Props = {
  visible: boolean;
  onClose: () => void;
  batches: MoistureBatchDraft[];
  onBatchesChange: (next: MoistureBatchDraft[]) => void;
  liveReadings: Record<string, unknown> | null;
  moistureSensorStatus?: string;
  onNotifyNoReading?: () => void;
};

function newLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatRecordedAt(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function captureReading(moisture: number, fishLabel: string): MoistureFishReading {
  return {
    localId: newLocalId(),
    moisture: Math.round(moisture),
    recordedAt: new Date().toISOString(),
    fishLabel,
  };
}

export default function MoistureCheckModal({
  visible,
  onClose,
  batches,
  onBatchesChange,
  liveReadings,
  moistureSensorStatus,
  onNotifyNoReading,
}: Props) {
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const probeWorking = isMoistureProbeWorking(liveReadings, moistureSensorStatus);
  const liveMoisture = probeWorking ? resolveMoisturePercent(liveReadings) : null;
  const liveMoistureLabel = probeWorking
    ? formatMoisturePercent(liveMoisture) ?? "--"
    : "Sensor is not working";

  useEffect(() => {
    if (!visible) {
      setExpandedBatchId(null);
    }
  }, [visible]);

  const toggleBatch = (batchId: string) => {
    setExpandedBatchId((cur) => (cur === batchId ? null : batchId));
  };

  const addBatch = () => {
    const newBatch: MoistureBatchDraft = {
      localId: newLocalId(),
      label: newMoistureBatchLabel(batches),
      readings: [],
    };
    onBatchesChange([...batches, newBatch]);
    setExpandedBatchId(newBatch.localId);
  };

  const removeBatch = (batch: MoistureBatchDraft) => {
    onBatchesChange(batches.filter((row) => row.localId !== batch.localId));
    if (expandedBatchId === batch.localId) {
      setExpandedBatchId(null);
    }
  };

  const removeReading = (batch: MoistureBatchDraft, reading: MoistureFishReading) => {
    onBatchesChange(
      batches.map((row) =>
        row.localId === batch.localId
          ? { ...row, readings: row.readings.filter((r) => r.localId !== reading.localId) }
          : row
      )
    );
  };

  const notifySensorNotWorking = () => {
    Alert.alert(
      "Sensor is not working",
      "The moisture probe is on standby. Place it firmly on the fish until the sensor shows Working, then try again."
    );
    onNotifyNoReading?.();
  };

  const canRecordReading = (): boolean => {
    if (!probeWorking) {
      notifySensorNotWorking();
      return false;
    }
    if (liveMoisture == null) {
      Alert.alert(
        "No reading yet",
        "The sensor is working but no moisture value was read. Hold the probe on the fish and try again."
      );
      return false;
    }
    return true;
  };

  const checkNew = (batch: MoistureBatchDraft) => {
    if (!canRecordReading() || liveMoisture == null) return;
    const fishLabel = nextFishLabel(batch);
    const reading = captureReading(liveMoisture, fishLabel);
    onBatchesChange(
      batches.map((row) =>
        row.localId === batch.localId
          ? { ...row, readings: [...row.readings, reading] }
          : row
      )
    );
  };

  const checkAgain = (batch: MoistureBatchDraft) => {
    if (!canRecordReading() || liveMoisture == null) return;
    const last = batch.readings[batch.readings.length - 1];
    const fishLabel = last ? last.fishLabel : "Fish 1";
    const reading = captureReading(liveMoisture, fishLabel);

    onBatchesChange(
      batches.map((row) => {
        if (row.localId !== batch.localId) return row;
        if (last) {
          return {
            ...row,
            readings: row.readings.map((r) => (r.localId === last.localId ? reading : r)),
          };
        }
        return { ...row, readings: [...row.readings, reading] };
      })
    );
  };

  const checkTotal = totalMoistureCheckCount(batches);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="overFullScreen"
      navigationBarTranslucent
    >
      <View style={styles.root} pointerEvents="box-none">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close moisture checks" />

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Moisture checks</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          <View style={styles.probeRow}>
            <Text style={styles.probeLabel}>Probe</Text>
            <Text
              style={[styles.probeValue, !probeWorking && styles.probeValueFault]}
            >
              {liveMoistureLabel}
            </Text>
          </View>

          <TouchableOpacity style={styles.addBtn} onPress={addBatch} activeOpacity={0.85}>
            <MaterialCommunityIcons name="plus" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Add batch</Text>
          </TouchableOpacity>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {batches.length === 0 ? (
              <Text style={styles.emptyText}>No batches yet. Tap Add batch above.</Text>
            ) : (
              batches.map((batch) => {
                const expanded = expandedBatchId === batch.localId;
                const count = batch.readings.length;
                return (
                  <View
                    key={batch.localId}
                    style={[styles.batchCard, expanded && styles.batchCardExpanded]}
                  >
                    <View style={styles.batchHeader}>
                      <TouchableOpacity
                        style={styles.batchHeaderLeft}
                        onPress={() => toggleBatch(batch.localId)}
                        activeOpacity={0.75}
                      >
                        <MaterialCommunityIcons
                          name={expanded ? "chevron-down" : "chevron-right"}
                          size={20}
                          color="#64748b"
                        />
                        <Text style={styles.batchTitle}>{batch.label}</Text>
                        {count > 0 ? (
                          <View style={styles.countBadge}>
                            <Text style={styles.countBadgeText}>{count}</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => removeBatch(batch)}
                        hitSlop={8}
                      >
                        <MaterialCommunityIcons
                          name="trash-can-outline"
                          size={18}
                          color="#b91c1c"
                        />
                      </TouchableOpacity>
                    </View>

                    {expanded ? (
                      <View style={styles.batchBody}>
                        {count === 0 ? (
                          <Text style={styles.noReadings}>No fish checked yet</Text>
                        ) : (
                          <ScrollView
                            style={styles.readingsScroll}
                            nestedScrollEnabled
                            showsVerticalScrollIndicator={false}
                          >
                            {batch.readings.map((reading) => (
                              <View key={reading.localId} style={styles.readingRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.readingFish}>{reading.fishLabel}</Text>
                                  <Text style={styles.readingValue}>{reading.moisture}%</Text>
                                  {reading.recordedAt ? (
                                    <Text style={styles.readingTime}>
                                      {formatRecordedAt(reading.recordedAt)}
                                    </Text>
                                  ) : null}
                                </View>
                                <TouchableOpacity
                                  onPress={() => removeReading(batch, reading)}
                                  hitSlop={8}
                                >
                                  <MaterialCommunityIcons
                                    name="close-circle-outline"
                                    size={20}
                                    color="#94a3b8"
                                  />
                                </TouchableOpacity>
                              </View>
                            ))}
                          </ScrollView>
                        )}

                        <View style={styles.batchActions}>
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.againBtn]}
                            onPress={() => checkAgain(batch)}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.againBtnText}>Check again</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.actionBtn, styles.newBtn]}
                            onPress={() => checkNew(batch)}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.newBtnText}>New</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>

          {checkTotal > 0 ? (
            <Text style={styles.footerMeta}>
              {checkTotal} check{checkTotal === 1 ? "" : "s"} · saves when session stops
            </Text>
          ) : null}

          <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    zIndex: 1,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "82%",
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    zIndex: 2,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    ...userTypography.cardTitle,
    fontSize: 18,
    color: "#0f172a",
  },
  probeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  probeLabel: {
    ...userTypography.caption,
    color: "#64748b",
  },
  probeValue: {
    ...userTypography.bodyStrong,
    color: "#1f4e6c",
    fontSize: 16,
  },
  probeValueFault: {
    color: "#c0392b",
    fontSize: 14,
  },
  addBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0d3b66",
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  addBtnText: {
    ...userTypography.bodyStrong,
    color: "#fff",
  },
  list: {
    maxHeight: 280,
  },
  listContent: {
    gap: 8,
    paddingBottom: 4,
  },
  emptyText: {
    ...userTypography.body,
    color: "#94a3b8",
    textAlign: "center",
    paddingVertical: 12,
  },
  batchCard: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    backgroundColor: "#fafafa",
    overflow: "hidden",
  },
  batchCardExpanded: {
    borderColor: "#1f4e6c",
    backgroundColor: "#fff",
  },
  batchHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 11,
  },
  batchHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingRight: 8,
  },
  batchTitle: {
    ...userTypography.bodyStrong,
    color: "#0f172a",
  },
  countBadge: {
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 4,
  },
  countBadgeText: {
    ...userTypography.caption,
    color: "#0369a1",
    fontWeight: "700",
  },
  batchBody: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  noReadings: {
    ...userTypography.caption,
    color: "#94a3b8",
    marginTop: 8,
    marginBottom: 4,
  },
  readingsScroll: {
    maxHeight: 140,
    marginTop: 4,
  },
  readingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    gap: 8,
  },
  readingFish: {
    ...userTypography.caption,
    color: "#64748b",
  },
  readingValue: {
    ...userTypography.bodyStrong,
    color: "#1f4e6c",
    fontSize: 16,
  },
  readingTime: {
    ...userTypography.caption,
    color: "#94a3b8",
    fontSize: 11,
  },
  batchActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
  },
  againBtn: {
    borderWidth: 1,
    borderColor: "#1f4e6c",
    backgroundColor: "#fff",
  },
  againBtnText: {
    ...userTypography.bodyStrong,
    color: "#1f4e6c",
  },
  newBtn: {
    backgroundColor: "#1f4e6c",
  },
  newBtnText: {
    ...userTypography.bodyStrong,
    color: "#fff",
  },
  footerMeta: {
    ...userTypography.caption,
    color: "#64748b",
    textAlign: "center",
    marginTop: 8,
  },
  doneBtn: {
    marginTop: 6,
    paddingVertical: 10,
    alignItems: "center",
  },
  doneBtnText: {
    ...userTypography.bodyStrong,
    color: "#475569",
  },
});
