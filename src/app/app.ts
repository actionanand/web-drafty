import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, Extension } from '@codemirror/state';
import {
  EditorView,
  ViewUpdate,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import {
  HtmlWorkspaceService,
  PreviewTextEditRequest,
  ResourceAsset,
} from './html-workspace.service';

interface TextEditDraft {
  readonly path: readonly number[];
  readonly originalValue: string;
  readonly value: string;
}

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'app-shell',
  },
})
export class App implements AfterViewInit, OnDestroy {
  private readonly workspace = inject(HtmlWorkspaceService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  private readonly textEditInput = viewChild<ElementRef<HTMLTextAreaElement>>('textEditInput');
  private editorView: EditorView | null = null;
  private readonly handlePreviewMessage = (event: MessageEvent<unknown>): void => {
    this.receivePreviewMessage(event);
  };

  protected readonly fileName = signal('index.html');
  protected readonly htmlSource = signal(this.workspace.starterHtml);
  protected readonly assets = signal<readonly ResourceAsset[]>([]);
  protected readonly statusMessage = signal('Ready');
  protected readonly isBusy = signal(false);
  protected readonly editMode = signal(true);
  protected readonly textEditDraft = signal<TextEditDraft | null>(null);
  private readonly previewSource = computed(() =>
    this.workspace.buildPreviewHtml(this.htmlSource(), this.assets(), this.editMode()),
  );
  protected readonly previewHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.previewSource()),
  );
  protected readonly assetCount = computed(() => this.assets().length);
  protected readonly documentStats = computed(() => {
    const html = this.htmlSource();
    const characters = html.length.toLocaleString();
    const lines = html.split('\n').length.toLocaleString();

    return `${lines} lines / ${characters} chars`;
  });

  ngAfterViewInit(): void {
    window.addEventListener('message', this.handlePreviewMessage);
    this.editorView = new EditorView({
      parent: this.editorHost().nativeElement,
      state: EditorState.create({
        doc: this.htmlSource(),
        extensions: this.editorExtensions(),
      }),
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.handlePreviewMessage);
    this.editorView?.destroy();
    this.workspace.releasePreviewUrls();
  }

  protected async openHtmlFile(event: Event): Promise<void> {
    const file = this.firstInputFile(event);

    if (!file) {
      return;
    }

    await this.runTask(async () => {
      this.workspace.releasePreviewUrls();
      const project = await this.workspace.createProjectFromHtmlFile(file);
      this.loadProject(project.fileName, project.html, project.assets);
      this.statusMessage.set(`Opened ${project.fileName}`);
    });
    this.resetInput(event);
  }

  protected async openHtmlFolder(event: Event): Promise<void> {
    const files = this.inputFiles(event);

    if (files.length === 0) {
      return;
    }

    await this.runTask(async () => {
      this.workspace.releasePreviewUrls();
      const project = await this.workspace.createProjectFromFolder(files);
      this.loadProject(project.fileName, project.html, project.assets);
      this.statusMessage.set(`Opened ${project.fileName} with ${project.assets.length} assets`);
    });
    this.resetInput(event);
  }

  protected updateFileName(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fileName.set(input.value);
  }

  protected async saveSingleHtml(): Promise<void> {
    await this.runTask(async () => {
      const html = await this.workspace.buildSingleFileHtml(this.htmlSource(), this.assets());
      const fileName = this.workspace.ensureHtmlFileName(this.fileName());
      this.downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), fileName);
      this.statusMessage.set(`Saved ${fileName}`);
    });
  }

  protected async saveFolderZip(): Promise<void> {
    await this.runTask(async () => {
      const htmlFileName = this.workspace.ensureHtmlFileName(this.fileName());
      const zipFileName = this.workspace.zipFileName(htmlFileName);
      const blob = await this.workspace.buildFolderZip(
        htmlFileName,
        this.htmlSource(),
        this.assets(),
      );
      this.downloadBlob(blob, zipFileName);
      this.statusMessage.set(`Saved ${zipFileName}`);
    });
  }

  protected assetTrackBy(_index: number, asset: ResourceAsset): string {
    return asset.path;
  }

  protected toggleEditMode(): void {
    this.editMode.update((isEnabled) => !isEnabled);
    this.textEditDraft.set(null);
    this.statusMessage.set(
      this.editMode() ? 'Edit mode on: double-click or right-click preview text' : 'Edit mode off',
    );
  }

  protected updateTextEditValue(event: Event): void {
    const input = event.target as HTMLTextAreaElement;
    const draft = this.textEditDraft();

    if (!draft) {
      return;
    }

    this.textEditDraft.set({
      ...draft,
      value: input.value,
    });
  }

  protected applyTextEdit(): void {
    const draft = this.textEditDraft();

    if (!draft) {
      return;
    }

    try {
      const html = this.workspace.replaceTextAtPath(this.htmlSource(), draft.path, draft.value);
      this.setHtmlSource(html);
      this.textEditDraft.set(null);
      this.statusMessage.set('Preview text updated');
    } catch (error: unknown) {
      this.statusMessage.set(
        error instanceof Error ? error.message : 'Unable to update that text.',
      );
    }
  }

  protected cancelTextEdit(): void {
    this.textEditDraft.set(null);
    this.statusMessage.set('Text edit cancelled');
  }

  private editorExtensions(): Extension[] {
    return [
      lineNumbers(),
      foldGutter(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      indentOnInput(),
      html(),
      placeholder('Start writing HTML...'),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...closeBracketsKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          this.htmlSource.set(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '0.95rem',
          backgroundColor: '#ffffff',
          color: '#17202a',
        },
        '.cm-scroller': {
          fontFamily:
            '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
          lineHeight: '1.55',
        },
        '.cm-gutters': {
          backgroundColor: '#f5f7f9',
          borderRight: '1px solid #d7dee7',
          color: '#697586',
        },
        '.cm-activeLine': {
          backgroundColor: '#eef6f4',
        },
        '.cm-activeLineGutter': {
          backgroundColor: '#dff0ec',
          color: '#163d36',
        },
        '.cm-selectionBackground': {
          backgroundColor: '#c9e7df !important',
        },
        '&.cm-focused': {
          outline: '2px solid #0f766e',
          outlineOffset: '-2px',
        },
      }),
    ];
  }

  private loadProject(fileName: string, html: string, assets: readonly ResourceAsset[]): void {
    this.fileName.set(fileName);
    this.assets.set(assets);
    this.setHtmlSource(html);
    this.textEditDraft.set(null);
  }

  private setHtmlSource(html: string): void {
    this.htmlSource.set(html);

    if (this.editorView) {
      this.editorView.dispatch({
        changes: {
          from: 0,
          to: this.editorView.state.doc.length,
          insert: html,
        },
      });
    }
  }

  private receivePreviewMessage(event: MessageEvent<unknown>): void {
    if (!this.editMode() || !this.isPreviewTextEditRequest(event.data)) {
      return;
    }

    this.textEditDraft.set({
      path: event.data.path,
      originalValue: event.data.value,
      value: event.data.value,
    });
    this.statusMessage.set('Editing preview text');
    window.setTimeout(() => {
      this.textEditInput()?.nativeElement.focus();
    }, 0);
  }

  private isPreviewTextEditRequest(value: unknown): value is PreviewTextEditRequest {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const message = value as Partial<PreviewTextEditRequest>;

    return (
      message.source === 'web-drafty-preview' &&
      message.type === 'edit-text' &&
      Array.isArray(message.path) &&
      message.path.every((item) => Number.isInteger(item) && item >= 0) &&
      typeof message.value === 'string'
    );
  }

  private async runTask(task: () => Promise<void>): Promise<void> {
    this.isBusy.set(true);

    try {
      await task();
    } catch (error: unknown) {
      this.statusMessage.set(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      this.isBusy.set(false);
    }
  }

  private inputFiles(event: Event): File[] {
    const input = event.target as HTMLInputElement;

    return Array.from(input.files ?? []);
  }

  private firstInputFile(event: Event): File | null {
    return this.inputFiles(event)[0] ?? null;
  }

  private resetInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = '';
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.click();

    URL.revokeObjectURL(url);
  }
}
