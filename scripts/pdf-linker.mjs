/*
PDF-PAGER

Copyright © 2022 Martin Smith

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

import { PDFCONFIG } from './pdf-config.mjs'

/**
 * Handle @PDF links inline:
 * 
 * @PDF[bookname|page=xxx]{label}
 * 
 * or the newer format
 * 
 * @PDF[journal|bookname|page=xxx]{label}
 * 
 * (The first format assumes that the journal has the same name as bookname)
 * 
 * If the PDF is not available then the link is replaced by just the label, with no sign of a broken link.
 */

/**
 * Enrich the generated HTML to show a link or just plain text
 */

 const pattern = /@PDF\[([^|#\]]+)(?:#([^\|\]]+))?(?:\|([^\]]+))?\]{([^}]*)}/g;

 Hooks.once('ready', () => {
    // Fields on Actors and Items call enrichHTML with async=false
	libWrapper.register(PDFCONFIG.MODULE_NAME, 'TextEditor.enrichHTML', TextEditor_enrichHTML, libWrapper.WRAPPER);
	libWrapper.register(PDFCONFIG.MODULE_NAME, 'JournalEntryPage.prototype._createDocumentLink', JournalEntryPage_createDocumentLink, libWrapper.MIXED);

    // The TextEditor.encrichers only works when enrichHTML is called with async=true
    CONFIG.TextEditor.enrichers.push({pattern, enricher});
})

function getAnchor(match) {
    // the pattern will put the page into p2 if only bookname is provided
    const [ matches, journalname, pagename=journalname, pagenum, label] = match;

    // Find the relevant PAGE in the relevant JOURNAL ENTRY
    for (const journal of game.journal.contents) {
        if (journal.name === journalname) {
            let page = journal.pages.find(page => page.type === 'pdf' && page.name === pagename);
            if (page) {
                let attrs = {draggable: true};
                if (pagenum) attrs["data-hash"] = pagenum;
                return page.toAnchor({
                    classes: ["content-link"],
                    attrs,
                    name: label
                });
            }
        }
    }
    // Failed to find a page within a journal with the given name.
    console.debug(`PDF-PAGER: failed to find page called '${pagename}' inside journal '${journalname}'`)
    return null;
}

/**
 * Hooked directly into TextEditor.enrichHTML to cope with async=false
 * @param {} wrapped 
 * @param {*} content 
 * @param {*} options 
 * @returns 
 */
function TextEditor_enrichHTML(wrapped, content, options) {
    let text = content;
    if (!options.async && text?.length && text.includes('@PDF[')) {
        text = text.replaceAll(pattern, (match, p1, p2, /*p3*/pagenum, /*p4*/label, options, groups) => {
            const anchor = getAnchor([match, p1, p2, pagenum, label]);
            return anchor ? anchor.outerHTML : label;
        });
    }
    return wrapped(text, options);
}

/**
 * Registered with PDFCONFIG.TextEditor.enrichers to cope with async=true (not strictly necessary at this time)
 * @param {*} match 
 * @param {*} options 
 * @returns 
 */
async function enricher(match, options) {
    return getAnchor(match) || match[4];
}

/**
 * Wraps JournalEntryPage.prototype._createDocumentLink in order to create @PDF links
 * when dropping a PDF journal page into another object.
 * 
 * @param {function} wrapped the original JournalEntryPage.prototype._createDocumentLink
 * @param {Object}} eventData first parameter for JournalEntryPage.prototype._createDocumentLink
 * @param {Object} args second parameter for JournalEntryPage.prototype._createDocumentLink
 * @returns 
 */
function JournalEntryPage_createDocumentLink(wrapped, eventData, args) {
    // Always convert slug for PDF into encoded-URI format
    if (this.type === 'pdf' && eventData?.anchor?.slug)
        eventData.anchor.slug = encodeURIComponent(eventData.anchor.slug);

    if (this.type !== 'pdf' || !game.settings.get(PDFCONFIG.MODULE_NAME, PDFCONFIG.CREATE_PDF_LINK_ON_DROP)) 
        return wrapped(eventData, args);
    else {
        let slug,label;
        if (eventData?.anchor?.slug) {
            // Use slug of section name
            label = eventData.anchor.name;
            slug = eventData.anchor.slug;
        } else {
            // Use page=xxx as slug
            let pagenum=1;
            let sheet = this.parent?.sheet;  // JournalEntry
            if (sheet && sheet._pages[sheet.pageIndex]._id == this.id)
            {
                let iframe = sheet.element?.find('iframe');
                if (iframe?.length>0) {
                    // Read current page from PDF viewer, then remove the user-configured offset from that number.
                    pagenum = iframe[0].contentWindow.PDFViewerApplication.page - (this.getFlag(PDFCONFIG.MODULE_NAME, PDFCONFIG.FLAG_OFFSET) ?? 0);
                }
            }
            slug = `page=${pagenum}`
            label = this.name;
        }
        // If journal and page have same name, only put the name in once.
        const fullname = (this.parent.name === this.name) ? this.name : `${this.parent.name}#${this.name}`;
        return `@PDF[${fullname}|${slug}]{${label}}`;
    }
}