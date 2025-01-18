/*
PDF-PAGER

Copyright © 2024 Martin Smith

Permission is hereby granted, free of charge, to any person obtaining a copy of this software 
and associated documentation files (the "Software"), to deal in the Software without 
restriction, including without limitation the rights to use, copy, modify, merge, publish, 
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the 
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or 
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, 
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE 
SOFTWARE.
*/

/*
 * When adding a STAMP (image), there a subsequent telemetry report of "inserted_image" which
 * is required to be received before setting the tooltip mode to NONE.
 * 
 * Generated by StampEditor#createCanvas (which is called from StampEditor.render())
 */

import { PDFCONFIG } from './pdf-config.mjs';

// Values for pdfPageMode
const NOT_EDITED = 0;
const IGNORE_EDIT = 1;
const HAS_LOCAL_EDITS = 2;

// Values for uimanager.updateToolbar (pdfjs: src/shared/util.js)
const AnnotationEditorType = {
  DISABLE: -1,
  NONE: 0,
  FREETEXT: 3,
  HIGHLIGHT: 9,
  STAMP: 13,
  INK: 15,
};

function flagName(pageNumber) { return `flags.${PDFCONFIG.MODULE_NAME}.objects.page${pageNumber}` }

let mapping = new Map();


class AnnotationManager {

  constructor(doc, pdfviewerapp, editable) {
    if (CONFIG.debug.pdfpager) console.debug(`AnnotationManager created for ${doc.name}`);
    this.document = doc;
    this.pdfviewerapp = pdfviewerapp;
    this.pdfViewer = pdfviewerapp.pdfViewer;
    this.editable = editable;
    //this.uimanager = undefined;

    // Prevent generating events until we've loaded all the pages.
    this.pdfViewer.pdfPagerMode = IGNORE_EDIT;
    mapping.set(doc, this);

    // Bind callbacks to allow eventBus.off to work
    this.bound_annotationeditoruimanager = this.#setUiManager.bind(this);
    this.bound_annotationeditorlayerrendered = this.#annotationeditorlayerrendered.bind(this);
    this.bound_annotationeditorstateschanged = this.#annotationeditorstateschanged.bind(this);

    // The UIManager is created very early on, and is needed for later loading of manual annotations.
    pdfviewerapp.eventBus.on('annotationeditoruimanager', this.bound_annotationeditoruimanager)
    pdfviewerapp.eventBus.on('annotationeditorlayerrendered', this.bound_annotationeditorlayerrendered);
    if (this.editable) pdfviewerapp.eventBus.on('annotationeditorstateschanged', this.bound_annotationeditorstateschanged)
  } // constructor

  delete() {
    if (CONFIG.debug.pdfpager) console.debug(`AnnotationManager.delete:`, this.document?.name);
    this.pdfviewerapp.eventBus.off('annotationeditoruimanager', this.bound_annotationeditoruimanager);
    this.pdfviewerapp.eventBus.off('annotationeditorlayerrendered', this.bound_annotationeditorlayerrendered);
    if (this.editable) this.pdfviewerapp.eventBus.off('annotationeditorstateschanged', this.bound_annotationeditorstateschanged);
    // Now this object can be safely deleted
    mapping.delete(this.document);
  }

  #setUiManager(event) {
    this.uimanager = event.uiManager;
    if (CONFIG.debug.pdfpager) console.debug(`annotationeditoruimanager:`, this.uimanager);
  }

  #annotationeditorlayerrendered(event) {
    const pageNumber = event.pageNumber;

    if (CONFIG.debug.pdfpager) console.debug(`annotationeditorlayerrendered: page ${pageNumber}`)

    // Prevent loading annotations if editor layer rendered a second time
    const editors = this.uimanager.getEditors(pageNumber - 1);
    if (editors.length > 0) {
      if (CONFIG.debug.pdfpager) console.debug(`annotationeditorlayerrendered: already loaded annotations for page ${pageNumber} - ignoring`);
      return;
    }

    // See pdf.js : PDFViewerApplication._initializeViewerComponents
    // in else part of "annotationEditorMode !== AnnotationEditorType.DISABLE"
    const domdoc = event.source.div.ownerDocument;
    for (const id of ["editorModeButtons", "editorModeSeparator"]) {
      domdoc.getElementById(id)?.classList.toggle("hidden", !this.editable);
    }

    // Prevent #annotationeditorstateschanged from triggering changes
    this.pdfViewer.pdfPagerMode = IGNORE_EDIT;
    this.setPageAnnotations(pageNumber);
    // Allow annotationeditorstateschanged to possibly update the Document's flags
    this.pdfViewer.pdfPagerMode = NOT_EDITED;
  }

  #updateFlags() {
    // Save any manual annotations made to this page.
    let updates = {}

    for (const pdfpageview of this.pdfViewer._pages) {
      if (!pdfpageview.pdfPage || !pdfpageview.annotationLayer) continue;  // during startup

      const editors = [];
      const pageNumber = pdfpageview.pdfPage.pageNumber;

      for (const editor of this.uimanager.getEditors(pageNumber - 1)) {
        const serialized = editor.serialize(/*isForCopying*/ true);
        if (serialized) {
          editors.push(serialized);
        }
      }
      const value = editors.length ? JSON.stringify(editors) : "";

      // setFlag without re-rendering
      const flag = flagName(pageNumber);
      const oldvalue = foundry.utils.getProperty(this.document, flag);

      if (oldvalue != value) {
        if (CONFIG.debug.pdfpager) console.debug(`annotationeditorstateschanged: page ${pageNumber} = ${editors.length} annotations (${value.length} bytes)`);
        foundry.utils.setProperty(updates, flag, value);
      }
    }

    if (CONFIG.debug.pdfpager) console.debug("Annotation updateFlags");
    if (Object.keys(updates).length) this.document.update(updates, { render: false, updatePdfEditors: true });
    this.pdfViewer.pdfPagerMode = NOT_EDITED;
  } // updateFlags

  // Register the debounceUpdates only once
  debounceUpdateFlags = foundry.utils.debounce(this.#updateFlags.bind(this), 250);

  #annotationeditorstateschanged(event) {
    // Don't update the flags if the user hasn't performed any edits yet.
    if (this.pdfViewer.pdfPagerMode == IGNORE_EDIT) return;

    if (event.details.isEditing) {
      if (CONFIG.debug.pdfpager) console.debug(`annotationeditorstateschanged: local editing has been detected`)
      this.pdfViewer.pdfPagerMode = HAS_LOCAL_EDITS;
      return;
    } else if (this.pdfViewer.pdfPagerMode != HAS_LOCAL_EDITS) {
      if (CONFIG.debug.pdfpager) console.debug(`annotationeditorstateschanged: no local edit performed yet`)
      return;
    }

    // The event is generated once, and lists only the currently displayed PDF page.
    // It doesn't account for changes made on other pages of the PDF page,
    // so we have to iterate over all the pages to see which contain actual changes.
    if (CONFIG.debug.pdfpager) console.debug(`annotationeditorstateschanged: setting delay for updateFlags`)
    this.debounceUpdateFlags();
  }

  removePageAnnotations(pageIndex) {
    const pdfpageview = this.pdfViewer._pages[pageIndex];
    if (!pdfpageview) return;
    for (const editor of this.uimanager.getEditors(pageIndex)) {
      editor.remove();
    }
  }

  setPageAnnotations(pageNumber) {
    const value = foundry.utils.getProperty(this.document, flagName(pageNumber));
    if (!value) return;

    if (CONFIG.debug.pdfpager) console.debug(`Loading annotations for page ${pageNumber}`)
    const pasteevent = new ClipboardEvent("copy", { clipboardData: new DataTransfer() });
    pasteevent.clipboardData.setData("application/pdfjs", value);

    const layer = this.uimanager.getLayer(pageNumber - 1);
    if (!layer) return; // They will be loaded when that layer is rendered

    // Prevent annotationeditorstateschanged from updating the Document's flags
    this.uimanager.updateMode(AnnotationEditorType.STAMP);

    // As per AnnotationEditorUIManager.paste
    const data = JSON.parse(value);

    for (const editordata of data) {
      const editor = layer.deserialize(editordata);
      if (editor) {
        // PDFJS will think that this is a paste, and so offset it based on width/height,
        // so fudge the opposite of what rebuild will do because it thinks we are doing a copy/paste.
        // PDFJS, Ink.render() doing `if (this.width) ... setAt <with offset>`
        editor.x -= editor.width;
        editor.y -= editor.height;
        if (CONFIG.debug.pdfpager) console.log("adding editor", editor);
        layer.add(editor);
        editor.unselect(); // Don't show edit options on STAMPs in particular
      }
    }
    this.debounceEndEdit();
  }

  #endEdit() {
    if (CONFIG.debug.pdfpager) console.debug(`endEdit`);
    //this.uimanager.unselectAll();
    this.uimanager.updateMode(AnnotationEditorType.NONE);
  }
  debounceEndEdit = foundry.utils.debounce(this.#endEdit.bind(this), 250);

  updateAnnotations(changed) {
    let changedPages = Object.keys(changed?.flags?.[PDFCONFIG.MODULE_NAME]?.objects ?? {});
    let changes = changedPages.map(key => parseInt(key.slice(4)));  // strip leading "page" from "pageXX"

    // Prevent #annotationeditorstateschanged from triggering changes
    this.pdfViewer.pdfPagerMode = IGNORE_EDIT;
    for (const pageNumber of changes) {
      this.removePageAnnotations(pageNumber - 1);
      this.setPageAnnotations(pageNumber);
    }
    // Allow annotationeditorstateschanged to possibly update the Document's flags
    this.pdfViewer.pdfPagerMode = NOT_EDITED;
  }
} // class AnnotationManager

/**
 * Hook to handle any changes to the displayed document
 * @param {*} doc 
 * @param {*} changed 
 * @param {*} options 
 * @param {*} userId 
 */

function updateAnnotations(doc, changed, options, userId) {

  const sheet = doc.parent?.sheet ?? doc.sheet;
  if (!sheet || !sheet.rendered) {
    // No longer rendered, so remove from the mapping (and delete the handler?)
    if (mapping.has(doc)) {
      if (CONFIG.debug.pdfpager) console.debug(`updateAnnotations: removing AnnotationManager for "${doc.name}"`);
      mapping.get(doc).delete();
    }
    return;
  }

  if (options.updatePdfEditors && game.userId != userId && changed?.flags?.[PDFCONFIG.MODULE_NAME]?.objects) {
    if (CONFIG.debug.pdfpager) console.debug('updateAnnotations', { doc, changed, options, userId });

    const handler = mapping.get(doc);
    if (!handler) return;

    // Just reload the annotations in the affected page
    handler.updateAnnotations(changed);
  }
}


function pageClosed(sheet, html) {
  if (CONFIG.debug.pdfpager) console.debug('pageClosed', { sheet, html });
  for (const [doc, app] of mapping) {
    if (sheet.document === doc || sheet.document == doc.parent) {
      if (CONFIG.debug.pdfpager) console.debug('pageClosed: deleting AnnotationManager');
      app.delete();
      break;
    }
  }
}

let hooks_set;

export async function initAnnotations(doc, pdfviewerapp, editable) {

  new AnnotationManager(doc, pdfviewerapp, editable);

  if (!hooks_set) {
    hooks_set = true;
    if (CONFIG.debug.pdfpager) console.debug('initAnnotations: hooks set');
    Hooks.on('updateJournalEntryPage', updateAnnotations);
    Hooks.on('updateActor', updateAnnotations);
    Hooks.on('updateItem', updateAnnotations);
    Hooks.on('closeJournalSheet', pageClosed);
    Hooks.on('closeJournalPDFPageSheet', pageClosed);
  }
}

/**
 * When initEditor isn't being used (because editing of form-fillable PDFs is disabled),
 * this function will initialize annotation editing separately.
 * @param {*} html 
 * @param {*} id_to_display 
 * @returns 
 */
export async function setupAnnotations(html, id_to_display) {

  const doc = (id_to_display.includes('.') && await fromUuid(id_to_display)) || game.actors.get(id_to_display) || game.items.get(id_to_display);
  if (!doc) return;

  html.on('load', async (event) => {

    // Wait for PDF to initialise before attaching to event bus.
    const pdfviewerapp = event.target.contentWindow.PDFViewerApplication;
    await pdfviewerapp.initializedPromise;

    const editable = doc.isOwner &&
      (!doc.pack || !game.packs.get(doc.pack)?.locked) &&
      (!doc.parent?.pack || !game.packs.get(doc.parent.pack)?.locked);
    initAnnotations(doc, pdfviewerapp, editable);
  })
}