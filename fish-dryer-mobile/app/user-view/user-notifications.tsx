import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert
} from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import {
  loadHardwareNotifications,
  markAllHardwareNotificationsRead,
  markHardwareNotificationsReadByIds,
  deleteHardwareNotificationsByIds,
  clearHardwareNotifications,
  isCriticalSensorAlert,
  isDryingTemperatureWarning,
  summarizeHardwareNotifications,
  type StoredHardwareNotification,
} from '@/lib/hardware-notifications-store';
import { ListPaginationBar, useListPagination } from '@/lib/list-pagination';
import MachineDropdown from './machine-dropdown';
import { useSelectedMachine } from '@/lib/selected-machine';

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

type UserNotificationsProps = {
  visible?: boolean;
  onBack?: () => void;
  onNotificationsChanged?: () => void;
};

export default function UserNotifications({
  visible = true,
  onBack,
  onNotificationsChanged,
}: UserNotificationsProps) {

  const [activeTab, setActiveTab] = useState('all');
  const [items, setItems] = useState<StoredHardwareNotification[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const {
    machines: userMachines,
    selectedId: selectedMachineId,
    selectMachine,
    loading: machinesLoading,
  } = useSelectedMachine();

  const reload = useCallback(async () => {
    const list = await loadHardwareNotifications();
    setItems(list);
    onNotificationsChanged?.();
    // Drop ids that no longer exist (e.g., after deletion).
    setSelected((prev) => {
      const validIds = new Set(list.map((x) => x.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [onNotificationsChanged]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!visible) return;
    void reload();
    const id = setInterval(() => {
      void reload();
    }, 2000);
    return () => clearInterval(id);
  }, [visible, reload]);

  const machineFilteredItems = useMemo(() => {
    if (selectedMachineId == null || selectedMachineId <= 0) return items;
    return items.filter((x) => x.machineId === selectedMachineId);
  }, [items, selectedMachineId]);

  const filteredNotifications = useMemo(() => {
    const base = machineFilteredItems.map((x) => ({
      id: x.id,
      type: x.type,
      componentKey: x.componentKey,
      title: x.title,
      desc: x.desc,
      time: formatRelativeTime(x.createdAt),
      read: x.read,
    }));
    if (activeTab === 'unread') return base.filter((n) => !n.read);
    if (activeTab === 'alerts') {
      return base.filter((n) => isCriticalSensorAlert(n));
    }
    if (activeTab === 'warnings') {
      return base.filter((n) => isDryingTemperatureWarning(n));
    }
    if (activeTab === 'info') return base.filter((n) => n.type === 'info');
    return base;
  }, [machineFilteredItems, activeTab]);

  const {
    pageItems: pagedNotifications,
    page,
    totalPages,
    setPage,
    resetPage,
  } = useListPagination(filteredNotifications);

  useEffect(() => {
    resetPage();
  }, [activeTab, selectedMachineId, resetPage]);

  /** Summary totals — entire store for this machine (all pages, not just current page). */
  const summary = useMemo(
    () => summarizeHardwareNotifications(machineFilteredItems),
    [machineFilteredItems]
  );
  const unreadCount = summary.unread;
  const criticalCount = summary.critical;
  const dryingWarningCount = summary.dryingWarnings;
  const infoCount = summary.info;
  const totalCount = summary.total;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMarkAllRead = async () => {
    if (selected.size > 0) {
      await markHardwareNotificationsReadByIds(Array.from(selected));
    } else {
      await markAllHardwareNotificationsRead();
    }
    await reload();
    await onNotificationsChanged?.();
    setSelected(new Set());
  };

  const handleDelete = () => {
    const usingSelection = selected.size > 0;
    Alert.alert(
      'Delete',
      usingSelection
        ? `Remove ${selected.size} selected notification${selected.size === 1 ? '' : 's'}?`
        : 'Remove all notifications?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (usingSelection) {
              await deleteHardwareNotificationsByIds(Array.from(selected));
            } else {
              await clearHardwareNotifications();
            }
            await reload();
            await onNotificationsChanged?.();
            setSelected(new Set());
          },
        },
      ]
    );
  };

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

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >

        <View style={styles.titleRow}>
          {onBack ? (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back to overview"
            >
              <FontAwesome name="chevron-left" size={18} color="#1f3b57" />
            </TouchableOpacity>
          ) : (
            <View style={styles.backPlaceholder} />
          )}
          <Text style={styles.title}>Notifications</Text>
          <View style={styles.backPlaceholder} />
        </View>

        <MachineDropdown
          machines={userMachines}
          selectedId={selectedMachineId}
          loading={machinesLoading}
          onSelect={selectMachine}
          onMachineChange={() => {
            setSelected(new Set());
            void onNotificationsChanged?.();
          }}
          style={styles.machineDropdown}
        />

        {/* FILTER TABS */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabs}
        >
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'unread', label: 'Unread' },
              { key: 'alerts', label: 'Critical Alerts' },
              { key: 'warnings', label: 'Drying Warnings' },
              { key: 'info', label: 'Info' },
            ] as const
          ).map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.activeTab]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.activeTabText]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* SUMMARY CARDS */}
        <View style={styles.cardRow}>
          <SummaryCard icon="envelope" color="#2196f3" value={String(unreadCount)} label="Unread Notifications" />
          <SummaryCard icon="exclamation-circle" color="#ff4d4d" value={String(criticalCount)} label="Critical Alerts" />
          <SummaryCard icon="exclamation-triangle" color="#f5b800" value={String(dryingWarningCount)} label="Drying Warnings" />
          <SummaryCard icon="info-circle" color="#4caf50" value={String(infoCount)} label="Info Notifications" />
        </View>

        {/* ACTION BUTTONS */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.markBtn]}
            onPress={() => void handleMarkAllRead()}
          >
            <FontAwesome name="check" size={14} color="#fff" />
            <Text style={styles.actionText} numberOfLines={1}>
              {selected.size > 0 ? `Read (${selected.size})` : 'Read all'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={handleDelete}>
            <FontAwesome name="trash" size={14} color="#fff" />
            <Text style={styles.actionText} numberOfLines={1}>
              {selected.size > 0 ? `Delete (${selected.size})` : 'Delete all'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* NOTIFICATION LIST */}
        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>
            Notifications ({totalCount} total · showing {filteredNotifications.length} in this filter)
          </Text>

          {pagedNotifications.length === 0 ? (
            <Text style={styles.emptyList}>No notifications in this filter.</Text>
          ) : null}

          {pagedNotifications.map((item) => {
            const icon = getIcon(item.type);
            const isChecked = selected.has(item.id);
            const isUnread = !item.read;
            return (
              <View
                key={item.id}
                style={[
                  styles.notification,
                  isUnread ? styles.notificationUnread : styles.notificationRead,
                  { borderLeftColor: getBorderColor(item.type) },
                ]}
              >
                <TouchableOpacity
                  style={styles.checkbox}
                  onPress={() => toggleSelect(item.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={isChecked ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={isChecked ? '#1f3b57' : '#888'}
                  />
                </TouchableOpacity>

                <View style={styles.notificationLeft}>
                  <FontAwesome name={icon.name as any} size={18} color={icon.color} />
                </View>

                <View style={styles.notificationContent}>
                  <Text style={styles.notificationTitle}>{item.title}</Text>
                  <Text style={styles.notificationDesc}>{item.desc}</Text>
                </View>

                <View style={styles.notificationRight}>
                  <Text style={styles.time}>{item.time}</Text>
                  <Ionicons
                    name={isUnread ? 'mail' : 'mail-outline'}
                    size={18}
                    color={isUnread ? '#1f3b57' : '#9aa5b1'}
                  />
                </View>
              </View>
            );
          })}

          {filteredNotifications.length > 0 ? (
            <ListPaginationBar
              page={page}
              totalPages={totalPages}
              totalItems={filteredNotifications.length}
              onPageChange={setPage}
            />
          ) : null}
        </View>

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
  },

  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },

  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#e8ecef',
  },

  backPlaceholder: {
    width: 36,
    height: 36,
  },

  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1f3b57',
    flex: 1,
    textAlign: 'center',
  },

  machineDropdown: {
    marginBottom: 12,
  },

  tabsScroll: {
    marginBottom: 20,
    flexGrow: 0,
  },

  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
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
    gap: 10,
    marginBottom: 15,
  },

  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },

  markBtn: {
    backgroundColor: '#1f3b57',
  },

  deleteBtn: {
    backgroundColor: '#f44336',
  },

  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
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
    paddingRight: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  notificationUnread: {
    backgroundColor: '#dce4ec',
  },

  notificationRead: {
    backgroundColor: '#fafbfc',
  },

  checkbox: {
    marginRight: 8,
    paddingHorizontal: 2,
  },

  notificationLeft: {
    marginRight: 10
  },

  notificationContent: {
    flex: 1,
  },

  notificationTitle: {
    fontWeight: '600',
    fontSize: 13,
    color: '#334155',
    flexShrink: 1,
  },

  notificationDesc: {
    fontSize: 12,
    color: '#666',
  },

  notificationRight: {
    alignItems: 'flex-end'
  },

  time: {
    fontSize: 10,
    color: '#888',
    marginBottom: 5
  },

  emptyList: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    paddingVertical: 16,
  },

});
