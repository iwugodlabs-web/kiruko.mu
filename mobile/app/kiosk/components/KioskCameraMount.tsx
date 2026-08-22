/**
 * Live selfie preview + capture for the kiosk clock-in flow (parity with web's
 * kioskCamera.ts which uses getUserMedia + canvas).
 *
 * Shows a small circular front-camera preview so the employee can see that a
 * photo is taken when they clock in (buddy-punch deterrent + transparency), and
 * captures imperatively via `capturePhoto()` the moment the PIN succeeds.
 *
 * Reliability notes:
 *   * A real, on-screen CameraView + an `onCameraReady` gate — the previous
 *     1x1 hidden mount frequently failed to initialize a capture session, so
 *     `takePictureAsync` returned null and no selfie was stored.
 *   * `capturePhoto()` waits briefly for the session to become ready, so a
 *     fast PIN entry right after mount still captures.
 *
 * Failure modes are still soft: permission denied / no front camera / capture
 * error all resolve to `null`, and the caller proceeds with the clock-in
 * regardless (a broken camera must never block clock-ins).
 */

import { CameraView, useCameraPermissions } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, View } from "react-native";

import { Palette, Type } from "../../constants/theme";

export interface KioskCameraHandle {
  /**
   * Capture a JPEG from the front camera and return its base-64 body (no
   * `data:image/jpeg;base64,` prefix — matches the web payload so the backend
   * treats both clients identically). Returns null on permission denied,
   * missing camera, or any error; the caller treats null as "photo
   * unavailable" and proceeds with the clock-in.
   */
  capturePhoto: () => Promise<string | null>;
  /** Whether we currently hold OS camera permission. */
  hasPermission: () => boolean;
}

const TILE = 116;

export const KioskCameraMount = forwardRef<KioskCameraHandle>((_, ref) => {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);

  // Ask once on mount if undetermined; harmless if already granted/denied.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission().catch(() => undefined);
    }
  }, [permission, requestPermission]);

  useImperativeHandle(
    ref,
    () => ({
      hasPermission: () => permission?.granted === true,
      capturePhoto: async () => {
        if (!permission?.granted || !cameraRef.current) return null;
        // Wait up to ~1.5s for the capture session to become ready — avoids
        // the null captures that happened when the PIN was entered before the
        // camera finished initializing.
        for (let i = 0; i < 15 && !readyRef.current; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        try {
          // Capture to a file (no base64 here — we re-encode after resizing).
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.7,
            exif: false,
          });
          if (!photo?.uri) return null;
          // Downscale to a small deterrent thumbnail. Full-res phone selfies
          // are multi-MB and blow past the backend cap; 480px wide @ 0.5 lands
          // around 50-80KB regardless of the sensor, and is plenty to
          // recognise a face. If the native manipulator module is unavailable
          // (dev client not rebuilt), this throws and we fall through to null.
          const resized = await manipulateAsync(
            photo.uri,
            [{ resize: { width: 480 } }],
            { compress: 0.5, format: SaveFormat.JPEG, base64: true },
          );
          return resized.base64 ?? null;
        } catch {
          return null;
        }
      },
    }),
    [permission?.granted],
  );

  // Permission not (yet) granted → labeled placeholder so the operator sees
  // the camera state instead of a blank gap.
  if (!permission?.granted) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.tile, styles.placeholder]}>
          <Text style={styles.placeholderText}>
            {permission?.canAskAgain === false ? "Camera off" : "Starting…"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.tile}>
        <CameraView
          ref={cameraRef}
          facing="front"
          style={styles.camera}
          mode="picture"
          onCameraReady={() => {
            readyRef.current = true;
            setReady(true);
          }}
        />
      </View>
      <Text style={styles.hint}>{ready ? "Look at the camera" : "Starting camera…"}</Text>
    </View>
  );
});

KioskCameraMount.displayName = "KioskCameraMount";

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: TILE / 2,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Palette.gold,
    backgroundColor: Palette.gray800,
  },
  camera: { flex: 1 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  placeholderText: {
    color: Palette.gray400,
    fontSize: Type.small,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  hint: { color: Palette.gray400, fontSize: Type.small, marginTop: 8 },
});
