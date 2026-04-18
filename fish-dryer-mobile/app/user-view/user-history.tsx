import React, { useEffect, useState } from 'react';
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
import UserGraph from "./user-graph";

type RangeFilter = 'weekly' | 'monthly' | '3months';

export default function UserHistory() {

  const [sessions, setSessions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [range, setRange] = useState<RangeFilter>('3months');
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [range]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/drying-sessions?range=${range}`);
      const data = await res.json();

      const rows = data?.sessions ?? data?.data ?? data ?? [];
      setSessions(Array.isArray(rows) ? rows : []);
      setSummary(data?.summary ?? null);

    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
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
            fetchHistory();
          } catch (error) {
            console.log(error);
          }
        }
      }
    ]);
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#4fc3f7" />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={styles.title}>History</Text>

      <ScrollView style={styles.container}>

        <UserGraph sessions={sessions} summary={summary} range={range} onChangeRange={setRange} />

        {/* TABLE HEADER */}
        <View style={styles.tableHeader}>
          <Text style={styles.headerText}>ID</Text>
          <Text style={styles.headerText}>Date</Text>
          <Text style={styles.headerText}>Fish</Text>
          <Text style={styles.headerText}>Action</Text>
        </View>

        {/* TABLE ROWS */}
        {sessions.map((item) => (
          <View style={styles.row} key={item.id}>

            <Text style={styles.cell}>#{item.id}</Text>
            <Text style={styles.cell}>{String(item.date).replace('T', ' ').slice(0, 16)}</Text>
            <Text style={styles.cell}>{item.fish_type}</Text>

            <View style={styles.actions}>
              <TouchableOpacity onPress={() => handleViewDetails(item.id)}>
                <FontAwesome name="eye" size={18} color="#4fc3f7" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(item.id)}>
                <FontAwesome name="trash" size={18} color="#e74c3c" />
              </TouchableOpacity>
            </View>

          </View>
        ))}

      </ScrollView>

      <Modal visible={!!selectedSession} transparent animationType="fade" onRequestClose={() => setSelectedSession(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Drying Session Details</Text>
            <Text style={styles.detailRow}>ID: #{selectedSession?.id}</Text>
            <Text style={styles.detailRow}>Date: {selectedSession?.date?.replace('T', ' ')}</Text>
            <Text style={styles.detailRow}>Fish Type: {selectedSession?.fish_type ?? '--'}</Text>
            <Text style={styles.detailRow}>Temperature: {selectedSession?.temperature ?? '--'} °C</Text>
            <Text style={styles.detailRow}>Humidity: {selectedSession?.humidity ?? '--'} %</Text>
            <Text style={styles.detailRow}>Moisture: {selectedSession?.moisture ?? '--'} %</Text>
            <Text style={styles.detailRow}>Fan Speed: {selectedSession?.fan_speed ?? '--'}</Text>
            <Text style={styles.detailRow}>Duration: {selectedSession?.duration_minutes ?? 0} mins</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedSession(null)}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20
  },

  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
    color: '#1f3b57'
  },

  tableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10
  },

  headerText: {
    fontWeight: '700',
    fontSize: 12
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

  cell: {
    fontSize: 12
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

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20
  },

  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    color: '#1f3b57'
  },

  detailRow: {
    fontSize: 13,
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
    fontWeight: '600'
  }

});