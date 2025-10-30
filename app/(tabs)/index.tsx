import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import { useScanStore } from '../../hooks/useScanStore';
import { theme } from '../../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';

export default function ScannerScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanState, setScanState] = useState<'idle' | 'success' | 'error'>('idle');
  const { products, addScan, loadData, clearAll } = useScanStore();
  const borderAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
      await loadData();
    })();
  }, []);

  // animate border on scan
  const flashBorder = (type: 'success' | 'error') => {
    setScanState(type);
    Animated.sequence([
      Animated.timing(borderAnim, { toValue: 1, duration: 150, useNativeDriver: false }),
      Animated.timing(borderAnim, { toValue: 0, duration: 800, useNativeDriver: false }),
    ]).start(() => setScanState('idle'));
  };

  const handleBarcodeScanned = async ({ type, data }: { type: string; data: string }) => {
    if (lastScanned === data) return;

    const productId = data.split('-')[0];

    // check duplicate before adding
    const existingProduct = products[productId];
    const isDuplicate = existingProduct?.codes.includes(data);

    if (isDuplicate) {
      flashBorder('error');
      return;
    }

    setLastScanned(data);
    await addScan(data, productId);
    flashBorder('success');

    setTimeout(() => setLastScanned(null), 1000);
  };

  if (hasPermission === null) return <Text>Requesting camera permission…</Text>;
  if (hasPermission === false) return <Text>No access to camera</Text>;

  // animated border color
  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', scanState === 'error' ? theme.colors.danger : theme.colors.accent],
  });

  return (
    <View style={styles.container}>
      <View style={styles.scannerArea}>
        <CameraView
          onBarcodeScanned={handleBarcodeScanned}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Animated frame */}
        <View style={styles.overlayFrame}>
          <Animated.View style={[styles.frame, { borderColor }]} />
        </View>
      </View>

      <View style={styles.bottomPanel}>
        <Text style={styles.title}>Scanned Products</Text>
        <ScrollView style={{ maxHeight: 240 }}>
          {Object.values(products).map((p) => (
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
  scannerArea: { flex: 1, backgroundColor: 'black' },
  overlayFrame: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: {
    width: 260,
    height: 260,
    borderWidth: 3,
    borderRadius: theme.radius.md,
  },
  bottomPanel: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    borderTopLeftRadius: theme.radius.lg * 1.5,
    borderTopRightRadius: theme.radius.lg * 1.5,
    shadowColor: '#000',
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
  codeCount: {
    color: theme.colors.subtleText,
    fontSize: 13,
  },
  clearButton: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    gap: 8,
  },
  clearButtonText: {
    color: 'white',
    fontFamily: theme.fonts.medium,
  },
});
