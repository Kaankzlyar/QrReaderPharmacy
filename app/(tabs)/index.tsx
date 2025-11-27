import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform } from "react-native";
import { Camera, useCameraDevice, useCodeScanner } from "react-native-vision-camera";
import { useScanStore } from "../../hooks/useScanStore";
import { theme } from "../../constants/theme";
import { MaterialIcons } from "@expo/vector-icons";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// Bottom panel yüksekliği çıkarılmış gerçek kamera alanı
const BOTTOM_PANEL_HEIGHT = 280;
const CAMERA_AREA_H = SCREEN_H - BOTTOM_PANEL_HEIGHT;

interface BarcodeBox {
  id: string;
  data: string;
  color: string;
  frame: { x: number; y: number; width: number; height: number };
  corners?: { x: number; y: number }[]; // QR kodun 4 köşesi
  timestamp: number;
  isNew?: boolean; 
}

interface DetectionTrack {
  code: string;
  frame: { x: number; y: number; width: number; height: number };
  corners?: { x: number; y: number }[];
  hitCount: number;
  lastSeen: number;
}

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

// GS1 DataMatrix formatını parse et
// Örnek: (01)08699717010109(21)294405443(17)SKT:05.2030(10)25089184A
// veya FNC1 karakterleri ile: ]d201086997170101092129440544317...
const parseGS1Code = (rawData: string): { productId: string; serialNumber: string; fullCode: string } => {
  let data = rawData;
  
  // GS1 DataMatrix prefix'lerini temizle
  if (data.startsWith("]d2") || data.startsWith("]Q3") || data.startsWith("]C1")) {
    data = data.substring(3);
  }
  
  // AI (Application Identifier) pattern'leri
  const aiPatterns: { [key: string]: RegExp } = {
    gtin: /\(01\)(\d{14})/,          // GTIN-14
    gtinShort: /\(01\)(\d{8,13})/,   // GTIN-8/12/13
    serial: /\(21\)([^\(]+)/,         // Serial number
    expiry: /\(17\)([^\(]+)/,         // Expiry date
    batch: /\(10\)([^\(]+)/,          // Batch/Lot number
  };
  
  // Parantezli format: (01)08699717010109(21)294405443
  let gtin = "";
  let serial = "";
  
  const gtinMatch = data.match(aiPatterns.gtin) || data.match(aiPatterns.gtinShort);
  if (gtinMatch) {
    gtin = gtinMatch[1];
  }
  
  const serialMatch = data.match(aiPatterns.serial);
  if (serialMatch) {
    serial = serialMatch[1];
  }
  
  // Parantez yoksa FNC1 format olabilir: 01086997170101092129440544317...
  // AI'lar: 01 (14 digit), 21 (variable), 17 (6 digit), 10 (variable)
  if (!gtin && !serial) {
    // 01 ile başlıyorsa
    if (data.startsWith("01") && data.length >= 16) {
      gtin = data.substring(2, 16); // 14 digit GTIN
      const rest = data.substring(16);
      
      // 21 ile devam ediyorsa (seri numarası)
      if (rest.startsWith("21")) {
        // Seri numarası 17 veya 10 AI'ına kadar devam eder
        const serialEnd = rest.search(/(?:17|10)/);
        if (serialEnd > 2) {
          serial = rest.substring(2, serialEnd);
        } else {
          serial = rest.substring(2); // Sonuna kadar
        }
      }
    }
  }
  
  // Fallback: Eski format (PRODUCT-001 gibi)
  if (!gtin && !serial) {
    const parts = data.split("-");
    if (parts.length >= 2) {
      return {
        productId: parts[0],
        serialNumber: data,
        fullCode: rawData,
      };
    }
    // Hiçbir format uymadı, olduğu gibi kullan
    return {
      productId: data.substring(0, Math.min(14, data.length)),
      serialNumber: data,
      fullCode: rawData,
    };
  }
  
  return {
    productId: gtin || "UNKNOWN",
    serialNumber: serial || data,
    fullCode: rawData,
  };
};

export default function ScannerScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [barcodeBoxes, setBarcodeBoxes] = useState<BarcodeBox[]>([]);
  const [scannedCodes, setScannedCodes] = useState<Set<string>>(new Set());
  const [permanentMarkers, setPermanentMarkers] = useState<Map<string, BarcodeBox>>(new Map());
  const [detectionTracks, setDetectionTracks] = useState<DetectionTrack[]>([]);
  const [torchOn, setTorchOn] = useState(false);
  const [frameDimensions, setFrameDimensions] = useState({ width: 1280, height: 720 });

  const VF_WIDTH_RATIO = 0.80;
  const VF_HEIGHT_RATIO = 0.45; // Reduced from 0.55 to move scanning area higher
  const CONFIRMATION_THRESHOLD = 1; // Reduced to 1 for instant confirmation
  const IOU_THRESHOLD = 0.3; // Reduced from 0.4 for more lenient tracking
  const MIN_BOX_AREA_RATIO = 0.001; // Reduced from 0.02 to accept smaller QR codes
  const MIN_ASPECT_RATIO = 0.5; // More lenient (was 0.7)
  const MAX_ASPECT_RATIO = 2; // More lenient (was 1.4)
  const TRACK_TIMEOUT = 1500; 
  
  const { products, addScan, loadData, clearAll } = useScanStore();
  const device = useCameraDevice("back");

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

  useEffect(() => {
    if (format) {
      setFrameDimensions({ width: format.videoWidth, height: format.videoHeight });
    }
  }, [format]);

  const vfW = SCREEN_W * VF_WIDTH_RATIO;
  const vfH = SCREEN_H * VF_HEIGHT_RATIO;
  const vfL = (SCREEN_W - vfW) / 2;
  const vfT = (SCREEN_H - vfH) / 2 - 150;

  const viewfinderRect = { left: vfL, top: vfT, width: vfW, height: vfH };

  // --- TEK NOKTA DÖNÜŞÜMÜ (Corner tabanlı) ---
  const adjustPoint = (point: { x: number; y: number }) => {
    const { width: frameW, height: frameH } = frameDimensions;

    const isPortraitUI = CAMERA_AREA_H > SCREEN_W;
    const isFrameLandscape = frameW > frameH;
    const shouldSwap = Platform.OS === 'android' && isPortraitUI && isFrameLandscape;

    if (shouldSwap) {
      // Android Portrait - CONTAIN mode
      // Frame 1280x720 (landscape) -> Ekranda 720x1280 gibi döndürülmüş gösteriliyor
      const rotatedFrameW = frameH; // 720
      const rotatedFrameH = frameW; // 1280
      
      // Contain mode: Aspect ratio koruyarak sığdır
      const scale = Math.min(SCREEN_W / rotatedFrameW, CAMERA_AREA_H / rotatedFrameH);
      const displayedW = rotatedFrameW * scale;
      const displayedH = rotatedFrameH * scale;
      
      // Ortalama için offset
      const offsetX = (SCREEN_W - displayedW) / 2;
      const offsetY = (CAMERA_AREA_H - displayedH) / 2;

      // 90° saat yönünde rotasyon dönüşümü
      // Sensör (x,y) -> Ekran (frameH - y, x)
      return {
        x: ((frameH - point.y) / frameH) * displayedW + offsetX,
        y: (point.x / frameW) * displayedH + offsetY,
      };
    } else {
      // iOS veya Landscape
      const scale = Math.min(SCREEN_W / frameW, CAMERA_AREA_H / frameH);
      const displayedW = frameW * scale;
      const displayedH = frameH * scale;
      const offsetX = (SCREEN_W - displayedW) / 2;
      const offsetY = (CAMERA_AREA_H - displayedH) / 2;

      return {
        x: (point.x / frameW) * displayedW + offsetX,
        y: (point.y / frameH) * displayedH + offsetY,
      };
    }
  };

  // --- CORNERS'DAN BOUNDING BOX HESAPLA ---
  const cornersToRect = (corners: { x: number; y: number }[]) => {
    if (!corners || corners.length < 4) return null;
    
    // Tüm köşeleri ekran koordinatlarına dönüştür
    const screenCorners = corners.map(c => adjustPoint(c));
    
    // Bounding box hesapla
    const xs = screenCorners.map(c => c.x);
    const ys = screenCorners.map(c => c.y);
    
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    return {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  };

  // --- ESKİ RECT DÖNÜŞÜMÜ (Fallback) ---
  const adjustRect = (rect: { x: number; y: number; width: number; height: number }) => {
    const { width: frameW, height: frameH } = frameDimensions;

    const isPortraitUI = CAMERA_AREA_H > SCREEN_W;
    const isFrameLandscape = frameW > frameH;
    const shouldSwap = Platform.OS === 'android' && isPortraitUI && isFrameLandscape;

    if (shouldSwap) {
      const rotatedFrameW = frameH;
      const rotatedFrameH = frameW;
      const scale = Math.min(SCREEN_W / rotatedFrameW, CAMERA_AREA_H / rotatedFrameH);
      const displayedW = rotatedFrameW * scale;
      const displayedH = rotatedFrameH * scale;
      const offsetX = (SCREEN_W - displayedW) / 2;
      const offsetY = (CAMERA_AREA_H - displayedH) / 2;

      return {
        left: ((frameH - rect.y - rect.height) / frameH) * displayedW + offsetX,
        top: (rect.x / frameW) * displayedH + offsetY,
        width: (rect.height / frameH) * displayedW,
        height: (rect.width / frameW) * displayedH,
      };
    } else {
      const scale = Math.min(SCREEN_W / frameW, CAMERA_AREA_H / frameH);
      const displayedW = frameW * scale;
      const displayedH = frameH * scale;
      const offsetX = (SCREEN_W - displayedW) / 2;
      const offsetY = (CAMERA_AREA_H - displayedH) / 2;

      return {
        left: (rect.x / frameW) * displayedW + offsetX,
        top: (rect.y / frameH) * displayedH + offsetY,
        width: (rect.width / frameW) * displayedW,
        height: (rect.height / frameH) * displayedH,
      };
    }
  };

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
    codeTypes: ["qr", "data-matrix"],
    onCodeScanned: useCallback((codes) => {
      if (codes.length === 0) return;
      
      // State güncellemelerini render döngüsü dışına taşı - setTimeout kullan
      setTimeout(() => {
        const now = Date.now();
        const screenArea = SCREEN_W * SCREEN_H;

        // State güncellemelerini fonksiyonel formda yap - race condition önleme
        setDetectionTracks((prevTracks) => {
          const newTracks: DetectionTrack[] = [...prevTracks];

          for (const code of codes) {
            const data = code.value;
            if (!data || !code.frame) continue;

            const frame = code.frame;
            const corners = code.corners;

            // Basic validation
            const boxArea = frame.width * frame.height;
            if (boxArea / screenArea < MIN_BOX_AREA_RATIO) continue;

            const aspectRatio = frame.width / frame.height;
            if (aspectRatio < MIN_ASPECT_RATIO || aspectRatio > MAX_ASPECT_RATIO) continue;

            let matchedTrack: DetectionTrack | undefined;
            
            for (let i = 0; i < newTracks.length; i++) {
              const track = newTracks[i];
              if (track.code === data) {
                const iou = calculateIoU(track.frame, frame);
                if (iou >= IOU_THRESHOLD) {
                  matchedTrack = track;
                  break;
                }
              }
            }

            if (matchedTrack) {
              matchedTrack.hitCount++;
              matchedTrack.frame = { ...frame };
              matchedTrack.corners = corners ? [...corners] : undefined;
              matchedTrack.lastSeen = now;
            } else {
              newTracks.push({
                code: data,
                frame: frame,
                corners: corners ? [...corners] : undefined,
                hitCount: 1,
                lastSeen: now,
              });
            }
          }

          return newTracks;
        });

        // Scanned codes kontrolü ve işleme
        const codesToProcess: { data: string; frame: any; corners: any; productId: string }[] = [];
        
        for (const code of codes) {
          const data = code.value;
          if (!data || !code.frame) continue;
          
          const frame = code.frame;
          const corners = code.corners;
          
          // GS1 formatını parse et
          const parsed = parseGS1Code(data);
          const productId = parsed.productId;
          const uniqueCode = parsed.serialNumber; // Benzersiz seri numarası

          // Atomik kontrol ve güncelleme - sadece Set güncelle, async işlem yapma
          setScannedCodes((prevScanned) => {
            if (prevScanned.has(uniqueCode)) {
              return prevScanned; // Zaten tarandı, değişiklik yok
            }
            // İşlenecek kodları topla
            codesToProcess.push({ data: uniqueCode, frame, corners, productId });
            return new Set([...prevScanned, uniqueCode]);
          });
        }

        // Async işlemleri state callback'inin DIŞINDA yap
        for (const { data, frame, corners, productId } of codesToProcess) {
          (async () => {
            let scanSuccess = false;
            
            // Önce database'de var mı kontrol et
            const existing = products[productId];
            if (existing?.codes.includes(data)) {
              console.log("⚠️ Already in database:", data);
              // Marker ekle - isNew: false (zaten vardı)
              setPermanentMarkers((prev) => {
                if (prev.has(data)) return prev;
                return new Map(prev).set(data, {
                  id: `permanent-${data}`,
                  data,
                  color: theme.colors.accent,
                  frame: frame,
                  corners: corners ? [...corners] : undefined,
                  timestamp: Date.now(),
                  isNew: false, // Zaten database'de vardı
                });
              });
              return;
            }

            console.log("🔄 Processing new code:", data);
            
            try {
              await addScan(data, productId);
              scanSuccess = true;
              console.log("✅ Scan saved to database:", { data, productId });
              
              setPermanentMarkers((prev) => {
                if (prev.has(data)) return prev;
                return new Map(prev).set(data, {
                  id: `permanent-${data}`,
                  data,
                  color: theme.colors.accent,
                  frame: frame,
                  corners: corners ? [...corners] : undefined,
                  timestamp: Date.now(),
                  isNew: true, // Bu oturumda yeni tarandı
                });
              });
            } catch (error) {
              console.error("❌ Scan failed:", error);
              // Başarısızsa scannedCodes'dan kaldır
              setScannedCodes((prev) => {
                const newSet = new Set(prev);
                newSet.delete(data);
                return newSet;
              });
            }

            // Geçici görsel feedback
            const boxId = `${data}-${Date.now()}`;
            setBarcodeBoxes((prev) => [...prev, {
              id: boxId,
              data,
              color: scanSuccess ? theme.colors.accent : theme.colors.danger,
              frame: frame,
              timestamp: Date.now(),
            }].slice(-8));

            setTimeout(() => {
              setBarcodeBoxes((prev) => prev.filter((x) => x.id !== boxId));
            }, scanSuccess ? 1800 : 500);
          })();
        }

        // Marker pozisyonlarını güncelle
        setPermanentMarkers((prevMarkers) => {
          let hasChanges = false;
          const updatedMarkers = new Map(prevMarkers);
          
          for (const code of codes) {
            const data = code.value;
            if (!data || !code.frame) continue;
            
            if (updatedMarkers.has(data)) {
              const existing = updatedMarkers.get(data)!;
              // Sadece pozisyon güncelle
              updatedMarkers.set(data, {
                ...existing,
                frame: code.frame,
                corners: code.corners ? [...code.corners] : undefined,
                timestamp: Date.now(),
              });
              hasChanges = true;
            }
          }
          
          return hasChanges ? updatedMarkers : prevMarkers;
        });
      }, 0); // setTimeout kapanışı
    }, [products, addScan]),
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
          //videoHdr={true}
          codeScanner={codeScanner}
          format={format}
          fps={30}
          videoStabilizationMode="off"
          resizeMode="contain"
          torch={torchOn ? "on" : "off"}
        />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* Viewfinder dışındaki karanlık alan - 4 parça */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vfT, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ position: 'absolute', top: vfT + vfH, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ position: 'absolute', top: vfT, left: 0, width: vfL, height: vfH, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ position: 'absolute', top: vfT, right: 0, width: vfL, height: vfH, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          
          {/* Viewfinder çerçevesi */}
          <View style={{ position: "absolute", left: vfL, top: vfT, width: vfW, height: vfH, borderWidth: 3, borderColor: theme.colors.accent }} />
          
          {/* --- YEŞIL DİKDÖRTGEN VE CHECKMARK KATMANI --- */}
          {Array.from(permanentMarkers.values()).map((marker) => {
            const rawFrame = marker.frame;
            
            // isNew flag'e göre renk belirle: true = yeşil (yeni), false = sarı (zaten vardı)
            const markerColor = marker.isNew === false ? "#FFD700" : "#00FF00"; // Sarı veya Yeşil
            const bgColor = marker.isNew === false ? "rgba(255, 215, 0, 0.15)" : "rgba(0, 255, 0, 0.1)";
            
            // Dinamik offset hesaplama - ekran boyutuna oranla
            // S25 Ultra (412x915) için -40, -80 değerleri referans alındı
            // Oran: X için ~%9.7, Y için ~%8.7
            const OFFSET_RATIO_X = -0.097; // Ekran genişliğinin %9.7'si kadar sola
            const OFFSET_RATIO_Y = -0.087; // Ekran yüksekliğinin %8.7'si kadar yukarı
            
            const offsetAdjustX = SCREEN_W * OFFSET_RATIO_X;
            const offsetAdjustY = SCREEN_H * OFFSET_RATIO_Y;
            
            let styleRect = {
              left: rawFrame.x + offsetAdjustX,
              top: rawFrame.y + offsetAdjustY,
              width: rawFrame.width,
              height: rawFrame.height,
            };
            
            // Viewfinder sınırları
            const minLeft = vfL;
            const maxRight = vfL + vfW;
            const minTop = vfT;
            const maxBottom = vfT + vfH;
            
            // Eğer kutu tamamen viewfinder dışındaysa gösterme
            if (styleRect.left + styleRect.width < minLeft || 
                styleRect.left > maxRight ||
                styleRect.top + styleRect.height < minTop || 
                styleRect.top > maxBottom) {
              return null;
            }
            
            // Kutuyu viewfinder içine sınırla (clip)
            const clippedLeft = Math.max(styleRect.left, minLeft);
            const clippedTop = Math.max(styleRect.top, minTop);
            const clippedRight = Math.min(styleRect.left + styleRect.width, maxRight);
            const clippedBottom = Math.min(styleRect.top + styleRect.height, maxBottom);
            
            styleRect = {
              left: clippedLeft,
              top: clippedTop,
              width: clippedRight - clippedLeft,
              height: clippedBottom - clippedTop,
            };
            
            if (styleRect.width < 10 || styleRect.height < 10) return null;
            
            const badgeSize = Math.min(styleRect.width * 0.5, 40); 
            const badgeRadius = badgeSize / 2;
            const iconSize = badgeSize * 0.7;

            return (
              <View
                key={marker.data}
                style={{
                  position: "absolute",
                  left: styleRect.left,
                  top: styleRect.top,
                  width: styleRect.width,
                  height: styleRect.height,
                  // DIŞ ÇERÇEVE (Yeşil veya Sarı Dikdörtgen)
                  borderWidth: 2,
                  borderColor: markerColor, 
                  backgroundColor: bgColor,
                  borderRadius: 4,
                  // İçindeki ikonu tam ortaya hizala
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                {/* ORTA İKON (Renkli Daire + Siyah Tik) */}
                <View style={{
                    backgroundColor: markerColor, 
                    width: badgeSize,
                    height: badgeSize,
                    borderRadius: badgeRadius,
                    justifyContent: 'center',
                    alignItems: 'center',
                    // Gölge efektleri
                    shadowColor: "#000",
                    shadowOpacity: 0.3,
                    shadowRadius: 2,
                    elevation: 3
                }}>
                  <MaterialIcons name="check" size={iconSize} color="black" style={{fontWeight: 'bold'}} />
                </View>
              </View>
            );
          })}
        </View>
        <View style={styles.debugInfo}>
          <Text style={styles.debugText}>Saved: {Object.values(products).reduce((sum, p) => sum + p.codes.length, 0)} | Markers: {permanentMarkers.size}</Text>
          <Text style={styles.debugText}>Screen: {Math.round(SCREEN_W)}x{Math.round(SCREEN_H)}</Text>
          <Text style={styles.debugText}>CamArea: {Math.round(SCREEN_W)}x{Math.round(CAMERA_AREA_H)}</Text>
          <Text style={styles.debugText}>Frame: {frameDimensions.width}x{frameDimensions.height}</Text>
          <Text style={styles.debugText}>Scale: {(Math.min(SCREEN_W / frameDimensions.height, CAMERA_AREA_H / frameDimensions.width)).toFixed(3)}</Text>
          <TouchableOpacity onPress={() => { setPermanentMarkers(new Map()); setScannedCodes(new Set()); setDetectionTracks([]); }} style={styles.clearMarkersBtn}>
            <Text style={styles.clearMarkersBtnText}>Clear Markers</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.bottomPanel}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.md }}>
          <Text style={styles.title}>Scanned Products</Text>
          <TouchableOpacity 
            onPress={() => setTorchOn(!torchOn)} 
            style={[styles.torchButton, { backgroundColor: torchOn ? "#FFA500" : theme.colors.accent }]}
          >
            <MaterialIcons name={torchOn ? "flash-on" : "flash-off"} size={20} color="white" />
            <Text style={styles.torchButtonText}>{torchOn ? "ON" : "OFF"}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }}>
          {Object.values(products)
            .sort((a, b) => a.id.localeCompare(b.id)) // Ürün ID'sine göre sırala
            .map((p) => (
            <View key={p.id} style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.productName}>{p.id}</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{p.codes.length}</Text>
                </View>
              </View>
              <View style={styles.codesContainer}>
                {p.codes
                  .slice() // Orijinali değiştirmemek için kopya
                  .sort((a, b) => a.localeCompare(b)) // Kodları alfabetik sırala
                  .map((code, index) => (
                  <View key={code} style={styles.codeItem}>
                    <MaterialIcons name="qr-code-2" size={14} color={theme.colors.subtleText} />
                    <Text style={styles.codeText}>{code}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
          {Object.keys(products).length === 0 && <Text style={{ color: theme.colors.subtleText }}>No products scanned yet.</Text>}
        </ScrollView>
        <TouchableOpacity style={styles.clearButton} onPress={() => {
          clearAll();
          setPermanentMarkers(new Map());
          setScannedCodes(new Set());
          setDetectionTracks([]);
        }}>
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
  bottomPanel: { height: 280, backgroundColor: theme.colors.surface, padding: theme.spacing.lg, borderTopLeftRadius: theme.radius.lg * 1.5, borderTopRightRadius: theme.radius.lg * 1.5, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  title: { fontFamily: theme.fonts.bold, fontSize: 17, color: theme.colors.text, marginBottom: 0 },
  torchButton: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.md, gap: 6 },
  torchButtonText: { color: "white", fontFamily: theme.fonts.medium, fontSize: 14 },
  card: { backgroundColor: theme.colors.background, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  productName: { fontFamily: theme.fonts.bold, fontSize: 16, color: theme.colors.text },
  countBadge: { backgroundColor: theme.colors.accent, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countBadgeText: { color: "white", fontFamily: theme.fonts.bold, fontSize: 14 },
  codesContainer: { marginTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: '#E5E5E5', paddingTop: theme.spacing.sm },
  codeItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 6 },
  codeText: { fontSize: 12, fontFamily: theme.fonts.regular, color: theme.colors.subtleText },
  codeCount: { color: theme.colors.subtleText, fontSize: 12 },
  clearButton: { marginTop: theme.spacing.lg, backgroundColor: theme.colors.danger, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md, paddingVertical: 10, gap: 8 },
  clearButtonText: { color: "white", fontFamily: theme.fonts.medium },
});
