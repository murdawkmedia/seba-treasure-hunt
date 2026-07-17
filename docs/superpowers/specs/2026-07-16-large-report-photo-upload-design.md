# Large Report Photo Upload Design

**Date:** July 16, 2026

**Status:** Approved design

**Target:** Validation first; production requires separate approval

## Purpose

Let hunters attach ordinary high-resolution phone photographs to private
reports without unexplained rejection. Preserve the current private-upload and
operator-review workflow while handling supported source files larger than
20 MB through browser-side optimization.

## Accepted File Contract

- Up to three JPEG, PNG or WebP images per report.
- A source file of 20,000,000 bytes or less uploads directly.
- A supported source file over 20,000,000 and up to 50,000,000 bytes is
  optimized in the browser before upload.
- A source file over 50,000,000 bytes is rejected before decoding with a clear
  filename-specific message.
- Every uploaded file must be at most 20,000,000 bytes after optimization.
- The combined uploaded payload must be at most 30,000,000 bytes after
  optimization.
- User-facing sizes use decimal **MB**, not MiB.
- HEIC and HEIF remain unsupported in this lowest-lift release. The interface
  explains how to choose or export a JPEG instead.

The server remains authoritative. Client checks improve the experience but do
not weaken MIME, count, size, dimension or pixel-count validation.

## Browser Optimization Pipeline

Files are processed sequentially to limit memory pressure on phones and older
browsers. Files at or below 20 MB bypass recompression and retain the existing
direct-upload path.

For a larger supported file, the client:

1. validates filename, declared MIME type and source size;
2. decodes the image using an orientation-aware browser API;
3. scales it so the longest edge is approximately 2560 pixels without
   upscaling;
4. draws it to a temporary canvas;
5. encodes a web-quality WebP, with a compatible JPEG fallback where needed;
6. checks the generated blob size;
7. retries with bounded reductions in quality and dimensions until the result
   is at most 20 MB;
8. records the optimized blob as the upload candidate;
9. releases image bitmaps, canvas backing storage and temporary object URLs.

The pipeline stops rather than producing an unusably degraded image. Its
minimum output target is approximately 1600 pixels on the longest edge with a
reasonable web-photo quality floor. If a file cannot meet the upload contract
within those bounds, the client explains that it could not safely prepare that
photo and asks the hunter to choose another copy.

Canvas output naturally removes embedded metadata from the uploaded copy,
including most EXIF location data. The original file on the hunter's device is
never changed or deleted. Only the temporary optimized copy is submitted.

## Upload and Storage Flow

The optimized blob enters the existing private report-upload flow:

1. the report record is created through the established authenticated or
   guest-report path;
2. the client uploads each accepted image to the private upload endpoint;
3. the server streams it into private R2 storage;
4. the existing media job creates the standard web derivative;
5. Ops reviews the report and decides separately whether an approved image may
   be published.

Browser optimization does not make evidence public, auto-approve media or
change the existing publication-default-off rule. The browser-produced file is
the private source retained by this workflow; the original device file is not
uploaded for larger sources.

Server, media-worker and user-facing limits are updated consistently to the
20 MB per-file contract. The request remains comfortably below Cloudflare's
platform request limit, while the file passed to the Cloudflare Images binding
does not exceed its 20 MB input limit.

Uploads receive a mobile-tolerant timeout and use an abortable request. A
failed upload does not silently clear the completed report fields.

## Interface Behavior

The report form states the contract before selection:

> Add up to three JPEG, PNG or WebP photos. Photos up to 20 MB upload directly;
> larger photos up to 50 MB will be optimized on this device.

During preparation, each file displays an independent state:

- **Checking photo…**
- **Optimizing 27.4 MB photo…**
- **Ready — reduced to 3.2 MB**
- **Uploading 1 of 3…**
- **Uploaded**
- **Could not prepare this photo** with a specific recovery instruction.

The submit action is disabled only while a required preparation or upload step
is active. Hunters may remove a pending file or cancel processing. Processing
one file does not erase successfully prepared siblings.

Errors identify the affected filename and distinguish:

- unsupported file type;
- source larger than 50 MB;
- browser unable to decode the image;
- browser unable to create an acceptable optimized copy;
- more than three images;
- optimized files exceeding the 30 MB combined limit;
- network timeout or interruption;
- server-side type, size, dimension or pixel rejection.

On a report-level failure, entered name, email, waypoint, message, callback
phone and consent state remain visible so the hunter can correct the problem.
On success, the existing confirmation view and report reference number remain
visible and the form is not presented as a silent reset.

## Compatibility and Accessibility

- The pipeline uses progressive enhancement. Direct files at or below 20 MB
  continue working even if the optimization API is unavailable.
- A browser that cannot optimize a larger source receives a clear manual
  recovery path instead of an upload attempt that will fail later.
- Progress and errors use a polite live region and are not conveyed by colour
  alone.
- Remove and Cancel controls are keyboard reachable and have accessible names.
- Status changes do not steal focus.
- Touch targets remain at least 44 by 44 CSS pixels.
- The form remains usable at 200% zoom and on narrow mobile viewports.

## Failure and Resource Handling

- Process only one large file at a time.
- Abort stale work when a file is removed or the page is unloaded.
- Revoke object URLs and release decoded image resources after every success,
  failure or cancellation.
- Use bounded retries; never loop indefinitely to chase a target size.
- Preserve prepared blobs in memory for an in-page retry after a network
  failure, but do not persist private photos to local storage or IndexedDB.
- Revalidate the final file on the server regardless of client status.
- Never fall back to uploading an oversized original.

## Testing and Acceptance

Implementation follows test-driven development. Automated coverage will
include:

- 20 MB boundary behavior using decimal bytes;
- direct upload below and at the boundary;
- browser optimization above 20 MB;
- rejection above 50 MB before decode;
- output dimensions, orientation and bounded quality retries;
- WebP encoding and compatible fallback behavior;
- sequential processing for multiple large files;
- three-file and 30 MB combined limits;
- accurate MB copy throughout source and rendered output;
- unsupported HEIC/HEIF guidance;
- decode, canvas, encoding, timeout, cancellation and server failures;
- field preservation after preparation or upload errors;
- successful confirmation and report reference behavior;
- server and media-worker enforcement at 20 MB;
- private R2 storage and publication-off-by-default invariants;
- keyboard, live-region, 200%-zoom and mobile-layout behavior;
- release of temporary browser resources.

Validation end-to-end testing will use representative small, 20 MB boundary,
larger compressible, incompressible/invalid and over-50 MB fixtures. Network
throttling will cover slow mobile upload, interruption and retry. Existing
report, media processing, Ops review and approved-publication tests will be
rerun before production approval.

## Out of Scope

- HEIC or HEIF decoding and conversion;
- video, audio, PDF or archive uploads;
- more than three images per report;
- direct-to-R2 multipart or presigned browser uploads;
- retaining the oversized original in campaign storage;
- deleting or changing the original on the hunter's device;
- automatic public publication or media approval;
- altering the authoritative Privacy Policy, Media Notice or Waiver language.
