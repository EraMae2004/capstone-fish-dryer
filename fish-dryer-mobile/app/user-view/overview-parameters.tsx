import React from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from "react-native";
import { userTypography } from "@/lib/user-typography";
import { formatDigitsAsHMS } from "@/lib/duration-format";

export default function OverviewParameters({
  fishType,
  setFishType,
  totalFish,
  setTotalFish,
  temperature,
  setTemperature,
  fanSpeed,
  setFanSpeed,
  /** Stored as digits-only string ("013000" for 01:30:00); displayed as HH:MM:SS. */
  duration,
  setDuration,
  startMachine,
  pauseMachine,
  stopMachine,
  recommendation,
  applyRecommendation,
  /** True while a drying session is `running` — disables all parameter inputs. */
  parametersLocked,
  sessionStatus,
  hasActiveSession,
  needsExtension,
  waitingForExtension,
  machineOnline,
}: any) {

  const [unit, setUnit] = React.useState("pcs");
  const [showUnit, setShowUnit] = React.useState(false);
  const [showFan, setShowFan] = React.useState(false);

  const locked = Boolean(parametersLocked);
  /** Match overview header: only treat explicit `false` as offline. */
  const online = machineOnline === true;
  const extensionMode = Boolean(waitingForExtension || needsExtension);
  const hasApplicableRecommendation =
    recommendation != null &&
    recommendation.temperature != null &&
    recommendation.fan_speed != null &&
    (extensionMode
      ? Number(recommendation.extension_minutes) >= 1
      : Number(recommendation.duration_minutes) >= 1);
  const sessionSt = String(sessionStatus ?? "").trim().toLowerCase();
  const isPaused = sessionSt === "paused";
  const sessionActive = Boolean(hasActiveSession);

  /**
   * Stopwatch-style HH:MM:SS input: the user types digits only (no colons).
   * Each new digit appends and the format shifts left, so the freshest digit
   * always lands in the seconds slot. Backspace drops the rightmost digit.
   *
   * The parent stores the raw digits buffer (e.g. "13000" → display "01:30:00").
   * We compare the lengths of the *formatted display* (always 8 chars) vs the
   * incoming `text` to robustly classify the edit:
   *   newLen > 8 → user typed a character (append last char of text)
   *   newLen < 8 → user backspaced (drop last buffer digit)
   *   newLen = 8 → paste/replace (take last 6 digits of text)
   */
  const durationDigits = String(duration ?? "").replace(/\D/g, "").slice(-6);
  const durationDisplay = formatDigitsAsHMS(durationDigits);

  const handleDurationChange = (text: string) => {
    const incoming = String(text ?? "");
    const newLen = incoming.length;
    const oldLen = durationDisplay.length; // always 8

    if (newLen > oldLen) {
      const lastChar = incoming.slice(-1);
      if (/\d/.test(lastChar)) {
        setDuration((durationDigits + lastChar).slice(-6));
      }
      return;
    }

    if (newLen < oldLen) {
      setDuration(durationDigits.slice(0, -1));
      return;
    }

    const incomingDigits = incoming.replace(/\D/g, "");
    setDuration(incomingDigits.slice(-6));
  };

  const inputStyle = [styles.input, locked && styles.inputDisabled];
  const inputWithRightControlStyle = [styles.input, styles.inputWithRightControl, locked && styles.inputDisabled];
  const inputWithSuffixStyle = [styles.input, styles.inputWithSuffix, locked && styles.inputDisabled];
  const inputButtonStyle = [styles.input, styles.inputButton, locked && styles.inputDisabled];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>

      {/* CONTROL PANEL */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Control Panel</Text>

        {!online && (
          <Text style={styles.lockNotice}>
            The machine is offline. Start and resume are unavailable until it reconnects.
          </Text>
        )}

        {locked && (
          <Text style={styles.lockNotice}>
            Drying is running. Pause or stop to change parameters.
          </Text>
        )}
        {isPaused && (
          <Text style={styles.lockNotice}>
            Drying is paused. Tap Resume to continue, or Stop to end the session.
          </Text>
        )}

        {/* TYPE OF FISH */}
        <View style={styles.formField}>
          <TextInput
            placeholder="Type of Fish"
            value={fishType}
            onChangeText={setFishType}
            style={inputStyle}
            editable={!locked}
          />
        </View>

        {/* NO. OF FISH */}
        <View style={[styles.formField, styles.fieldContainer]}>
          <TextInput
            placeholder="No. of Fish"
            value={totalFish}
            onChangeText={setTotalFish}
            style={inputWithRightControlStyle}
            keyboardType="numeric"
            editable={!locked}
          />

          {/* RIGHT ARROW */}
          <TouchableOpacity
            style={styles.dropdownTrigger}
            onPress={() => {
              setShowUnit(!showUnit);
              setShowFan(false);
            }}
            disabled={locked}
          >
            <Text style={styles.dropdownText}>
              {unit.toUpperCase()} ▼
            </Text>
          </TouchableOpacity>

          {/* DROPDOWN */}
          {showUnit && !locked && (
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
            style={inputWithSuffixStyle}
            keyboardType="numeric"
            editable={!locked}
          />
          <Text style={styles.suffix}>°C</Text>
        </View>

        {/* FAN SPEED */}
        <View style={[styles.formField, styles.fieldContainer]}>
          <TouchableOpacity
            style={inputButtonStyle}
            onPress={() => {
              setShowFan(!showFan);
              setShowUnit(false);
            }}
            disabled={locked}
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
            disabled={locked}
          >
            <Text style={styles.dropdownText}>▼</Text>
          </TouchableOpacity>

          {/* DROPDOWN */}
          {showFan && !locked && (
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
            placeholder="00:00:00"
            value={durationDisplay}
            onChangeText={handleDurationChange}
            style={inputStyle}
            keyboardType="numeric"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!locked}
          />
        </View>

        {/* BUTTONS */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.startBtn, (locked || !online) && styles.btnDisabled]}
            onPress={startMachine}
            disabled={locked || !online}
          >
            <Text style={styles.btnText}>▶ Start</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.pauseBtn,
              (!locked && !isPaused) || (isPaused && !online) ? styles.btnDisabled : null,
            ]}
            onPress={pauseMachine}
            disabled={(!locked && !isPaused) || (isPaused && !online)}
          >
            <Text style={styles.btnText}>{isPaused ? "▶ Resume" : "|| Pause"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.stopBtn, !sessionActive && styles.btnDisabled]}
            onPress={stopMachine}
            disabled={!sessionActive}
          >
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

        <TouchableOpacity
          style={[
            styles.applyBtn,
            ((locked && !waitingForExtension) ||
              !hasApplicableRecommendation ||
              (extensionMode && !online)) &&
              styles.btnDisabled,
          ]}
          onPress={() => void applyRecommendation()}
          disabled={
            (locked && !waitingForExtension) ||
            !hasApplicableRecommendation ||
            (extensionMode && !online)
          }
        >
          <Text style={styles.applyText}>
            {waitingForExtension || needsExtension
              ? "Apply & Continue Drying"
              : "Apply Recommendation"}
          </Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    elevation: 3,
  },

  cardTitle: {
    ...userTypography.cardTitle,
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
    ...userTypography.body,
  },

  inputDisabled: {
    backgroundColor: "#ececec",
    color: "#888",
    opacity: 0.7,
  },

  lockNotice: {
    ...userTypography.body,
    color: "#b8860b",
    backgroundColor: "#fff8e1",
    borderColor: "#f1c40f",
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },

  durationHint: {
    ...userTypography.caption,
    color: "#777",
    marginTop: 4,
  },

  btnDisabled: {
    opacity: 0.5,
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
    ...userTypography.bodyStrong,
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
    ...userTypography.bodyStrong,
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
    ...userTypography.bodyStrong,
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
    ...userTypography.bodyStrong,
  },

  recommendationText:{
    textAlign:"center",
    marginVertical:20,
    ...userTypography.body,
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
    ...userTypography.bodyStrong,
    fontWeight: "700",
  }

});