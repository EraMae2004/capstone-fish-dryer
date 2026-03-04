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
  const [stage, setStage] = useState<"front" | "back">("front");

  const [preview, setPreview] = useState<string | null>(null);
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);
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

  function saveImage() {
    if (stage === "front") {
      setFrontImage(preview);
      setPreview(null);

      const msg =
        mode === "capture"
          ? "Flip tray to capture back view..."
          : "Select image that capture the fish tray back view";

      setMessage(msg);

      setTimeout(() => {
        setMessage(null);
        setStage("back");
      }, 3000);
    } else {
      const back = preview;

      setBackImage(back);
      setPreview(null);

      setAnalyzing(true);

      setTimeout(() => {
        router.replace({
          pathname: "/user-view/overview-control-panel",
          params: {
            frontImage,
            backImage: back,
            batchIndex,
          },
        });
      }, 2000);
    }
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
          <Text style={styles.text}>Analyzing Image...</Text>
        </View>
      </View>
    );
  }

  if (message) {
    return (
      <View style={styles.container}>
        <View style={styles.frame}>
          <Text style={styles.text}>{message}</Text>
        </View>

        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => router.back()}
        >
          <Text style={styles.btnText}>Close</Text>
        </TouchableOpacity>
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

      <TouchableOpacity
        style={styles.closeBtn}
        onPress={() => router.back()}
      >
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