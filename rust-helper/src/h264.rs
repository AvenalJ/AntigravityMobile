//! Opt-in H.264 software encoding (OpenH264) for the "HD" screen stream.
//!
//! The phone toggles this on via an `InputCommand::Video { codec: "h264" }`.
//! Frames are emitted as Annex-B access units, tagged so Node/the phone can tell
//! them apart from JPEG frames and detect keyframes:
//!
//!   [0x48 ('H'), keyflag(0|1), ...annexb NAL units]
//!
//! JPEG frames are tagged [0x4A ('J'), ...jpeg] by the capture loop.

use openh264::encoder::{Encoder, EncoderConfig, FrameType};
use openh264::formats::{RgbSliceU8, YUVBuffer};
use openh264::OpenH264API;

/// Force a keyframe at least this often so a late-joining phone can sync quickly.
const KEYFRAME_INTERVAL: u32 = 60;

pub struct H264 {
    enc: Encoder,
    dims: (usize, usize),
    since_key: u32,
}

impl H264 {
    pub fn new(fps: u32, bitrate_bps: u32) -> Result<Self, String> {
        let config = EncoderConfig::new()
            .set_bitrate_bps(bitrate_bps)
            .max_frame_rate(fps as f32)
            .enable_skip_frame(true);
        let enc = Encoder::with_api_config(OpenH264API::from_source(), config)
            .map_err(|e| e.to_string())?;
        Ok(Self { enc, dims: (0, 0), since_key: KEYFRAME_INTERVAL })
    }

    /// Encode a tightly-packed RGB frame (even width/height) into a tagged
    /// Annex-B access unit: [0x48, keyflag, ...annexb].
    pub fn encode(&mut self, rgb: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
        // A resolution change re-inits the encoder internally; force a keyframe.
        if self.dims != (w, h) {
            self.dims = (w, h);
            self.since_key = KEYFRAME_INTERVAL;
        }
        if self.since_key >= KEYFRAME_INTERVAL {
            self.enc.force_intra_frame();
            self.since_key = 0;
        }

        let src = RgbSliceU8::new(rgb, (w, h));
        let yuv = YUVBuffer::from_rgb_source(src);
        let bs = self.enc.encode(&yuv).map_err(|e| e.to_string())?;
        let key = matches!(bs.frame_type(), FrameType::IDR | FrameType::I);

        let mut out = Vec::with_capacity(8192);
        out.push(0x48); // 'H'
        out.push(if key { 1 } else { 0 });
        bs.write_vec(&mut out);
        self.since_key += 1;
        Ok(out)
    }
}
