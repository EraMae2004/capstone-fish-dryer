import React, { useEffect, useMemo, useState } from 'react';
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
import { Stack } from 'expo-router';
import { API_BASE_URL } from "@/config/api";
import UserGraph from './user-graph';
import { userTypography } from "@/lib/user-typography";
import { formatMinutesAsHMS, formatSecondsAsHMS } from "@/lib/duration-format";
import { ListPaginationBar, useListPagination } from '@/lib/list-pagination';
import MachineDropdown from './machine-dropdown';
import { useSelectedMachine } from '@/lib/selected-machine';

function fmtPct(value: unknown): string {
  if (value === null || value === undefined || value === "") return "--";
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}` : "--";
}

function fmtDryMins(value: unknown): string {
  if (value === null || value === undefined || value === "") return "--";
  const n = Number(value);
  return Number.isFinite(n) ? formatMinutesAsHMS(n) : "--";
}

function fmtSessionDryTime(row: any): string {
  const sec = Number(row?.drying_time_seconds);
  if (Number.isFinite(sec) && sec >= 0) {
    return formatSecondsAsHMS(sec);
  }
  const mins = Number(row?.drying_time_minutes ?? row?.duration_minutes);
  if (Number.isFinite(mins) && mins > 0) {
    return formatSecondsAsHMS(mins * 60);
  }
  return "00:00:00";
}

function fmtSessionDate(value: unknown): string {
  if (value == null || value === "") return "--";
  return String(value).replace("T", " ").slice(0, 19);
}

export default function UserHistory() {

  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'weekly' | 'monthly' | '3months'>('weekly');
  const {
    machines: userMachines,
    selectedId: selectedMachineId,
    selectMachine,
    loading: machinesLoading,
  } = useSelectedMachine();

  useEffect(() => {
    if (machinesLoading) return;
    void fetchHistory(range, selectedMachineId);
  }, [range, selectedMachineId, machinesLoading]);

  const fetchHistory = async (
    rangeKey: typeof range,
    machineId: number | null
  ) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ range: rangeKey });
      if (machineId != null && machineId > 0) {
        params.set('microcontroller_id', String(machineId));
      }
      const res = await fetch(`${API_BASE_URL}/drying-sessions?${params.toString()}`);
      const data = await res.json();

      const rows = data?.sessions ?? data?.data ?? data ?? [];
      setSessions(Array.isArray(rows) ? rows : []);
      setSelectedIds(new Set());

    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  };

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

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleViewDetails = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/drying-sessions/${id}`);
      const data = await res.json();
      const detail = data?.data ?? data;
      setSelectedSession(detail ?? null);
    } catch (error) {
      console.log(error);
    }
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Session', 'Are you sure you want to delete this drying session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await fetch(`${API_BASE_URL}/drying-sessions/${id}`, { method: 'DELETE' });
            if (selectedSession?.id === id) {
              setSelectedSession(null);
            }
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            void fetchHistory(range, selectedMachineId);
          } catch (error) {
            console.log(error);
          }
        }
      }
    ]);
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
          onPress: async () => {
            try {
              await fetch(`${API_BASE_URL}/drying-sessions/batch-delete`, {
                method: 'POST',
                headers: {
                  Accept: 'application/json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids }),
              });
              setSelectedSession(null);
              void fetchHistory(range, selectedMachineId);
            } catch (error) {
              console.log(error);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#4fc3f7" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={styles.title}>History</Text>

      <MachineDropdown
        machines={userMachines}
        selectedId={selectedMachineId}
        loading={machinesLoading}
        onSelect={selectMachine}
        onMachineChange={(id) => {
          void fetchHistory(range, id);
        }}
        style={styles.machineDropdown}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        <UserGraph
          sessions={filteredSessions}
          summary={{ total_batches: filteredSessions.length }}
          range={range}
          onChangeRange={setRange}
        />

        <View style={styles.tableHeader}>
          <Text style={styles.headerText}> </Text>
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
              <Text style={styles.cell}>{String(item.date).replace('T', ' ').slice(0, 16)}</Text>
              <Text style={styles.cell}>{item.fish_type}</Text>

              <View style={styles.actions}>
                <TouchableOpacity onPress={() => handleViewDetails(id)}>
                  <FontAwesome name="eye" size={18} color="#4fc3f7" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(id)}>
                  <FontAwesome name="trash" size={18} color="#e74c3c" />
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
              <Text style={styles.detailRow}>Fish Type: {selectedSession?.fish_type ?? '--'}</Text>
              <Text style={styles.detailRow}>No. of Fish: {selectedSession?.total_fish ?? '--'}</Text>
              <Text style={styles.detailRow}>Target Temp: {selectedSession?.target_temperature ?? '--'} °C</Text>
              <Text style={styles.detailRow}>
                Planned duration: {fmtDryMins(selectedSession?.set_duration_minutes)}
              </Text>
              <Text style={styles.detailRow}>
                Temperature: {selectedSession?.temperature != null ? `${selectedSession.temperature} °C` : '--'}
              </Text>
              <Text style={styles.detailRow}>
                Humidity: {fmtPct(selectedSession?.humidity ?? selectedSession?.avg_humidity)} %
              </Text>
              <Text style={styles.detailRow}>
                Moisture: {fmtPct(selectedSession?.moisture ?? selectedSession?.avg_moisture)} %
              </Text>
              <Text style={styles.detailRow}>Fan Speed: {selectedSession?.fan_speed ?? '--'}</Text>
              <Text style={styles.detailRow}>
                Total drying time: {fmtSessionDryTime(selectedSession)}
              </Text>
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
