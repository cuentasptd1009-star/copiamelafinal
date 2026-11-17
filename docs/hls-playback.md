# Live HLS playback

Some H.264 open-GOP sources include leading pictures with presentation timestamps
before the first intra picture. Those pictures can reference the previous GOP,
which a newly attached browser decoder has never received. Native players may
recover from that condition while a browser MediaSource decoder raises a fatal
error. Equal relay/origin segment bytes alone do not establish a source outage.

The full and floating players share `live-hls-transport.ts`. For each new main
video rendition/discontinuity or decoder attachment, its fragment loader removes
only those leading pictures from the first open-GOP TS fragment. Audio and later
video remain intact; subsequent continuous fragments are untouched. IDR sources,
non-TS/fMP4, encrypted input and unrecognized video remain unchanged. This is
client-side packet selection, not a VPS transcode.

Live playback uses complete fragments and starts on the segment boundary rather
than seeking into another open GOP during initial attachment. Ordinary relays
share a two-target-duration live position and a 12-second buffer target, so short
origin playlist windows do not put new viewers at the oldest available fragment.
Enhanced channels retain their existing server/client buffer configuration and
quality selection. Only WIN SPORTS + is selected for enhanced processing in the
current deployment.

Media errors recover automatically with bounded delays (up to 15 seconds), with
one pending recovery timer per player. Channel changes and cleanup cancel that
timer. The permanent decoder-warning overlay introduced in bdfc2a9 is removed.
Recovery does not guarantee a playable result for an unavailable or unsupported
source.

Run `node --test scripts/live-hls-transport.test.mjs`. Browser checks must verify
increasing decoded frame counts and decoded audio, not just a nonzero video
width or advancing media time. Test a fresh ESPN entry, sustained playback,
floating-player entry/exit, a normal IDR source, and enhanced quality selection.
