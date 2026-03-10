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
import { useRouter } from 'expo-router';
import { API_BASE_URL } from '@/config/api';

const BASE_URL = "https://spinproof-brineless-marleen.ngrok-free.dev";

export default function ForgotPassword() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const handleVerify = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/mobile/verify-identity`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          phone,
          address
        })
      });

      const data = await response.json();

      if (data.success) {
        router.push({
          pathname: '/authentication/reset-password',
          params: { email }
        });
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
            <Ionicons name="arrow-back" size={22} color="#4fc3f7" />
          </TouchableOpacity>

          <Text style={styles.title}>Forgot Password</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="envelope" size={14} color="#4fc3f7" /> Email
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="phone" size={14} color="#4fc3f7" /> Phone
            </Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="map-marker" size={14} color="#4fc3f7" /> Address
            </Text>
            <TextInput
              style={styles.input}
              value={address}
              onChangeText={setAddress}
            />
          </View>

          <TouchableOpacity
            style={styles.button}
            onPress={handleVerify}
          >
            <Text style={styles.buttonText}>Reset Password</Text>
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
    paddingVertical: 50,
    paddingHorizontal: 20,
    borderRadius: 18,
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12
  },
  backArrow: {
    position: 'absolute',
    top: 20,
    left: 20
  },
  title: {
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 50,
    color: '#2c3e50'
  },
  formGroup: {
    marginBottom: 30
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 8,
    color: '#2c3e50'
  },
  input: {
    width: '100%',
    padding: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#e0e6ed',
    fontSize: 14
  },
  button: {
    width: '80%',
    alignSelf: 'center',
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#4fc3f7',
    marginTop: 20
  },
  buttonText: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50'
  }
});