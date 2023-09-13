// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ActivityMonitor, PathExt } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { Message } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { TOCItem } from './toc_item';
import { TOCTree } from './toc_tree';
import { IHeading, ITableOfContentsRegistry as Registry } from './tokens';

/**
 * Timeout for throttling ToC rendering.
 *
 * @private
 */
const RENDER_TIMEOUT = 1000;

/**
 * Widget for hosting a notebook table of contents.
 */
export class TableOfContents extends Widget {
  /**
   * Returns a new table of contents.
   *
   * @param options - options
   * @returns widget
   */
  constructor(options: TableOfContents.IOptions) {
    super();
    this.translator = options.translator || nullTranslator;
    this._docmanager = options.docmanager;
    this._rendermime = options.rendermime;
    this._trans = this.translator.load('jupyterlab');
    this._headings = [];
    this._entryClicked = new Signal<TableOfContents, TOCItem>(this);
    this._entryClicked.connect((toc, item) => {
      this.activeEntry = item.props.heading;
    });
    if (this._current) {
      this._headings = this._current.generator.generate(
        this._current.widget,
        this._current.generator.options
      );
    }
  }

  /**
   * Current widget-generator tuple for the ToC.
   */
  get current(): TableOfContents.ICurrentWidget | null {
    return this._current;
  }
  set current(value: TableOfContents.ICurrentWidget | null) {
    // If they are the same as previously, do nothing...
    if (
      value &&
      this._current &&
      this._current.widget === value.widget &&
      this._current.generator === value.generator
    ) {
      return;
    }
    if (this._current) {
      this._current.widget.disposed.disconnect(this._onWidgetDisposed, this);
    }

    this._current = value;

    if (this._current) {
      this._current.widget.disposed.connect(this._onWidgetDisposed, this);
    }

    if (this.generator) {
      if (this.generator.toolbarGenerator) {
        this._toolbar = this.generator.toolbarGenerator();
      } else {
        this._toolbar = null;
      }
    }
    // Dispose an old activity monitor if one existed...
    if (this._monitor) {
      this._monitor.dispose();
      this._monitor = null;
    }
    // If we are wiping the ToC, update and return...
    if (!this._current) {
      this.update();
      return;
    }
    // Find the document model associated with the widget:
    const context = this._docmanager.contextForWidget(this._current.widget);
    if (!context || !context.model) {
      throw Error('Could not find a context for the Table of Contents');
    }
    // Throttle the rendering rate of the table of contents:
    this._monitor = new ActivityMonitor({
      signal: context.model.contentChanged,
      timeout: RENDER_TIMEOUT
    });
    this._monitor.activityStopped.connect(this.update, this);
    this.update();
  }

  /**
   * Callback invoked upon widget disposal.
   *
   * @param _widget - widget
   */
  private _onWidgetDisposed(_widget: Widget) {
    // when the widget is disposed, dispose from the toc widget (calling the _current setter)
    this.current = null;
  }

  /**
   * Current table of contents generator.
   *
   * @returns table of contents generator
   */
  get generator(): Registry.IGenerator<Widget> | null {
    if (this._current) {
      return this._current.generator;
    }
    return null;
  }

  /**
   * Callback invoked upon an update request.
   *
   * @param msg - message
   */
  protected onUpdateRequest(msg: Message): void {
    let title = this._trans.__('Table of Contents');
    if (this._current) {
      this._headings = this._current.generator.generate(
        this._current.widget,
        this._current.generator.options
      );
      const context = this._docmanager.contextForWidget(this._current.widget);
      if (context) {
        title = PathExt.basename(context.localPath);
      }
    }
    let itemRenderer: (
      item: IHeading,
      toc: IHeading[]
    ) => JSX.Element | null = (item: IHeading) => {
      return <span>{item.text}</span>;
    };
    if (this._current && this._current.generator.itemRenderer) {
      itemRenderer = this._current.generator.itemRenderer!;
    }
    let jsx;
    if (this._current && this._current.generator) {
      jsx = (
        <TOCTree
          title={title}
          toc={this._headings}
          entryClicked={this._entryClicked}
          generator={this.generator}
          itemRenderer={itemRenderer}
          toolbar={this._toolbar}
        />
      );
    } else {
      jsx = (
        <div className="jpcodetoc-TableOfContents">
          <div className="jpcodetoc-stack-panel-header">{title}</div>
          <div></div>
          <div className="jpcodetoc-TableOfContents-placeholder">
            <div className="jpcodetoc-TableOfContents-placeholderContent">
              <h3>No Widget Selected</h3>
              <p>
                Open a notebook, or a file (Markdown, Python or LaTeX supported)
                to see its table of contents.
              </p>
            </div>
          </div>
        </div>
      );
    }
    ReactDOM.render(jsx, this.node, () => {
      if (
        this._current &&
        this._current.generator.usesLatex === true &&
        this._rendermime.latexTypesetter
      ) {
        this._rendermime.latexTypesetter.typeset(this.node);
      }
    });
  }

  /**
   * Current active entry.
   *
   * @returns table of contents active entry
   */
  get activeEntry(): IHeading {
    return this._activeEntry;
  }

  set activeEntry(value: IHeading) {
    this._activeEntry = value;
  }

  /**
   * List of headings.
   *
   * @returns table of contents list of headings
   */
  get headings(): IHeading[] {
    return this._headings;
  }

  /**
   * Callback invoked to re-render after showing a table of contents.
   *
   * @param msg - message
   */
  protected onAfterShow(msg: Message): void {
    this.update();
  }

  private translator: ITranslator;
  private _activeEntry: IHeading = { text: '', level: 0, onClick: () => {} };
  private _entryClicked?: Signal<TableOfContents, TOCItem>;
  private _trans: TranslationBundle;
  private _toolbar: any;
  private _rendermime: IRenderMimeRegistry;
  private _docmanager: IDocumentManager;
  private _current: TableOfContents.ICurrentWidget | null = null;
  private _monitor: ActivityMonitor<any, any> | null = null;
  private _headings: IHeading[];
}

/**
 * A namespace for TableOfContents statics.
 */
export namespace TableOfContents {
  /**
   * Interface describing table of contents widget options.
   */
  export interface IOptions {
    /**
     * Application document manager.
     */
    docmanager: IDocumentManager;

    /**
     * Application rendered MIME type.
     */
    rendermime: IRenderMimeRegistry;

    /**
     * Application language translator.
     */
    translator?: ITranslator;
  }

  /**
   * Interface describing the current widget.
   */
  export interface ICurrentWidget<W extends Widget = Widget> {
    /**
     * Current widget.
     */
    widget: W;

    /**
     * Table of contents generator for the current widget.
     */
    generator: Registry.IGenerator<W>;
  }
}
