import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from "react-native";
import { Camera, useCameraDevice, useCodeScanner } from "react-native-vision-camera";
import { useScanStore } from "../../hooks/useScanStore";
import { theme } from "../../constants/theme";
import { MaterialIcons } from "@expo/vector-icons";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

interface BarcodeBox {
  id: string;
  data: string;
  color: string;
  frame: { x: number; y: number; width: number; height: number };
  timestamp: number;
}

interface DetectionTrack {
  code: string;
  frame: { x: number; y: number; width: number; height: number };
  hitCount: number;
  lastSeen: number;
}

// Calculate Intersection over Union for two rectangles
const calculateIoU = (
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): number => {
  const x1 = Math.max(rect1.x, rect2.x);
  const y1 = Math.max(rect1.y, rect2.y);
  const x2 = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
  const y2 = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);

  if (x2 < x1 || y2 < y1) return 0;

  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = rect1.width * rect1.height;
  const area2 = rect2.width * rect2.height;
  const union = area1 + area2 - intersection;

  return intersection / union;
};

export default function ScannerScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [barcodeBoxes, setBarcodeBoxes] = useState<BarcodeBox[]>([]);
  const [scannedCodes, setScannedCodes] = useState<Set<string>>(new Set());
  const [permanentMarkers, setPermanentMarkers] = useState<Map<string, BarcodeBox>>(new Map());
  const [detectionTracks, setDetectionTracks] = useState<DetectionTrack[]>([]);
  const [torchOn, setTorchOn] = useState(false);

  const VF_WIDTH_RATIO = 0.75;
  const VF_HEIGHT_RATIO = 0.55;
  const CONFIRMATION_THRESHOLD = 3; // Require 3 detections before confirming
  const IOU_THRESHOLD = 0.4; // Minimum IoU to match tracks
  const MIN_BOX_AREA_RATIO = 0.02; // Minimum 2% of screen area
  const MIN_ASPECT_RATIO = 0.7; // Minimum width/height ratio
  const MAX_ASPECT_RATIO = 1.4; // Maximum width/height ratio
  const TRACK_TIMEOUT = 2000; // Remove tracks not seen for 2 seconds
  
  const { products, addScan, loadData, clearAll } = useScanStore();
  const device = useCameraDevice("back");

  // Select camera format: 720p @ 30fps for balance of quality and performance
  const format = device?.formats.find(
    (f) => 
      f.videoWidth === 1280 && 
      f.videoHeight === 720 && 
      f.maxFps >= 30
  ) || device?.formats[0];

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === "granted");
      await loadData();
    })();
  }, []);

  const vfW = SCREEN_W * VF_WIDTH_RATIO;
  const vfH = SCREEN_H * VF_HEIGHT_RATIO;
  const vfL = (SCREEN_W - vfW) / 2;
  const vfT = (SCREEN_H - vfH) / 2;

  const viewfinderRect = { left: vfL, top: vfT, width: vfW, height: vfH };

  const pointInRect = (x: number, y: number, rect: { left: number; top: number; width: number; height: number }) =>
    x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;

  // Clean up old tracks periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setDetectionTracks((prev) => 
        prev.filter((track) => now - track.lastSeen < TRACK_TIMEOUT)
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ["qr"],
    onCodeScanned: useCallback((codes) => {
      if (codes.length === 0) return;
      
      const now = Date.now();
      const screenArea = SCREEN_W * SCREEN_H;
      const newTracks: DetectionTrack[] = [...detectionTracks];

      for (const code of codes) {
        const data = code.value;
        if (!data || !code.frame) continue;

        const frame = code.frame;
        
        // Quality filter 1: Check if center is in viewfinder
        const centerX = frame.x + frame.width / 2;
        const centerY = frame.y + frame.height / 2;
        if (!pointInRect(centerX, centerY, viewfinderRect)) continue;

        // Quality filter 2: Minimum size (2% of screen)
        const boxArea = frame.width * frame.height;
        if (boxArea / screenArea < MIN_BOX_AREA_RATIO) continue;

        // Quality filter 3: Aspect ratio (squareness check)
        const aspectRatio = frame.width / frame.height;
        if (aspectRatio < MIN_ASPECT_RATIO || aspectRatio > MAX_ASPECT_RATIO) continue;

        // Already confirmed and scanned?
        if (scannedCodes.has(data)) continue;

        // Try to match with existing track
        let matchedTrack: DetectionTrack | undefined;
        let matchedIndex = -1;
        
        for (let i = 0; i < newTracks.length; i++) {
          const track = newTracks[i];
          if (track.code === data) {
            const iou = calculateIoU(track.frame, frame);
            if (iou >= IOU_THRESHOLD) {
              matchedTrack = track;
              matchedIndex = i;
              break;
            }
          }
        }

        if (matchedTrack) {
          // Update existing track
          matchedTrack.hitCount++;
          matchedTrack.frame = frame;
          matchedTrack.lastSeen = now;

          // Check if track is confirmed
          if (matchedTrack.hitCount >= CONFIRMATION_THRESHOLD && !scannedCodes.has(data)) {
            console.log("[QR CONFIRMED]", { data, frame, hitCount: matchedTrack.hitCount });
            
            const productId = data.split("-")[0];
            const existing = products[productId];
            if (existing?.codes.includes(data)) continue;
            
            setScannedCodes((prev) => new Set([...prev, data]));
            
            (async () => {
              let scanSuccess = false;
              try {
                await addScan(data, productId);
                scanSuccess = true;
                console.log("✅ Scan added successfully:", { data, productId });
              } catch (error) {
                console.error("❌ Scan failed:", error);
              }
              
              const id = `${data}-${Date.now()}`;
              const newBox: BarcodeBox = {
                id,
                data,
                color: scanSuccess ? theme.colors.accent : theme.colors.danger,
                frame: frame,
                timestamp: Date.now(),
              };
              
              setBarcodeBoxes((prev) => [...prev, newBox].slice(-4));
              
              // Auto-remove after delay
              setTimeout(() => {
                setBarcodeBoxes((prev) => prev.filter((x) => x.id !== id));
                if (!scanSuccess) {
                  setScannedCodes((prev) => { const newSet = new Set(prev); newSet.delete(data); return newSet; });
                }
              }, scanSuccess ? 1800 : 500);
              
              if (scanSuccess && !permanentMarkers.has(data)) {
                setPermanentMarkers((prev) => new Map(prev).set(data, { ...newBox, id: `permanent-${data}` }));
              }
            })();
          }
        } else {
          // Create new track
          newTracks.push({
            code: data,
            frame: frame,
            hitCount: 1,
            lastSeen: now,
          });
          console.log("[QR DETECTED]", { data, frame, hitCount: 1 });
        }
      }

      setDetectionTracks(newTracks);
    }, [scannedCodes, products, permanentMarkers, viewfinderRect, addScan, detectionTracks]),
  });

  if (hasPermission === null) return <Text>Requesting camera permission…</Text>;
  if (hasPermission === false) return <Text>No access to camera</Text>;
  if (!device) return <Text>No camera device found</Text>;

  return (
    <View style={styles.container}>
      <View style={styles.scannerArea}>
        <Camera 
          style={StyleSheet.absoluteFill} 
          device={device} 
          isActive={true} 
          codeScanner={codeScanner}
          format={format}
          fps={30}
          torch={torchOn ? "on" : "off"}
        />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: vfT, backgroundColor: "#FFFFFF" }} />
          <View style={{ position: "absolute", top: vfT + vfH, left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF" }} />
          <View style={{ position: "absolute", top: vfT, left: 0, width: vfL, height: vfH, backgroundColor: "#FFFFFF" }} />
          <View style={{ position: "absolute", top: vfT, left: vfL + vfW, right: 0, height: vfH, backgroundColor: "#FFFFFF" }} />
          <View style={{ position: "absolute", left: vfL, top: vfT, width: vfW, height: vfH, borderRadius: 16, borderWidth: 3, borderColor: theme.colors.accent }} />
          {barcodeBoxes.map((b) => {
            const isGreen = b.color === theme.colors.accent;
            return (
              <View key={b.id} style={{ position: "absolute", left: b.frame.x, top: b.frame.y, width: b.frame.width, height: b.frame.height, borderWidth: 3, borderColor: isGreen ? "#00FF00" : "#FF0000", borderRadius: 8, backgroundColor: isGreen ? "rgba(0, 255, 0, 0.2)" : "rgba(255, 0, 0, 0.2)" }} />
            );
          })}
          {Array.from(permanentMarkers.values()).map((marker) => (
            <View key={marker.id} style={{ position: "absolute", left: marker.frame.x, top: marker.frame.y, width: marker.frame.width, height: marker.frame.height, borderWidth: 3, borderColor: "#FFD700", borderRadius: 8, backgroundColor: "rgba(255, 215, 0, 0.15)", display: "none" }}>
              <View style={{ position: "absolute", top: -25, left: 0, backgroundColor: "rgba(255, 215, 0, 0.9)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
                <Text style={{ color: "#000", fontSize: 11, fontWeight: "bold" }}>{marker.data.split("-")[0]}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.debugInfo}>
          <Text style={styles.debugText}>Boxes: {barcodeBoxes.length} | Markers: {permanentMarkers.size}</Text>
          <Text style={styles.debugText}>Products: {Object.keys(products).length} | Tracks: {detectionTracks.length}</Text>
          <Text style={styles.debugText}>Screen: {Math.round(SCREEN_W)}x{Math.round(SCREEN_H)}</Text>
          <TouchableOpacity 
            onPress={() => setTorchOn(!torchOn)} 
            style={[styles.clearMarkersBtn, { backgroundColor: torchOn ? "#FFA500" : "#FFD700", marginBottom: 5 }]}
          >
            <Text style={styles.clearMarkersBtnText}>{torchOn ? "🔦 ON" : "🔦 OFF"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setPermanentMarkers(new Map()); setScannedCodes(new Set()); setDetectionTracks([]); }} style={styles.clearMarkersBtn}>
            <Text style={styles.clearMarkersBtnText}>Clear Markers</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.bottomPanel}>
        <Text style={styles.title}>Scanned Products</Text>
        <ScrollView style={{ flex: 1 }}>
          {Object.values(products).map((p) => (
            <View key={p.id} style={styles.card}>
              <View>
                <Text style={styles.productName}>{p.id}</Text>
                <Text style={styles.codeCount}>{p.codes.length} pcs</Text>
              </View>
            </View>
          ))}
          {Object.keys(products).length === 0 && <Text style={{ color: theme.colors.subtleText }}>No products scanned yet.</Text>}
        </ScrollView>
        <TouchableOpacity style={styles.clearButton} onPress={clearAll}>
          <MaterialIcons name="delete-outline" size={20} color="white" />
          <Text style={styles.clearButtonText}>Clear All</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scannerArea: { flex: 1, backgroundColor: "black" },
  debugInfo: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.7)", padding: 8, borderRadius: 8, zIndex: 1000 },
  debugText: { color: "white", fontSize: 12, marginBottom: 5 },
  clearMarkersBtn: { backgroundColor: "#FFD700", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, alignItems: "center" },
  clearMarkersBtnText: { color: "#000", fontSize: 11, fontWeight: "bold" },
  bottomPanel: { height: 200, backgroundColor: theme.colors.surface, padding: theme.spacing.lg, borderTopLeftRadius: theme.radius.lg * 1.5, borderTopRightRadius: theme.radius.lg * 1.5, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  title: { fontFamily: theme.fonts.bold, fontSize: 18, color: theme.colors.text, marginBottom: theme.spacing.md },
  card: { backgroundColor: theme.colors.background, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  productName: { fontFamily: theme.fonts.medium, fontSize: 16, color: theme.colors.text },
  codeCount: { color: theme.colors.subtleText, fontSize: 13 },
  clearButton: { marginTop: theme.spacing.lg, backgroundColor: theme.colors.danger, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md, paddingVertical: 10, gap: 8 },
  clearButtonText: { color: "white", fontFamily: theme.fonts.medium },
});
