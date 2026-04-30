// export_utils.js
// Shared file-save helpers for all CSV and binary (XLSX) exports.
// Detects Tauri native Save As dialog; falls back to browser Blob download.

/**
 * Trigger a browser Blob download.
 * @param {string|Uint8Array} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadFileViaBrowser(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Save a text file (CSV etc.) with native Save As when running in Tauri,
 * or fall back to a browser Blob download.
 *
 * @param {string} text - File content
 * @param {string} filename - Suggested filename
 * @returns {Promise<"saved"|"cancelled"|"downloaded"|"fallback">}
 */
export async function saveTextFileWithDialogOrDownload(text, filename) {
  const invoke = window.__TAURI__?.core?.invoke;

  if (typeof invoke === 'function') {
    try {
      const result = await invoke('save_text_file_with_dialog', { filename, contents: text });
      return result === 'cancelled' ? 'cancelled' : 'saved';
    } catch (err) {
      console.error('Native text save failed; falling back to browser download', err);
      downloadFileViaBrowser(text, filename, 'text/plain;charset=utf-8;');
      return 'fallback';
    }
  }

  downloadFileViaBrowser(text, filename, 'text/plain;charset=utf-8;');
  return 'downloaded';
}

/**
 * Save a binary file (XLSX etc.) via native Save As when running in Tauri.
 * Accepts base64-encoded content (use XLSX.write with type:'base64').
 *
 * Returns "browser" when not in Tauri — caller is responsible for using
 * XLSX.writeFile or equivalent browser download instead.
 *
 * @param {string} base64 - Base64-encoded binary content
 * @param {string} filename - Suggested filename
 * @returns {Promise<"saved"|"cancelled"|"fallback"|"browser">}
 */
export async function saveBinaryFileWithDialogOrDownload(base64, filename) {
  const invoke = window.__TAURI__?.core?.invoke;

  if (typeof invoke !== 'function') return 'browser';

  try {
    const result = await invoke('save_binary_file_with_dialog', { filename, contentsBase64: base64 });
    return result === 'cancelled' ? 'cancelled' : 'saved';
  } catch (err) {
    console.error('Native binary save failed', err);
    return 'fallback';
  }
}
