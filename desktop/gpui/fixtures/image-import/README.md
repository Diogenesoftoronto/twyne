These are technical codec fixtures, not Twyne artwork. Run `bun generate-images.ts`
from this directory to regenerate the tiny PNG/JPEG/GIF/WebP fixtures, rotated
EXIF JPEG, and animated GIF/WebP/APNG. The generator uses the installed Sharp
version plus explicit APNG chunks; Rust and Chrome both validate the output.

Run `bun capture-web.ts` to regenerate `web-reference.json`. It executes the
current original offline image-upload adapter with the browser's real FileReader,
the installed Tiptap editor, and the actual ImageNode/insertImageFiles extension.
Every network request is blocked. The reference records ready node attributes,
original-byte data URLs, natural image dimensions, and serialized web HTML.

Native imports retain the same ready image fields and portable data-\* attributes.
The original Tiptap HTML additionally mirrors raw src/alt/caption/alignment/width/
aspectratio/offline/uploadid/uploadstatus onto the figure. Native new images keep
the portable attributes without creating raw mirrors that would become stale
during later inspector edits. Existing imported mirrors remain source metadata.
This HTML shape difference is a current fidelity gap.

The native import limit is the original 10 MiB compressed-file boundary. Additional
native limits are 16,384 pixels per edge, 32 megapixels per frame, 256 MiB decoder
allocation (best effort as documented by image), 256 animation frames, and 128
megapixels cumulatively across animation frames. All original encoded bytes remain
in the document; these checks do not recompress, rotate, or flatten the payload.
Caller-owned document insertion must additionally fit the total projection/import
budget and active folio/revision/selection guards before mutating the document.

The executed boundary test preserves an exact 10 MiB PNG payload through native
HTML reopen: 13,981,515 bytes of portable HTML, or 27,962,560 with the browser's
duplicated raw src mirror. The original packaged document converter rejects that
payload with `Typst document exceeds the 5 MB editing limit.` Its canonical-source
limit remains authoritative; the application must preflight actual conversion
before insertion. The accepted 1 MiB fixture instead survives actual original
fromHtml/reconcile/project and native reopen with byte-identical data URL and
canonical source: 1,398,611 bytes of HTML, 2,804,615 of source, and a 4,203,864-byte
reconciliation request. File-upload, HTML and canonical-source limits are separate.

Pinned GPUI applies EXIF orientation for static raster images. The rotated JPEG's
browser natural dimensions are 2 by 3, matching actual native RenderImage pixels.
The existing embedded Image::to_image_data path animates GIF, but displays a static
frame for WebP and APNG. The importer validates all frames and preserves their
original bytes; validation does not establish animated display parity for those
two existing consumer paths. This is a current rendering gap.
