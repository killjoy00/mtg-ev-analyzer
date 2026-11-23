import { useState } from 'react';
import { Image } from 'expo-image';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea } from '@/src/components/ScreenArea';
import { colors, spacing } from '@/src/theme';
import { cardDisplayFaces, faceLabel, type FaceCard, type DisplayFace } from '../../../card-faces.mjs';

function FaceArtwork({ face, height }: { face: DisplayFace; height: number }) {
  const [normal, setNormal] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const uri = normal ? face.image_url : face.large_image_url || face.image_url;
  return <View style={[styles.art, { height }]}>
    {failed ? <View style={styles.error}>
      <Text style={styles.light}>Image unavailable for {face.name}.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Retry image for ${face.name}`}
        style={styles.button} onPress={() => { setFailed(false); setAttempt(value => value + 1); }}>
        <Text style={styles.buttonText}>Retry image</Text>
      </Pressable>
    </View> : <Image key={`${uri}:${attempt}`} source={uri} style={StyleSheet.absoluteFill}
      contentFit="contain" cachePolicy="memory-disk" accessibilityLabel={`${face.name} — ${faceLabel(face)}`}
      onError={() => { if (!normal && face.large_image_url) setNormal(true); else setFailed(true); }} />}
  </View>;
}

function FaceContent({ card, onClose }: { card: FaceCard; onClose: () => void }) {
  const [active, setActive] = useState(0);
  const { width, height } = useWindowDimensions();
  const faces = cardDisplayFaces(card);
  const wide = width >= 760;
  const next = faces[active === 0 ? 1 : 0];
  const imageHeight = Math.max(120, Math.min(height - (wide ? 180 : 260), 700));
  // Keep the name and Close target outside the dismissable image viewport.
  // The header never scrolls behind the notch or an enlarged card.
  return <ScreenArea edges={['top', 'right', 'bottom', 'left']} style={styles.safe}>
    <View style={styles.panel} accessibilityViewIsModal>
      <View testID="card-viewer-header" style={styles.header}>
        <Text numberOfLines={2} accessibilityRole="header" style={styles.title}>{card.name}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close card viewer"
          hitSlop={12} onPress={onClose} style={styles.closeButton}>
          <Text style={styles.buttonText}>Close</Text>
        </Pressable>
      </View>
      {!wide && faces.length === 2 && next ? <Pressable accessibilityRole="button"
        accessibilityLabel={`Show ${faceLabel(next).toLowerCase()}: ${next.name}`}
        style={styles.faceButton} onPress={() => setActive(value => value === 0 ? 1 : 0)}>
        <Text style={styles.buttonText}>Show {faceLabel(next).toLowerCase()}</Text>
      </Pressable> : null}
      <Pressable accessible={false} testID="card-viewer-dismiss" onPress={onClose} style={styles.dismissArea}>
        <ScrollView style={styles.imageScroll} contentContainerStyle={[styles.faces, wide && styles.wide]}>
          {faces.map((face, index) => <View key={face.image_url}
            style={[styles.face, !wide && index !== active && styles.hidden]}>
            {faces.length === 2 ? <Text style={styles.light}>{`${faceLabel(face)} · ${face.name}`}</Text> : null}
            <FaceArtwork face={face} height={imageHeight} />
            {face.partner_name ? <Text style={styles.light}>Melds with {face.partner_name}. Both cards are required.</Text> : null}
          </View>)}
          {!faces.length ? <Text style={styles.light}>Artwork unavailable.</Text> : null}
        </ScrollView>
      </Pressable>
    </View>
  </ScreenArea>;
}

export function CardFaceViewer({ card, onClose }: { card: FaceCard | null; onClose: () => void }) {
  return <Modal animationType="fade" transparent visible={card !== null} onRequestClose={onClose}>
    {card ? <FaceContent key={`${card.name}:${card.image_url}`} card={card} onClose={onClose} /> : null}
  </Modal>;
}

// The viewer stays near-black with bright, readable controls in either OS mode.
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'rgba(10,20,14,0.96)', padding: spacing.md },
  panel: { flex: 1, minHeight: 0, width: '100%', maxWidth: 1080, alignSelf: 'center', gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 56, zIndex: 2 },
  title: { flex: 1, flexShrink: 1, minWidth: 0, color: '#fff', fontSize: 18, lineHeight: 23, fontWeight: '800' },
  button: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  closeButton: { minHeight: 48, minWidth: 82, backgroundColor: colors.surface, borderRadius: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md },
  faceButton: { minHeight: 48, backgroundColor: colors.surface, borderRadius: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg },
  buttonText: { color: colors.ink, fontWeight: '800', fontSize: 16 },
  dismissArea: { flex: 1, minHeight: 0 },
  imageScroll: { flex: 1 },
  faces: { gap: spacing.sm, paddingBottom: spacing.md },
  wide: { flexDirection: 'row' },
  face: { flex: 1, gap: spacing.sm, minWidth: 0 },
  hidden: { display: 'none' },
  light: { color: '#fff', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  art: { width: '100%' },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
});
