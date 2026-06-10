# WebDrafty Architecture

WebDrafty is an Angular single-page app for opening, editing, previewing, and exporting standalone HTML webpages. It supports two common inputs:

- A single `.html` / `.htm` file.
- A saved webpage pair such as `Sample Page.html` plus `Sample Page_files/`.

The app keeps the source HTML in Angular signal state, renders a live preview in a sandboxed iframe, and can export either a single inlined HTML file or a ZIP with the HTML and resource folder.

## Main Packages

### `@codemirror/state`

Used for CodeMirror editor state. It stores the current document content, editor extensions, selections, history state, and transactions.

In WebDrafty, it creates the initial editor document from the loaded HTML:

```ts
EditorState.create({
  doc: this.htmlSource(),
  extensions: this.editorExtensions(),
});
```

### `@codemirror/view`

Used to render the editor UI in the Angular component. It provides `EditorView`, line numbers, selection drawing, active-line highlighting, update listeners, editor themes, and wrapping.

WebDrafty uses it to:

- Mount the editor into the HTML pane.
- Listen for document changes.
- Push editor changes back into the `htmlSource` signal.
- Apply editor styling consistent with the app.

### `@codemirror/lang-html`

Used for HTML language support in the editor. It provides HTML parsing and editor behavior, so the code side understands HTML structure better than a plain text area.

This helps with editing real HTML documents, including large table-based pages such as invoices.

### `@codemirror/commands`

Used for common editor commands and keymaps. WebDrafty uses default commands, undo/redo history commands, and tab indentation support.

Examples:

- `defaultKeymap`
- `history`
- `historyKeymap`
- `indentWithTab`

### `@codemirror/search`

Used for editor search support. It provides search-related keymaps and selection match highlighting.

This lets users search inside large HTML files more naturally while editing source code.

### `jszip`

Used for ZIP export when the user wants normal HTML plus a resource folder instead of one self-contained HTML file.

For folder export, WebDrafty creates a ZIP containing:

- The edited HTML file.
- Each loaded asset at its original relative path, for example `Sample Page_files/logo.png`.

## HTML And Asset Loading

The loader supports two browser-save patterns.

First, the user can open a parent folder that contains:

```text
Sample Page.html
Sample Page_files/
```

The app picks the HTML file and detects the matching `_files` folder. Asset paths are kept relative to the HTML, so a reference like:

```html
<img src="./Sample Page_files/logo.png" />
```

maps to:

```text
Sample Page_files/logo.png
```

Second, the user can open the HTML file first, then open only the `_files` folder. In that case, the app attaches those assets to the current HTML document.

For preview reliability inside the iframe, local assets are converted to `data:` URLs. This avoids sandbox and object URL issues while keeping the original saved/exported paths intact.

## Live Preview

The preview is rendered using an iframe with `srcdoc`. Angular normally sanitizes HTML bindings, which can break legacy HTML that depends on inline styles and old table attributes.

To preserve common saved webpages, WebDrafty marks the preview HTML as trusted for this sandboxed iframe:

```ts
this.sanitizer.bypassSecurityTrustHtml(this.previewSource());
```

The iframe still uses sandboxing:

```html
<iframe sandbox="allow-forms allow-modals allow-popups allow-scripts"></iframe>
```

This keeps the preview isolated from the Angular app while still allowing real webpage behavior where needed.

## Edit Preview Mode

Edit Preview mode lets the user edit rendered text without hunting through raw HTML.

When edit mode is active, WebDrafty injects a small preview-only bridge script into the iframe document. This script is not saved into the exported HTML. It only exists in the live preview.

The bridge listens for:

- `dblclick`
- `contextmenu`

When the user double-clicks or right-clicks visible text, the bridge:

1. Finds the nearest editable text node under the pointer.
2. Builds a DOM path to that text node.
3. Sends the selected text and path to the Angular app with `postMessage`.

The message shape is:

```ts
{
  source: 'web-drafty-preview',
  type: 'edit-text',
  path: number[],
  value: string
}
```

Angular receives the message, opens the text edit dialog, and focuses the textarea. When the user applies the change, WebDrafty parses the current source HTML, finds the same text node by path, updates its text content, serializes the HTML, and updates CodeMirror.

That means preview edits still become normal source edits, and saving uses the updated HTML.

## Export Modes

### Save single HTML

This is the default export. When assets exist, WebDrafty inlines them as `data:` URLs where possible:

- Images become data URI references.
- Linked CSS can be inlined into `<style>`.
- Local script files can be inlined when they are text-like JavaScript.

### Save folder ZIP

This export keeps the HTML and assets separate. WebDrafty uses JSZip to produce a ZIP containing the edited HTML plus all loaded asset files under their original relative paths.

This is useful when the user wants a normal browser-saved webpage structure.
