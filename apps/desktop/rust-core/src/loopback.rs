use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::*;

pub struct LoopbackCapture {
    running: Arc<AtomicBool>,
    thread: Option<JoinHandle<Result<(), String>>>,
}

impl LoopbackCapture {
    pub fn request_stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
    pub fn start(
        path: PathBuf,
        paused: Arc<AtomicBool>,
        recording_clock: Arc<Mutex<Option<Instant>>>,
    ) -> Result<Self, String> {
        let running = Arc::new(AtomicBool::new(true));
        let worker_running = running.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread = thread::spawn(move || {
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
                .ok()
                .map_err(|e| format!("Cannot initialize system audio: {e}"))?;
            let result =
                unsafe { record(path, worker_running, paused, recording_clock, &ready_tx) };
            if let Err(error) = &result {
                let _ = ready_tx.send(Err(error.clone()));
            }
            unsafe {
                CoUninitialize();
            }
            result
        });
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(Self {
                running,
                thread: Some(thread),
            }),
            result => {
                running.store(false, Ordering::SeqCst);
                // Initialization may be stuck in an audio driver; never block the UI indefinitely.
                Err(match result {
                    Ok(Err(error)) => error,
                    _ => "System audio initialization timed out or failed".to_string(),
                })
            }
        }
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.running.store(false, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let deadline = Instant::now() + Duration::from_secs(3);
            while !thread.is_finished() {
                if Instant::now() >= deadline {
                    return Err(
                        "System audio device did not stop within 3 seconds; audio file retained"
                            .to_string(),
                    );
                }
                thread::sleep(Duration::from_millis(5));
            }
            thread
                .join()
                .map_err(|_| "System audio worker panicked".to_string())??;
        }
        Ok(())
    }
}

impl Drop for LoopbackCapture {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

fn write_silence(file: &mut File, bytes: u64) -> std::io::Result<()> {
    let silence = [0u8; 8192];
    let mut remaining = bytes;
    while remaining > 0 {
        let count = remaining.min(silence.len() as u64) as usize;
        file.write_all(&silence[..count])?;
        remaining -= count as u64;
    }
    Ok(())
}

unsafe fn record(
    path: PathBuf,
    running: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    recording_clock: Arc<Mutex<Option<Instant>>>,
    ready: &mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Cannot enumerate audio devices: {e}"))?;
    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, eConsole)
        .map_err(|e| format!("No system audio output device: {e}"))?;
    let client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("Cannot activate system audio: {e}"))?;
    let format = client.GetMixFormat().map_err(|e| e.to_string())?;
    let format_bytes =
        std::slice::from_raw_parts(format.cast::<u8>(), 18 + (*format).cbSize as usize).to_vec();
    let sample_rate = (*format).nSamplesPerSec as u64;
    let block_align = (*format).nBlockAlign as u64;
    let initialized = client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        1_000_000,
        0,
        format,
        None,
    );
    CoTaskMemFree(Some(format.cast()));
    initialized.map_err(|e| format!("Cannot initialize WASAPI loopback: {e}"))?;
    let capture: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    // Preserve the native WAVEFORMATEXTENSIBLE format instead of assuming PCM.
    file.write_all(b"RIFF\0\0\0\0WAVEfmt ")
        .map_err(|e| e.to_string())?;
    file.write_all(&(format_bytes.len() as u32).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&format_bytes).map_err(|e| e.to_string())?;
    file.write_all(b"data\0\0\0\0").map_err(|e| e.to_string())?;
    let data_start = file.stream_position().map_err(|e| e.to_string())?;
    client.Start().map_err(|e| e.to_string())?;
    let mut started = Instant::now();
    let mut gate_open = false;
    let _ = ready.send(Ok(()));
    let mut pause_started = None;
    let mut paused_total = Duration::ZERO;
    let mut first_position = None;
    let mut initial_offset = 0;
    let mut initial_paused_frames = 0;
    let mut frames_written = 0u64;
    let result = (|| -> Result<(), String> {
        while running.load(Ordering::SeqCst) {
            let mut just_started = false;
            if !gate_open {
                if let Some(clock) = *recording_clock.lock().unwrap() {
                    started = clock;
                    gate_open = true;
                    just_started = true;
                }
            }
            let is_paused = paused.load(Ordering::SeqCst);
            if is_paused && pause_started.is_none() {
                pause_started = Some(Instant::now());
            }
            if !is_paused {
                if let Some(time) = pause_started.take() {
                    paused_total += Instant::now().duration_since(time);
                }
            }
            while capture.GetNextPacketSize().map_err(|e| e.to_string())? > 0 {
                let mut data = std::ptr::null_mut();
                let mut frames = 0;
                let mut flags = 0;
                let mut position = 0;
                capture
                    .GetBuffer(
                        &mut data,
                        &mut frames,
                        &mut flags,
                        Some(&mut position),
                        None,
                    )
                    .map_err(|e| e.to_string())?;
                let packet_result = (|| -> Result<(), String> {
                    if !gate_open || just_started || is_paused || frames == 0 {
                        return Ok(());
                    }
                    let first = *first_position.get_or_insert_with(|| {
                        initial_offset =
                            (started.elapsed().saturating_sub(paused_total).as_secs_f64()
                                * sample_rate as f64) as u64;
                        initial_offset = initial_offset.saturating_sub(frames as u64);
                        initial_paused_frames =
                            (paused_total.as_secs_f64() * sample_rate as f64) as u64;
                        position
                    });
                    let removed = ((paused_total.as_secs_f64() * sample_rate as f64) as u64)
                        .saturating_sub(initial_paused_frames);
                    let device_target =
                        initial_offset + position.saturating_sub(first).saturating_sub(removed);
                    let elapsed_target =
                        (started.elapsed().saturating_sub(paused_total).as_secs_f64()
                            * sample_rate as f64) as u64;
                    // Some drivers mark timestamps invalid or reset their device
                    // clocks. Never let a bad timestamp create an unbounded gap.
                    let target = if flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 != 0
                        || device_target > elapsed_target.saturating_add(sample_rate / 5)
                    {
                        frames_written
                    } else {
                        device_target
                    };
                    if target > frames_written {
                        write_silence(&mut file, (target - frames_written) * block_align)
                            .map_err(|e| e.to_string())?;
                        frames_written = target;
                    }
                    let skipped = frames_written.saturating_sub(target).min(frames as u64);
                    let kept_frames = frames as u64 - skipped;
                    let bytes = kept_frames * block_align;
                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                        write_silence(&mut file, bytes).map_err(|e| e.to_string())?;
                    } else if bytes > 0 {
                        if data.is_null() {
                            return Err("Audio driver returned an empty packet buffer".to_string());
                        }
                        file.write_all(std::slice::from_raw_parts(
                            data.add((skipped * block_align) as usize),
                            bytes as usize,
                        ))
                        .map_err(|e| e.to_string())?;
                    }
                    frames_written += kept_frames;
                    Ok(())
                })();
                capture.ReleaseBuffer(frames).map_err(|e| e.to_string())?;
                packet_result?;
            }
            thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    })();
    let _ = client.Stop();
    let active_pause = pause_started.map(|time| time.elapsed()).unwrap_or_default();
    let final_frames = if gate_open {
        (started
            .elapsed()
            .saturating_sub(paused_total + active_pause)
            .as_secs_f64()
            * sample_rate as f64) as u64
    } else {
        0
    };
    if final_frames > frames_written {
        write_silence(&mut file, (final_frames - frames_written) * block_align)
            .map_err(|e| e.to_string())?;
    }
    let length = file.stream_position().map_err(|e| e.to_string())?;
    if length > u32::MAX as u64 {
        return Err("System audio WAV exceeded 4 GB".to_string());
    }
    file.seek(SeekFrom::Start(4)).map_err(|e| e.to_string())?;
    file.write_all(&((length - 8) as u32).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(data_start - 4))
        .map_err(|e| e.to_string())?;
    file.write_all(&((length - data_start) as u32).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a Windows render endpoint"]
    fn captures_loopback_wav_and_removes_pause() {
        let path =
            std::env::temp_dir().join(format!("foom-loopback-test-{}.wav", std::process::id()));
        let paused = Arc::new(AtomicBool::new(false));
        let clock = Arc::new(Mutex::new(None));
        let capture = LoopbackCapture::start(path.clone(), paused.clone(), clock.clone()).unwrap();
        *clock.lock().unwrap() = Some(Instant::now());
        thread::sleep(Duration::from_millis(120));
        paused.store(true, Ordering::SeqCst);
        thread::sleep(Duration::from_millis(200));
        paused.store(false, Ordering::SeqCst);
        thread::sleep(Duration::from_millis(120));
        capture.stop().unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(
            u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8,
            bytes.len()
        );
        let format_len = u32::from_le_bytes(bytes[16..20].try_into().unwrap()) as usize;
        let byte_rate = u32::from_le_bytes(bytes[28..32].try_into().unwrap());
        let data_size_offset = 24 + format_len;
        let data_size = u32::from_le_bytes(
            bytes[data_size_offset..data_size_offset + 4]
                .try_into()
                .unwrap(),
        );
        let seconds = data_size as f64 / byte_rate as f64;
        assert!(
            (0.18..0.34).contains(&seconds),
            "audio duration includes pause: {seconds}"
        );
        std::fs::remove_file(path).unwrap();
    }
}
