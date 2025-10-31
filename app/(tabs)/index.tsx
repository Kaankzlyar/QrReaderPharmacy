import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
} from "react-native";
import { CameraView, Camera } from "expo-camera";
import { useScanStore } from "../../hooks/useScanStore";
import { theme } from "../../constants/theme";
import { MaterialIcons } from "@expo/vector-icons";

type BarcodeScanningResult = {
  data: string;
  bounds?: {
    origin: { x: number; y: number };
    size: { width: number; height: number };
  };
  cornerPoints?: { x: number; y: number }[];
  type?: string;
};

interface BarcodeBox {
  id: string;
  data: string;
  color: string;
  // normalized [0..1] relative to camera area
  bounds: {
    origin: { x: number; y: number };
    size: { width: number; height: number };
  };
  opacity: Animated.Value;
}

export default function ScannerScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [barcodeBoxes, setBarcodeBoxes] = useState<BarcodeBox[]>([]);
  const [scannedCodes, setScannedCodes] = useState<Set<string>>(new Set());
  const [allDetectedCodes, setAllDetectedCodes] = useState<Set<string>>(new Set());

  // The actual size of the camera preview area
  const [camLayout, setCamLayout] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const { products, addScan, loadData, clearAll } = useScanStore();

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
      await loadData();
    })();
  }, [loadData]);

  // Normalize bounds helper
  const normalizeBounds = (
    raw:
      | undefined
      | {
          origin: { x: number; y: number };
          size: { width: number; height: number };
        }
  ): BarcodeBox["bounds"] | undefined => {
    if (!raw) return undefined;
    if (camLayout.w <= 0 || camLayout.h <= 0) return undefined;

    // If any value > 1, assume pixel space → normalize
    const looksPixel =
      raw.origin.x > 1 ||
      raw.origin.y > 1 ||
      raw.size.width > 1 ||
      raw.size.height > 1;

    if (looksPixel) {
      return {
        origin: { x: raw.origin.x / camLayout.w, y: raw.origin.y / camLayout.h },
        size: { width: raw.size.width / camLayout.w, height: raw.size.height / camLayout.h },
      };
    }
    // Already normalized
    return raw;
  };

  const normalizeFromCornerPoints = (
    cornerPoints?: { x: number; y: number }[]
  ): BarcodeBox["bounds"] | undefined => {
    if (!cornerPoints || cornerPoints.length < 2) return undefined;
    if (camLayout.w <= 0 || camLayout.h <= 0) return undefined;

    const xs = cornerPoints.map((p) => p.x);
    const ys = cornerPoints.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
      origin: { x: minX / camLayout.w, y: minY / camLayout.h },
      size: { width: (maxX - minX) / camLayout.w, height: (maxY - minY) / camLayout.h },
    };
  };

  // Main handler for detected barcodes (multi-QR ready)
  const handleBarcodes = async (event: { barcodes: BarcodeScanningResult[] }) => {
    const { barcodes } = event;
    if (!barcodes?.length) return;

    for (const b of barcodes) {
      if (!b.data) continue;

      const data = b.data;

      if (allDetectedCodes.has(data)) continue;

      setAllDetectedCodes((prev) => new Set([...prev, data]));
      setScannedCodes((prev) => new Set([...prev, data]));

      console.log("Barcode detected:", JSON.stringify(b));

      // 1) Prefer b.bounds; normalize if needed
      let nBounds = normalizeBounds(b.bounds);

      // 2) Fallback: compute from cornerPoints
      if (!nBounds) {
        nBounds = normalizeFromCornerPoints(b.cornerPoints);
        if (nBounds) {
          console.log("Calculated bounds from corner points (normalized to camera area):", nBounds);
        }
      }

      // 3) Final fallback: center box
      if (!nBounds) {
        nBounds = {
          origin: { x: 0.25, y: 0.35 },
          size: { width: 0.5, height: 0.3 },
        };
        console.log("Using fallback bounds");
      }

      const productId = data.split("-")[0];

      if (!products[productId]?.codes?.includes?.(data)) {
        try {
          await addScan(data, productId);
        } catch (e) {
          console.warn("addScan failed", e);
        }
      }

      const id = `${data}-${Date.now()}`;
      const newBox: BarcodeBox = {
        id,
        data,
        color: "#00ff00",
        bounds: nBounds,
        opacity: new Animated.Value(1),
      };

      setBarcodeBoxes((prev) => {
        const filtered = prev.filter((box) => box.data !== data);
        return [...filtered, newBox];
      });

      console.log("Added box to state. Total boxes:", barcodeBoxes.length + 1);
      console.log("Box details:", { id, data, bounds: nBounds });
    }
  };

  if (hasPermission === null) return <Text>Requesting camera permission…</Text>;
  if (hasPermission === false) return <Text>No access to camera</Text>;

  const cameraReady = camLayout.w > 0 && camLayout.h > 0;

  return (
    <View style={styles.container}>
      <View
        style={styles.scannerArea}
        onLayout={(e) => {
          const { x, y, width, height } = e.nativeEvent.layout;
          setCamLayout({ x, y, w: width, h: height });
        }}
      >
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(event) => handleBarcodes({ barcodes: [event] })}
        />

        {/* Header: counter + reset */}
        <View
          style={styles.headerBar}
          pointerEvents="box-none"
        >
          <Text style={styles.counter}>
            Detected QRs: {allDetectedCodes.size}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setBarcodeBoxes([]);
              setAllDetectedCodes(new Set());
              setScannedCodes(new Set());
            }}
            style={styles.resetBtn}
          >
            <MaterialIcons name="refresh" size={16} color="white" />
            <Text style={{ color: "white" }}>Reset Grid</Text>
          </TouchableOpacity>
        </View>

        {/* Overlays */}
        {cameraReady &&
          barcodeBoxes.map((b) => {
            const { origin, size } = b.bounds;

            // At this point bounds are normalized [0..1]
            const left = origin.x * camLayout.w;
            const top = origin.y * camLayout.h;
            const width = size.width * camLayout.w;
            const height = size.height * camLayout.h;

            return (
              <View
                key={b.id}
                pointerEvents="none"
                style={[
                  styles.qrBox,
                  {
                    left,
                    top,
                    width,
                    height,
                    borderColor: b.color,
                    backgroundColor: "rgba(0,255,0,0.2)",
                  },
                ]}
              >
                <View style={styles.cornersRow}>
                  <View style={styles.corner} />
                  <View style={styles.corner} />
                </View>
                <View style={styles.cornersRow}>
                  <View style={styles.corner} />
                  <View style={styles.corner} />
                </View>
              </View>
            );
          })}
      </View>

      {/* Bottom panel */}
      <View style={styles.bottomPanel}>
        <Text style={styles.title}>Scanned Products</Text>
        <ScrollView style={{ maxHeight: 240 }}>
          {Object.values(products).map((p: any) => (
            <View key={p.id} style={styles.card}>
              <View>
                <Text style={styles.productName}>{p.id}</Text>
                <Text style={styles.codeCount}>{p.codes.length} pcs</Text>
              </View>
            </View>
          ))}
          {Object.keys(products).length === 0 && (
            <Text style={{ color: theme.colors.subtleText }}>No products scanned yet.</Text>
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

  headerBar: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    zIndex: 1001,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  counter: {
    color: "white",
    fontSize: 16,
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 5,
    borderRadius: 5,
  },
  resetBtn: {
    backgroundColor: "rgba(255,0,0,0.7)",
    padding: 8,
    borderRadius: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  qrBox: {
    position: "absolute",
    borderWidth: 4,
    shadowColor: "#00ff00",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 8,
    justifyContent: "space-between",
  },
  cornersRow: { flexDirection: "row", justifyContent: "space-between" },
  corner: {
    width: 10,
    height: 10,
    backgroundColor: "#00ff00",
    borderRadius: 5,
  },

  bottomPanel: {
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
    fontSize: 18,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  productName: {
    fontFamily: theme.fonts.medium,
    fontSize: 16,
    color: theme.colors.text,
  },
  codeCount: { color: theme.colors.subtleText, fontSize: 13 },
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
