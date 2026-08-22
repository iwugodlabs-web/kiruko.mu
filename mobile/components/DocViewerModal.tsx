import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

/**
 * In-app document viewer. Renders a vault file (image / PDF) inside a modal via
 * WebView — no external browser / link. `url` must already be absolute (use
 * resolveFileUrl). On iOS WKWebView renders images and PDFs natively; on Android
 * images render inline (PDF support depends on the system WebView).
 */
export default function DocViewerModal({
  visible,
  url,
  title,
  onClose,
}: {
  visible: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={() => setLoading(true)}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text numberOfLines={1} style={styles.title}>{title || 'Document'}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <MaterialIcons name="close" size={22} color={Palette.gray700} />
          </Pressable>
        </View>

        <View style={styles.body}>
          {url ? (
            <WebView
              source={{ uri: url }}
              style={{ flex: 1, backgroundColor: Palette.white }}
              originWhitelist={['*']}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
            />
          ) : null}
          {loading && (
            <View style={styles.loader} pointerEvents="none">
              <ActivityIndicator size="large" color={Palette.blue} />
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.gray100,
  },
  title: { flex: 1, fontSize: Type.title, fontWeight: '700', color: Palette.ink, marginRight: 12 },
  closeBtn: { padding: 4 },
  body: { flex: 1 },
  loader: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
