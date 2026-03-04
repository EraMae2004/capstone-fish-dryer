import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';

const { width } = Dimensions.get('window');

// === CONFIG ===
const API_BASE_URL = 'http://192.168.1.100:8000/api/mobile'; // CHANGE THIS
const DEV_MODE = true; // Set true to skip real auth
// ==============

const HardwareStatus = () => {
  const [machines, setMachines] = useState([]);
  const [components, setComponents] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [machineName, setMachineName] = useState('');
  const [microSelectOpen, setMicroSelectOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [espDevices, setEspDevices] = useState([]);
  const [addingMachine, setAddingMachine] = useState(false);
  const [apiError, setApiError] = useState(null);

  useEffect(() => {
    loadMachines();
  }, []);

  const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(typeof options.headers === 'object' && options.headers ? options.headers : {}),
    };
    // In DEV_MODE, add a dummy token if your API expects one (optional)
    if (DEV_MODE) {
      headers.Authorization = 'Bearer dev-token';
    }
    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      throw new Error(err.message);
    }
  };

  const loadMachines = async () => {
    try {
      setLoading(true);
      setApiError(null);
      const res = await apiRequest('/machines');
      if (res.success && res.data) {
        setMachines(res.data);
        if (res.data.length) {
          setSelectedMachine(res.data[0]);
          loadComponents(res.data[0].id);
        }
      } else {
        // Fallback if no machines
        setMachines([]);
      }
    } catch (err) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadComponents = async (machineId) => {
    try {
      const res = await apiRequest(`/machines/${machineId}/components`);
      if (res.success && res.data) setComponents(res.data);
    } catch (err) {
      console.warn(err.message);
      // keep existing components (fallback list below)
    }
  };

  const handleTestAll = async () => {
    if (!selectedMachine) return;
    if (selectedMachine.status !== 'online') {
      Alert.alert('Offline', 'Machine is offline. Cannot test.');
      return;
    }
    try {
      await apiRequest(`/machines/${selectedMachine.id}/components/test-all`, { method: 'POST' });
      await loadComponents(selectedMachine.id);
      await loadMachines();
      Alert.alert('Success', 'All components tested');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const handleTestComponent = async (componentName) => {
    if (!selectedMachine) return;
    if (selectedMachine.status !== 'online') {
      Alert.alert('Offline', 'Machine is offline. Cannot test.');
      return;
    }
    try {
      const res = await apiRequest(
        `/machines/${selectedMachine.id}/components/${encodeURIComponent(componentName)}/test`,
        { method: 'POST' }
      );
      if (res.success) {
        setComponents(prev =>
          prev.map(c => (c.component_name === componentName ? { ...c, status: res.data.status } : c))
        );
        await loadMachines();
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const handleAddMachine = () => {
    setMachineName('');
    setEspDevices([]);
    setMicroSelectOpen(false);
    setModalVisible(true);
  };

  const handleSaveMachine = async () => {
    if (!machineName.trim()) return;
    try {
      setAddingMachine(true);
      await apiRequest('/machines', {
        method: 'POST',
        body: JSON.stringify({
          name: machineName,
          microcontrollers: espDevices.filter(d => d.selected),
        }),
      });
      await loadMachines();
      setModalVisible(false);
      setMachineName('');
      setEspDevices([]);
      Alert.alert('Success', 'Machine added');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setAddingMachine(false);
    }
  };

  const handleDetectMicrocontrollers = async () => {
    setDetecting(true);
    try {
      const res = await apiRequest('/microcontrollers/detect');
      if (res.success) setEspDevices(res.data);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setDetecting(false);
    }
  };

  const toggleESPSelection = (id) => {
    setEspDevices(prev => prev.map(d => (d.id === id ? { ...d, selected: !d.selected } : d)));
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'online':
      case 'working':
        return '#2ecc71';
      case 'offline':
      case 'not_working':
        return '#e74c3c';
      case 'warning':
        return '#f39c12';
      default:
        return '#95a5a6';
    }
  };

  const getStatusBackground = (status) => {
    switch (status?.toLowerCase()) {
      case 'working':
        return '#eaf6f0';
      case 'not_working':
        return '#fdecec';
      case 'warning':
        return '#fef5e7';
      default:
        return '#f0f0f0';
    }
  };

  const getStatusLabel = (status) => {
    switch (status?.toLowerCase()) {
      case 'working':
        return 'Working';
      case 'not_working':
        return 'Not Working';
      case 'warning':
        return 'Warning';
      default:
        return 'Not Connected';
    }
  };

  const getIconName = (name) => {
    const n = name.toLowerCase();
    if (n.includes('esp')) return 'microchip';
    if (n.includes('lcd')) return 'tv';
    if (n.includes('buzzer')) return 'volume-up';
    if (n.includes('fan')) return 'fan';
    if (n.includes('moisture')) return 'tint';
    if (n.includes('temp') || n.includes('humidity')) return 'thermometer-half';
    if (n.includes('led')) return 'lightbulb-o';
    return 'microchip';
  };

  // Default component list (always visible)
  const defaultComponents = [
    'ESP32 Controller',
    'LCD Display',
    'Buzzer',
    'Fan',
    'Moisture Sensor',
    'Temperature and Humidity Sensor',
    'LED',
  ];

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1f4e6c" />
        <Text>Connecting...</Text>
      </View>
    );
  }

  if (apiError) {
    return (
      <View style={styles.center}>
        <Icon name="exclamation-triangle" size={50} color="#e74c3c" />
        <Text style={styles.errorText}>{apiError}</Text>
        <TouchableOpacity style={styles.retry} onPress={loadMachines}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Hardware Status</Text>

        {/* Machine cards horizontal */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.machineScroll}>
          <View style={styles.machineRow}>
            {machines.map(m => (
              <TouchableOpacity
                key={m.id}
                style={[styles.machineCard, { borderTopColor: getStatusColor(m.status) }]}
                onPress={() => {
                  setSelectedMachine(m);
                  loadComponents(m.id);
                }}>
                <View style={styles.machineHeader}>
                  <Text style={styles.machineName} numberOfLines={1}>{m.name}</Text>
                  <View style={styles.statusBadge}>
                    <View style={[styles.dot, { backgroundColor: getStatusColor(m.status) }]} />
                    <Text style={styles.statusText}>{m.status?.charAt(0).toUpperCase() + m.status?.slice(1)}</Text>
                  </View>
                </View>
                <View>
                  <Text style={styles.stat}>Working: <Text style={styles.bold}>{m.working}</Text></Text>
                  <Text style={styles.stat}>Warning Issues: <Text style={styles.bold}>{m.warning}</Text></Text>
                  <Text style={styles.stat}>Not Working: <Text style={styles.bold}>{m.not_working}</Text></Text>
                  <Text style={styles.stat}>Overall Health: <Text style={styles.bold}>{m.health}% Good</Text></Text>
                </View>
              </TouchableOpacity>
            ))}
            {/* Add Machine Card */}
            <TouchableOpacity style={[styles.machineCard, styles.addCard]} onPress={handleAddMachine}>
              <View style={styles.addIcon}><Text style={styles.addIconText}>+</Text></View>
              <Text style={styles.addTitle}>Add New Machine</Text>
              <Text style={styles.addSub}>Register a new drying machine</Text>
              <View style={styles.addBtn}><Text style={styles.addBtnText}>Add Machine</Text></View>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {selectedMachine && (
          <View style={styles.selectWrapper}>
            <View style={styles.selectBox}>
              <Text style={styles.selectText}>{selectedMachine.name}</Text>
              <Icon name="chevron-down" size={12} color="#666" />
            </View>
          </View>
        )}

        {/* Hardware Components Card */}
        <View style={styles.componentsCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitle}>
              <Icon name="bars" size={16} color="#333" />
              <Text style={styles.cardTitleText}>Hardware Components Status</Text>
            </View>
            <TouchableOpacity
              style={[styles.testAll, (!selectedMachine || selectedMachine.status !== 'online') && styles.disabled]}
              onPress={handleTestAll}
              disabled={!selectedMachine || selectedMachine.status !== 'online'}>
              <Text style={styles.testAllText}>Test All</Text>
            </TouchableOpacity>
          </View>

          {/* Component list – always visible */}
          <View>
            {(components.length ? components : defaultComponents).map((item, idx) => {
              const name = typeof item === 'string' ? item : item.component_name;
              const status = typeof item === 'string' ? null : item.status;
              const color = getStatusColor(status);
              const bg = getStatusBackground(status);
              const label = getStatusLabel(status);
              return (
                <View key={idx} style={styles.componentRow}>
                  <View style={[styles.line, { backgroundColor: color }]} />
                  <View style={styles.componentMain}>
                    <View style={styles.topRow}>
                      <View style={[styles.iconBox, { backgroundColor: bg }]}>
                        <Icon name={getIconName(name)} size={20} color={color} />
                      </View>
                      <View style={styles.textContainer}>
                        <Text style={styles.compName}>{name.toUpperCase()}</Text>
                        <Text style={styles.compDesc}>Hardware component monitoring system</Text>
                      </View>
                    </View>
                    <View style={styles.bottomRow}>
                      <View style={[styles.pill, { backgroundColor: bg }]}>
                        <Text style={[styles.pillText, { color }]}>{label}</Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.play,
                          { backgroundColor: getStatusColor('working') },
                          (!selectedMachine || selectedMachine.status !== 'online') && styles.disabled,
                        ]}
                        onPress={() => handleTestComponent(name)}
                        disabled={!selectedMachine || selectedMachine.status !== 'online'}>
                        <Icon name="play" size={14} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Add Machine Modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}><Text style={styles.modalHeaderText}>Add Machine</Text></View>
            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>Machine Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter Machine Name"
                value={machineName}
                onChangeText={setMachineName}
              />
              <Text style={styles.label}>Select Microcontrollers</Text>
              <View style={styles.microBox}>
                <TouchableOpacity style={styles.microHeader} onPress={() => setMicroSelectOpen(!microSelectOpen)}>
                  <Text>Select Options</Text>
                  <Icon name={microSelectOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#666" />
                </TouchableOpacity>
                {microSelectOpen && (
                  <View style={styles.microBody}>
                    <View style={styles.microSubHeader}>
                      <Text>Detect Microcontrollers</Text>
                      <TouchableOpacity onPress={handleDetectMicrocontrollers} disabled={detecting}>
                        <Icon name="refresh" size={14} color="#666" /><Text> Refresh</Text>
                      </TouchableOpacity>
                    </View>
                    {detecting ? (
                      <View style={styles.detecting}><ActivityIndicator /><Text> Detecting...</Text></View>
                    ) : espDevices.length ? (
                      espDevices.map(d => (
                        <TouchableOpacity key={d.id} style={styles.espItem} onPress={() => toggleESPSelection(d.id)}>
                          <Text>{d.name}</Text>
                          <View style={[styles.checkbox, d.selected && styles.checked]}>
                            {d.selected && <Icon name="check" size={10} color="#fff" />}
                          </View>
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text style={styles.noDevices}>No microcontrollers detected</Text>
                    )}
                  </View>
                )}
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancel} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.save, (!machineName.trim() || addingMachine) && styles.disabled]}
                onPress={handleSaveMachine}
                disabled={!machineName.trim() || addingMachine}>
                {addingMachine ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Add Machine</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { color: '#e74c3c', marginVertical: 10, textAlign: 'center', fontSize: 16 },
  retry: { backgroundColor: '#1f4e6c', paddingHorizontal: 30, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '500' },
  scroll: { padding: 16, paddingBottom: 30 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 20, color: '#333' },
  machineScroll: { marginBottom: 20 },
  machineRow: { flexDirection: 'row', gap: 16, paddingRight: 16 },
  machineCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: width * 0.7,
    maxWidth: 260,
    borderTopWidth: 5,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
    marginRight: 16,
  },
  machineHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  machineName: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, color: '#666' },
  stat: { fontSize: 13, color: '#666' },
  bold: { fontWeight: '600', color: '#333' },
  addCard: { borderWidth: 2, borderColor: '#d6d6d6', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addIcon: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: '#1f4e6c', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  addIconText: { fontSize: 24, color: '#fff' },
  addTitle: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  addSub: { fontSize: 13, color: '#7a8796', textAlign: 'center', marginBottom: 12 },
  addBtn: { backgroundColor: '#1f4e6c', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6 },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  selectWrapper: { alignItems: 'flex-end', marginBottom: 20 },
  selectBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#ddd', gap: 8 },
  selectText: { fontSize: 14, color: '#333', maxWidth: 200 },
  componentsCard: { backgroundColor: '#fff', borderRadius: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3, overflow: 'hidden' },
  cardHeader: { backgroundColor: '#f6f8fa', padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef1f4' },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  cardTitleText: { fontSize: 16, fontWeight: '600', color: '#333', flex: 1 },
  testAll: { backgroundColor: '#163a59', paddingVertical: 7, paddingHorizontal: 15, borderRadius: 6 },
  testAllText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  disabled: { opacity: 0.5 },
  componentRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eef1f4' },
  line: { width: 4 },
  componentMain: { flex: 1, padding: 18 },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconBox: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  textContainer: { flex: 1 },
  compName: { fontSize: 15, fontWeight: '600', color: '#333' },
  compDesc: { fontSize: 12, color: '#7a8796', marginTop: 2 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 },
  pill: { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 20 },
  pillText: { fontSize: 12, fontWeight: '500' },
  play: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#f5f6f8', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' },
  modalHeader: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#dcdcdc' },
  modalHeaderText: { fontSize: 18, fontWeight: '600' },
  modalBody: { padding: 20, maxHeight: 400 },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 20 },
  microBox: { borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 8, backgroundColor: '#fff', marginBottom: 20 },
  microHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  microBody: { borderTopWidth: 1, borderTopColor: '#e4e4e4' },
  microSubHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, backgroundColor: '#f0f2f5' },
  detecting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 8 },
  espItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f1f1' },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: '#1f4e6c', justifyContent: 'center', alignItems: 'center' },
  checked: { backgroundColor: '#1f4e6c' },
  noDevices: { padding: 16, textAlign: 'center', color: '#999' },
  modalFooter: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderTopWidth: 1, borderTopColor: '#dcdcdc', gap: 12 },
  cancel: { flex: 1, backgroundColor: '#7a8597', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  save: { flex: 1, backgroundColor: '#102c57', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '500' },
});

export default HardwareStatus;