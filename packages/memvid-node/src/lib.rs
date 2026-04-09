#![deny(clippy::all)]
#![allow(clippy::needless_pass_by_value)]

use std::fs;
use std::io::{Read as _, Seek, SeekFrom};
use std::num::NonZeroU64;
use std::panic;

use blake3::Hasher;
use napi::bindgen_prelude::*;
use napi_derive::napi;

use memvid_core::footer::{find_last_valid_footer, FOOTER_SIZE};
use memvid_core::memvid::lifecycle::Memvid;
use memvid_core::types::acl::AclEnforcementMode;
use memvid_core::types::{PutOptions as MemvidPutOptions, SearchRequest, TimelineQuery, Toc};

// ---------------------------------------------------------------------------
// JS-facing option/result structs
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct JsPutOptions {
    pub title: Option<String>,
    pub uri: Option<String>,
    pub tags: Option<Vec<String>>,
    pub timestamp: Option<i64>,
}

#[napi(object)]
pub struct SearchHit {
    pub frame_id: f64,
    pub score: f64,
    pub snippet: String,
}

#[napi(object)]
pub struct JsTimelineEntry {
    pub frame_id: f64,
    /// Unix epoch seconds (i64 cast to f64; lossless for positive timestamps).
    pub timestamp: f64,
    pub preview: String,
    pub uri: Option<String>,
}

#[napi(object)]
pub struct BrainStats {
    pub frame_count: f64,
    pub file_size: f64,
    pub segment_sizes: SegmentSizes,
}

#[napi(object)]
pub struct SegmentSizes {
    pub data: f64,
    pub lex: f64,
    pub time_index: f64,
    pub temporal_track: f64,
    pub sketch_track: f64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map any memvid Result to a napi::Error.
fn map_err<T>(result: memvid_core::Result<T>) -> napi::Result<T> {
    result.map_err(|e| napi::Error::from_reason(format!("{e}")))
}

/// Run a closure catching Rust panics and converting them to napi::Error.
fn catch_panic<F, T>(f: F) -> napi::Result<T>
where
    F: FnOnce() -> napi::Result<T> + panic::UnwindSafe,
{
    match panic::catch_unwind(f) {
        Ok(result) => result,
        Err(payload) => {
            let msg = if let Some(s) = payload.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "Unknown Rust panic".to_string()
            };
            Err(napi::Error::from_reason(format!("Rust panic: {msg}")))
        }
    }
}

/// Maximum file size we will attempt to read the footer from (1 GiB).
/// Pet brains beyond this size indicate corruption or abuse.
const MAX_MV2_FILE_SIZE: u64 = 1 << 30;

/// Read a committed .mv2 file's TOC by reading only the tail of the file
/// (footer region) rather than loading the entire file into memory.
/// This avoids OOM for large `.mv2` files.
fn read_toc_from_file(path: &str) -> napi::Result<memvid_core::types::Toc> {
    let mut file = fs::File::open(path)
        .map_err(|e| napi::Error::from_reason(format!("Failed to open file: {e}")))?;

    let file_len = file
        .metadata()
        .map_err(|e| napi::Error::from_reason(format!("Failed to read file metadata: {e}")))?
        .len();

    if file_len > MAX_MV2_FILE_SIZE {
        return Err(napi::Error::from_reason(format!(
            "File size ({file_len} bytes) exceeds maximum ({MAX_MV2_FILE_SIZE} bytes)"
        )));
    }

    if (file_len as usize) < FOOTER_SIZE {
        return Err(napi::Error::from_reason(
            "File too small to contain a valid footer".to_string(),
        ));
    }

    // Read only the tail of the file. The footer is at the end and is
    // FOOTER_SIZE bytes, but the TOC blob it references may be larger.
    // Read a generous tail (up to 64 KiB or the whole file if smaller)
    // to capture both the footer and the TOC region it points to.
    let tail_size = std::cmp::min(file_len, 64 * 1024) as usize;
    let tail_offset = file_len - tail_size as u64;

    file.seek(SeekFrom::Start(tail_offset))
        .map_err(|e| napi::Error::from_reason(format!("Failed to seek: {e}")))?;

    let mut tail_bytes = vec![0u8; tail_size];
    file.read_exact(&mut tail_bytes)
        .map_err(|e| napi::Error::from_reason(format!("Failed to read file tail: {e}")))?;

    let footer_slice = find_last_valid_footer(&tail_bytes).ok_or_else(|| {
        napi::Error::from_reason("No valid commit footer found in .mv2 file".to_string())
    })?;

    let toc = Toc::decode(footer_slice.toc_bytes)
        .map_err(|e| napi::Error::from_reason(format!("Failed to decode TOC: {e}")))?;

    Ok(toc)
}

/// Compute the deterministic brain hash from TOC checksums.
///
/// Each optional segment is preceded by a domain separator byte (0x01 =
/// present, 0x00 = absent) so that the hash distinguishes "segment missing"
/// from "segment present with a checksum that happens to collide with the
/// continuation of other data".  Segment primary checksums are always
/// present (frames are required), so they have no separator.
fn compute_brain_hash(toc: &memvid_core::types::Toc) -> String {
    let mut hasher = Hasher::new();

    // 1. Frames primary checksum -- chain all segment primary checksums
    for seg in &toc.segments {
        hasher.update(&seg.primary_checksum);
    }

    // 2. Lex index checksum (optional -- domain-separated)
    if let Some(ref lex) = toc.indexes.lex {
        hasher.update(&[0x01]);
        hasher.update(&lex.checksum);
    } else {
        hasher.update(&[0x00]);
    }

    // 3. Time index checksum (optional -- domain-separated)
    if let Some(ref ti) = toc.time_index {
        hasher.update(&[0x01]);
        hasher.update(&ti.checksum);
    } else {
        hasher.update(&[0x00]);
    }

    // 4. Temporal track checksum (optional -- domain-separated)
    if let Some(ref tt) = toc.temporal_track {
        hasher.update(&[0x01]);
        hasher.update(&tt.checksum);
    } else {
        hasher.update(&[0x00]);
    }

    // 5. Sketch track checksum (optional -- domain-separated)
    if let Some(ref st) = toc.sketch_track {
        hasher.update(&[0x01]);
        hasher.update(&st.checksum);
    } else {
        hasher.update(&[0x00]);
    }

    let hash_bytes = hasher.finalize();
    hash_bytes.to_hex().to_string()
}

// ---------------------------------------------------------------------------
// PetBrain class
// ---------------------------------------------------------------------------

#[napi]
pub struct PetBrain {
    inner: Option<Memvid>,
    path: String,
}

impl PetBrain {
    fn get_inner_mut(&mut self) -> napi::Result<&mut Memvid> {
        self.inner
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("PetBrain is closed"))
    }

    fn ensure_open(&self) -> napi::Result<()> {
        if self.inner.is_none() {
            return Err(napi::Error::from_reason("PetBrain is closed"));
        }
        Ok(())
    }
}

#[napi]
impl PetBrain {
    /// Create a new .mv2 brain file at the given path.
    /// Throws if the file already exists.
    ///
    /// Note: The pre-existence check is not atomic (TOCTOU) but Memvid::create()
    /// does not enforce uniqueness itself, so this guard is necessary for AC-2.
    /// In practice, pet brain files are created by a single agent process, so
    /// the race window is negligible.
    #[napi(factory)]
    pub fn create(path: String) -> napi::Result<Self> {
        catch_panic(|| {
            if std::path::Path::new(&path).exists() {
                return Err(napi::Error::from_reason(format!(
                    "File already exists: {path}"
                )));
            }
            let mem = map_err(Memvid::create(&path))?;
            Ok(PetBrain {
                inner: Some(mem),
                path,
            })
        })
    }

    /// Open an existing .mv2 brain file. WAL auto-replays on open.
    /// Throws if the file does not exist.
    #[napi(factory)]
    pub fn open(path: String) -> napi::Result<Self> {
        catch_panic(|| {
            if !std::path::Path::new(&path).exists() {
                return Err(napi::Error::from_reason(format!(
                    "File does not exist: {path}"
                )));
            }
            let mem = map_err(Memvid::open(&path))?;
            Ok(PetBrain {
                inner: Some(mem),
                path,
            })
        })
    }

    /// Ingest a Buffer into the brain as a new frame.
    /// Returns the frame sequence number (u64 mapped to f64; safe for pet brain
    /// scale -- guarded by MAX_SAFE_INTEGER check).
    #[napi]
    pub fn put_bytes(
        &mut self,
        data: Buffer,
        options: Option<JsPutOptions>,
    ) -> napi::Result<f64> {
        catch_panic(std::panic::AssertUnwindSafe(|| {
            let mem = self.get_inner_mut()?;
            let payload: &[u8] = &data;

            let frame_id = match options {
                Some(opts) => {
                    let mut put_opts = MemvidPutOptions::default();
                    if let Some(title) = opts.title {
                        put_opts.title = Some(title);
                    }
                    if let Some(uri) = opts.uri {
                        put_opts.uri = Some(uri);
                    }
                    if let Some(tags) = opts.tags {
                        put_opts.tags = tags;
                    }
                    if let Some(ts) = opts.timestamp {
                        put_opts.timestamp = Some(ts);
                    }
                    map_err(mem.put_bytes_with_options(payload, put_opts))?
                }
                None => map_err(mem.put_bytes(payload))?,
            };

            // JS Number.MAX_SAFE_INTEGER = 2^53 - 1
            const MAX_SAFE_INTEGER: u64 = (1u64 << 53) - 1;
            if frame_id > MAX_SAFE_INTEGER {
                return Err(napi::Error::from_reason(format!(
                    "Frame ID {frame_id} exceeds Number.MAX_SAFE_INTEGER"
                )));
            }

            Ok(frame_id as f64)
        }))
    }

    /// Flush WAL, rebuild indices, write TOC.
    #[napi]
    pub fn commit(&mut self) -> napi::Result<()> {
        catch_panic(std::panic::AssertUnwindSafe(|| {
            let mem = self.get_inner_mut()?;
            map_err(mem.commit())
        }))
    }

    /// Returns a 64-character lowercase hex string: the BLAKE3 composite hash
    /// of deterministic segments only (frames primary checksum, lex checksum,
    /// time index checksum, temporal track checksum, sketch track checksum).
    /// Vec index (HNSW) is excluded.
    ///
    /// **Important:** Call `commit()` before `hash()`. This method reads the TOC
    /// from the committed file on disk. Uncommitted WAL data is not reflected
    /// in the hash.
    #[napi]
    pub fn hash(&self) -> napi::Result<String> {
        catch_panic(std::panic::AssertUnwindSafe(|| {
            self.ensure_open()?;
            let toc = read_toc_from_file(&self.path)?;
            Ok(compute_brain_hash(&toc))
        }))
    }

    /// Full-text (Tantivy/lex) search. Returns SearchHit[] with frameId, score, snippet.
    /// Vec (HNSW) search is disabled; this is lex-only.
    #[napi]
    pub fn search(&mut self, query: String, top_k: u32) -> napi::Result<Vec<SearchHit>> {
        catch_panic(std::panic::AssertUnwindSafe(|| {
            let mem = self.get_inner_mut()?;

            let request = SearchRequest {
                query: query.clone(),
                top_k: top_k as usize,
                snippet_chars: 200,
                uri: None,
                scope: None,
                cursor: None,
                as_of_frame: None,
                as_of_ts: None,
                no_sketch: false,
                acl_context: None,
                // Pet brains have no ACL policies -- Audit mode is a no-op.
                // If ACL is ever enabled for pet brains, switch to Enforce.
                acl_enforcement_mode: AclEnforcementMode::Audit,
            };

            let response = map_err(mem.search(request))?;

            let hits: Vec<SearchHit> = response
                .hits
                .into_iter()
                .map(|h| SearchHit {
                    frame_id: h.frame_id as f64,
                    score: h.score.unwrap_or(0.0) as f64,
                    snippet: h.text,
                })
                .collect();

            Ok(hits)
        }))
    }

    /// Returns timeline entries in chronological order.
    #[napi]
    pub fn timeline(&mut self, limit: Option<u32>) -> napi::Result<Vec<JsTimelineEntry>> {
        catch_panic(std::panic::AssertUnwindSafe(|| {
            let mem = self.get_inner_mut()?;

            let lim = match limit {
                Some(0) => {
                    return Err(napi::Error::from_reason(
                        "timeline limit must be greater than 0".to_string(),
                    ));
                }
                Some(n) => NonZeroU64::new(n as u64).unwrap(),
                None => NonZeroU64::new(100).unwrap(),
            };
            let query = TimelineQuery::builder().limit(lim).build();

            let entries = map_err(mem.timeline(query))?;

            let result: Vec<JsTimelineEntry> = entries
                .into_iter()
                .map(|e| JsTimelineEntry {
                    frame_id: e.frame_id as f64,
                    timestamp: e.timestamp as f64,
                    preview: e.preview,
                    uri: e.uri,
                })
                .collect();

            Ok(result)
        }))
    }

    /// Returns brain stats: frameCount, fileSize, segmentSizes.
    #[napi]
    pub fn stats(&self) -> napi::Result<BrainStats> {
        catch_panic(std::panic::AssertUnwindSafe(|| {
            self.ensure_open()?;

            // Read the TOC to get detailed segment info
            let toc = read_toc_from_file(&self.path)?;

            let raw_frame_count = toc.frames.len() as u64;
            const MAX_SAFE_INTEGER: u64 = (1u64 << 53) - 1;
            if raw_frame_count > MAX_SAFE_INTEGER {
                return Err(napi::Error::from_reason(format!(
                    "Frame count {raw_frame_count} exceeds Number.MAX_SAFE_INTEGER"
                )));
            }
            let frame_count = raw_frame_count as f64;

            let file_size = fs::metadata(&self.path)
                .map(|m| m.len() as f64)
                .unwrap_or(0.0);

            let data_size: u64 = toc.segments.iter().map(|s| s.bytes_length).sum();
            let lex_size: u64 = toc.indexes.lex.as_ref().map_or(0, |l| l.bytes_length);
            let time_index_size: u64 = toc.time_index.as_ref().map_or(0, |t| t.bytes_length);
            let temporal_track_size: u64 =
                toc.temporal_track.as_ref().map_or(0, |t| t.bytes_length);
            let sketch_track_size: u64 =
                toc.sketch_track.as_ref().map_or(0, |s| s.bytes_length);

            Ok(BrainStats {
                frame_count,
                file_size,
                segment_sizes: SegmentSizes {
                    data: data_size as f64,
                    lex: lex_size as f64,
                    time_index: time_index_size as f64,
                    temporal_track: temporal_track_size as f64,
                    sketch_track: sketch_track_size as f64,
                },
            })
        }))
    }

    /// Release the file handle and native resources.
    /// Subsequent method calls will throw.
    #[napi]
    pub fn close(&mut self) -> napi::Result<()> {
        catch_panic(std::panic::AssertUnwindSafe(|| {
            if self.inner.is_none() {
                return Err(napi::Error::from_reason("PetBrain is already closed"));
            }
            let _ = self.inner.take();
            Ok(())
        }))
    }
}
