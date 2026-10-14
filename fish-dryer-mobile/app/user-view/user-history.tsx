import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { getApiBaseUrl } from "@/config/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import UserGraph, { type HistoryRange } from './user-graph';
import { userTypography } from "@/lib/user-typography";
import { formatSecondsAsHMS } from "@/lib/duration-format";
import { ListPaginationBar, useListPagination } from '@/lib/list-pagination';
import MachineDropdown from './machine-dropdown';
import { useSelectedMachine } from '@/lib/selected-machine';

function fmtPct(value: unknown): string {
  if (value === null || value === undefined || value === "") return "--";
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}` : "--";
}

/** Actual running time only (pause excluded). Never the planned or extended duration. */
function usedDryingSeconds(row: any): number {
  const sec = Number(row?.drying_time_seconds);
  if (Number.isFinite(sec) && sec >= 0) return Math.floor(sec);
  return 0;
}

function fmtSessionDryTime(row: any): string {
  return formatSecondsAsHMS(usedDryingSeconds(row));
}

const PHILIPPINE_TIME = "Asia/Manila";

/** API datetimes are UTC. Show them on Philippine time. */
function parseUtcStamp(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim().replace(" ", "T");
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtSessionDate(value: unknown): string {
  const date = parseUtcStamp(value);
  if (!date) return "--";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PHILIPPINE_TIME,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Clock time of the session in Philippine time, 12-hour (1–12). */
function fmtSessionClock(value: unknown): string {
  const date = parseUtcStamp(value);
  if (!date) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHILIPPINE_TIME,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function UserHistory({ active = true }: { active?: boolean }) {

  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<HistoryRange>('all');
  const {
    machines: userMachines,
    selectedId: selectedMachineId,
    selectMachine,
    loading: machinesLoading,
  } = useSelectedMachine();

  const fetchSeqRef = useRef(0);
  const selectedMachineIdRef = useRef(selectedMachineId);
  selectedMachineIdRef.current = selectedMachineId;
  const sessionsLenRef = useRef(0);
  const sessionsRef = useRef<any[]>([]);
  const deletedIdsRef = useRef<Set<number>>(new Set());
  const deletedCodesRef = useRef<Set<string>>(new Set());
  const HISTORY_DELETED_KEY = "history_deleted_sessions_v1";

  const persistDeletedSessions = () => {
    void AsyncStorage.setItem(
      HISTORY_DELETED_KEY,
      JSON.stringify({
        ids: Array.from(deletedIdsRef.current),
        codes: Array.from(deletedCodesRef.current),
      })
    );
  };

  const [deletedReady, setDeletedReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(HISTORY_DELETED_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const ids = Array.isArray(parsed?.ids) ? parsed.ids : [];
          const codes = Array.isArray(parsed?.codes) ? parsed.codes : [];
          ids.forEach((id: unknown) => {
            const n = Number(id);
            if (Number.isFinite(n) && n > 0) deletedIdsRef.current.add(n);
          });
          codes.forEach((code: unknown) => {
            const s = String(code ?? "").trim();
            if (s) deletedCodesRef.current.add(s);
          });
        }
      } catch {
        // ignore corrupt cache
      } finally {
        setDeletedReady(true);
      }
    })();
  }, []);

  const [boundMachineId, setBoundMachineId] = useState(selectedMachineId);
  const [boundRange, setBoundRange] = useState(range);
  if (boundMachineId !== selectedMachineId || boundRange !== range) {
    setBoundMachineId(selectedMachineId);
    setBoundRange(range);
    fetchSeqRef.current += 1;
    sessionsLenRef.current = 0;
    sessionsRef.current = [];
    setSelectedSession(null);
    setSelectedIds(new Set());
    setSessions([]);
  } else {
    sessionsRef.current = sessions;
  }

  const applySessions = (list: any[], machineId: number | null) => {
    const deleted = deletedIdsRef.current;
    const deletedCodes = deletedCodesRef.current;
    const next = list.filter((row) => {
      const id = Number(row?.id);
      if (Number.isFinite(id) && deleted.has(id)) return false;
      const code = String(row?.session_code ?? "").trim();
      if (code && deletedCodes.has(code)) return false;
      if (machineId == null || machineId <= 0) return true;
      const mid = Number(row?.microcontroller_id);
      if (!Number.isFinite(mid) || mid <= 0) return true;
      return mid === machineId;
    });
    sessionsLenRef.current = next.length;
    setSessions(next);
    return next;
  };

  const deleteSessionsOnServer = async (ids: number[], codes: string[]) => {
    const res = await fetch(`${getApiBaseUrl()}/drying-sessions/batch-delete`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids, session_codes: codes }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      throw new Error(String(data?.message ?? 'delete failed'));
    }
  };

  const fetchHistory = useCallback(async (rangeKey: typeof range, silent = false) => {
    const seq = ++fetchSeqRef.current;
    const machineId = selectedMachineIdRef.current;
    try {
      if (!silent && sessionsLenRef.current === 0) {
        setLoading(true);
      }
      const params = new URLSearchParams({ range: rangeKey });
      if (machineId != null && machineId > 0) {
        params.set('machine_id', String(machineId));
      }
      const res = await fetch(`${getApiBaseUrl()}/drying-sessions?${params.toString()}`);
      const data = await res.json();
      if (seq !== fetchSeqRef.current) return;

      const rows = data?.sessions ?? data?.data ?? data ?? [];
      const list = Array.isArray(rows) ? rows : [];
      applySessions(list, machineId);
      if (!silent) {
        setSelectedIds(new Set());
      }
    } catch (error) {
      console.log(error);
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!active || machinesLoading || !deletedReady) return;
    void fetchHistory(range);
  }, [range, active, selectedMachineId, machinesLoading, fetchHistory, deletedReady]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      void fetchHistory(range, true);
    }, 60000);
    return () => clearInterval(t);
  }, [range, active, fetchHistory]);

  /** API already filters by range; keep list in sync with graph. */
  const filteredSessions = sessions;

  const {
    pageItems: pagedSessions,
    page,
    totalPages,
    setPage,
    resetPage,
  } = useListPagination(filteredSessions);

  useEffect(() => {
    resetPage();
  }, [range, selectedMachineId, resetPage]);

  const pageIds = pagedSessions
    .map((item) => Number(item.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (pageIds.length > 0 && pageIds.every((id) => next.has(id))) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleViewDetails = (id: number) => {
    const existing = sessionsRef.current.find((row) => Number(row.id) === id) ?? null;
    if (existing) {
      setSelectedSession(existing);
    }
    void (async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/drying-sessions/${id}`);
        const data = await res.json();
        const detail = data?.data ?? data?.session ?? data;
        if (!detail || typeof detail !== 'object') return;
        const merged = existing ? { ...existing, ...detail } : detail;
        if (
          existing &&
          usedDryingSeconds(detail) === 0 &&
          usedDryingSeconds(existing) > 0
        ) {
          merged.drying_time_seconds = usedDryingSeconds(existing);
        }
        setSelectedSession(merged);
        setSessions((prev) => {
          const next = prev.map((row) =>
            Number(row.id) === id ? { ...row, ...merged } : row
          );
          sessionsLenRef.current = next.length;
          return next;
        });
      } catch (error) {
        console.log(error);
      }
    })();
  };

  const removeSessionsLocally = (ids: number[]) => {
    const idSet = new Set(ids.map((n) => Number(n)));
    idSet.forEach((id) => deletedIdsRef.current.add(id));
    sessionsRef.current.forEach((row) => {
      if (!idSet.has(Number(row?.id))) return;
      const code = String(row?.session_code ?? "").trim();
      if (code) deletedCodesRef.current.add(code);
    });
    persistDeletedSessions();
    setSessions((prev) => {
      const next = prev.filter((row) => !idSet.has(Number(row.id)));
      sessionsLenRef.current = next.length;
      sessionsRef.current = next;
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setSelectedSession((prev: any | null) =>
      prev && idSet.has(Number(prev.id)) ? null : prev
    );
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    Alert.alert(
      'Delete Selected',
      `Delete ${ids.length} drying session${ids.length === 1 ? '' : 's'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const codes = sessionsRef.current
              .filter((row) => ids.includes(Number(row?.id)))
              .map((row) => String(row?.session_code ?? "").trim())
              .filter((code) => code.length > 0);
            void (async () => {
              try {
                await deleteSessionsOnServer(ids, codes);
              } catch (error) {
                console.log(error);
                try {
                  await deleteSessionsOnServer(ids, codes);
                } catch (retryError) {
                  console.log(retryError);
                  Alert.alert("Delete failed", "Those sessions are still saved. Try again.");
                  return;
                }
              }
              removeSessionsLocally(ids);
              await fetchHistory(range, true);
            })();
          },
        },
      ]
    );
  };

  const detailChecks = Array.isArray(selectedSession?.moisture_checks)
    ? selectedSession.moisture_checks
    : [];
  const detailMoistureAvg =
    detailChecks.length > 0
      ? detailChecks.reduce(
          (sum: number, check: { moisture?: unknown }) => sum + Number(check?.moisture ?? 0),
          0
        ) / detailChecks.length
      : null;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>History</Text>

      <MachineDropdown
        active={active}
        machines={userMachines}
        selectedId={selectedMachineId}
        loading={machinesLoading}
        onSelect={selectMachine}
        style={styles.machineDropdown}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        <UserGraph
          key={`history-graph-${selectedMachineId ?? 0}-${filteredSessions.length}-${filteredSessions[0]?.id ?? 0}`}
          active={active}
          sessions={filteredSessions}
          summary={{ total_batches: filteredSessions.length }}
          range={range}
          onChangeRange={setRange}
        />

        {loading && sessions.length === 0 ? (
          <ActivityIndicator size="large" color="#4fc3f7" style={{ marginVertical: 24 }} />
        ) : null}

        <View style={styles.tableHeader}>
          <TouchableOpacity
            onPress={toggleSelectPage}
            style={styles.checkboxTouch}
            disabled={pageIds.length === 0}
            accessibilityLabel="Select all sessions on this page"
          >
            <FontAwesome
              name={allPageSelected ? 'check-square' : 'square-o'}
              size={20}
              color="#1f3b57"
            />
          </TouchableOpacity>
          <Text style={styles.headerText}>ID</Text>
          <Text style={styles.headerText}>Date</Text>
          <Text style={styles.headerText}>Fish</Text>
          <Text style={styles.headerText}>Action</Text>
        </View>

        {pagedSessions.map((item) => {
          const id = Number(item.id);
          const checked = selectedIds.has(id);
          return (
            <View style={styles.row} key={item.id}>
              <TouchableOpacity onPress={() => toggleSelect(id)} style={styles.checkboxTouch}>
                <FontAwesome
                  name={checked ? 'check-square' : 'square-o'}
                  size={20}
                  color="#1f3b57"
                />
              </TouchableOpacity>

              <Text style={styles.cell}>#{item.id}</Text>
              <Text style={styles.cell}>{fmtSessionDate(item.date)}</Text>
              <Text style={styles.cell}>{item.fish_type}</Text>

              <View style={styles.actions}>
                <TouchableOpacity onPress={() => handleViewDetails(id)}>
                  <FontAwesome name="eye" size={18} color="#4fc3f7" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {selectedIds.size > 0 ? (
          <TouchableOpacity style={styles.deleteSelected} onPress={handleDeleteSelected}>
            <FontAwesome name="trash" size={16} color="#e74c3c" />
            <Text style={styles.deleteSelectedText}> Delete selected</Text>
          </TouchableOpacity>
        ) : null}

        {filteredSessions.length > 0 ? (
          <View style={styles.paginationWrap}>
            <ListPaginationBar
              page={page}
              totalPages={totalPages}
              totalItems={filteredSessions.length}
              onPageChange={setPage}
            />
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={!!selectedSession} transparent animationType="fade" onRequestClose={() => setSelectedSession(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Drying Session Details</Text>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator>
              <Text style={styles.detailRow}>ID: #{selectedSession?.id}</Text>
              <Text style={styles.detailRow}>Date: {fmtSessionDate(selectedSession?.date ?? selectedSession?.ended_at)}</Text>
              <Text style={styles.detailRow}>
                Time: {fmtSessionClock(selectedSession?.date ?? selectedSession?.ended_at)}
              </Text>
              <Text style={styles.detailRow}>Fish Type: {selectedSession?.fish_type ?? '--'}</Text>
              <Text style={styles.detailRow}>No. of Fish: {selectedSession?.total_fish ?? '--'}</Text>
              <Text style={styles.detailRow}>Target Temp: {selectedSession?.target_temperature ?? '--'} °C</Text>
              <Text style={styles.detailRow}>
                Time used: {fmtSessionDryTime(selectedSession)}
              </Text>
              <Text style={styles.detailRow}>
                Temperature: {selectedSession?.temperature != null ? `${selectedSession.temperature} °C` : '--'}
              </Text>
              <Text style={styles.detailRow}>
                Humidity: {fmtPct(selectedSession?.humidity ?? selectedSession?.avg_humidity)} %
              </Text>

              {Array.isArray(selectedSession?.moisture_checks) &&
              selectedSession.moisture_checks.length > 0 ? (
                <View style={styles.moistureChecksBlock}>
                  <Text style={styles.moistureChecksTitle}>
                    Moisture checks ({selectedSession.moisture_checks.length})
                  </Text>
                  {selectedSession.moisture_checks.map((check: any, index: number) => (
                    <Text key={check.id ?? index} style={styles.moistureCheckRow}>
                      {check.check_label
                        ? `${check.check_label}: ${fmtPct(check.moisture)}%`
                        : `Check ${index + 1}: ${fmtPct(check.moisture)}%`}
                    </Text>
                  ))}
                  <Text style={styles.moistureSummaryRow}>
                    Average: {fmtPct(detailMoistureAvg)}%
                  </Text>
                  <Text style={styles.moistureSummaryRow}>
                    Last: {fmtPct(selectedSession?.moisture)}%
                  </Text>
                </View>
              ) : (
                <Text style={styles.detailRow}>
                  Moisture: {fmtPct(selectedSession?.moisture ?? selectedSession?.avg_moisture)} %
                </Text>
              )}
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedSession(null)}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({

  screen: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 0,
    paddingTop: 0,
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: 16,
  },

  title: {
    ...userTypography.pageTitle,
    marginBottom: 12,
    color: '#1f3b57'
  },

  machineDropdown: {
    marginBottom: 16,
  },

  tableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 10
  },

  headerText: {
    ...userTypography.tableHeader,
    color: '#1f3b57'
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 8,
    borderRadius: 8
  },

  checkboxTouch: {
    width: 24,
    alignItems: 'center'
  },

  cell: {
    ...userTypography.tableCell,
  },

  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },

  actions: {
    flexDirection: 'row',
    gap: 14
  },

  deleteSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16
  },

  deleteSelectedText: {
    ...userTypography.tableCell,
    color: '#e74c3c'
  },

  paginationWrap: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingBottom: 4,
    marginTop: 4,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20
  },

  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    maxHeight: '80%'
  },

  modalScroll: {
    maxHeight: 320,
  },

  modalTitle: {
    ...userTypography.cardTitle,
    marginBottom: 10,
    color: '#1f3b57'
  },

  detailRow: {
    ...userTypography.tableCell,
    marginBottom: 6,
    color: '#334155'
  },

  moistureChecksBlock: {
    marginTop: 4,
    marginBottom: 8,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },

  moistureChecksTitle: {
    ...userTypography.bodyStrong,
    color: '#1f3b57',
    marginBottom: 8,
  },

  moistureCheckRow: {
    ...userTypography.tableCell,
    color: '#334155',
    marginBottom: 4,
  },

  moistureSummaryRow: {
    ...userTypography.caption,
    color: '#64748b',
    marginTop: 6,
  },

  closeBtn: {
    marginTop: 12,
    backgroundColor: '#1f3b57',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center'
  },

  closeText: {
    color: '#fff',
    ...userTypography.bodyStrong,
  }

});

export default React.memo(UserHistory);
