import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image
} from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';

const BASE_URL = "http://10.246.103.15:8000";

export default function Registration() {
  const router = useRouter();

  const [profileImage, setProfileImage] = useState<any>(null);
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (!result.canceled) {
      setProfileImage(result.assets[0]);
    }
  };

  const removeImage = () => {
    setProfileImage(null);
  };

  const handleRegister = async () => {
    if (!name || !email || !phone || !password) {
      Alert.alert("Error", "Please fill required fields.");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }

    try {
      setLoading(true);

      const formData = new FormData();
      formData.append('name', name);
      formData.append('birthdate', birthdate);
      formData.append('address', address);
      formData.append('phone', phone);
      formData.append('email', email);
      formData.append('password', password);
      formData.append('password_confirmation', confirmPassword);

      if (profileImage) {
        formData.append('profile_picture', {
          uri: profileImage.uri,
          name: 'profile.jpg',
          type: 'image/jpeg',
        } as any);
      }

      const response = await fetch(`${BASE_URL}/api/mobile/register`, {
        method: "POST",
        headers: { Accept: 'application/json' },
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        Alert.alert("Success", "Registration successful.");
        router.replace('/authentication/login');
      } else {
        Alert.alert("Error", data.message || "Registration failed.");
      }

    } catch (error) {
      Alert.alert("Error", "Server connection failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.wrapper}>
          <View style={styles.card}>

            <Text style={styles.title}>Create Account</Text>

            {/* PROFILE IMAGE */}
            <View style={styles.imageSection}>
              <View style={styles.imageContainer}>
                {profileImage ? (
                  <Image source={{ uri: profileImage.uri }} style={styles.profileImage} />
                ) : (
                  <Ionicons name="person" size={50} color="#ccc" />
                )}
              </View>

              <View style={{ flexDirection: 'row', marginTop: 10 }}>
                <TouchableOpacity style={styles.editBtn} onPress={pickImage}>
                  <FontAwesome name="edit" size={12} color="#fff" />
                  <Text style={styles.smallBtnText}> Edit</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.removeBtn} onPress={removeImage}>
                  <FontAwesome name="trash" size={12} color="#fff" />
                  <Text style={styles.smallBtnText}> Remove</Text>
                </TouchableOpacity>
              </View>
            </View>

            {renderInput("user", "Name", name, setName)}

            {/* BIRTHDATE */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>
                <FontAwesome name="birthday-cake" size={14} color="#4fc3f7" /> Birthdate
              </Text>

              <TouchableOpacity style={styles.input} onPress={() => setShowPicker(true)}>
                <Text style={{ color: birthdate ? '#000' : '#999' }}>
                  {birthdate || 'Select birthdate'}
                </Text>
              </TouchableOpacity>

              {showPicker && (
                <DateTimePicker
                  value={date}
                  mode="date"
                  maximumDate={new Date()}
                  onChange={(event, selectedDate) => {
                    setShowPicker(false);
                    if (selectedDate) {
                      const formatted =
                        selectedDate.getFullYear() +
                        '-' +
                        String(selectedDate.getMonth() + 1).padStart(2, '0') +
                        '-' +
                        String(selectedDate.getDate()).padStart(2, '0');

                      setBirthdate(formatted);
                    }
                  }}
                />
              )}
            </View>

            {renderInput("map-marker", "Address", address, setAddress)}
            {renderInput("phone", "Contact No.", phone, setPhone)}
            {renderInput("envelope", "Email", email, setEmail)}

            {renderPassword("Password", password, setPassword, showPassword, setShowPassword)}
            {renderPassword("Confirm Password", confirmPassword, setConfirmPassword, showConfirm, setShowConfirm)}

            {/* REGISTER BUTTON */}
            <TouchableOpacity
              style={styles.registerBtn}
              onPress={handleRegister}
              disabled={loading}
            >
              <FontAwesome
                name="user-plus"
                size={16}
                color="#1f3b57"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.registerText}>
                {loading ? "Registering..." : "Register"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 20 }}
              onPress={() => router.replace('/authentication/login')}
            >
              <Text style={styles.bottomLink}>
                Already have an account? <Text style={styles.link}>click here</Text>
              </Text>
            </TouchableOpacity>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function renderInput(icon: any, label: string, value: string, setter: any) {
  return (
    <View style={styles.formGroup}>
      <Text style={styles.label}>
        <FontAwesome name={icon} size={14} color="#4fc3f7" /> {label}
      </Text>
      <TextInput style={styles.input} value={value} onChangeText={setter} />
    </View>
  );
}

function renderPassword(
  label: string,
  value: string,
  setter: any,
  visible: boolean,
  setVisible: any
) {
  return (
    <View style={styles.formGroup}>
      <Text style={styles.label}>
        <FontAwesome name="lock" size={14} color="#4fc3f7" /> {label}
      </Text>

      <View style={styles.passwordWrapper}>
        <TextInput
          style={styles.passwordInput}
          value={value}
          onChangeText={setter}
          secureTextEntry={!visible}
        />

        <TouchableOpacity onPress={() => setVisible(!visible)}>
          <Ionicons
            name={visible ? "eye-off" : "eye"}
            size={20}
            color="#4fc3f7"
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexGrow: 1,
    backgroundColor: '#2c3e50',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 40,
    paddingHorizontal: 25,
    elevation: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 25,
    color: '#1f3b57',
  },
  imageSection: { alignItems: 'center', marginBottom: 20 },
  imageContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#eee',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImage: { width: 120, height: 120, borderRadius: 60 },
  editBtn: {
    backgroundColor: '#6c757d',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 5,
    marginRight: 8,
    flexDirection: 'row',
  },
  removeBtn: {
    backgroundColor: '#dc3545',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 5,
    flexDirection: 'row',
  },
  smallBtnText: { fontSize: 12, color: '#fff' },
  formGroup: { marginBottom: 15 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 6,
    padding: 10,
  },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 6,
    paddingHorizontal: 10,
  },
  passwordInput: { flex: 1, paddingVertical: 10 },
  registerBtn: {
    marginTop: 20,
    backgroundColor: '#4fc3f7',
    paddingVertical: 15,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  registerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f3b57',
  },
  bottomLink: { textAlign: 'center', fontSize: 13 },
  link: { color: '#4fc3f7', fontWeight: '600' },
});