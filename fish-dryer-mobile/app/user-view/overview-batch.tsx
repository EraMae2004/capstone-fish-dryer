import React, { useState, useCallback } from "react";
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";


export default function OverviewBatch({ session }: any) {

  const router = useRouter();
  const params = useLocalSearchParams();

  function createEmptyBatch() {
    return {
      image: null as string | null,
      appearance: "--",
      color: "--",
      texture: "--",
      description: "--",
      fully_dried: "--",
      partially_dried: "--",
      not_dried: "--",
      detections: [] as any[],
      recommendation: {} as any,
    };
  }

  const [batches, setBatches] = useState([createEmptyBatch()]);

  /* RECEIVE IMAGE FROM CAMERA */

  useFocusEffect(
    useCallback(() => {

      if (params.image && params.batchIndex !== undefined) {

        const index = Number(params.batchIndex);

        const img =
          Array.isArray(params.image)
            ? params.image[0]
            : params.image;

        setBatches((prev) => {

          const updated = [...prev];

          if (!updated[index]) return prev;

          updated[index] = {
            ...updated[index],
            image: img,
          };

          setTimeout(() => {
            if (updated[index]?.image) {
              analyzeBatch(index);
            }
          }, 50);

          return updated;

        });

      }

    }, [params])
  );

  const addBatch = () => {
    setBatches((prev) => [...prev, createEmptyBatch()]);
  };

  const removeBatch = (index: number) => {
    const updated = [...batches];
    updated.splice(index, 1);
    setBatches(updated);
  };

  const captureTray = (index: number) => {

    router.push({
      pathname: "/user-view/camera-view",
      params: {
        mode: "capture",
        batchIndex: index,
      },
    });

  };

  const uploadImage = (index: number) => {

    router.push({
      pathname: "/user-view/camera-view",
      params: {
        mode: "upload",
        batchIndex: index,
      },
    });

  };

  async function uriToDataUrl(uri: string) {
    try {
      const resp = await fetch(uri);
      const blob = await resp.blob();

      return await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });

    } catch (e) {
      return null;
    }
  }

  /* AI ANALYSIS */

  const analyzeBatch = async (index: number) => {

    const batch = batches[index];

    if (!batch.image) return;

    const imageData = await uriToDataUrl(batch.image);

    try {

      const res = await fetch("http://10.246.103.15:8000/api/ai/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: imageData,
        }),
      });

      const data = await res.json();

      setBatches((prev) => {

        const updated = [...prev];

        updated[index] = {
          ...updated[index],
          image: data.annotated_image || updated[index].image,
          appearance: data.appearance || "--",
          color: data.color_text || "--",
          texture: data.texture_text || "--",
          description: data.description || "--",
          fully_dried: String(data.fully_dried ?? "--"),
          partially_dried: String(data.partially_dried ?? "--"),
          not_dried: String(data.not_dried ?? "--"),
          detections: data.annotated_image ? [] : (data.detections || []),
          recommendation: data.recommendation || {},
        };

        return updated;

      });

    } catch (err) {
      console.error(err);
    }

  };

  const applyRecommendation = async () => {

    try {

      await fetch("http://localhost:8000/api/apply-recommendation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session?.id,
          recommendation: batches[0]?.recommendation,
        }),
      });

    } catch (err) {
      console.log(err);
    }

  };

  return (

    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }}>

      <Text style={styles.pageTitle}>OVERVIEW</Text>

      {/* BATCH EVALUATION */}

      <View style={styles.card}>

        <View style={styles.batchHeader}>

          <Text style={styles.cardTitle}>Batch Evaluation</Text>

          <TouchableOpacity style={styles.addBatchBtn} onPress={addBatch}>
            <Text style={styles.addBatchText}>+ Add Batch</Text>
          </TouchableOpacity>

        </View>

        {batches.map((batch, index) => (

          <View key={index} style={styles.batchCard}>

            <View style={styles.batchTopBar}>

              <Text style={styles.batchTitle}>
                Batch {index + 1}
              </Text>

              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => removeBatch(index)}
              >
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>

            </View>

            <TouchableOpacity
              style={styles.captureBtn}
              onPress={() => captureTray(index)}
            >
              <Text style={styles.btnText}>Capture Tray</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.uploadBtn}
              onPress={() => uploadImage(index)}
            >
              <Text style={styles.btnText}>Upload Image</Text>
            </TouchableOpacity>

            {/* IMAGE */}

            <View style={styles.imageBox}>

              {batch.image ? (

                <View style={{ width: "100%", height: "100%" }}>

                  <Image
                    source={{ uri: batch.image }}
                    style={styles.previewImage}
                    resizeMode="cover"
                  />

                  <DetectionImage
                    uri={batch.image}
                    detections={batch.detections || []}
                  />

                </View>

              ) : (

                <Text style={styles.imageText}>Image</Text>

              )}

            </View>

            {/* STATUS */}

            <View style={styles.statusHeader}>
              <Text style={styles.statusHeaderText}>Status</Text>
            </View>

            <View style={styles.statusContent}>

              <View style={styles.statusColumn}>
                <StatusRow label="Appearance" value={batch.appearance} />
                <StatusRow label="Color" value={batch.color} />
                <StatusRow label="Texture" value={batch.texture} />
                <StatusRow label="Description" value={batch.description} />
              </View>

              <View style={styles.statusColumn}>
                <StatusRow label="Fully Dried" value={batch.fully_dried} />
                <StatusRow label="Partially Dried" value={batch.partially_dried} />
                <StatusRow label="Not Dried" value={batch.not_dried} />
              </View>

            </View>

          </View>

        ))}

      </View>

      {/* RECOMMENDATIONS */}

      <View style={styles.card}>

        <Text style={styles.cardTitle}>Recommendations</Text>

        <Text style={styles.recommendationText}>
          {batches[0]?.recommendation?.description ?? "No recommendation yet"}
        </Text>

        <TouchableOpacity
          style={styles.applyBtn}
          onPress={applyRecommendation}
        >
          <Text style={styles.applyText}>
            Apply Recommendations
          </Text>
        </TouchableOpacity>

      </View>

    </ScrollView>

  );

}

/* COMPONENTS */

function StatusRow({ label, value }: any) {

  return (

    <View style={styles.statusRow}>

      <Text style={styles.statusLabel}>
        {label}:
      </Text>

      <Text style={styles.statusValue}>
        {value}
      </Text>

    </View>

  );

}

function DetectionImage({ uri, detections }: any) {

  const [imgSize, setImgSize] = useState({ w: 1, h: 1 });
  const [displaySize, setDisplaySize] = useState({ w: 1, h: 1 });

  const onImageLoad = (e: any) => {

    const s = e.nativeEvent.source || {};

    if (s.width && s.height) {
      setImgSize({
        w: s.width,
        h: s.height,
      });
    }

  };

  return (

    <View
      style={{ width: "100%", height: "100%", position: "absolute" }}
      onLayout={(e) => {

        const layout = e.nativeEvent.layout;

        setDisplaySize({
          w: layout.width,
          h: layout.height,
        });

      }}
    >

      <Image
        source={{ uri }}
        style={styles.previewImage}
        resizeMode="cover"
        onLoad={onImageLoad}
      />

      {detections.map((d: any, i: number) => {

        const box = d.box || [0, 0, 0, 0];

        const scaleX = displaySize.w / imgSize.w;
        const scaleY = displaySize.h / imgSize.h;

        const left = box[0] * scaleX;
        const top = box[1] * scaleY;
        const width = (box[2] - box[0]) * scaleX;
        const height = (box[3] - box[1]) * scaleY;

        return (

          <View
            key={i}
            style={{
              position: "absolute",
              left,
              top,
              width,
              height,
              borderWidth: 2,
              borderColor: "green",
            }}
          />

        );

      })}

    </View>

  );

}

/* STYLES */

const styles = StyleSheet.create({

  container: {
    flex: 1,
    padding: 15,
    backgroundColor: "#f2f4f7",
  },

  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 15,
    color: "#1f3c5c",
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    elevation: 3,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
    color: "#1f3c5c",
  },

  batchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  addBatchBtn: {
    backgroundColor: "#0d3b66",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },

  addBatchText: {
    color: "#fff",
    fontWeight: "600",
  },

  batchCard: {
    borderWidth: 1,
    borderColor: "#dcdcdc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },

  batchTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  batchTitle: {
    fontWeight: "600",
    fontSize: 16,
  },

  removeBtn: {
    backgroundColor: "#e74c3c",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },

  removeText: {
    color: "#fff",
  },

  captureBtn: {
    backgroundColor: "#123d5a",
    padding: 10,
    borderRadius: 6,
    alignItems: "center",
    marginBottom: 8,
  },

  uploadBtn: {
    backgroundColor: "#2f4f65",
    padding: 10,
    borderRadius: 6,
    alignItems: "center",
    marginBottom: 10,
  },

  btnText: {
    color: "#fff",
    fontWeight: "600",
  },

  imageBox: {
    height: 150,
    backgroundColor: "#d9d9d9",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    marginBottom: 10,
  },

  previewImage: {
    width: "100%",
    height: "100%",
  },

  imageText: {
    color: "#555",
  },

  statusHeader: {
    backgroundColor: "#e7d5a2",
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 4,
  },

  statusHeaderText: {
    fontWeight: "600",
  },

  statusContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },

  statusColumn: {
    width: "48%",
  },

  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  statusLabel: {
    fontSize: 12,
  },

  statusValue: {
    fontSize: 12,
    fontWeight: "600",
  },

  recommendationText: {
    textAlign: "center",
    marginVertical: 20,
    color: "#555",
  },

  applyBtn: {
    backgroundColor: "#0d3b66",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },

  applyText: {
    color: "#fff",
    fontWeight: "700",
  },

});