/**
 * Shared helpers for rendering uploaded attachments (concern evidence,
 * message files). Concern attachments are arbitrary uploads (image, PDF, doc),
 * so surfaces preview images inline and fall back to a link for everything else.
 */

/** True when a stored file URL points at an image we can preview inline. */
export const isImageUrl = (url?: string | null): boolean =>
  !!url && /\.(png|jpe?g|gif|webp|heic|bmp)(\?.*)?$/i.test(url);
