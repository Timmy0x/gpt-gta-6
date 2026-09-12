/** Node host shim only: the pinned renderer passes a real File to Babylon's unchanged loader. */
class BlobFileReader {
  result: ArrayBuffer | string | null = null;
  private aborted = false;
  onload: ((event: { target: BlobFileReader }) => void) | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  async readAsArrayBuffer(blob: Blob) { await this.read(blob.arrayBuffer()); }
  async readAsText(blob: Blob) { await this.read(blob.text()); }
  abort() { this.aborted = true; this.onloadend?.(); }
  private async read(result: Promise<ArrayBuffer | string>) {
    try { this.result = await result; if (!this.aborted) this.onload?.({ target: this }); }
    catch { if (!this.aborted) this.onerror?.(); }
    finally { if (!this.aborted) this.onloadend?.(); }
  }
}
globalThis.FileReader ??= BlobFileReader as unknown as typeof FileReader;
