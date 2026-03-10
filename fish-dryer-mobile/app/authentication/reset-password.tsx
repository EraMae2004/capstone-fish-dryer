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
  Alert
} from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';

const BASE_URL = "http://10.246.103.15:8000";

export default function ResetPassword() {
  const router = useRouter();
  const { email } = useLocalSearchParams();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleUpdate = async () => {
    if (password !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }

    try {
      const response = await fetch(`${BASE_URL}/api/mobile/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          password_confirmation: confirmPassword
        })
      });

      const data = await response.json();

      if (data.success) {
        Alert.alert("Success", data.message);
        router.replace('/authentication/login');
      } else {
        Alert.alert("Error", data.message);
      }

    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Something went wrong.");
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.wrapper}>
        <View style={styles.container}>

          <TouchableOpacity
            style={styles.backArrow}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#4fc3f7" />
          </TouchableOpacity>

          <Text style={styles.title}>Reset Password</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="lock" size={14} color="#4fc3f7" /> New Password
            </Text>
            <View style={styles.passwordWrapper}>
              <TextInput
                style={styles.passwordInput}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <FontAwesome
                  name={showPassword ? "eye-slash" : "eye"}
                  size={18}
                  color="#4fc3f7"
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="lock" size={14} color="#4fc3f7" /> Confirm Password
            </Text>
            <View style={styles.passwordWrapper}>
              <TextInput
                style={styles.passwordInput}
                secureTextEntry={!showConfirm}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)}>
                <FontAwesome
                  name={showConfirm ? "eye-slash" : "eye"}
                  size={18}
                  color="#4fc3f7"
                />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleUpdate}>
            <Text style={styles.buttonText}>Update Password</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexGrow: 1,
    backgroundColor: '#2c3e50',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  container: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    paddingVertical: 55,
    paddingHorizontal: 25,
    borderRadius: 25,
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 15 },
    elevation: 15
  },
  backArrow: {
    position: 'absolute',
    top: 25,
    left: 25
  },
  title: {
    textAlign: 'center',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 45,
    color: '#2c3e50'
  },
  formGroup: {
    marginBottom: 30
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    color: '#2c3e50'
  },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e6ed',
    borderRadius: 12,
    paddingHorizontal: 15,
    height: 50,
    justifyContent: 'space-between'
  },
  passwordInput: {
    flex: 1,
    fontSize: 14
  },
  button: {
    marginTop: 30,
    backgroundColor: '#4fc3f7',
    paddingVertical: 14,
    borderRadius: 12
  },
  buttonText: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#2c3e50'
  }
});