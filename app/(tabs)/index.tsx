import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { Camera, useCameraDevice, useCodeScanner } from "react-native-vision-camera";
import { useScanStore } from "../../hooks/useScanStore";
import { theme } from "../../constants/theme";
import { MaterialIcons } from "@expo/vector-icons";
import {
  calculateIoU,
  pointInRect,
  isValidQRDetection,
  findMatchingTrack,
  updateTrack,
  createTrack,
  cleanupExpiredTracks,
  assignRegionsToBoxes,
  isQRConfirmed,
  type BarcodeBox,
  type DetectionTrack,
  type ViewfinderRect,
  type DetectionConfig,
} from "../../utils/qrDetectionUtils";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

export default function ScannerScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [barcodeBoxes, setBarcodeBoxes] = useState<BarcodeBox[]>([]);
  const [scannedCodes, setScannedCodes] = useState<Set<string>>(new Set());
  const [permanentMarkers, setPermanentMarkers] = useState<Map<string, BarcodeBox>>(new Map());
  const [detectionTracks, setDetectionTracks] = useState<DetectionTrack[]>([]);
  const [torchOn, setTorchOn] = useState(false);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);

  const VF_WIDTH_RATIO = 0.8;
  const VF_HEIGHT_RATIO = 0.4;

  const detectionConfig: DetectionConfig = {
    confirmationThreshold: 1,
    iouThreshold: 0.03,
    minBoxAreaRatio: 0.0001,
    minAspectRatio: 0.05,
    maxAspectRatio: 2,
    trackTimeout: 3000,
  };

  const { scannedItems, addScan, loadData, clearAll } = useScanStore();
  const device = useCameraDevice("back");

  const format =
    device?.formats.find(
      (f) => f.videoWidth === 1280 && f.videoHeight === 720 && f.maxFps >= 30
    ) || device?.formats[0];

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === "granted");
      await loadData();
    })();
  }, []);

  useEffect(() => {
    if (format) {
      const cameraAspectRatio = format.videoWidth / format.videoHeight;
      const screenAspectRatio = SCREEN_W / SCREEN_H;

      let previewWidth = SCREEN_W;
      let previewHeight = SCREEN_H;

      if (cameraAspectRatio > screenAspectRatio) {
        // Camera is wider - fit to height
        previewHeight = SCREEN_H;
        previewWidth = SCREEN_H * cameraAspectRatio;
      } else {
        // Camera is taller - fit to width
        previewWidth = SCREEN_W;
        previewHeight = SCREEN_W / cameraAspectRatio;
      }

      setPreviewSize({ width: previewWidth, height: previewHeight });
      console.log("[PREVIEW SIZE]", {
        screen: { w: SCREEN_W, h: SCREEN_H },
        camera: { w: format.videoWidth, h: format.videoHeight },
        preview: { w: previewWidth, h: previewHeight },
        cameraAR: cameraAspectRatio.toFixed(2),
        screenAR: screenAspectRatio.toFixed(2),
      });
    }
  }, [format]);

  const vfW = SCREEN_W * VF_WIDTH_RATIO;
  const vfH = SCREEN_H * VF_HEIGHT_RATIO;
  const vfL = (SCREEN_W - vfW) / 2;
  const vfT = (SCREEN_H - vfH) / 2 - 150;

  const viewfinderRect: ViewfinderRect = { left: vfL, top: vfT, width: vfW, height: vfH };
  console.log("[VIEWFINDER RECTANGLE]", viewfinderRect);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setDetectionTracks((prev) => cleanupExpiredTracks(prev, now, detectionConfig.trackTimeout));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ["qr"],
    onCodeScanned: useCallback(
      (codes) => {
        if (codes.length === 0) return;

        const now = Date.now();
        const screenArea = SCREEN_W * SCREEN_H;
        const newTracks: DetectionTrack[] = [...detectionTracks];

        for (const code of codes) {
          const data = code.value;
          if (!data || !code.frame) continue;

          const frame = code.frame;

          // Use utility function to validate QR detection
          if (!isValidQRDetection(frame, viewfinderRect, SCREEN_W, SCREEN_H, detectionConfig)) {
            continue;
          }

          if (scannedCodes.has(data)) continue;

          // Find matching track using utility function
          const matchResult = findMatchingTrack(data, frame, newTracks, detectionConfig.iouThreshold);

          if (matchResult) {
            const { track: matchedTrack, index: matchedIndex } = matchResult;
            
            // Update track using utility function
            newTracks[matchedIndex] = updateTrack(matchedTrack, frame, now);

            if (isQRConfirmed(newTracks[matchedIndex], detectionConfig.confirmationThreshold) && !scannedCodes.has(data)) {
              console.log("[QR CONFIRMED]", { data, frame, hitCount: newTracks[matchedIndex].hitCount });

              const productId = data.split("-")[0];

              setScannedCodes((prev) => new Set([...prev, data]));

              (async () => {
                let scanSuccess = false;
                try {
                  await addScan(data, productId);
                  scanSuccess = true;
                  console.log("✅ Scan added successfully:", {
                    data,
                    productId,
                  });
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

                setBarcodeBoxes((prev) => [...prev, newBox].slice());

                setTimeout(() => {
                  setBarcodeBoxes((prev) => prev.filter((x) => x.id !== id));
                  if (!scanSuccess) {
                    setScannedCodes((prev) => {
                      const newSet = new Set(prev);
                      newSet.delete(data);
                      return newSet;
                    });
                  }
                }, scanSuccess ? 1800 : 500);

                // ✅ Kalıcı marker: QR üzerinde yeşil tik + 4'er 4'er bölge mantığı
                if (scanSuccess) {
                  setPermanentMarkers((prev) => {
                    const updated = new Map(prev);
                    if (!updated.has(data)) {
                      updated.set(data, { ...newBox, id: `permanent-${data}` });
                    }

                    const withRegions = assignRegionsToBoxes(Array.from(updated.values()));
                    const remapped = new Map<string, BarcodeBox>();
                    for (const box of withRegions) {
                      remapped.set(box.data, box);
                    }
                    return remapped;
                  });
                }
              })();
            }
          } else {
            // Create new track using utility function
            newTracks.push(createTrack(data, frame, now));
            console.log("[QR DETECTED]", { data, frame, hitCount: 1 });
          }
        }

        setDetectionTracks(newTracks);
      },
      [scannedCodes, scannedItems, viewfinderRect, addScan, detectionTracks]
    ),
  });

  if (hasPermission === null) return <Text>Requesting camera permission…</Text>;
  if (hasPermission === false) return <Text>No access to camera</Text>;
  if (!device) return <Text>No camera device found</Text>;

  const totalRegions = Math.ceil(permanentMarkers.size / 4);

  return (
    <View style={styles.container}>
      <View style={styles.scannerArea}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          videoHdr={true}
          codeScanner={codeScanner}
          format={format}
          fps={30}
          videoStabilizationMode="auto"
          torch={torchOn ? "on" : "off"}
        />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* Ana çerçeve */}
          {/* <View
            style={{
              position: "absolute",
              left: vfL,
              top: vfT,
              width: vfW,
              height: vfH,
              borderRadius: 16,
              borderWidth: 3,
              borderColor: theme.colors.accent,
            }}
          /> */}

          {Array.from(permanentMarkers.values()).map((marker) => {
            const { x, y, width, height } = marker.frame;
            const size = 26; // tik ikonu boyutu
            return (
              <View
                key={marker.id}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width,
                  height,
                }}
              >
                {/* yeşil border (QR çevresi) */}
                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100%",
                    height: "100%",
                    borderWidth: 2,
                    borderColor: "#00FF00",
                    borderRadius: 8,
                    backgroundColor: "rgba(0, 255, 0, 0.1)",
                  }}
                />

                {/* yeşil tik – QR'ın ortasında */}
                <MaterialIcons
                  name="check-circle"
                  size={size}
                  color="#00FF00"
                  style={{
                    position: "absolute",
                    left: width / 2 - size / 2,
                    top: height / 2 - size / 2,
                  }}
                />

                {/* İstersen bölge etiketi de gösterebilirsin */}
                {typeof marker.regionIndex === "number" && (
                  <View
                    style={{
                      position: "absolute",
                      top: -22,
                      left: 0,
                      backgroundColor: "rgba(0,0,0,0.7)",
                      paddingHorizontal: 6,
                      paddingVertical: 3,
                      borderRadius: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: "bold",
                      }}
                    >
                      Bölge {marker.regionIndex! + 1} • #{(marker.indexInRegion ?? 0) + 1}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
        <View style={styles.debugInfo}>
          <Text style={styles.debugText}>
            Boxes: {barcodeBoxes.length} | Markers: {permanentMarkers.size}
          </Text>
          <Text style={styles.debugText}>
            Scanned Items: {scannedItems.length} | Tracks: {detectionTracks.length}
          </Text>
          <Text style={styles.debugText}>
            Screen: {Math.round(SCREEN_W)}x{Math.round(SCREEN_H)}
          </Text>
          {previewSize && (
            <Text style={styles.debugText}>
              Preview: {Math.round(previewSize.width)}x{Math.round(previewSize.height)}
            </Text>
          )}
          <Text style={styles.debugText}>Regions (4&apos;lü): {totalRegions}</Text>
          <TouchableOpacity
            onPress={() => {
              setPermanentMarkers(new Map());
              setScannedCodes(new Set());
              setDetectionTracks([]);
            }}
            style={styles.clearMarkersBtn}
          >
            <Text style={styles.clearMarkersBtnText}>Clear Markers</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.bottomPanel}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: theme.spacing.md,
          }}
        >
          <Text style={styles.title}>Scanned Products</Text>
          <TouchableOpacity
            onPress={() => setTorchOn(!torchOn)}
            style={[
              styles.torchButton,
              { backgroundColor: torchOn ? "#FFA500" : theme.colors.accent },
            ]}
          >
            <MaterialIcons name={torchOn ? "flash-on" : "flash-off"} size={20} color="white" />
            <Text style={styles.torchButtonText}>{torchOn ? "ON" : "OFF"}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }}>
          {scannedItems.length > 0 ? (
            scannedItems.map((item) => (
              <View key={item.code} style={styles.card}>
                <View>
                  <Text style={styles.productName}>{item.productId}</Text>
                  <Text style={styles.codeCount}>Code: {item.code}</Text>
                  <Text style={{ color: theme.colors.subtleText, fontSize: 10, marginTop: 4 }}>
                    Scanned: {new Date(item.timestamp).toLocaleTimeString()}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={{ color: theme.colors.subtleText, marginTop: 20 }}>
              No items scanned yet. Scan QR codes to add items.
            </Text>
          )}
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
  debugInfo: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 8,
    borderRadius: 8,
    zIndex: 1000,
  },
  debugText: { color: "white", fontSize: 12, marginBottom: 5 },
  clearMarkersBtn: {
    backgroundColor: "#FFD700",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    alignItems: "center",
  },
  clearMarkersBtnText: { color: "#000", fontSize: 11, fontWeight: "bold" },
  bottomPanel: {
    height: 280,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    borderTopLeftRadius: theme.radius.lg * 1.5,
    borderTopRightRadius: theme.radius.lg * 1.5,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontFamily: theme.fonts.bold,
    fontSize: 17,
    color: theme.colors.text,
    marginBottom: 0,
  },
  torchButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    gap: 6,
  },
  torchButtonText: { color: "white", fontFamily: theme.fonts.medium, fontSize: 14 },
  card: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  productName: { fontFamily: theme.fonts.medium, fontSize: 20, color: theme.colors.text },
  codeCount: { color: theme.colors.subtleText, fontSize: 12 },
  clearButton: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.danger,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    gap: 8,
  },
  clearButtonText: { color: "white", fontFamily: theme.fonts.medium },
});
