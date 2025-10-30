import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Button, ScrollView } from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import { useScanStore } from '../../hooks/useScanStore';

export default function IndexScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const { products, addScan, loadData, clearAll } = useScanStore();

  useEffect(() => {
    const getCameraPermissions = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
      await loadData();
    };

    getCameraPermissions();
  }, []);

  const handleBarcodeScanned = async ({ type, data }: { type: string; data: string }) => {
    if (lastScanned === data) return;
    setLastScanned(data);

    const productId = data.split('-')[0];
    await addScan(data, productId);

    setTimeout(() => setLastScanned(null), 1000);
  };

  if (hasPermission === null) return <Text>Requesting camera permission...</Text>;
  if (hasPermission === false) return <Text>No access to camera.</Text>;

  return (
    <View style={styles.container}>
      <CameraView
        onBarcodeScanned={handleBarcodeScanned}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.overlay}>
        <Text style={styles.title}>📦 Pharmacy Stock Scanner</Text>
        <ScrollView>
          {Object.values(products).map((p) => (
            <Text key={p.id} style={styles.item}>
              {p.id}: {p.codes.length}
            </Text>
          ))}
        </ScrollView>
        <Button title="Clear All" onPress={clearAll} color="#e63946" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: '#000a',
    padding: 16,
  },
  title: { color: 'white', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  item: { color: 'white', fontSize: 16 },
});
