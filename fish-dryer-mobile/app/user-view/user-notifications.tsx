import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView
} from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';

export default function UserNotifications() {

  const [activeTab, setActiveTab] = useState('all');

  const notifications = [
    {
      id: 1,
      type: 'critical',
      title: 'Temperature Sensor Failure',
      desc: 'Temperature sensor stopped responding. Drying process may be affected.',
      time: 'Just now'
    },
    {
      id: 2,
      type: 'info',
      title: 'Drying Process Completed',
      desc: 'Drying process of Salmon completed successfully.',
      time: '5 minutes ago'
    },
    {
      id: 3,
      type: 'warning',
      title: 'Humidity Slightly Above Ideal',
      desc: 'Humidity rising above optimal drying range.',
      time: '23h ago'
    },
    {
      id: 4,
      type: 'info',
      title: 'Drying Process Started',
      desc: 'New drying process started for 150 pcs of Salmon.',
      time: 'Just now'
    }
  ];

  const getBorderColor = (type: string) => {
    switch (type) {
      case 'critical': return '#ff4d4d';
      case 'warning': return '#f5b800';
      case 'info': return '#4caf50';
      default: return '#ccc';
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'critical': return { name: 'exclamation-circle', color: '#ff4d4d' };
      case 'warning': return { name: 'exclamation-triangle', color: '#f5b800' };
      case 'info': return { name: 'info-circle', color: '#4caf50' };
      default: return { name: 'bell', color: '#4fc3f7' };
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView style={styles.container}>

        <Text style={styles.title}>History</Text>

        {/* FILTER TABS */}
        <View style={styles.tabs}>
          {['all', 'unread', 'alerts', 'info'].map(tab => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.tab,
                activeTab === tab && styles.activeTab
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[
                styles.tabText,
                activeTab === tab && styles.activeTabText
              ]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* SUMMARY CARDS */}
        <View style={styles.cardRow}>
          <SummaryCard icon="envelope" color="#2196f3" value="2" label="Unread Notifications" />
          <SummaryCard icon="exclamation-circle" color="#ff4d4d" value="4" label="Critical Alerts" />
          <SummaryCard icon="exclamation-triangle" color="#f5b800" value="1" label="Warning Alerts" />
          <SummaryCard icon="info-circle" color="#4caf50" value="4" label="Info Notifications" />
        </View>

        {/* ACTION BUTTONS */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.markBtn}>
            <FontAwesome name="check" size={14} color="#fff" />
            <Text style={styles.actionText}> Mark all as Read</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteBtn}>
            <FontAwesome name="trash" size={14} color="#fff" />
            <Text style={styles.actionText}> Delete</Text>
          </TouchableOpacity>
        </View>

        {/* NOTIFICATION LIST */}
        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>All Notifications</Text>

          {notifications.map((item) => {
            const icon = getIcon(item.type);
            return (
              <View
                key={item.id}
                style={[
                  styles.notification,
                  { borderLeftColor: getBorderColor(item.type) }
                ]}
              >
                <View style={styles.notificationLeft}>
                  <FontAwesome name={icon.name as any} size={18} color={icon.color} />
                </View>

                <View style={styles.notificationContent}>
                  <Text style={styles.notificationTitle}>
                    {item.title}
                  </Text>
                  <Text style={styles.notificationDesc}>
                    {item.desc}
                  </Text>
                </View>

                <View style={styles.notificationRight}>
                  <Text style={styles.time}>{item.time}</Text>
                  <Ionicons name="mail-outline" size={18} color="#1f3b57" />
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.pagination}>Page 1 of 10</Text>

      </ScrollView>
    </>
  );
}

function SummaryCard({ icon, color, value, label }: any) {
  return (
    <View style={styles.summaryCard}>
      <FontAwesome name={icon} size={16} color={color} />
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
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
    marginBottom: 15,
    color: '#1f3b57'
  },

  tabs: {
    flexDirection: 'row',
    marginBottom: 20
  },

  tab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#e0e6ed',
    marginRight: 10
  },

  activeTab: {
    backgroundColor: '#2196f3'
  },

  tabText: {
    fontSize: 12,
    fontWeight: '600'
  },

  activeTabText: {
    color: '#fff'
  },

  cardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20
  },

  summaryCard: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10
  },

  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    marginVertical: 4
  },

  summaryLabel: {
    fontSize: 11,
    color: '#555'
  },

  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15
  },

  markBtn: {
    backgroundColor: '#1f3b57',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center'
  },

  deleteBtn: {
    backgroundColor: '#f44336',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center'
  },

  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600'
  },

  listContainer: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15
  },

  listTitle: {
    fontWeight: '700',
    marginBottom: 10,
    fontSize: 15
  },

  notification: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderLeftWidth: 4,
    paddingLeft: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee'
  },

  notificationLeft: {
    marginRight: 10
  },

  notificationContent: {
    flex: 1
  },

  notificationTitle: {
    fontWeight: '600',
    fontSize: 13
  },

  notificationDesc: {
    fontSize: 12,
    color: '#666'
  },

  notificationRight: {
    alignItems: 'flex-end'
  },

  time: {
    fontSize: 10,
    color: '#888',
    marginBottom: 5
  },

  pagination: {
    textAlign: 'center',
    marginTop: 15,
    fontSize: 12,
    color: '#555'
  }

});