import { Injectable } from '@angular/core';
import JSZip from 'jszip';

export interface ResourceAsset {
  readonly path: string;
  readonly file: File;
  readonly previewUrl: string;
}

export interface HtmlProject {
  readonly fileName: string;
  readonly html: string;
  readonly assets: readonly ResourceAsset[];
}

export interface PreviewTextEditRequest {
  readonly source: 'web-drafty-preview';
  readonly type: 'edit-text';
  readonly path: readonly number[];
  readonly value: string;
}

interface RawAsset {
  readonly path: string;
  readonly file: File;
}

type ReferenceResolver = (value: string, contextPath: string) => string;

@Injectable({
  providedIn: 'root',
})
export class HtmlWorkspaceService {
  readonly starterHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Untitled page</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: system-ui, sans-serif;
        color: #17202a;
        background: #f8fafc;
      }

      main {
        max-width: 48rem;
        padding: 2rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Hello from WebDrafty</h1>
      <p>Edit this document and export it as one HTML file or a zipped folder.</p>
    </main>
  </body>
</html>
`;

  private readonly objectUrls = new Set<string>();

  async createProjectFromHtmlFile(file: File): Promise<HtmlProject> {
    return {
      fileName: this.ensureHtmlFileName(file.name),
      html: await this.readHtmlText(file),
      assets: [],
    };
  }

  async createProjectFromFolder(files: readonly File[]): Promise<HtmlProject> {
    const htmlFile = this.pickHtmlFile(files);

    if (!htmlFile) {
      throw new Error('No .html or .htm file was found in that folder.');
    }

    const htmlPath = this.getFilePath(htmlFile);
    const baseDirectory = this.getDirectoryPath(htmlPath);
    const rawAssets = files
      .filter((file) => file !== htmlFile)
      .map((file) => this.toRawAsset(file, baseDirectory))
      .filter((asset): asset is RawAsset => asset !== null);

    return {
      fileName: this.ensureHtmlFileName(this.basename(htmlPath)),
      html: await this.readHtmlText(htmlFile),
      assets: await this.createResourceAssets(rawAssets),
    };
  }

  buildPreviewHtml(html: string, assets: readonly ResourceAsset[], editMode: boolean): string {
    if (assets.length === 0) {
      return editMode ? this.injectPreviewEditor(html) : html;
    }

    const doc = this.parseHtml(html);
    const assetMap = this.createAssetMap(assets);

    this.rewriteDomReferences(doc, (value, contextPath) =>
      this.resolveAssetReference(
        value,
        contextPath,
        assetMap,
        (asset, suffix) => `${asset.previewUrl}${suffix}`,
      ),
    );

    const previewHtml = this.serializeHtml(doc);
    return editMode ? this.injectPreviewEditor(previewHtml) : previewHtml;
  }

  async buildSingleFileHtml(html: string, assets: readonly ResourceAsset[]): Promise<string> {
    if (assets.length === 0) {
      return html;
    }

    const doc = this.parseHtml(html);
    const assetMap = this.createAssetMap(assets);
    const dataUriMap = await this.createDataUriMap(assets);

    await this.inlineStylesheets(doc, assetMap, dataUriMap);
    await this.inlineScripts(doc, assetMap);

    this.rewriteDomReferences(doc, (value, contextPath) =>
      this.resolveAssetReference(value, contextPath, assetMap, (asset, suffix) => {
        const dataUri = dataUriMap.get(asset.path);
        return dataUri ? `${dataUri}${suffix}` : value;
      }),
    );

    return this.serializeHtml(doc);
  }

  async buildFolderZip(
    fileName: string,
    html: string,
    assets: readonly ResourceAsset[],
  ): Promise<Blob> {
    const zip = new JSZip();

    zip.file(this.ensureHtmlFileName(fileName), html);

    for (const asset of assets) {
      zip.file(asset.path, asset.file);
    }

    return zip.generateAsync({ type: 'blob' });
  }

  releasePreviewUrls(): void {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }

    this.objectUrls.clear();
  }

  ensureHtmlFileName(fileName: string): string {
    const trimmedName = fileName.trim();
    const name = trimmedName.length > 0 ? trimmedName : 'index.html';

    return /\.html?$/i.test(name) ? name : `${name}.html`;
  }

  zipFileName(fileName: string): string {
    return this.ensureHtmlFileName(fileName).replace(/\.html?$/i, '.zip');
  }

  replaceTextAtPath(html: string, path: readonly number[], value: string): string {
    const doc = this.parseHtml(html);
    const node = this.findNodeAtPath(doc, path);

    if (!node || node.nodeType !== Node.TEXT_NODE) {
      throw new Error('That text could not be mapped back to the HTML source.');
    }

    node.textContent = value;

    return this.serializeHtml(doc);
  }

  private async createResourceAssets(
    rawAssets: readonly RawAsset[],
  ): Promise<readonly ResourceAsset[]> {
    const previewUrls = new Map<string, string>();

    for (const asset of rawAssets) {
      previewUrls.set(asset.path, this.createObjectUrl(asset.file));
    }

    const rewrittenAssets = await Promise.all(
      rawAssets.map(async (asset) => {
        if (!this.isCssPath(asset.path)) {
          return {
            path: asset.path,
            file: asset.file,
            previewUrl: previewUrls.get(asset.path) ?? this.createObjectUrl(asset.file),
          };
        }

        const css = await asset.file.text();
        const rewrittenCss = this.rewriteCssReferences(css, asset.path, (value, contextPath) =>
          this.resolvePreviewReference(value, contextPath, previewUrls),
        );
        const previewUrl = this.createObjectUrl(new Blob([rewrittenCss], { type: 'text/css' }));

        return {
          path: asset.path,
          file: asset.file,
          previewUrl,
        };
      }),
    );

    return rewrittenAssets.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async inlineStylesheets(
    doc: Document,
    assetMap: ReadonlyMap<string, ResourceAsset>,
    dataUriMap: ReadonlyMap<string, string>,
  ): Promise<void> {
    const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[href]'));

    for (const link of links) {
      if (!this.isStylesheetLink(link)) {
        continue;
      }

      const href = link.getAttribute('href');
      if (!href) {
        continue;
      }

      const asset = this.findAsset(href, '', assetMap);
      if (!asset) {
        continue;
      }

      const css = await asset.file.text();
      const style = doc.createElement('style');
      style.textContent = this.rewriteCssReferences(css, asset.path, (value, contextPath) =>
        this.resolveAssetReference(value, contextPath, assetMap, (matchedAsset, suffix) => {
          const dataUri = dataUriMap.get(matchedAsset.path);
          return dataUri ? `${dataUri}${suffix}` : value;
        }),
      );
      link.replaceWith(style);
    }
  }

  private async inlineScripts(
    doc: Document,
    assetMap: ReadonlyMap<string, ResourceAsset>,
  ): Promise<void> {
    const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[src]'));

    for (const script of scripts) {
      const source = script.getAttribute('src');
      if (!source) {
        continue;
      }

      const asset = this.findAsset(source, '', assetMap);
      if (!asset || !this.isTextLikeScript(script)) {
        continue;
      }

      script.removeAttribute('src');
      script.textContent = await asset.file.text();
    }
  }

  private rewriteDomReferences(doc: Document, resolver: ReferenceResolver): void {
    const elements = Array.from(
      doc.querySelectorAll<HTMLElement>('[src], [href], [poster], [style]'),
    );

    for (const element of elements) {
      this.rewriteAttribute(element, 'src', resolver);
      this.rewriteAttribute(element, 'href', resolver);
      this.rewriteAttribute(element, 'poster', resolver);

      const style = element.getAttribute('style');
      if (style) {
        element.setAttribute('style', this.rewriteCssReferences(style, '', resolver));
      }
    }

    const srcsetElements = Array.from(
      doc.querySelectorAll<HTMLImageElement | HTMLSourceElement>('[srcset]'),
    );
    for (const element of srcsetElements) {
      const srcset = element.getAttribute('srcset');
      if (srcset) {
        element.setAttribute('srcset', this.rewriteSrcset(srcset, '', resolver));
      }
    }

    const styles = Array.from(doc.querySelectorAll<HTMLStyleElement>('style'));
    for (const style of styles) {
      style.textContent = this.rewriteCssReferences(style.textContent ?? '', '', resolver);
    }
  }

  private rewriteAttribute(
    element: HTMLElement,
    attribute: string,
    resolver: ReferenceResolver,
  ): void {
    const value = element.getAttribute(attribute);

    if (!value) {
      return;
    }

    element.setAttribute(attribute, resolver(value, ''));
  }

  private rewriteCssReferences(
    css: string,
    contextPath: string,
    resolver: ReferenceResolver,
  ): string {
    return css.replace(
      /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
      (_match, quote: string, value: string) => {
        const resolved = resolver(value.trim(), contextPath);
        const safeQuote = quote || '"';

        return `url(${safeQuote}${resolved}${safeQuote})`;
      },
    );
  }

  private rewriteSrcset(srcset: string, contextPath: string, resolver: ReferenceResolver): string {
    return srcset
      .split(',')
      .map((candidate) => {
        const trimmed = candidate.trim();
        const separatorIndex = trimmed.search(/\s/);

        if (separatorIndex === -1) {
          return resolver(trimmed, contextPath);
        }

        const url = trimmed.slice(0, separatorIndex);
        const descriptor = trimmed.slice(separatorIndex);

        return `${resolver(url, contextPath)}${descriptor}`;
      })
      .join(', ');
  }

  private resolvePreviewReference(
    value: string,
    contextPath: string,
    previewUrls: ReadonlyMap<string, string>,
  ): string {
    const normalizedPath = this.resolveReferencePath(value, contextPath);

    if (!normalizedPath) {
      return value;
    }

    const matchedUrl = previewUrls.get(normalizedPath.path);
    return matchedUrl ? `${matchedUrl}${normalizedPath.suffix}` : value;
  }

  private resolveAssetReference(
    value: string,
    contextPath: string,
    assetMap: ReadonlyMap<string, ResourceAsset>,
    mapper: (asset: ResourceAsset, suffix: string) => string,
  ): string {
    const asset = this.findAsset(value, contextPath, assetMap);

    if (!asset) {
      return value;
    }

    const normalizedPath = this.resolveReferencePath(value, contextPath);
    return normalizedPath ? mapper(asset, normalizedPath.suffix) : value;
  }

  private findAsset(
    value: string,
    contextPath: string,
    assetMap: ReadonlyMap<string, ResourceAsset>,
  ): ResourceAsset | null {
    const normalizedPath = this.resolveReferencePath(value, contextPath);

    return normalizedPath ? (assetMap.get(normalizedPath.path) ?? null) : null;
  }

  private resolveReferencePath(
    value: string,
    contextPath: string,
  ): { path: string; suffix: string } | null {
    const trimmedValue = value.trim();

    if (!trimmedValue || this.isExternalReference(trimmedValue)) {
      return null;
    }

    const suffixIndex = this.firstSuffixIndex(trimmedValue);
    const pathPart = suffixIndex === -1 ? trimmedValue : trimmedValue.slice(0, suffixIndex);
    const suffix = suffixIndex === -1 ? '' : trimmedValue.slice(suffixIndex);

    if (!pathPart || pathPart.startsWith('/')) {
      return null;
    }

    const decodedPath = this.decodePath(pathPart);
    const baseDirectory = this.getDirectoryPath(contextPath);
    const resolvedPath = this.normalizePath(
      baseDirectory ? `${baseDirectory}/${decodedPath}` : decodedPath,
    );

    return { path: resolvedPath, suffix };
  }

  private createAssetMap(assets: readonly ResourceAsset[]): ReadonlyMap<string, ResourceAsset> {
    const map = new Map<string, ResourceAsset>();

    for (const asset of assets) {
      map.set(asset.path, asset);
    }

    return map;
  }

  private async createDataUriMap(
    assets: readonly ResourceAsset[],
  ): Promise<ReadonlyMap<string, string>> {
    const map = new Map<string, string>();

    await Promise.all(
      assets.map(async (asset) => {
        map.set(asset.path, await this.fileToDataUri(asset.file));
      }),
    );

    return map;
  }

  private fileToDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.addEventListener('load', () => {
        resolve(typeof reader.result === 'string' ? reader.result : '');
      });
      reader.addEventListener('error', () => {
        reject(reader.error ?? new Error('Unable to read asset.'));
      });
      reader.readAsDataURL(file);
    });
  }

  private async readHtmlText(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const fallbackText = new TextDecoder('utf-8').decode(buffer);
    const encoding = this.detectDeclaredEncoding(new Uint8Array(buffer));

    if (!encoding || this.isUtf8Encoding(encoding)) {
      return fallbackText;
    }

    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      return fallbackText;
    }
  }

  private detectDeclaredEncoding(bytes: Uint8Array): string | null {
    const header = Array.from(bytes.slice(0, 4096), (byte) =>
      byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ' ',
    ).join('');
    const metaCharset =
      header.match(/<meta[^>]+charset\s*=\s*["']?\s*([^"'\s/>]+)/i)?.[1] ??
      header.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([^"'\s;>]+)/i)?.[1];
    const xmlEncoding = header.match(/<\?xml[^>]+encoding\s*=\s*["']([^"']+)/i)?.[1];

    return metaCharset ?? xmlEncoding ?? null;
  }

  private isUtf8Encoding(encoding: string): boolean {
    return /^utf-?8$/i.test(encoding.trim());
  }

  private findNodeAtPath(doc: Document, path: readonly number[]): Node | null {
    let node: Node = doc;

    for (const index of path) {
      const child = node.childNodes.item(index);

      if (!child) {
        return null;
      }

      node = child;
    }

    return node;
  }

  private injectPreviewEditor(html: string): string {
    const bridge = this.previewEditorBridge();

    if (/<\/body\s*>/i.test(html)) {
      return html.replace(/<\/body\s*>/i, `${bridge}</body>`);
    }

    return `${html}${bridge}`;
  }

  private previewEditorBridge(): string {
    return `<script>
(function () {
  var source = 'web-drafty-preview';
  var skipTags = {
    SCRIPT: true,
    STYLE: true,
    TEXTAREA: true,
    INPUT: true,
    SELECT: true,
    OPTION: true,
    NOSCRIPT: true
  };

  function isEditableTextNode(node) {
    return node && node.nodeType === Node.TEXT_NODE && node.data.trim().length > 0;
  }

  function firstEditableTextNode(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node = walker.nextNode();

    while (node) {
      if (isEditableTextNode(node)) {
        return node;
      }

      node = walker.nextNode();
    }

    return null;
  }

  function textNodeFromPoint(event) {
    var target = event.target;

    if (!target || skipTags[target.tagName]) {
      return null;
    }

    if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(event.clientX, event.clientY);

      if (position && isEditableTextNode(position.offsetNode)) {
        return position.offsetNode;
      }
    }

    if (document.caretRangeFromPoint) {
      var range = document.caretRangeFromPoint(event.clientX, event.clientY);

      if (range && isEditableTextNode(range.startContainer)) {
        return range.startContainer;
      }
    }

    return firstEditableTextNode(target);
  }

  function pathForNode(node) {
    var path = [];

    while (node && node !== document) {
      var parent = node.parentNode;

      if (!parent) {
        return [];
      }

      path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
      node = parent;
    }

    return path;
  }

  function requestTextEdit(event) {
    var node = textNodeFromPoint(event);

    if (!node) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    parent.postMessage(
      {
        source: source,
        type: 'edit-text',
        path: pathForNode(node),
        value: node.data
      },
      '*'
    );
  }

  document.addEventListener('dblclick', requestTextEdit, true);
  document.addEventListener('contextmenu', requestTextEdit, true);
  document.documentElement.style.cursor = 'text';
})();
</script>`;
  }

  private toRawAsset(file: File, baseDirectory: string): RawAsset | null {
    const absolutePath = this.getFilePath(file);
    const path = this.stripBaseDirectory(absolutePath, baseDirectory);

    if (!path || this.isHtmlPath(path)) {
      return null;
    }

    return {
      path,
      file,
    };
  }

  private pickHtmlFile(files: readonly File[]): File | null {
    const htmlFiles = files
      .filter((file) => this.isHtmlPath(this.getFilePath(file)))
      .sort((left, right) => {
        const leftDepth = this.getFilePath(left).split('/').length;
        const rightDepth = this.getFilePath(right).split('/').length;

        return (
          leftDepth - rightDepth || this.getFilePath(left).localeCompare(this.getFilePath(right))
        );
      });

    return htmlFiles[0] ?? null;
  }

  private getFilePath(file: File): string {
    return this.normalizePath(file.webkitRelativePath || file.name);
  }

  private stripBaseDirectory(path: string, baseDirectory: string): string {
    if (!baseDirectory) {
      return path;
    }

    const prefix = `${baseDirectory}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }

  private normalizePath(path: string): string {
    const segments: string[] = [];

    for (const segment of path.replace(/\\/g, '/').split('/')) {
      if (!segment || segment === '.') {
        continue;
      }

      if (segment === '..') {
        segments.pop();
        continue;
      }

      segments.push(segment);
    }

    return segments.join('/');
  }

  private getDirectoryPath(path: string): string {
    const normalizedPath = this.normalizePath(path);
    const lastSlash = normalizedPath.lastIndexOf('/');

    return lastSlash === -1 ? '' : normalizedPath.slice(0, lastSlash);
  }

  private basename(path: string): string {
    const normalizedPath = this.normalizePath(path);
    const lastSlash = normalizedPath.lastIndexOf('/');

    return lastSlash === -1 ? normalizedPath : normalizedPath.slice(lastSlash + 1);
  }

  private isHtmlPath(path: string): boolean {
    return /\.html?$/i.test(path);
  }

  private isCssPath(path: string): boolean {
    return /\.css(?:[?#].*)?$/i.test(path);
  }

  private isStylesheetLink(link: HTMLLinkElement): boolean {
    const rel = link.getAttribute('rel') ?? '';

    return rel.split(/\s+/).some((token) => token.toLowerCase() === 'stylesheet');
  }

  private isTextLikeScript(script: HTMLScriptElement): boolean {
    const type = script.getAttribute('type');

    return !type || /^(?:module|text\/javascript|application\/javascript)$/i.test(type);
  }

  private isExternalReference(value: string): boolean {
    return (
      value.startsWith('#') ||
      value.startsWith('data:') ||
      value.startsWith('blob:') ||
      value.startsWith('mailto:') ||
      value.startsWith('tel:') ||
      value.startsWith('javascript:') ||
      /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    );
  }

  private firstSuffixIndex(value: string): number {
    const queryIndex = value.indexOf('?');
    const hashIndex = value.indexOf('#');

    if (queryIndex === -1) {
      return hashIndex;
    }

    if (hashIndex === -1) {
      return queryIndex;
    }

    return Math.min(queryIndex, hashIndex);
  }

  private decodePath(path: string): string {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  }

  private parseHtml(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  private serializeHtml(doc: Document): string {
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  }

  private createObjectUrl(blob: Blob): string {
    const objectUrl = URL.createObjectURL(blob);
    this.objectUrls.add(objectUrl);

    return objectUrl;
  }
}
