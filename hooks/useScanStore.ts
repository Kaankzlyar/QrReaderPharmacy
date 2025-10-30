import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Product {
  id: string;
  codes: string[];
}

interface ScanState {
  products: Record<string, Product>;
  addScan: (code: string, productId: string) => Promise<void>;
  loadData: () => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useScanStore = create<ScanState>((set, get) => ({
  products: {},

  loadData: async () => {
    const saved = await AsyncStorage.getItem('scanned_products');
    if (saved) set({ products: JSON.parse(saved) });
  },

  addScan: async (code, productId) => {
    const current = { ...get().products };
    if (!current[productId]) current[productId] = { id: productId, codes: [] };
    if (current[productId].codes.includes(code)) return;

    current[productId].codes.push(code);
    await AsyncStorage.setItem('scanned_products', JSON.stringify(current));
    set({ products: current });
  },

  clearAll: async () => {
    await AsyncStorage.removeItem('scanned_products');
    set({ products: {} });
  },
}));
