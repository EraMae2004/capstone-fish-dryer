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
  variant?: "start" | "resume";
  onCancel: () => void;
  onContinue: () => void;
};

export default function DoorOpenModal({
  visible,
  variant = "start",
  onCancel,
  onContinue,
}: Props) {
  const lead =
    variant === "resume"
      ? "The dryer door reads open. Close it before you resume for safe, even drying. If the door sensor is not working correctly, tap Continue to treat the door as closed and resume anyway."
      : "The dryer door reads open. Close it before you start for safe, even drying. If the door sensor is not working correctly, tap Continue to treat the door as closed and start anyway.";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onCancel} />

        <View style={styles.card}>
          <View style={styles.iconRing}>
            <MaterialCommunityIcons name="door-open" size={36} color="#b45309" />
          </View>

          <Text style={styles.title}>Door is open</Text>
          <Text style={styles.lead}>{lead}</Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.continueBtn}
              onPress={onContinue}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="check-circle-outline" size={18} color="#fff" />
              <Text style={styles.continueText}>Continue</Text>
            </TouchableOpacity>
          </View>
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
    ...StyleSheet.absoluteFill,
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
    alignItems: "center",
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
    backgroundColor: "#fff7ed",
    borderWidth: 2,
    borderColor: "#fed7aa",
    alignItems: "center",
    justifyContent: "center",
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

  actions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },

  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },

  cancelText: {
    ...userTypography.bodyStrong,
    color: "#475569",
  },

  continueBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#1f4e6c",
    alignItems: "center",
    justifyContent: "center",
  },

  continueText: {
    ...userTypography.bodyStrong,
    color: "#fff",
  },
});
