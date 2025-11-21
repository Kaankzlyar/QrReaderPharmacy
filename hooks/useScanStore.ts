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
    return new Promise<void>((resolve, reject) => {
      set((state) => {
        const current = { ...state.products };
        
        // Initialize product if doesn't exist
        if (!current[productId]) {
          current[productId] = { id: productId, codes: [] };
        }
        
        // Check if already exists
        if (current[productId].codes.includes(code)) {
          console.log('⚠️ Duplicate prevented in addScan:', code);
          reject(new Error('Code already exists'));
          return state; // Return unchanged state
        }

        // Add new code
        current[productId].codes.push(code);
        
        // Save to AsyncStorage
        AsyncStorage.setItem('scanned_products', JSON.stringify(current))
          .then(() => {
            console.log('💾 Saved to storage:', code);
            resolve();
          })
          .catch((error) => {
            console.error('❌ Storage failed:', error);
            reject(error);
          });
        
        return { products: current };
      });
    });
  },

  clearAll: async () => {
    await AsyncStorage.removeItem('scanned_products');
    set({ products: {} });
  },
}));
