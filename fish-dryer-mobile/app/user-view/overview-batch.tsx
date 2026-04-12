// overview-batch.tsx


import React, { useState, useEffect, useRef } from "react";
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions
} from "react-native";
import OverviewParameters from "./overview-parameters";

const BATCH_PAGE_WIDTH = Dimensions.get("window").width - 60;
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useLocalSearchParams} from "expo-router";

/* TYPES */

type Batch = {
  image: string | null;

  fish_species: string;
  fish_counts: string;
  duration: string;

  appearance: string;
  color: string;
  texture: string;

  fully_dried: string;
  partially_dried: string;
  not_dried: string;

  detections: any[];

  recommendation: {
    description?: string;
    [key: string]: any;
  };
};

export default function OverviewBatch({ session }: any) {

  const router = useRouter();
  const params = useLocalSearchParams();

  const [machineStatus, setMachineStatus] = useState("Stopped");
  const [machineName, setMachineName] = useState("");

  const [startTime, setStartTime] = useState<number | null>(null);
  const [duration, setDuration] = useState("00:00:00");

  const [temperature, setTemperature] = useState("");
  const [fanSpeed, setFanSpeed] = useState("");
  const [durationInput, setDurationInput] = useState("");


  useEffect(() => {

    const loadStartTime = async () => {

      const stored = await AsyncStorage.getItem("dryer_start_time");

      if (stored) {
        setStartTime(Number(stored));
        setMachineStatus("Drying");
      }

    };

    loadStartTime();

  }, []);


  useEffect(() => {

    if (!startTime) return;

    const timer = setInterval(() => {

      const diff = Date.now() - startTime;

      const totalSeconds = Math.floor(diff / 1000);

      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const formatted =
        String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(seconds).padStart(2, "0");

      setDuration(formatted);

    }, 1000);

    return () => clearInterval(timer);

  }, [startTime]);

  function getCurrentDuration() {

    if (!startTime) return "00:00:00";

    const diff = Date.now() - startTime;

    const totalSeconds = Math.floor(diff / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return (
      String(hours).padStart(2,"0") + ":" +
      String(minutes).padStart(2,"0") + ":" +
      String(seconds).padStart(2,"0")
    );

  }

  function createEmptyBatch(): Batch {
    return {
      image: null,
      fish_species: "--",
      fish_counts: "--",
      duration: "--",
      appearance: "--",
      color: "--",
      texture: "--",
      fully_dried: "--",
      partially_dried: "--",
      not_dried: "--",
      detections: [],
      recommendation: {}
    };
  }

  const [batches, setBatches] = useState<Batch[]>([createEmptyBatch()]);
  const batchCarouselRef = useRef<ScrollView>(null);
  const prevBatchCount = useRef(1);

  /* MACHINE CONTROLS */

  const startMachine = async () => {

    const now = Date.now();

    setMachineStatus("Drying");
    setStartTime(now);

    await AsyncStorage.setItem("dryer_start_time", now.toString());

  };

  const pauseMachine = () => {
    setMachineStatus("Paused");
  };

  const stopMachine = async () => {

    setMachineStatus("Stopped");
    setStartTime(null);
    setDuration("00:00:00");

    await AsyncStorage.removeItem("dryer_start_time");

  };


  /* RECEIVE IMAGE */

  useEffect(() => {

    const imageParam = params.image;
    const batchIndexParam = params.batchIndex;

    if (!imageParam || batchIndexParam === undefined) return;

    const index = Number(batchIndexParam);

    const img = Array.isArray(imageParam)
      ? imageParam[0]
      : imageParam;

    if (!img) return;

    setBatches(prev => {
      const updated = [...prev];
      if (!updated[index]) return prev;

      updated[index] = {
        ...updated[index],
        image: img
      };

      return updated;
    });

    analyzeBatch(index, img);

  }, [params.image]);

  const addBatch = () => {
    setBatches(prev => [...prev, createEmptyBatch()]);
  };

  useEffect(() => {
    if (batches.length > prevBatchCount.current) {
      const lastIndex = batches.length - 1;
      requestAnimationFrame(() => {
        batchCarouselRef.current?.scrollTo({
          x: lastIndex * BATCH_PAGE_WIDTH,
          animated: true
        });
      });
    }
    prevBatchCount.current = batches.length;
  }, [batches.length]);

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
        batchIndex: index
      }
    });

  };

  const uploadImage = (index: number) => {

    router.push({
      pathname: "/user-view/camera-view",
      params: {
        mode: "upload",
        batchIndex: index
      }
    });

  };

  async function uriToDataUrl(uri: string) {

    try {

      const resp = await fetch(uri);
      const blob = await resp.blob();

      return await new Promise<string>((res, rej) => {

        const reader = new FileReader();

        reader.onloadend = () => res(reader.result as string);
        reader.onerror = rej;

        reader.readAsDataURL(blob);

      });

    } catch {
      return null;
    }

  }

  const analyzeBatch = async (index: number, imageUri: string) => {

    const imageData = await uriToDataUrl(imageUri);
    if (!imageData) return;

    const capturedDuration = getCurrentDuration();

    try {

      const res = await fetch("http://10.208.224.15:8000/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageData,
          drying_time_minutes: startTime
            ? Math.floor((Date.now() - startTime) / 60000)
            : 0
        })
      });

      const data = await res.json();

      setBatches(prev => {

        const updated = [...prev];

        updated[index] = {
          ...updated[index],
          image: data.annotated_image
            ? `data:image/jpeg;base64,${data.annotated_image}`
            : updated[index].image,
          fish_species: data.fish_species || "--",
          fish_counts: data.fish_counts || "--",
          duration: capturedDuration,
          appearance: data.appearance_display || "--",
          color: data.color_display || "--",
          texture: data.texture_display || "--",
          fully_dried: String(data.fully_dried ?? "--"),
          partially_dried: String(data.partially_dried ?? "--"),
          not_dried: String(data.not_dried ?? "--"),
          detections: data.annotated_image ? [] : (data.detections || []),
          recommendation: data.recommendation || {}
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session?.id,
          recommendation: batches[0]?.recommendation
        })
      });

    } catch (err) {
      console.log(err);
    }

  };

  return (

    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 10 }} // 👈 ADD THIS
      showsVerticalScrollIndicator={false}
    >

      <Text style={styles.pageTitle}>OVERVIEW</Text>

      <View style={styles.machineHeader}>

        <View style={styles.statusRowHeader}>

          <Text style={styles.machineStatus}>
            Machine Status: <Text style={styles.greenDot}>●</Text> {machineStatus}
          </Text>

          <Text style={styles.timerText}>
            {duration}
          </Text>

        </View>

        <TouchableOpacity style={styles.machineDropdown}>
          <Text>{machineName || "Select Machine"} ▼</Text>
        </TouchableOpacity>


      </View>

      <OverviewParameters
          temperature={temperature}
          setTemperature={setTemperature}
          fanSpeed={fanSpeed}
          setFanSpeed={setFanSpeed}
          duration={durationInput}
          setDuration={setDurationInput}
          startMachine={startMachine}
          pauseMachine={pauseMachine}
          stopMachine={stopMachine}
        />

      <View style={styles.card}>

        <View style={styles.batchHeader}>

          <Text style={styles.cardTitle}>Batch Evaluation</Text>

          <TouchableOpacity style={styles.addBatchBtn} onPress={addBatch}>
            <Text style={styles.addBatchText}>+ Add Batch</Text>
          </TouchableOpacity>

        </View>

        <ScrollView
          ref={batchCarouselRef}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={styles.batchCarousel}
          keyboardShouldPersistTaps="handled"
        >
          {batches.map((batch, index) => {
            const dynamicHeight = 320;

            return (
              <View key={index} style={{ width: BATCH_PAGE_WIDTH }}>
                <View style={styles.batchCard}>
                  <View style={styles.batchTopBar}>
                    <Text style={styles.batchTitle}>Batch {index + 1}</Text>

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

                  <View style={[styles.imageBox, { height: dynamicHeight }]}>
                    {batch.image ? (
                      <Image
                        source={{ uri: batch.image }}
                        style={styles.previewImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={styles.imageText}>Image</Text>
                    )}
                  </View>

                  <View style={styles.statusHeader}>
                    <Text style={styles.statusHeaderText}>Status</Text>
                  </View>

                  <View style={styles.statusContent}>
                    <StatusRow label="Fish Species" value={batch.fish_species} />
                    <StatusRow label="No. of Fishes" value={batch.fish_counts} />
                    <StatusRow label="Duration" value={batch.duration} />
                    <StatusRow label="Color" value={batch.color} />
                    <StatusRow label="Appearance" value={batch.appearance} />
                    <StatusRow label="Texture" value={batch.texture} />
                    <StatusRow label="Fully Dried" value={batch.fully_dried} />
                    <StatusRow
                      label="Partially Dried"
                      value={batch.partially_dried}
                    />
                    <StatusRow label="Not Dried" value={batch.not_dried} />
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

      </View>

      <View style={styles.card}>

        <Text style={styles.cardTitle}>Recommendations</Text>

        <Text style={styles.recommendationText}>
          {batches[0]?.recommendation?.description || "No recommendation yet"}
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

function StatusRow({ label, value }: any) {
  return (
    <View style={styles.statusRowClean}>

      <Text style={styles.statusLabelClean}>
        {label}
      </Text>

      <Text style={styles.statusValueClean}>
        {value}
      </Text>

    </View>
  );
}

const styles = StyleSheet.create({


  pageTitle:{
    fontSize:20,
    fontWeight:"700",
    marginBottom:15,
    alignContent:"center",
    color:"#1f3c5c"
  },

  machineHeader:{
    marginBottom:20
  },

  machineStatus:{
    fontWeight:"600"
  },

  greenDot:{
    color:"green"
  },

  machineDropdown:{
    backgroundColor:"#fff",
    padding:10,
    borderRadius:8,
    borderWidth:1,
    borderColor:"#ddd",
    marginBottom:20
  },

  statusRowHeader:{
    flexDirection:"row",
    justifyContent:"space-between",
    alignItems:"center",
    width:"100%",
    marginBottom:10
  },

  timerText:{
    fontSize:15,
    fontWeight:"700",
    color:"#1f3c5c"
  },

  timerRow:{
    width:"100%",
    alignItems:"flex-end",
    marginBottom:10
  },

  machineButtonsRow:{
    flexDirection:"row",
    justifyContent:"space-between",
    alignItems:"center",
    gap:10
  },

  startBtn:{
    flex:1,
    backgroundColor:"#2ecc71",
    paddingVertical:10,
    borderRadius:6,
    alignItems:"center"
  },

  pauseBtn:{
    flex:1,
    backgroundColor:"#ffc400",
    flexDirection:"row",
    justifyContent:"center",
    alignItems:"center",
    paddingVertical:10,
    borderRadius:6
  },

  pauseIcon:{
    color:"#fff",
    fontWeight:"700"
  },

  pauseLabel:{
    color:"#fff",
    fontWeight:"600"
  },

  stopBtn:{
    flex:1,
    backgroundColor:"#e74c3c",
    paddingVertical:10,
    borderRadius:6,
    alignItems:"center"
  },

  controlText:{
    color:"#fff",
    fontWeight:"600"
  },

  card:{
    backgroundColor:"#fff",
    borderRadius:12,
    padding:15,
    marginTop:15,
    marginBottom:20,
    elevation:3
  },

  cardTitle:{
    fontSize:16,
    fontWeight:"700",
    marginBottom:10,
    color:"#1f3c5c"
  },

  batchHeader:{
    flexDirection:"row",
    justifyContent:"space-between",
    marginBottom:15,
    marginTop:15
  },

  addBatchBtn:{
    backgroundColor:"#0d3b66",
    paddingHorizontal:12,
    paddingVertical:6,
    borderRadius:6
  },

  addBatchText:{
    color:"#fff",
    fontWeight:"600"
  },

  batchCarousel:{
    width:BATCH_PAGE_WIDTH,
    alignSelf:"center"
  },

  batchCard:{
    borderWidth:1,
    borderColor:"#dcdcdc",
    borderRadius:8,
    padding:12
  },

  batchTopBar:{
    flexDirection:"row",
    justifyContent:"space-between",
    marginBottom:15,
    marginTop:15
  },

  batchTitle:{
    fontWeight:"600",
    fontSize:16
  },

  removeBtn:{
    backgroundColor:"#e74c3c",
    paddingHorizontal:10,
    paddingVertical:5,
    borderRadius:5
  },

  removeText:{
    color:"#fff"
  },

  captureBtn:{
    backgroundColor:"#123d5a",
    padding:10,
    borderRadius:6,
    alignItems:"center",
    marginBottom:10
  },

  uploadBtn:{
    backgroundColor:"#2f4f65",
    padding:10,
    borderRadius:6,
    alignItems:"center",
    marginBottom:10
  },

  btnText:{
    color:"#fff",
    fontWeight:"600"
  },

  imageBox:{
    width:"100%",
    backgroundColor:"#d9d9d9",
    borderRadius:6,
    overflow:"hidden",
    marginBottom:10,
    justifyContent:"center",
    alignItems:"center"
  },

  previewImage:{
    width:"100%",
    height:"100%"
  },

  imageText:{
    color:"#555",
    fontWeight:"600"
  },

  statusHeader:{
    backgroundColor:"#e7d5a2",
    paddingVertical:8,
    alignItems:"center",
    borderRadius:4
  },

  statusHeaderText:{
    fontWeight:"600"
  },

  statusContent:{
    marginTop:12,
    gap:12
  },

  statusRowClean:{
    backgroundColor:"#ffffff",
    borderRadius:10,
    paddingVertical:12,
    paddingHorizontal:14,
    borderWidth:1,
    borderColor:"#e5e7eb"
  },

  statusLabelClean:{
    fontSize:12,
    color:"#6b7280",
    fontWeight:"600",
    marginBottom:4,
    textTransform:"uppercase",
    letterSpacing:0.5
  },

  statusValueClean:{
    fontSize:12,
    color:"#073A61",
    fontWeight:"500",
    lineHeight:18
  },

  /* COLOR BADGES */

  greenBadge:{
    backgroundColor:"#d1fae5"
  },

  yellowBadge:{
    backgroundColor:"#fef3c7"
  },

  redBadge:{
    backgroundColor:"#fee2e2"
  },

  defaultBadge:{
    backgroundColor:"#e5e7eb"
  },

  recommendationText:{
    textAlign:"center",
    marginVertical:20,
    color:"#555"
  },

  applyBtn:{
    backgroundColor:"#0d3b66",
    padding:12,
    borderRadius:8,
    alignItems:"center"
  },

  applyText:{
    color:"#fff",
    fontWeight:"700"
  }

});