import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Product {
  id: string;           // GTIN (ürün kodu) - örn: "08699717010109"
  name?: string;        // Ürün adı (opsiyonel, sonra eklenebilir)
  codes: string[];      // Seri numaraları listesi - örn: ["294405443", "294405444"]
}

interface ScanState {
  products: Record<string, Product>;
  addScan: (serialNumber: string, gtin: string) => Promise<void>;
  loadData: () => Promise<void>;
  clearAll: () => Promise<void>;
  getProductByGtin: (gtin: string) => Product | undefined;
  getTotalScans: () => number;
}

export const useScanStore = create<ScanState>((set, get) => ({
  products: {},

  loadData: async () => {
    try {
      const saved = await AsyncStorage.getItem('scanned_products');
      if (saved) {
        set({ products: JSON.parse(saved) });
        console.log('📂 Loaded products from storage');
      }
    } catch (error) {
      console.error('❌ Failed to load data:', error);
    }
  },

  addScan: async (serialNumber: string, gtin: string) => {
    return new Promise<void>((resolve, reject) => {
      const state = get();
      const current = { ...state.products };
      
      // GTIN ile ürün yoksa oluştur
      if (!current[gtin]) {
        current[gtin] = { id: gtin, codes: [] };
      }
      
      // Seri numarası zaten var mı kontrol et
      if (current[gtin].codes.includes(serialNumber)) {
        console.log('⚠️ Duplicate serial number prevented:', serialNumber);
        reject(new Error('Serial number already exists'));
        return;
      }

      // Yeni seri numarasını ekle
      current[gtin].codes.push(serialNumber);
      
      // State'i güncelle
      set({ products: current });
      
      // AsyncStorage'a kaydet
      AsyncStorage.setItem('scanned_products', JSON.stringify(current))
        .then(() => {
          console.log('💾 Saved to storage:', { gtin, serialNumber });
          resolve();
        })
        .catch((error) => {
          console.error('❌ Storage failed:', error);
          // Rollback
          current[gtin].codes = current[gtin].codes.filter(c => c !== serialNumber);
          if (current[gtin].codes.length === 0) {
            delete current[gtin];
          }
          set({ products: current });
          reject(error);
        });
    });
  },

  clearAll: async () => {
    try {
      await AsyncStorage.removeItem('scanned_products');
      set({ products: {} });
      console.log('🗑️ All data cleared');
    } catch (error) {
      console.error('❌ Failed to clear data:', error);
    }
  },

  getProductByGtin: (gtin: string) => {
    return get().products[gtin];
  },

  getTotalScans: () => {
    const products = get().products;
    return Object.values(products).reduce((sum, p) => sum + p.codes.length, 0);
  },
}));
