import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  Alert,
} from "react-native";
import { Ionicons, FontAwesome } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";

const BASE_URL = "https://spinproof-brineless-marleen.ngrok-free.dev";

export default function UserProfile() {
  const [user, setUser] = useState<any>(null);
  const [originalData, setOriginalData] = useState<any>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [removeImageFlag, setRemoveImageFlag] = useState(false);

  const [passwordModal, setPasswordModal] = useState(false);
  const [successModal, setSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // ================= LOAD USER =================
  useEffect(() => {
    const loadUser = async () => {
      const storedUser = await AsyncStorage.getItem("user");
      if (!storedUser) return;

      const parsed = JSON.parse(storedUser);

      const response = await fetch(
        `${BASE_URL}/api/mobile/user/${parsed.id}`
      );
      const data = await response.json();

      if (data.success) {
        setUser(data.user);
        setOriginalData(data.user);

        setName(data.user.name || "");
        setPhone(data.user.phone || "");
        setBirthdate(
          data.user.birthdate
            ? data.user.birthdate.split("T")[0]
            : ""
        );
        setEmail(data.user.email || "");
        setAddress(data.user.address || "");
      }
    };

    loadUser();
  }, []);

  const initials =
    user?.name
      ?.split(" ")
      .map((w: string) => w[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "";

  // ================= IMAGE PICKER =================
  const pickImage = async () => {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required");
      return;
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
      setRemoveImageFlag(false);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
    setRemoveImageFlag(true);
  };

  // ================= SAVE PROFILE =================
  const saveProfile = async () => {
    if (!user) return;

    const formData = new FormData();

    formData.append("name", name);
    formData.append("phone", phone);
    formData.append("email", email);
    formData.append("birthdate", birthdate);
    formData.append("address", address);

    if (selectedImage) {
      const filename = selectedImage.split("/").pop();
      const match = /\.(\w+)$/.exec(filename ?? "");
      const type = match ? `image/${match[1]}` : `image`;

      formData.append("profile_picture", {
        uri: selectedImage,
        name: filename,
        type,
      } as any);
    }

    if (removeImageFlag) {
      formData.append("remove_image", "1");
    }

    const response = await fetch(
      `${BASE_URL}/api/mobile/update-profile/${user.id}`,
      {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      }
    );

    const data = await response.json();

    if (data.success) {
      setUser(data.user);
      setOriginalData(data.user);
      await AsyncStorage.setItem(
        "user",
        JSON.stringify(data.user)
      );

      setSelectedImage(null);
      setRemoveImageFlag(false);

      setSuccessMessage("Profile Changes Saved!");
      setSuccessModal(true);
    } else {
      Alert.alert("Error", "Failed to save profile.");
    }
  };

  // ================= CANCEL =================
  const discardProfile = () => {
    if (!originalData) return;

    setName(originalData.name || "");
    setPhone(originalData.phone || "");
    setBirthdate(
      originalData.birthdate
        ? originalData.birthdate.split("T")[0]
        : ""
    );
    setEmail(originalData.email || "");
    setAddress(originalData.address || "");

    setSelectedImage(null);
    setRemoveImageFlag(false);
  };

  // ================= CHANGE PASSWORD =================
  const handlePasswordSave = async () => {
    if (!currentPass || !newPass || !confirmPass)
      return Alert.alert("Fill all fields");

    if (newPass !== confirmPass)
      return Alert.alert("Passwords do not match");

    const response = await fetch(
      `${BASE_URL}/api/mobile/change-password/${user.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          current_password: currentPass,
          new_password: newPass,
          new_password_confirmation: confirmPass,
        }),
      }
    );

    const data = await response.json();

    if (data.success) {
      setPasswordModal(false);
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");

      setSuccessMessage("Password updated successfully.");
      setSuccessModal(true);
    } else {
      Alert.alert("Error", data.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity
          style={styles.changePasswordBtn}
          onPress={() => setPasswordModal(true)}
        >
          <FontAwesome name="key" size={14} color="white" />
          <Text style={styles.changePasswordText}>
            {" "}Change Password
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.profileSection}>
          <View style={styles.profileCircle}>
            {selectedImage ? (
              <Image source={{ uri: selectedImage }} style={styles.image} />
            ) : !removeImageFlag && user?.profile_picture ? (
              <Image
                source={{
                  uri: `${BASE_URL}/storage/${user.profile_picture}`,
                }}
                style={styles.image}
              />
            ) : (
              <Text style={styles.initialText}>{initials}</Text>
            )}
          </View>

          <View style={styles.imageButtons}>
            <TouchableOpacity style={styles.editBtn} onPress={pickImage}>
              <FontAwesome name="pencil" size={13} color="white" />
              <Text style={styles.smallBtnText}> Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.removeBtn} onPress={removeImage}>
              <FontAwesome name="trash" size={13} color="white" />
              <Text style={styles.smallBtnText}> Remove</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Input label="Name" icon="user" value={name} onChange={setName} />
        <Input label="Birthdate" icon="birthday-cake" value={birthdate} onChange={setBirthdate} />
        <Input label="Address" icon="map-marker" value={address} onChange={setAddress} />
        <Input label="Contact No." icon="phone" value={phone} onChange={setPhone} />
        <Input label="Email" icon="envelope" value={email} onChange={setEmail} />

        <View style={styles.footer}>
          <TouchableOpacity style={styles.saveBtn} onPress={saveProfile}>
            <Text style={styles.footerBtnText}>Save</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={discardProfile}>
            <Text style={styles.footerBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* PASSWORD MODAL */}
      <Modal visible={passwordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.passwordCard}>
            <PasswordInput label="Current Password" value={currentPass} setValue={setCurrentPass} show={showCurrent} setShow={setShowCurrent} />
            <PasswordInput label="New Password" value={newPass} setValue={setNewPass} show={showNew} setShow={setShowNew} />
            <PasswordInput label="Confirm Password" value={confirmPass} setValue={setConfirmPass} show={showConfirm} setShow={setShowConfirm} />

            <TouchableOpacity style={styles.updateBtn} onPress={handlePasswordSave}>
              <Text style={{ color: "white" }}>Save</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setPasswordModal(false)}
            >
              <Text style={{ color: "white" }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SUCCESS MODAL */}
      <Modal visible={successModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.successCard}>
            <View style={styles.checkIcon}>
              <Ionicons name="checkmark" size={26} color="white" />
            </View>
            <Text style={{ marginTop: 20, fontWeight: "600" }}>
              {successMessage}
            </Text>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setSuccessModal(false)}
            >
              <Text style={{ color: "white" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const Input = ({ label, icon, value, onChange }: any) => (
  <View style={{ marginBottom: 15 }}>
    <Text style={styles.label}>
      <FontAwesome name={icon} size={14} color="#113F67" /> {label}
    </Text>
    <TextInput style={styles.input} value={value} onChangeText={onChange} />
  </View>
);

const PasswordInput = ({ label, value, setValue, show, setShow }: any) => (
  <View style={{ marginBottom: 15 }}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.passwordInput}>
      <TextInput secureTextEntry={!show} style={{ flex: 1 }} value={value} onChangeText={setValue} />
      <Ionicons name={show ? "eye-off" : "eye"} size={20} color="#4fb0d9" onPress={() => setShow(!show)} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: "#f5f7fa" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  title: { fontSize: 22, fontWeight: "700" },

  changePasswordBtn: {
    backgroundColor: "#113F67",
    padding: 8,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
  },

  changePasswordText: { color: "white", fontSize: 12 },

  card: { backgroundColor: "white", padding: 25, borderRadius: 12 },

  profileSection: { alignItems: "center", marginBottom: 20 },

  profileCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#ddd",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },

  image: { width: "100%", height: "100%" },

  imageButtons: { flexDirection: "row", gap: 20, marginTop: 15 },

  editBtn: {
    backgroundColor: "#495057",
    padding: 8,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
  },

  removeBtn: {
    backgroundColor: "#dc3545",
    padding: 8,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
  },

  smallBtnText: { color: "white", fontSize: 12 },
  initialText: { fontSize: 28, fontWeight: "700" },

  label: { fontWeight: "600", marginBottom: 6 },

  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 10,
  },

  footer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 25,
    marginTop: 20,
  },

  saveBtn: {
    backgroundColor: "#113F67",
    padding: 10,
    borderRadius: 6,
    minWidth: 100,
    alignItems: "center",
  },

  cancelBtn: {
    backgroundColor: "#6c757d",
    padding: 10,
    borderRadius: 6,
    minWidth: 100,
    alignItems: "center",
  },

  footerBtnText: { color: "white" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },

  passwordCard: {
    backgroundColor: "white",
    padding: 25,
    borderRadius: 20,
    width: "85%",
  },

  passwordInput: {
    flexDirection: "row",
    borderWidth: 2,
    borderColor: "#dcdcdc",
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },

  updateBtn: {
    backgroundColor: "#4fb0d9",
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },

  modalCancelBtn: {
    backgroundColor: "#6c757d",
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 15,
  },

  successCard: {
    backgroundColor: "#fff",
    padding: 30,
    borderRadius: 20,
    alignItems: "center",
    width: "80%",
  },

  checkIcon: {
    width: 70,
    height: 70,
    backgroundColor: "#4fb0d9",
    borderRadius: 35,
    justifyContent: "center",
    alignItems: "center",
  },
});