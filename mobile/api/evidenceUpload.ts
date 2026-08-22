// api/evidenceUpload.ts
import { DocumentPickerAsset } from 'expo-document-picker';

/**
 * Handles evidence file upload for complaints.
 * If file is present, uploads to S3/DigitalOcean and returns the public file URL.
 * @param file The DocumentPickerAsset object
 * @param presignedUrlApi The backend endpoint to get a pre-signed URL
 * @returns The public file URL after upload, or empty string if no file
 */
export async function handleEvidenceUpload(
  file: DocumentPickerAsset | null,
  presignedUrlApi: string
): Promise<string> {
  if (!file || !file.uri || !file.name) return '';
  // 1. Get pre-signed URL from backend
  const presignedRes = await fetch(presignedUrlApi, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, mimeType: file.mimeType || 'application/octet-stream' })
  });
  const presignedData = await presignedRes.json();
  const presignedUrl = presignedData.url;

  // 2. Upload file
  const fileData = await fetch(file.uri);
  const blob = await fileData.blob();
  const uploadRes = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.mimeType || 'application/octet-stream' },
    body: blob,
  });
  if (!uploadRes.ok) throw new Error('File upload failed');
  return presignedUrl.split('?')[0]; // The public file URL
}
