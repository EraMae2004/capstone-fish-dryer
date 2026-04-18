import React from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from "react-native";

export default function OverviewParameters({
  fishType,
  setFishType,
  totalFish,
  setTotalFish,
  temperature,
  setTemperature,
  fanSpeed,
  setFanSpeed,
  duration,
  setDuration,
  startMachine,
  pauseMachine,
  stopMachine,
  machineStatus,
  machineName,
  timer,
  recommendation,
  applyRecommendation
}: any) {

  const [unit, setUnit] = React.useState("pcs");
  const [showUnit, setShowUnit] = React.useState(false);
  const [showFan, setShowFan] = React.useState(false);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>

      {/* HEADER */}
      <Text style={styles.pageTitle}>OVERVIEW</Text>

      <View style={styles.machineHeader}>
        <View style={styles.statusRowHeader}>
          <Text style={styles.machineStatus}>
            Machine Status: <Text style={styles.greenDot}>●</Text> {machineStatus}
          </Text>
          <Text style={styles.timerText}>{timer ?? "--"}</Text>
        </View>

        <TouchableOpacity style={styles.machineDropdown}>
          <Text>{machineName || "Select Machine"} ▼</Text>
        </TouchableOpacity>
      </View>

      {/* CONTROL PANEL */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Control Panel</Text>

        {/* TYPE OF FISH */}
        <View style={styles.formField}>
          <TextInput
            placeholder="Type of Fish"
            value={fishType}
            onChangeText={setFishType}
            style={styles.input}
          />
        </View>

        {/* NO. OF FISH */}
        <View style={[styles.formField, styles.fieldContainer]}>
          <TextInput
            placeholder="No. of Fish"
            value={totalFish}
            onChangeText={setTotalFish}
            style={[styles.input, styles.inputWithRightControl]}
            keyboardType="numeric"
          />

          {/* RIGHT ARROW */}
          <TouchableOpacity
            style={styles.dropdownTrigger}
            onPress={() => {
              setShowUnit(!showUnit);
              setShowFan(false);
            }}
          >
            <Text style={styles.dropdownText}>
              {unit.toUpperCase()} ▼
            </Text>
          </TouchableOpacity>

          {/* DROPDOWN */}
          {showUnit && (
            <View style={styles.dropdown}>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  setUnit("kg");
                  setShowUnit(false);
                }}
              >
                <Text style={styles.dropdownItemText}>KG</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  setUnit("pcs");
                  setShowUnit(false);
                }}
              >
                <Text style={styles.dropdownItemText}>PCS</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* TEMPERATURE */}
        <View style={[styles.formField, styles.inputWrapper]}>
          <TextInput
            placeholder="Temperature"
            value={temperature}
            onChangeText={setTemperature}
            style={[styles.input, styles.inputWithSuffix]}
            keyboardType="numeric"
          />
          <Text style={styles.suffix}>°C</Text>
        </View>

        {/* FAN SPEED */}
        <View style={[styles.formField, styles.fieldContainer]}>
          <TouchableOpacity
            style={[styles.input, styles.inputButton]}
            onPress={() => {
              setShowFan(!showFan);
              setShowUnit(false);
            }}
          >
            <Text>Fan Speed Level {fanSpeed || "1"}</Text>
          </TouchableOpacity>

          {/* RIGHT ARROW */}
          <TouchableOpacity
            style={styles.dropdownTrigger}
            onPress={() => {
              setShowFan(!showFan);
              setShowUnit(false);
            }}
          >
            <Text style={styles.dropdownText}>▼</Text>
          </TouchableOpacity>

          {/* DROPDOWN */}
          {showFan && (
            <View style={styles.dropdown}>
              {["1","2","3"].map(level => (
                <TouchableOpacity
                  key={level}
                  style={styles.dropdownItem}
                  onPress={() => {
                    setFanSpeed(level);
                    setShowFan(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>
                    Level {level}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* DURATION */}
        <View style={styles.formField}>
          <TextInput
            placeholder="Duration (minutes)"
            value={duration}
            onChangeText={setDuration}
            style={styles.input}
            keyboardType="numeric"
          />
        </View>

        {/* BUTTONS */}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.startBtn} onPress={startMachine}>
            <Text style={styles.btnText}>▶ Start</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.pauseBtn} onPress={pauseMachine}>
            <Text style={styles.btnText}>|| Pause</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.stopBtn} onPress={stopMachine}>
            <Text style={styles.btnText}>■ Stop</Text>
          </TouchableOpacity>
        </View>

      </View>

      {/* RECOMMENDATION */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recommendation</Text>

        <Text style={styles.recommendationText}>
          {recommendation?.description || "No recommendation available"}
        </Text>

        <TouchableOpacity style={styles.applyBtn} onPress={applyRecommendation}>
          <Text style={styles.applyText}>Apply Recommendation</Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({

  pageTitle:{
    fontSize:20,
    fontWeight:"700",
    marginBottom:15,
    color:"#1f3c5c"
  },

  machineHeader:{
    marginBottom:20
  },

  machineStatus:{
    fontWeight:"600"
  },

  greenDot:{
    color:"green"
  },

  machineDropdown:{
    backgroundColor:"#fff",
    padding:10,
    borderRadius:8,
    borderWidth:1,
    borderColor:"#ddd",
    marginBottom:20
  },

  statusRowHeader:{
    flexDirection:"row",
    justifyContent:"space-between",
    alignItems:"center",
    marginBottom:10
  },

  timerText:{
    fontSize:15,
    fontWeight:"700",
    color:"#1f3c5c"
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    elevation: 3,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 14,
    color: "#1f3c5c",
  },

  input: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 12,
    minHeight: 48,
  },

  formField: {
    marginBottom: 12,
  },

  inputWrapper:{
    position:"relative"
  },

  inputWithRightControl: {
    paddingRight: 80,
  },

  inputWithSuffix: {
    paddingRight: 44,
  },

  inputButton: {
    justifyContent: "center",
  },

  suffix:{
    position:"absolute",
    right:12,
    top:12,
    fontWeight:"600",
    color:"#555"
  },

  fieldContainer:{
    position:"relative"
  },

  dropdownTrigger:{
    position:"absolute",
    right:12,
    top:12
  },

  dropdownText:{
    fontWeight:"600",
    color:"#555"
  },

  dropdown:{
    position:"absolute",
    right:0,
    top:50,
    width:120,
    backgroundColor:"#fff",
    borderWidth:1,
    borderColor:"#ccc",
    borderRadius:8,
    zIndex:100
  },

  dropdownItem:{
    padding:12,
    borderBottomWidth:1,
    borderBottomColor:"#eee"
  },

  dropdownItemText:{
    textAlign:"center",
    fontWeight:"600"
  },

  buttonRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginTop: 2,
  },

  startBtn: {
    flex: 1,
    maxWidth: 100,
    backgroundColor: "#2ecc71",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },

  pauseBtn: {
    flex: 1,
    maxWidth: 100,
    backgroundColor: "#f1c40f",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },

  stopBtn: {
    flex: 1,
    maxWidth: 100,
    backgroundColor: "#e74c3c",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },

  btnText: {
    color: "#fff",
    fontWeight: "600",
  },

  recommendationText:{
    textAlign:"center",
    marginVertical:20,
    color:"#555"
  },

  applyBtn:{
    backgroundColor:"#0d3b66",
    padding:12,
    borderRadius:8,
    alignItems:"center"
  },

  applyText:{
    color:"#fff",
    fontWeight:"700"
  }

});