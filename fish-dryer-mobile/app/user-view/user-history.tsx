import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Stack } from 'expo-router';

const BASE_URL = 'https://spinproof-brineless-marleen.ngrok-free.dev';

export default function UserHistory({ navigation }: any) {

  const [sessions, setSessions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/mobile/drying-sessions`);
      const data = await res.json();

      if (data.success) {
        setSessions(data.sessions);
        setSummary(data.summary);
      }

    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
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

      <ScrollView style={styles.container}>

        <Text style={styles.title}>History</Text>

        {/* SUMMARY CARDS */}
        <View style={styles.cardsContainer}>

          <View style={styles.card}>
            <FontAwesome name="database" size={20} color="#1f3b57" />
            <Text style={styles.cardValue}>
              {summary?.total_batches ?? 0}
            </Text>
            <Text style={styles.cardLabel}>Total Batches</Text>
          </View>

          <View style={styles.card}>
            <FontAwesome name="hourglass-half" size={20} color="#1f3b57" />
            <Text style={styles.cardValue}>
              {summary?.avg_duration ?? 0}h
            </Text>
            <Text style={styles.cardLabel}>Avg. Duration</Text>
          </View>

          <View style={styles.card}>
            <FontAwesome name="tint" size={20} color="#1f3b57" />
            <Text style={styles.cardValue}>
              {summary?.avg_moisture ?? 0}%
            </Text>
            <Text style={styles.cardLabel}>Avg. Moisture</Text>
          </View>

        </View>

        {/* TABLE HEADER */}
        <View style={styles.tableHeader}>
          <Text style={styles.headerText}>ID</Text>
          <Text style={styles.headerText}>Date</Text>
          <Text style={styles.headerText}>Fish</Text>
          <Text style={styles.headerText}>No.</Text>
          <Text style={styles.headerText}>Action</Text>
        </View>

        {/* TABLE ROWS */}
        {sessions.map((item) => (
          <View style={styles.row} key={item.id}>

            <Text style={styles.cell}>#{item.batch_code}</Text>
            <Text style={styles.cell}>{item.created_at}</Text>
            <Text style={styles.cell}>{item.fish_type}</Text>
            <Text style={styles.cell}>{item.no_of_fish} pcs</Text>

            <TouchableOpacity
              onPress={() =>
                navigation.navigate('user-history-details', { id: item.id })
              }
            >
              <FontAwesome name="eye" size={18} color="#4fc3f7" />
            </TouchableOpacity>

          </View>
        ))}

      </ScrollView>
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

  cardsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 25
  },

  card: {
    backgroundColor: '#fff',
    width: '30%',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center'
  },

  cardValue: {
    fontSize: 20,
    fontWeight: '700',
    marginVertical: 5
  },

  cardLabel: {
    fontSize: 12,
    color: '#555'
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
  }

});