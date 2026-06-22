import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { userTypography } from "@/lib/user-typography";

type Props = {
  visible: boolean;
  onCheckMoisture: () => void;
  onDryAgain: () => void;
  onStop: () => void;
};

export default function DryingCompleteModal({
  visible,
  onCheckMoisture,
  onDryAgain,
  onStop,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDryAgain}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onDryAgain} />

        <View style={styles.card}>
          <View style={styles.iconRing}>
            <MaterialCommunityIcons name="timer-off" size={36} color="#1f4e6c" />
          </View>

          <Text style={styles.title}>Drying time is complete</Text>
          <Text style={styles.lead}>
            The dryer has stopped heating and the fan is off. Check the moisture of your fish
            before you finish. If the fish still needs more drying, you can run another cycle.
            Tap Stop when you are done with this batch.
          </Text>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={onCheckMoisture}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="water-percent" size={18} color="#fff" />
            <Text style={styles.primaryText}>Check moisture</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={onDryAgain}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="refresh" size={18} color="#1f4e6c" />
            <Text style={styles.secondaryText}>Continue drying session</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.stopBtn}
            onPress={onStop}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="stop-circle-outline" size={18} color="#c0392b" />
            <Text style={styles.stopText}>Stop session</Text>
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
    paddingHorizontal: 24,
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },

  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: "stretch",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },

  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#e8f4fc",
    borderWidth: 2,
    borderColor: "#b8d9f0",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },

  title: {
    ...userTypography.pageTitle,
    fontSize: 22,
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 10,
  },

  lead: {
    ...userTypography.body,
    color: "#475569",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 22,
  },

  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#1f4e6c",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },

  primaryText: {
    ...userTypography.bodyStrong,
    color: "#fff",
  },

  secondaryBtn: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#b8d9f0",
    backgroundColor: "#f0f7fc",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },

  secondaryText: {
    ...userTypography.bodyStrong,
    color: "#1f4e6c",
  },

  stopBtn: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#f5c6c0",
    backgroundColor: "#fff5f4",
    alignItems: "center",
    justifyContent: "center",
  },

  stopText: {
    ...userTypography.bodyStrong,
    color: "#c0392b",
  },
});
