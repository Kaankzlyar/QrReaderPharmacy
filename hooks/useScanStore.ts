import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ScannedItem {
  code: string;
  productId: string;
  timestamp: number;
}

interface ScanState {
  scannedItems: ScannedItem[];
  addScan: (code: string, productId: string) => Promise<void>;
  loadData: () => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useScanStore = create<ScanState>((set, get) => ({
  scannedItems: [],

  loadData: async () => {
    const saved = await AsyncStorage.getItem('scanned_items');
    if (saved) set({ scannedItems: JSON.parse(saved) });
  },

  addScan: async (code, productId) => {
    const current = [...get().scannedItems];
    
    current.push({
      code,
      productId,
      timestamp: Date.now(),
    });
    
    await AsyncStorage.setItem('scanned_items', JSON.stringify(current));
    set({ scannedItems: current });
  },

  clearAll: async () => {
    await AsyncStorage.removeItem('scanned_items');
    set({ scannedItems: [] });
  },
}));
