import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from "react-native";
import { CameraView, Camera } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function CameraViewScreen() {
  const router = useRouter();
  const { mode, batchIndex } = useLocalSearchParams();

  const cameraRef = useRef<any>(null);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    requestPermission();
  }, []);

  async function requestPermission() {
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasPermission(status === "granted");
  }

  async function takePhoto() {
    if (!cameraRef.current) return;

    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.8,
    });

    setPreview(photo.uri);
  }

  async function uploadPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
    });

    if (!result.canceled) {
      setPreview(result.assets[0].uri);
    }
  }

  function retake() {
    setPreview(null);
  }

  /* SAVE IMAGE → RETURN TO BATCH SCREEN */

  function saveImage() {

    if (!preview) return;

    setAnalyzing(true);

    setTimeout(() => {
      router.replace({
        pathname: "/user-view/overview-batch",
        params: {
          image: preview,
          batchIndex,
        },
      });
    }, 500);

  }

  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text>No Camera Permission</Text>
      </View>
    );
  }

  if (analyzing) {
    return (
      <View style={styles.container}>
        <View style={styles.frame}>
          <ActivityIndicator size="large" />
          <Text style={styles.text}>Processing Image...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        {preview ? (
          <Image source={{ uri: preview }} style={styles.image} />
        ) : mode === "capture" ? (
          <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        ) : (
          <View style={styles.uploadPlaceholder}>
            <Text style={styles.text}>Upload Photo</Text>
          </View>
        )}
      </View>

      {preview ? (
        <>
          <TouchableOpacity style={styles.primaryBtn} onPress={saveImage}>
            <Text style={styles.btnText}>SAVE</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={retake}>
            <Text style={styles.btnText}>
              {mode === "capture" ? "Retake Photo" : "Re-upload Photo"}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={mode === "capture" ? takePhoto : uploadPhoto}
        >
          <Text style={styles.btnText}>
            {mode === "capture" ? "Take Photo" : "Upload Photo"}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
        <Text style={styles.btnText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f4f7",
    padding: 20,
    justifyContent: "center",
  },

  frame: {
    height: 350,
    backgroundColor: "#ddd",
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },

  camera: {
    width: "100%",
    height: "100%",
  },

  image: {
    width: "100%",
    height: "100%",
  },

  uploadPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  text: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f3c5c",
    textAlign: "center",
  },

  primaryBtn: {
    backgroundColor: "#123d5a",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
    marginBottom: 10,
  },

  secondaryBtn: {
    backgroundColor: "#2f4f65",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
    marginBottom: 10,
  },

  closeBtn: {
    backgroundColor: "#2f4f65",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
  },

  btnText: {
    color: "#fff",
    fontWeight: "600",
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});