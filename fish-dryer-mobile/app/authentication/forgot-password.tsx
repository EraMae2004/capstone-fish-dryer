import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function ForgotPassword() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.wrapper}>
        <View style={styles.container}>

          {/* BACK BUTTON */}
          <TouchableOpacity
            style={styles.backArrow}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={22} color="#4fc3f7" />
          </TouchableOpacity>

          {/* TITLE */}
          <Text style={styles.title}>Forgot Password</Text>

          {/* EMAIL */}
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
              placeholderTextColor="#999"
            />
          </View>

          {/* PHONE */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="phone" size={14} color="#4fc3f7" /> Phone
            </Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholderTextColor="#999"
            />
          </View>

          {/* ADDRESS */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="map-marker" size={14} color="#4fc3f7" /> Address
            </Text>
            <TextInput
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              placeholderTextColor="#999"
            />
          </View>

          {/* BUTTON */}
          <TouchableOpacity style={styles.button}>
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