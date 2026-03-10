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
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Login() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  const BASE_URL = 'http://10.246.103.15:8000';

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter email and password");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(`${BASE_URL}/api/mobile/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Login Failed", data.message || "Invalid credentials");
        return;
      }

      // ✅ Save Laravel user
      await AsyncStorage.setItem('user', JSON.stringify(data.user));

      // ✅ Role based redirect
      if (data.user.role === "admin") {
        router.replace('/admin-view/admin-view');
      } else {
        router.replace('/user-view/user-view');
      }

    } catch (error: any) {
      Alert.alert("Error", "Cannot connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.wrapper}>
        <View style={styles.card}>

          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>
            Sign in to your AutoDry Pro account
          </Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="envelope" size={14} color="#4fc3f7" /> Email Address
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              <FontAwesome name="lock" size={14} color="#4fc3f7" /> Password
            </Text>

            <View style={styles.passwordWrapper}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter your password"
                placeholderTextColor="#999"
                secureTextEntry={!passwordVisible}
                value={password}
                onChangeText={setPassword}
              />

              <TouchableOpacity
                onPress={() => setPasswordVisible(!passwordVisible)}
              >
                <Ionicons
                  name={passwordVisible ? "eye-off" : "eye"}
                  size={20}
                  color="#4fc3f7"
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.options}>
            <TouchableOpacity
              style={styles.rememberContainer}
              onPress={() => setRemember(!remember)}
            >
              <View
                style={[
                  styles.checkbox,
                  remember && styles.checkboxActive
                ]}
              />
              <Text style={styles.rememberText}>Remember me</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/authentication/forgot-password')}
            >
              <Text style={styles.forgot}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.loginBtn}
            onPress={handleLogin}
            disabled={loading}
          >
            <FontAwesome
              name="sign-in"
              size={16}
              color="#2c3e50"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.loginText}>
              {loading ? "Signing In..." : "Sign In"}
            </Text>
          </TouchableOpacity>

          <View style={styles.bottomLink}>
            <Text style={{ fontSize: 14 }}>
              Don’t have an account?{' '}
              <Text
                style={styles.link}
                onPress={() => router.push('/authentication/registration')}
              >
                Click here
              </Text>
            </Text>
          </View>

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

  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#ffffff',
    paddingVertical: 60,
    paddingHorizontal: 30,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10
  },

  title: {
    fontSize: 42,
    fontWeight: '700',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 10
  },

  subtitle: {
    fontSize: 15,
    color: '#5a6b7b',
    textAlign: 'center',
    marginBottom: 50
  },

  formGroup: {
    marginBottom: 25
  },

  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 8
  },

  input: {
    width: '100%',
    padding: 15,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e6ed',
    fontSize: 15
  },

  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e6ed',
    borderRadius: 12,
    paddingHorizontal: 15
  },

  passwordInput: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 15
  },

  options: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 35
  },

  rememberContainer: {
    flexDirection: 'row',
    alignItems: 'center'
  },

  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: '#999',
    borderRadius: 4,
    marginRight: 8
  },

  checkboxActive: {
    backgroundColor: '#4fc3f7',
    borderColor: '#4fc3f7'
  },

  rememberText: {
    fontSize: 14
  },

  forgot: {
    fontSize: 14,
    color: '#4fc3f7'
  },

  loginBtn: {
    width: '100%',
    padding: 18,
    borderRadius: 14,
    backgroundColor: '#4fc3f7',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center'
  },

  loginText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2c3e50'
  },

  bottomLink: {
    marginTop: 25,
    alignItems: 'center'
  },

  link: {
    color: '#4fc3f7',
    fontWeight: '600'
  }

});