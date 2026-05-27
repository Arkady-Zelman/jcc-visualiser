/**
 * Earliest month/date that visualisations should render.
 *
 * PAJ JCC monthly history goes back to 2012-01, but composition coverage
 * (HS-mapping completeness, customs ingest density) is only reliable from
 * around 2016 onward — earlier years have large unmapped buckets and sparse
 * volumes that distort the visual story. Charts gate on this cutoff so the
 * user always sees an editorially defensible slice.
 *
 * Tweak this single value to shift the visible window.
 */
export const MIN_DATA_MONTH = "2016-01-01";
export const MIN_DATA_DATE = "2016-01-01";
