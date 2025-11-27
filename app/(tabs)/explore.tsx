import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { FontAwesome} from '@expo/vector-icons';
import { useScanStore } from '../../hooks/useScanStore';
import { theme } from '../../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';

export default function ProductsScreen() {
  const { products, loadData, clearAll } = useScanStore();

  useEffect(() => {
    loadData();
  }, []);

  const totalProducts = Object.keys(products).length;
  const totalScans = Object.values(products).reduce((sum, p) => sum + p.codes.length, 0);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <FontAwesome name="archive" size={24} color={theme.colors.accent} />
          <Text style={[styles.headerTitle, { marginLeft: theme.spacing.sm, marginTop: 7 }]}>Products</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          {totalProducts} products • {totalScans} scans
        </Text>
      </View>

      {/* Product List */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {Object.keys(products).length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="inventory-2" size={64} color={theme.colors.subtleText} />
            <Text style={styles.emptyText}>No products scanned yet</Text>
            <Text style={styles.emptySubtext}>Scan QR codes to add products</Text>
          </View>
        ) : (
          Object.values(products)
            .sort((a, b) => a.id.localeCompare(b.id)) // Ürün ID'sine göre sırala
            .map((product) => (
            <View key={product.id} style={styles.productCard}>
              <View style={styles.productHeader}>
                <MaterialIcons name="medication" size={24} color={theme.colors.accent} />
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.id}</Text>
                  <Text style={styles.productCount}>{product.codes.length} items</Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{product.codes.length}</Text>
                </View>
              </View>
              
              {/* Code List */}
              <View style={styles.codeList}>
                {product.codes
                  .slice()
                  .sort((a, b) => a.localeCompare(b)) // Kodları alfabetik sırala
                  .map((code) => (
                  <View key={code} style={styles.codeItem}>
                    <MaterialIcons name="qr-code-2" size={16} color={theme.colors.subtleText} />
                    <Text style={styles.codeText}>{code}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Clear Button */}
      {totalScans > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.clearButton} onPress={clearAll}>
            <MaterialIcons name="delete-outline" size={20} color="white" />
            <Text style={styles.clearButtonText}>Clear All Products</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: theme.fonts.regular,
    color: theme.colors.subtleText,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing.md,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    fontFamily: theme.fonts.medium,
    color: theme.colors.text,
    marginTop: theme.spacing.md,
  },
  emptySubtext: {
    fontSize: 14,
    fontFamily: theme.fonts.regular,
    color: theme.colors.subtleText,
    marginTop: 4,
  },
  productCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  productInfo: {
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
  productName: {
    fontSize: 18,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  productCount: {
    fontSize: 13,
    fontFamily: theme.fonts.regular,
    color: theme.colors.subtleText,
    marginTop: 2,
  },
  codeList: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: theme.spacing.sm,
  },
  codeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  codeText: {
    fontSize: 13,
    fontFamily: theme.fonts.regular,
    color: theme.colors.text,
    marginLeft: 8,
  },
  countBadge: {
    backgroundColor: theme.colors.accent,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countBadgeText: {
    color: 'white',
    fontFamily: theme.fonts.bold,
    fontSize: 14,
  },
  footer: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  clearButton: {
    backgroundColor: theme.colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    gap: 8,
  },
  clearButtonText: {
    color: 'white',
    fontFamily: theme.fonts.medium,
    fontSize: 16,
  },
});
