/**
 * @file background-music.ts
 * @description Background Royalty-Free Music System for foOm Screen Recorder.
 * Pre-decodes AudioBuffer and mixes music into recording AudioContext.
 */

import { useState, useCallback, useRef } from "react";

export type MusicMood = "focus" | "calm" | "upbeat" | "cinematic" | "corporate" | "ambient";

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  mood: MusicMood;
  url: string;
  previewUrl: string;
  durationSec: number;
}

export const SAMPLE_TRACKS: MusicTrack[] = [
  {
    id: "track-1",
    title: "Cinematic Glow",
    artist: "foOm Originals",
    mood: "cinematic",
    url: "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3",
    previewUrl: "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3",
    durationSec: 120,
  },
  {
    id: "track-2",
    title: "Deep Focus Flow",
    artist: "foOm Originals",
    mood: "focus",
    url: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73229.mp3",
    previewUrl: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73229.mp3",
    durationSec: 180,
  },
  {
    id: "track-3",
    title: "Upbeat Tech Demo",
    artist: "foOm Originals",
    mood: "upbeat",
    url: "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3",
    previewUrl: "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3",
    durationSec: 150,
  },
];

export class BackgroundMusicManager {
  private audioCtx: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private currentVolume = 0.3;

  /**
   * Load and decode a music track before recording starts.
   */
  public async loadTrack(track: MusicTrack, existingCtx?: AudioContext): Promise<void> {
    this.audioCtx = existingCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const resp = await fetch(track.url);
    const arrayBuffer = await resp.arrayBuffer();
    this.audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
  }

  /**
   * Connect music source node directly to recording AudioContext destination.
   */
  public connectToRecording(ctx: AudioContext, destination: MediaStreamAudioDestinationNode): void {
    if (!this.audioBuffer) return;

    this.audioCtx = ctx;
    this.gainNode = ctx.createGain();
    this.gainNode.gain.setValueAtTime(this.currentVolume, ctx.currentTime);

    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.loop = true;

    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(destination);

    this.sourceNode.start(0);
    this.isPlaying = true;
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(this.currentVolume, this.audioCtx.currentTime);
    }
  }

  public pause(): void {
    if (this.audioCtx && this.isPlaying) {
      this.audioCtx.suspend();
      this.isPlaying = false;
    }
  }

  public resume(): void {
    if (this.audioCtx && !this.isPlaying) {
      this.audioCtx.resume();
      this.isPlaying = true;
    }
  }

  public async stop(fadeDurationSec: number = 3): Promise<void> {
    if (this.gainNode && this.audioCtx && this.isPlaying) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.linearRampToValueAtTime(0.001, now + fadeDurationSec);
      setTimeout(() => {
        try {
          this.sourceNode?.stop();
          this.sourceNode?.disconnect();
          this.gainNode?.disconnect();
        } catch {
          // Ignore if already stopped
        }
        this.isPlaying = false;
      }, fadeDurationSec * 1000);
    }
  }
}

export function useBackgroundMusic() {
  const [tracks] = useState<MusicTrack[]>(SAMPLE_TRACKS);
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);
  const [volume, setVolumeState] = useState<number>(0.3);
  const managerRef = useRef<BackgroundMusicManager>(new BackgroundMusicManager());

  const selectTrack = useCallback(async (track: MusicTrack) => {
    setSelectedTrack(track);
    await managerRef.current.loadTrack(track);
  }, []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    managerRef.current.setVolume(v);
  }, []);

  return {
    tracks,
    selectedTrack,
    selectTrack,
    volume,
    setVolume,
    manager: managerRef.current,
  };
}
