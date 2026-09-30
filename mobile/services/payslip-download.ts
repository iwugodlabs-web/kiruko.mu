/**
 * Shared authenticated PDF download + share helper for payslips.
 *
 * Previously each screen hand-rolled its own expo-file-system
 * `downloadAsync` + expo-sharing flow, which failed in several ways:
 *
 *   * The backend 302-redirected object-store (S3/Spaces) PDFs to the CDN
 *     while the device forwarded the `Authorization: Bearer` header onto
 *     the redirect target — S3 rejects the foreign token, so the "PDF"
 *     saved on-device was an XML error page and sharing failed. The
 *     backend now streams those bytes same-origin
 *     (see GET /payslips/{id}/pdf), and this helper treats any error
 *     body as an error instead of handing it to the share sheet.
 *   * JSON error bodies (409 PAYSLIP_NOT_FINALIZED /
 *     OFFICIAL_PAYSLIP_EXISTS / NO_CLOCKINS_FOR_PERIOD /
 *     NO_PAY_BASIS_CONFIGURED, 503 renderer-off) were saved to a `.pdf`
 *     path and only surfaced as a generic "could not open" alert — and
 *     the stale file lingered in the cache under a reused filename.
 *
 * This helper downloads to a unique cache filename, sniffs the response
 * for JSON error bodies (by status AND content-type, so a mislabeled
 * 200 can't reach the share sheet), deletes non-PDF files, and returns
 * a discriminated result so callers can show the right message.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type PayslipDownloadErrorCode =
  | 'PAYSLIP_NOT_FINALIZED'
  | 'OFFICIAL_PAYSLIP_EXISTS'
  | 'NO_CLOCKINS_FOR_PERIOD'
  | 'NO_PAY_BASIS_CONFIGURED'
  | 'SHARING_UNAVAILABLE'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR';

export type PayslipDownloadResult =
  | { status: 'shared' }
  | { status: 'error'; code: PayslipDownloadErrorCode; httpStatus?: number };

interface DownloadOptions {
  /** Authenticated PDF URL (api.defaults.baseURL-derived stream endpoint). */
  url: string;
  /** Filename prefix — a timestamp is appended so stale cache files can never collide. */
  filenamePrefix: string;
  /** Share-sheet title. */
  dialogTitle: string;
}

async function tryDelete(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort cache cleanup — never fail the flow on it.
  }
}

async function readErrorCode(uri: string): Promise<PayslipDownloadErrorCode | undefined> {
  try {
    const body = await FileSystem.readAsStringAsync(uri);
    const parsed = JSON.parse(body);
    const code = parsed?.detail?.code;
    if (
      code === 'PAYSLIP_NOT_FINALIZED' ||
      code === 'OFFICIAL_PAYSLIP_EXISTS' ||
      code === 'NO_CLOCKINS_FOR_PERIOD' ||
      code === 'NO_PAY_BASIS_CONFIGURED'
    ) {
      return code;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function downloadAndSharePdf({
  url,
  filenamePrefix,
  dialogTitle,
}: DownloadOptions): Promise<PayslipDownloadResult> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    return { status: 'error', code: 'NETWORK_ERROR' };
  }
  const safePrefix = filenamePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  const localUri = `${cacheDir}${safePrefix}_${Date.now()}.pdf`;

  let result: FileSystem.FileSystemDownloadResult;
  try {
    const token = await AsyncStorage.getItem('authToken');
    result = await FileSystem.downloadAsync(url, localUri, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : undefined),
        Accept: 'application/pdf',
      },
    });
  } catch (err) {
    console.warn('payslip: download failed', err);
    await tryDelete(localUri);
    return { status: 'error', code: 'NETWORK_ERROR' };
  }

  // Error bodies arrive as JSON — either via a non-200 status or (defensive:
  // a misbehaving hop can relabel them 200) via the content-type sniff.
  const contentType =
    Object.entries(result.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  const looksJson = String(contentType).toLowerCase().includes('json');

  if (result.status !== 200 || looksJson) {
    const code = (await readErrorCode(result.uri)) ?? 'HTTP_ERROR';
    await tryDelete(result.uri);
    return { status: 'error', code, httpStatus: result.status };
  }

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    await tryDelete(result.uri);
    return { status: 'error', code: 'SHARING_UNAVAILABLE' };
  }

  try {
    await Sharing.shareAsync(result.uri, {
      mimeType: 'application/pdf',
      dialogTitle,
      UTI: 'com.adobe.pdf',
    });
    return { status: 'shared' };
  } catch (err) {
    console.warn('payslip: share failed', err);
    await tryDelete(result.uri);
    return { status: 'error', code: 'NETWORK_ERROR' };
  }
}
