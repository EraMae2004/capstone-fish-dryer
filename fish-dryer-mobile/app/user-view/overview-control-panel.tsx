import React, { useState, useCallback } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";

export default function OverviewControlPanel({ session }: any) {

  const router = useRouter();
  const params = useLocalSearchParams();

  function createEmptyBatch() {
    return {
      frontImage: null as string | null,
      backImage: null as string | null,
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

  // control inputs state so recommendations can autofill
  const [controls, setControls] = useState({
    fish_type: session?.fish_type || "",
    quantity: session?.quantity || "",
    target_moisture: session?.target_moisture || "",
    target_humidity: session?.target_humidity || "",
    target_temperature: session?.target_temperature || "",
    fan_speed: session?.fan_speed || "",
    planned_duration_minutes: session?.planned_duration_minutes || "",
  });

  /* RECEIVE IMAGES FROM CAMERA VIEW */

  useFocusEffect(
    useCallback(() => {

      if (
        params.frontImage &&
        params.backImage &&
        params.batchIndex !== undefined
      ) {

        const index = Number(params.batchIndex);

        const front =
          Array.isArray(params.frontImage)
            ? params.frontImage[0]
            : params.frontImage;

        const back =
          Array.isArray(params.backImage)
            ? params.backImage[0]
            : params.backImage;

        setBatches((prev) => {

          const updated = [...prev];

          if (!updated[index]) return prev;

          updated[index] = {
            ...updated[index],
            frontImage: front,
            backImage: back,
          };

          // trigger analysis for the updated batch
          setTimeout(() => {
            // ensure image URIs are set before calling
            if (updated[index]?.frontImage && updated[index]?.backImage) {
              // call analyzeBatch for this index
              // (fire-and-forget)
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

  // convert image URI to data URL
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

  // analyze batch by calling ai-server
  const analyzeBatch = async (index: number) => {
    const batch = batches[index];
    if (!batch.frontImage || !batch.backImage) return;

    const frontData = await uriToDataUrl(batch.frontImage);
    const backData = await uriToDataUrl(batch.backImage);

    try {
      const res = await fetch("http://localhost:5000/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: frontData, back: backData }),
      });
      const data = await res.json();

      // attach analysis results to batch
      setBatches(prev => {
        const upd = [...prev];
        upd[index] = {
          ...upd[index],
          appearance: `ColorIdx:${data.color_index.toFixed(1)}`,
          color: String(data.color_index),
          texture: String(data.texture_index),
          description: `Total:${data.total_fish} unknown:${data.unknown_objects}`,
          fully_dried: String(data.fully_dried),
          partially_dried: String(data.partially_dried),
          not_dried: String(data.not_dried),
          detections: data.detections || [],
          recommendation: data.recommendation || {},
        };
        return upd;
      });

      // autofill controls preview with recommendation (not applied yet)
      const rec = data.recommendation || {};
      setControls(c => ({ ...c, target_temperature: rec.temperature || c.target_temperature, fan_speed: rec.fan_speed || c.fan_speed }));

    } catch (err) {
      console.error(err);
    }
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 120 }}
    >

      <Text style={styles.pageTitle}>OVERVIEW</Text>

      {/* CONTROL PANEL */}

      <View style={styles.card}>

        <Text style={styles.cardTitle}>Control Panel</Text>

        <FormInput label="Fish Species" value={controls.fish_type} onChangeText={(v: string)=> setControls(c=>({...c, fish_type: v}))} />
        <FormInput label="No. of Fish" value={String(controls.quantity)} onChangeText={(v: string)=> setControls(c=>({...c, quantity: v}))} />
        <FormInput label="Target Moisture (%)" value={String(controls.target_moisture)} onChangeText={(v: string)=> setControls(c=>({...c, target_moisture: v}))} />
        <FormInput label="Set Humidity (%)" value={String(controls.target_humidity)} onChangeText={(v: string)=> setControls(c=>({...c, target_humidity: v}))} />
        <FormInput label="Set Temperature (°C)" value={String(controls.target_temperature)} onChangeText={(v: string)=> setControls(c=>({...c, target_temperature: v}))} />
        <FormInput label="Fan Speed" value={String(controls.fan_speed)} onChangeText={(v: string)=> setControls(c=>({...c, fan_speed: v}))} />
        {/* Duration as HH:MM:SS */}
        <TimeInput label="Duration (hh:mm:ss)" minutesValue={Number(controls.planned_duration_minutes) || 0} onChangeMinutes={(mins: number) => setControls(c=>({...c, planned_duration_minutes: String(mins)}))} />

        

        <View style={styles.buttonRow}>
          <ControlButton label="Start" color="#2ecc71" />
          <ControlButton label="Pause" color="#f1c40f" textColor="#000" />
          <ControlButton label="Stop" color="#e74c3c" />
        </View>

      </View>

      {/* BATCH EVALUATION */}

      <View style={styles.card}>

        <View style={styles.batchHeader}>
          <Text style={styles.cardTitle}>Batch Evaluation</Text>

          <TouchableOpacity style={styles.addBatchBtn} onPress={addBatch}>
            <Text style={styles.addBatchText}>+ Add Batch</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.batchScrollWrapper}>

          <ScrollView
            showsVerticalScrollIndicator
            nestedScrollEnabled
            contentContainerStyle={{ paddingBottom: 20 }}
          >

            {batches.map((batch, index) => (

              <View key={index} style={styles.batchCard}>

                {/* TOP BAR */}

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

                {/* BUTTONS */}

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

                {/* FRONT IMAGE */}

                <View style={styles.imageBox}>
                  {batch.frontImage ? (
                    <View style={{ width: '100%', height: '100%' }}>
                      <Image
                        source={{ uri: batch.frontImage }}
                        style={styles.previewImage}
                        resizeMode="cover"
                      />
                      <DetectionImage uri={batch.frontImage} detections={batch.detections || []} />
                    </View>
                  ) : (
                    <Text style={styles.imageText}>Front Image</Text>
                  )}
                </View>

                        {/* BACK IMAGE */}

                        <View style={styles.imageBox}>
                          {batch.backImage ? (
                            <Image
                              source={{ uri: batch.backImage }}
                              style={styles.previewImage}
                            />
                          ) : (
                            <Text style={styles.imageText}>Back Image</Text>
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

          </ScrollView>

        </View>

      </View>

      {/* RECOMMENDATION CARD (outside batch evaluation) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recommendations</Text>

        <View style={{ paddingVertical: 6 }}>
          <Text style={{ marginBottom: 6 }}><Text style={{ fontWeight: '700' }}>Extend Drying Time:</Text> {batches[0]?.recommendation?.extend_minutes ?? '--'}</Text>
          <Text style={{ marginBottom: 6 }}><Text style={{ fontWeight: '700' }}>Suggested Temperature:</Text> {batches[0]?.recommendation?.temperature ?? '--'} °C</Text>
          <Text style={{ marginBottom: 6 }}><Text style={{ fontWeight: '700' }}>Suggested Fan Level:</Text> {batches[0]?.recommendation?.fan_speed ?? '--'}</Text>

          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <TouchableOpacity style={styles.applyBtn} onPress={() => {
              const rec = batches[0]?.recommendation || {};
              setControls(c => ({
                ...c,
                planned_duration_minutes: rec.extend_minutes ?? c.planned_duration_minutes,
                target_temperature: rec.temperature ?? c.target_temperature,
                fan_speed: rec.fan_speed ?? c.fan_speed,
              }));
            }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Apply Recommendation</Text>
            </TouchableOpacity>

            
          </View>

        </View>

      </View>

    </ScrollView>
  );
}

/* COMPONENTS */

function FormInput({ label, value, onChangeText }: any) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value ? String(value) : ""}
        onChangeText={onChangeText}
        style={styles.input}
      />
    </View>
  );
}

function pad(n: number) { return n.toString().padStart(2, '0'); }

function TimeInput({ label, minutesValue, onChangeMinutes }: any) {
  // Convert minutes (integer) -> HH:MM:SS
  const toHHMMSS = (m: number) => {
    const mins = Math.max(0, Math.floor(Number(m) || 0));
    const totalSec = mins * 60;
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  };

  // Parse HH:MM:SS string -> minutes (rounded)
  const fromHHMMSS = (str: string) => {
    const parts = (str || '00:00:00').split(':').map(p => Number(p || 0));
    if (parts.length === 3) {
      const hrs = Math.max(0, Math.floor(parts[0] || 0));
      const mins = Math.max(0, Math.floor(parts[1] || 0));
      const secs = Math.max(0, Math.floor(parts[2] || 0));
      const totalMinutes = hrs * 60 + mins + Math.round(secs / 60);
      return totalMinutes;
    }
    return 0;
  };

  const [text, setText] = useState(toHHMMSS(minutesValue));

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          // try to parse hh:mm:ss into minutes
          const minutes = fromHHMMSS(v);
          onChangeMinutes(minutes);
        }}
        style={styles.input}
      />
    </View>
  );
}

function ControlButton({ label, color, textColor = "#fff" }: any) {
  return (
    <TouchableOpacity style={[styles.controlBtn, { backgroundColor: color }]}>
      <Text style={{ color: textColor, fontWeight: "600" }}>{label}</Text>
    </TouchableOpacity>
  );
}

function StatusRow({ label, value }: any) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}:</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

function DetectionImage({ uri, detections }: any) {
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 });
  const [displaySize, setDisplaySize] = useState({ w: 1, h: 1 });

  const onImageLoad = (e: any) => {
    const s = e.nativeEvent.source || {};
    if (s.width && s.height) setImgSize({ w: s.width, h: s.height });
  };

  return (
    <View style={{ width: '100%', height: '100%', position: 'relative' }} onLayout={(e) => {
      const layout = e.nativeEvent.layout;
      setDisplaySize({ w: layout.width, h: layout.height });
    }}>
      <Image source={{ uri }} style={styles.previewImage} resizeMode="cover" onLoad={onImageLoad} />

      {/* overlay boxes */}
      {detections && detections.map((d: any, i: number) => {
        const box = d.box || [0,0,0,0];
        const imgW = imgSize.w || 1;
        const imgH = imgSize.h || 1;
        const scaleX = displaySize.w / imgW || 1;
        const scaleY = displaySize.h / imgH || 1;
        const left = box[0] * scaleX;
        const top = box[1] * scaleY;
        const width = Math.max(2, (box[2] - box[0]) * scaleX);
        const height = Math.max(2, (box[3] - box[1]) * scaleY);

        const borderColor = d.type === 'unknown' ? 'purple' : (d.dryness_class === 0 ? 'green' : (d.dryness_class === 1 ? 'yellow' : 'red'));

        return (
          <View key={i} style={{ position: 'absolute', left, top, width, height, borderWidth: 2, borderColor, borderRadius: 4 }}>
            <View style={{ backgroundColor: '#00000066', paddingHorizontal: 4 }}>
              <Text style={{ color: '#fff', fontSize: 11 }}>{d.type === 'unknown' ? 'Unknown' : (d.species || 'Fish')}</Text>
            </View>
          </View>
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

  inputLabel: {
    fontSize: 12,
    marginBottom: 5,
    color: "#444",
  },

  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 8,
  },

  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
  },

  controlBtn: {
    width: 90,
    padding: 10,
    borderRadius: 6,
    alignItems: "center",
  },

  applyBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#0d3b66',
    alignItems: 'center',
  },

  batchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 13,
    marginBottom: 22,
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
    fontSize: 13,
  },

  batchScrollWrapper: {
    height: 660,
    overflow: "hidden",
  },

  batchCard: {
    borderWidth: 1,
    borderColor: "#dcdcdc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    backgroundColor: "#fafafa",
  },

  batchTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
  },

  batchTitle: {
    fontWeight: "600",
    fontSize: 18,
  },

  removeBtn: {
    backgroundColor: "#e74c3c",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },

  removeText: {
    color: "#fff",
    fontSize: 12,
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
    borderRadius: 4,
    alignItems: "center",
    marginTop: 5,
  },

  statusHeaderText: {
    fontWeight: "600",
    color: "#333",
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
    color: "#444",
  },

  statusValue: {
    fontSize: 12,
    fontWeight: "600",
  },

});