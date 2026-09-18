#!/usr/bin/env python3
"""Reference-based acoustic matching for dialogue.

Open-source MVP: NumPy + SciPy + FFmpeg.  It deliberately uses conservative
processing.  The goal is continuity between dialogue takes, not forensic room
impulse-response recovery from a single utterance.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from scipy import ndimage, signal
from scipy.io import wavfile


EPS = 1e-10
SUPPORTED_EXTENSIONS = {".wav", ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus"}


@dataclass
class ProcessingOptions:
    dereverb_strength: float = 0.0
    denoise_strength: float = 0.0
    eq_strength: float = 0.30
    dynamics_strength: float = 0.25
    room_strength: float = 0.0
    early_reflection_strength: float = 0.0
    room_decay_scale: float = 1.0
    room_pre_delay_ms: float = 18.0
    room_damping: float = 0.55
    noise_strength: float = 0.0
    max_eq_db: float = 3.0
    low_tone_db: float = 0.0
    presence_db: float = 0.0
    high_tone_db: float = 0.0
    target_lufs: float | None = None
    target_lra_lu: float | None = None
    target_true_peak_dbfs: float | None = None
    duplicate_passthrough: bool = True


def run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        check=True,
        stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.PIPE if capture else subprocess.DEVNULL,
    )


def require_ffmpeg() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("FFmpeg and ffprobe must be installed and available in PATH")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def probe_audio_properties(path: Path) -> dict:
    result = run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries",
            "stream=sample_rate,channels,bits_per_sample,bits_per_raw_sample,sample_fmt,codec_name",
            "-of", "json", str(path),
        ],
        capture=True,
    )
    data = json.loads(result.stdout.decode("utf-8"))
    stream = data["streams"][0]
    bit_depth = int(stream.get("bits_per_sample") or stream.get("bits_per_raw_sample") or 0)
    return {
        "sample_rate": int(stream["sample_rate"]),
        "channels": int(stream.get("channels") or 1),
        "bit_depth": bit_depth or None,
        "sample_format": stream.get("sample_fmt"),
        "codec_name": stream.get("codec_name"),
    }


def probe_sample_rate(path: Path) -> int:
    return int(probe_audio_properties(path)["sample_rate"])


def decode_audio(path: Path, sample_rate: int | None = None) -> tuple[int, np.ndarray]:
    require_ffmpeg()
    sr = sample_rate or probe_sample_rate(path)
    result = run(
        [
            "ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
            "-ar", str(sr), "-f", "f32le", "pipe:1",
        ],
        capture=True,
    )
    audio = np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)
    if audio.size == 0:
        raise ValueError(f"No audio samples decoded from {path}")
    audio = np.nan_to_num(audio)
    audio -= float(np.mean(audio))
    return sr, audio


def encode_wav(path: Path, sample_rate: int, audio: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(audio, -0.999969, 0.999969)
    wavfile.write(path, sample_rate, (pcm * 32767.0).astype(np.int16))


def frames(audio: np.ndarray, frame_length: int, hop: int) -> np.ndarray:
    if audio.size < frame_length:
        audio = np.pad(audio, (0, frame_length - audio.size))
    count = 1 + int(math.ceil((audio.size - frame_length) / hop))
    total = (count - 1) * hop + frame_length
    padded = np.pad(audio, (0, max(0, total - audio.size)))
    shape = (count, frame_length)
    strides = (padded.strides[0] * hop, padded.strides[0])
    return np.lib.stride_tricks.as_strided(padded, shape=shape, strides=strides).copy()


def frame_analysis(audio: np.ndarray, sr: int) -> dict:
    frame_length = max(128, int(round(0.040 * sr)))
    hop = max(32, int(round(0.010 * sr)))
    n_fft = 1 << int(math.ceil(math.log2(frame_length)))
    framed = frames(audio, frame_length, hop)
    rms = np.sqrt(np.mean(framed * framed, axis=1) + EPS)
    rms_db = 20.0 * np.log10(rms + EPS)

    noise_threshold = float(np.percentile(rms_db, 22))
    speech_threshold = max(noise_threshold + 9.0, float(np.percentile(rms_db, 48)))
    speech_mask = rms_db >= speech_threshold
    if int(speech_mask.sum()) < max(4, int(0.08 * speech_mask.size)):
        speech_mask = rms_db >= float(np.percentile(rms_db, 65))
    noise_mask = rms_db <= float(np.percentile(rms_db, 20))

    window = signal.windows.hann(frame_length, sym=False)
    spectra = np.abs(np.fft.rfft(framed * window, n=n_fft, axis=1)) + EPS
    power = spectra * spectra
    frequencies = np.fft.rfftfreq(n_fft, 1.0 / sr)
    voice_band = (frequencies >= 90.0) & (frequencies <= min(3800.0, sr * 0.475))

    speech_db = 20.0 * np.log10(spectra[speech_mask] + EPS)
    speech_db -= np.median(speech_db[:, voice_band], axis=1, keepdims=True)
    speech_spectrum_db = np.median(speech_db, axis=0)

    noise_power = np.median(power[noise_mask], axis=0)
    noise_shape_db = 10.0 * np.log10(noise_power + EPS)
    noise_shape_db -= float(np.mean(noise_shape_db[voice_band]))

    speech_levels = rms_db[speech_mask]
    noise_levels = rms_db[noise_mask]
    speech_level = float(np.median(speech_levels))
    noise_level = float(np.median(noise_levels))
    dynamics = float(np.percentile(speech_levels, 90) - np.percentile(speech_levels, 10))
    rt60, wetness = estimate_room(rms_db, speech_mask, hop / sr, noise_level)

    return {
        "frame_length": frame_length,
        "hop": hop,
        "n_fft": n_fft,
        "frequencies_hz": frequencies,
        "rms_db": rms_db,
        "speech_mask": speech_mask,
        "noise_mask": noise_mask,
        "speech_spectrum_db": speech_spectrum_db,
        "noise_shape_db": noise_shape_db,
        "speech_level_dbfs": speech_level,
        "noise_level_dbfs": noise_level,
        "dynamic_range_db": dynamics,
        "rt60_proxy_s": rt60,
        "wetness_proxy": wetness,
    }


def estimate_room(
    rms_db: np.ndarray, speech_mask: np.ndarray, frame_step_s: float, noise_db: float
) -> tuple[float, float]:
    """Estimate a cautious room-decay proxy from gaps after speech offsets."""
    offsets = np.where(speech_mask[:-1] & ~speech_mask[1:])[0]
    estimates: list[float] = []
    tail_drops: list[float] = []
    max_frames = max(6, int(round(0.55 / frame_step_s)))
    for offset in offsets:
        stop = min(rms_db.size, offset + 1 + max_frames)
        tail = rms_db[offset + 1:stop]
        if tail.size < 5:
            continue
        next_speech = np.where(speech_mask[offset + 1:stop])[0]
        if next_speech.size:
            tail = tail[: int(next_speech[0])]
        if tail.size < 5:
            continue
        start_db = float(rms_db[offset])
        relative = tail - start_db
        useful = (relative <= -3.0) & (tail >= noise_db + 2.0)
        idx = np.where(useful)[0]
        if idx.size >= 4:
            x = (idx + 1) * frame_step_s
            slope, _ = np.polyfit(x, relative[idx], 1)
            if slope < -12.0:
                estimates.append(float(np.clip(-60.0 / slope, 0.08, 1.20)))
        tail_drops.append(float(np.median(relative[: min(8, relative.size)])))

    rt60 = float(np.median(estimates)) if estimates else 0.22
    drop = float(np.median(tail_drops)) if tail_drops else -24.0
    wetness = float(np.clip((drop + 34.0) / 55.0, 0.06, 0.32))
    return rt60, wetness


def measure_loudness(path: Path) -> dict:
    result = run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
            "-af", "ebur128=peak=true", "-f", "null", "-",
        ],
        capture=True,
    )
    text = result.stderr.decode("utf-8", errors="replace")
    summary = text.rsplit("Summary:", 1)[-1]

    def value(pattern: str, default: float) -> float:
        match = re.search(pattern, summary)
        return float(match.group(1)) if match else default

    return {
        "integrated_lufs": value(r"I:\s+(-?[0-9.]+)\s+LUFS", -23.0),
        "loudness_range_lu": value(r"LRA:\s+([0-9.]+)\s+LU", 4.0),
        "true_peak_dbfs": value(r"Peak:\s+(-?[0-9.]+)\s+dBFS", -1.0),
    }


def create_profile(reference: Path) -> dict:
    properties = probe_audio_properties(reference)
    sr, audio = decode_audio(reference)
    analysis = frame_analysis(audio, sr)
    loudness = measure_loudness(reference)
    return {
        "schema_version": 1,
        "reference": {
            "filename": reference.name,
            "sha256": file_sha256(reference),
            "duration_s": round(audio.size / sr, 6),
            "sample_rate": sr,
            "bit_depth": properties["bit_depth"],
            "channels": properties["channels"],
            "codec_name": properties["codec_name"],
        },
        "loudness": loudness,
        "speech": {
            "level_dbfs": analysis["speech_level_dbfs"],
            "dynamic_range_db": analysis["dynamic_range_db"],
        },
        "noise": {
            "level_dbfs": analysis["noise_level_dbfs"],
            "shape_db": analysis["noise_shape_db"].round(5).tolist(),
        },
        "room": {
            "rt60_proxy_s": analysis["rt60_proxy_s"],
            "wetness_proxy": analysis["wetness_proxy"],
        },
        "spectrum": {
            "n_fft": analysis["n_fft"],
            "frequencies_hz": analysis["frequencies_hz"].round(5).tolist(),
            "speech_shape_db": analysis["speech_spectrum_db"].round(5).tolist(),
        },
    }


def profile_metrics(profile: dict, reference_profile: dict | None = None) -> dict:
    speech_level = float(profile["speech"]["level_dbfs"])
    noise_level = float(profile["noise"]["level_dbfs"])
    metrics = {
        "duration_s": round(float(profile["reference"]["duration_s"]), 3),
        "sample_rate_hz": int(profile["reference"]["sample_rate"]),
        "sample_rate_khz": round(float(profile["reference"]["sample_rate"]) / 1000.0, 3),
        "bit_depth": profile["reference"].get("bit_depth"),
        "integrated_lufs": round(float(profile["loudness"]["integrated_lufs"]), 2),
        "true_peak_dbfs": round(float(profile["loudness"]["true_peak_dbfs"]), 2),
        "loudness_range_lu": round(float(profile["loudness"]["loudness_range_lu"]), 2),
        "speech_level_dbfs": round(speech_level, 2),
        "noise_level_dbfs": round(noise_level, 2),
        "estimated_snr_db": round(speech_level - noise_level, 2),
        "dynamic_range_db": round(float(profile["speech"]["dynamic_range_db"]), 2),
        "rt60_proxy_s": round(float(profile["room"]["rt60_proxy_s"]), 3),
        "wetness_proxy": round(float(profile["room"]["wetness_proxy"]), 3),
    }
    if reference_profile is not None:
        sr, audio = decode_audio(Path(profile["_source_path"]), int(reference_profile["reference"]["sample_rate"]))
        metrics["spectral_distance_db"] = round(
            spectral_distance(audio, sr, reference_profile), 3
        )
        metrics["loudness_difference_lu"] = round(
            metrics["integrated_lufs"]
            - float(reference_profile["loudness"]["integrated_lufs"]),
            2,
        )
    return metrics


def analyze_file(path: Path, reference_profile: dict | None = None) -> tuple[dict, dict]:
    profile = create_profile(path)
    profile["_source_path"] = str(path.resolve())
    metrics = profile_metrics(profile, reference_profile)
    profile.pop("_source_path", None)
    return profile, metrics


def distance_macro_settings(reference_profile: dict, target_metrics: dict) -> dict:
    """Map perceived microphone distance to coupled, non-linear corrections."""
    target_lufs = float(target_metrics["integrated_lufs"])
    reference_lufs = float(reference_profile["loudness"]["integrated_lufs"])
    difference = float(np.clip(reference_lufs - target_lufs, -6.0, 6.0))
    direction = 1.0 if difference >= 0.0 else -1.0  # +1 means bring voice closer.
    magnitude = (abs(difference) / 6.0) ** (1.0 / 1.25) if difference else 0.0
    lever = 50.0 - direction * 50.0 * magnitude
    if direction > 0:
        low = 2.5 * magnitude ** 1.4
        presence = 1.3 * magnitude ** 1.2
        high = 0.8 * magnitude ** 1.35
    else:
        low = -2.0 * magnitude ** 1.4
        presence = -1.0 * magnitude ** 1.2
        high = -1.8 * magnitude ** 1.25
    return {
        "distance_lever": round(float(np.clip(lever, 0.0, 100.0)), 1),
        "target_lufs": round(reference_lufs, 1),
        "low_tone_db": round(low, 1),
        "presence_db": round(presence, 1),
        "high_tone_db": round(high, 1),
    }


def reverb_macro_settings(reference_profile: dict, target_metrics: dict) -> dict:
    """Map room-decay mismatch to either dereverberation or added room."""
    reference_rt60 = float(reference_profile["room"]["rt60_proxy_s"])
    target_rt60 = float(target_metrics["rt60_proxy_s"])
    difference = float(np.clip(reference_rt60 - target_rt60, -0.8, 0.8))
    magnitude = (abs(difference) / 0.8) ** (1.0 / 1.3) if difference else 0.0
    if difference < -0.04:  # Target has a longer tail: make it drier.
        lever = 50.0 - 50.0 * magnitude
        dereverb = 0.35 * magnitude ** 1.3
        room = 0.0
        early = 0.0
    elif difference > 0.04:  # Target is drier: add a cautious share of the reference room.
        lever = 50.0 + 50.0 * magnitude
        dereverb = 0.0
        room = 0.35 * magnitude ** 1.3
        early = 0.25 * magnitude ** 1.15
    else:
        lever, dereverb, room, early = 50.0, 0.0, 0.0, 0.0
    decay_scale = float(np.clip(reference_rt60 / max(target_rt60, 0.08), 0.65, 1.45))
    return {
        "reverb_lever": round(float(np.clip(lever, 0.0, 100.0)), 1),
        "dereverb_strength": round(dereverb, 2),
        "room_strength": round(room, 2),
        "early_reflection_strength": round(early, 2),
        "room_decay_scale": round(decay_scale, 2),
        "room_pre_delay_ms": 18.0,
        "room_damping": 0.55,
    }


def recommend_settings(reference_profile: dict, target_metrics: dict) -> dict:
    """Return intentionally conservative starting values for human audition."""
    spectral = float(target_metrics.get("spectral_distance_db", 0.0))
    noise_difference = (
        float(target_metrics["noise_level_dbfs"])
        - float(reference_profile["noise"]["level_dbfs"])
    )
    dynamic_difference = abs(
        float(target_metrics["dynamic_range_db"])
        - float(reference_profile["speech"]["dynamic_range_db"])
    )
    if spectral < 1.2:
        eq_strength = 0.0
    elif spectral < 2.5:
        eq_strength = 0.18
    elif spectral < 5.0:
        eq_strength = 0.30
    else:
        eq_strength = 0.42
    denoise = float(np.clip((noise_difference - 2.0) / 14.0, 0.0, 0.55))
    recommendation = {
        "denoise_strength": round(denoise, 2),
        "eq_strength": eq_strength,
        "dynamics_strength": 0.15 if dynamic_difference < 2.0 else 0.30,
        "noise_strength": 0.0,
        "max_eq_db": round(float(np.clip(spectral * 0.75, 2.0, 5.0)), 1),
        "target_lra_lu": round(float(reference_profile["loudness"]["loudness_range_lu"]), 1),
        "target_true_peak_dbfs": round(
            min(float(reference_profile["loudness"]["true_peak_dbfs"]), -1.0), 1
        ),
    }
    recommendation.update(distance_macro_settings(reference_profile, target_metrics))
    recommendation.update(reverb_macro_settings(reference_profile, target_metrics))
    return recommendation


def spectral_denoise(audio: np.ndarray, sr: int, strength: float) -> np.ndarray:
    if strength <= 0.0:
        return audio.copy()
    nperseg = max(256, 1 << int(math.ceil(math.log2(max(128, int(0.032 * sr))))))
    noverlap = int(nperseg * 0.75)
    _, _, spectrum = signal.stft(
        audio, fs=sr, nperseg=nperseg, noverlap=noverlap, boundary="zeros"
    )
    power = np.abs(spectrum) ** 2
    frame_energy = np.mean(power, axis=0)
    quiet = frame_energy <= np.percentile(frame_energy, 20)
    if int(quiet.sum()) < 2:
        quiet[np.argsort(frame_energy)[: max(2, frame_energy.size // 8)]] = True
    noise_power = np.median(power[:, quiet], axis=1, keepdims=True)
    gain = 1.0 - strength * noise_power / (power + EPS)
    gain = np.sqrt(np.clip(gain, 0.18, 1.0))
    gain = ndimage.uniform_filter(gain, size=(3, 3), mode="nearest")
    _, cleaned = signal.istft(
        spectrum * gain, fs=sr, nperseg=nperseg, noverlap=noverlap,
        input_onesided=True, boundary=True,
    )
    return cleaned[: audio.size]


def spectral_dereverb(audio: np.ndarray, sr: int, strength: float) -> np.ndarray:
    """Conservatively attenuate persistent late energy in the STFT domain."""
    if strength <= 0.0:
        return audio.copy()
    nperseg = max(256, 1 << int(math.ceil(math.log2(max(128, int(0.032 * sr))))))
    noverlap = int(nperseg * 0.75)
    _, _, spectrum = signal.stft(
        audio, fs=sr, nperseg=nperseg, noverlap=noverlap, boundary="zeros"
    )
    power = np.abs(spectrum) ** 2
    hop_seconds = (nperseg - noverlap) / sr
    persistence = math.exp(-hop_seconds / 0.16)
    late = np.zeros_like(power)
    for index in range(1, power.shape[1]):
        late[:, index] = persistence * late[:, index - 1] + (1.0 - persistence) * power[:, index - 1]
    ratio = late / (power + late + EPS)
    gain = 1.0 - float(np.clip(strength, 0.0, 0.85)) * ratio
    gain = ndimage.uniform_filter(gain, size=(3, 3), mode="nearest")
    gain = np.clip(gain, 0.42, 1.0)
    _, cleaned = signal.istft(
        spectrum * gain, fs=sr, nperseg=nperseg, noverlap=noverlap,
        input_onesided=True, boundary=True,
    )
    return cleaned[: audio.size]


def match_equalization(
    audio: np.ndarray, sr: int, profile: dict, strength: float, max_eq_db: float
) -> tuple[np.ndarray, float]:
    if strength <= 0.0:
        return audio.copy(), 0.0
    target = frame_analysis(audio, sr)
    ref_freqs = np.asarray(profile["spectrum"]["frequencies_hz"], dtype=float)
    ref_shape = np.asarray(profile["spectrum"]["speech_shape_db"], dtype=float)
    frequencies = target["frequencies_hz"]
    ref_interp = np.interp(frequencies, ref_freqs, ref_shape)
    delta = (ref_interp - target["speech_spectrum_db"]) * strength
    delta = ndimage.gaussian_filter1d(delta, sigma=max(2.0, delta.size / 48.0))
    delta = np.clip(delta, -max_eq_db, max_eq_db)
    delta[frequencies < 70.0] = 0.0
    delta[frequencies > min(3900.0, sr * 0.48)] = 0.0

    normalized = frequencies / (sr / 2.0)
    normalized[0] = 0.0
    normalized[-1] = 1.0
    taps = min(513, max(65, int(sr * 0.024) | 1))
    gains = 10.0 ** (delta / 20.0)
    fir = signal.firwin2(taps, normalized, gains)
    matched = signal.fftconvolve(audio, fir, mode="same")
    voice_band = (frequencies >= 100.0) & (frequencies <= min(3500.0, sr * 0.46))
    mean_correction = float(np.mean(np.abs(delta[voice_band])))
    return matched, mean_correction


def match_dynamics(
    audio: np.ndarray, sr: int, profile: dict, strength: float = 1.0
) -> np.ndarray:
    if strength <= 0.0:
        return audio.copy()
    window = max(32, int(0.050 * sr))
    power = ndimage.uniform_filter1d(audio * audio, size=window, mode="nearest")
    envelope_db = 10.0 * np.log10(power + EPS)
    active = envelope_db >= np.percentile(envelope_db, 45)
    levels = envelope_db[active]
    if levels.size < 10:
        return audio
    target_center = float(np.median(levels))
    target_range = float(np.percentile(levels, 90) - np.percentile(levels, 10))
    ref_center = float(profile["speech"]["level_dbfs"])
    ref_range = float(profile["speech"]["dynamic_range_db"])
    slope = float(np.clip(ref_range / max(target_range, 1.0), 0.82, 1.18))
    desired = ref_center + slope * (envelope_db - target_center)
    gain_db = np.clip(desired - envelope_db, -7.0, 7.0) * float(np.clip(strength, 0.0, 1.0))
    gain_db = ndimage.gaussian_filter1d(gain_db, sigma=max(1.0, 0.035 * sr))
    return audio * (10.0 ** (gain_db / 20.0))


def peaking_equalizer(
    audio: np.ndarray, sr: int, frequency_hz: float, gain_db: float, q: float
) -> np.ndarray:
    if abs(gain_db) < 0.01 or frequency_hz <= 0.0 or frequency_hz >= sr / 2.0:
        return audio
    amplitude = 10.0 ** (gain_db / 40.0)
    omega = 2.0 * math.pi * frequency_hz / sr
    alpha = math.sin(omega) / (2.0 * q)
    cos_omega = math.cos(omega)
    b = np.array([
        1.0 + alpha * amplitude,
        -2.0 * cos_omega,
        1.0 - alpha * amplitude,
    ])
    a = np.array([
        1.0 + alpha / amplitude,
        -2.0 * cos_omega,
        1.0 - alpha / amplitude,
    ])
    return signal.lfilter(b / a[0], a / a[0], audio)


def apply_manual_tone(audio: np.ndarray, sr: int, options: ProcessingOptions) -> np.ndarray:
    result = peaking_equalizer(audio, sr, min(250.0, sr * 0.10), options.low_tone_db, 0.70)
    result = peaking_equalizer(result, sr, min(1800.0, sr * 0.30), options.presence_db, 0.85)
    result = peaking_equalizer(result, sr, min(3200.0, sr * 0.40), options.high_tone_db, 0.70)
    return result


def add_reference_room(
    audio: np.ndarray,
    sr: int,
    profile: dict,
    strength: float,
    seed: int,
    early_reflection_strength: float = 0.0,
    decay_scale: float = 1.0,
    pre_delay_ms: float = 18.0,
    damping: float = 0.55,
) -> tuple[np.ndarray, float]:
    wet = float(profile["room"]["wetness_proxy"]) * strength
    wet = float(np.clip(wet, 0.0, 0.24))
    if wet <= 0.002:
        return audio.copy(), 0.0
    rt60 = float(np.clip(
        profile["room"]["rt60_proxy_s"] * np.clip(decay_scale, 0.5, 1.8),
        0.08,
        1.50,
    ))
    length = max(int(0.12 * sr), int(min(1.40, rt60 * 1.15) * sr))
    rng = np.random.default_rng(seed)
    time = np.arange(length) / sr
    decay = np.exp(-6.91 * time / max(rt60, 0.05))
    late = rng.normal(size=length) * decay
    if sr > 1200:
        damping = float(np.clip(damping, 0.0, 1.0))
        cutoff_hz = 3600.0 - 1800.0 * damping
        high = min(0.94, cutoff_hz / (sr / 2.0))
        low = min(high * 0.5, 120.0 / (sr / 2.0))
        sos = signal.butter(2, [max(0.01, low), high], btype="bandpass", output="sos")
        late = signal.sosfilt(sos, late)
    pre_delay_s = float(np.clip(pre_delay_ms, 0.0, 120.0)) / 1000.0
    late[: max(1, int(pre_delay_s * sr))] = 0.0
    early_scale = float(np.clip(early_reflection_strength, 0.0, 1.0))
    for delay_ms, amplitude in ((13, 0.75), (23, -0.50), (37, 0.38), (59, -0.25)):
        index = int((pre_delay_ms + delay_ms) * sr / 1000.0)
        if index < length:
            late[index] += amplitude * early_scale
    late /= math.sqrt(float(np.sum(late * late)) + EPS)
    reverberant = signal.fftconvolve(audio, late, mode="full")[: audio.size]
    dry_rms = math.sqrt(float(np.mean(audio * audio)) + EPS)
    wet_rms = math.sqrt(float(np.mean(reverberant * reverberant)) + EPS)
    reverberant *= dry_rms / max(wet_rms, EPS)
    return (1.0 - wet) * audio + wet * reverberant, wet


def add_reference_noise(
    audio: np.ndarray, sr: int, profile: dict, strength: float, seed: int
) -> tuple[np.ndarray, float]:
    if strength <= 0.0:
        return audio.copy(), 0.0
    target_analysis = frame_analysis(audio, sr)
    desired_db = float(profile["noise"]["level_dbfs"])
    current_db = float(target_analysis["noise_level_dbfs"])
    desired_rms = 10.0 ** (desired_db / 20.0) * strength
    current_rms = 10.0 ** (current_db / 20.0)
    needed_rms = math.sqrt(max(0.0, desired_rms * desired_rms - current_rms * current_rms))
    if needed_rms < 1e-7:
        return audio.copy(), 0.0

    rng = np.random.default_rng(seed + 17)
    white = rng.normal(size=audio.size)
    ref_freqs = np.asarray(profile["spectrum"]["frequencies_hz"], dtype=float)
    noise_shape_db = np.asarray(profile["noise"]["shape_db"], dtype=float)
    normalized = ref_freqs / max(ref_freqs[-1], 1.0)
    gains = 10.0 ** (np.clip(noise_shape_db, -18.0, 18.0) / 20.0)
    taps = min(257, max(65, int(sr * 0.016) | 1))
    fir = signal.firwin2(taps, normalized, gains)
    colored = signal.fftconvolve(white, fir, mode="same")
    colored /= math.sqrt(float(np.mean(colored * colored)) + EPS)
    return audio + colored * needed_rms, 20.0 * math.log10(needed_rms + EPS)


def loudness_normalize(
    input_path: Path,
    output_path: Path,
    sample_rate: int,
    profile: dict,
    options: ProcessingOptions | None = None,
) -> None:
    options = options or ProcessingOptions()
    loudness = profile["loudness"]
    integrated = float(np.clip(
        options.target_lufs if options.target_lufs is not None else loudness["integrated_lufs"],
        -50.0,
        -5.0,
    ))
    lra = float(np.clip(
        options.target_lra_lu if options.target_lra_lu is not None else loudness["loudness_range_lu"],
        1.0,
        20.0,
    ))
    peak_setting = (
        options.target_true_peak_dbfs
        if options.target_true_peak_dbfs is not None
        else min(loudness["true_peak_dbfs"], -1.0)
    )
    true_peak = float(np.clip(peak_setting, -9.0, -1.0))
    first_pass_filter = (
        f"loudnorm=I={integrated}:LRA={lra}:TP={true_peak}:print_format=json"
    )
    first_pass = run([
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(input_path),
        "-af", first_pass_filter, "-f", "null", "-",
    ], capture=True)
    log = first_pass.stderr.decode("utf-8", errors="replace")
    json_blocks = re.findall(r"\{[^{}]+\}", log, flags=re.DOTALL)
    measured = json.loads(json_blocks[-1]) if json_blocks else None
    if measured:
        filter_spec = (
            f"loudnorm=I={integrated}:LRA={lra}:TP={true_peak}:"
            f"measured_I={measured['input_i']}:"
            f"measured_LRA={measured['input_lra']}:"
            f"measured_TP={measured['input_tp']}:"
            f"measured_thresh={measured['input_thresh']}:"
            f"offset={measured['target_offset']}:linear=true"
        )
    else:
        filter_spec = f"loudnorm=I={integrated}:LRA={lra}:TP={true_peak}"
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(input_path),
        "-af", filter_spec, "-ar", str(sample_rate), "-ac", "1",
        "-c:a", "pcm_s16le", str(output_path),
    ])


def spectral_distance(audio: np.ndarray, sr: int, profile: dict) -> float:
    analysis = frame_analysis(audio, sr)
    ref_freqs = np.asarray(profile["spectrum"]["frequencies_hz"], dtype=float)
    ref_shape = np.asarray(profile["spectrum"]["speech_shape_db"], dtype=float)
    expected = np.interp(analysis["frequencies_hz"], ref_freqs, ref_shape)
    band = (analysis["frequencies_hz"] >= 100.0) & (
        analysis["frequencies_hz"] <= min(3500.0, sr * 0.46)
    )
    return float(np.mean(np.abs(expected[band] - analysis["speech_spectrum_db"][band])))


def process_one(
    reference: Path,
    target: Path,
    output: Path,
    profile: dict,
    options: ProcessingOptions,
) -> dict:
    target_hash = file_sha256(target)
    if options.duplicate_passthrough and target_hash == profile["reference"]["sha256"]:
        shutil.copy2(target, output)
        loudness = measure_loudness(output)
        return {
            "input": target.name,
            "output": output.name,
            "status": "identical_to_reference_passthrough",
            "before_lufs": loudness["integrated_lufs"],
            "after_lufs": loudness["integrated_lufs"],
            "target_lufs": profile["loudness"]["integrated_lufs"],
            "before_spectral_distance_db": 0.0,
            "after_spectral_distance_db": 0.0,
            "eq_mean_correction_db": 0.0,
            "applied_wet_mix": 0.0,
            "added_noise_dbfs": 0.0,
        }

    sr = int(profile["reference"]["sample_rate"])
    _, original = decode_audio(target, sample_rate=sr)
    before_spectral = spectral_distance(original, sr, profile)
    with tempfile.TemporaryDirectory(prefix="acoustic_match_") as temporary:
        temporary_path = Path(temporary)
        decoded = temporary_path / "decoded.wav"
        encode_wav(decoded, sr, original)
        before_loudness = measure_loudness(decoded)

        processed = spectral_dereverb(original, sr, options.dereverb_strength)
        processed = spectral_denoise(processed, sr, options.denoise_strength)
        processed, eq_correction = match_equalization(
            processed, sr, profile, options.eq_strength, options.max_eq_db
        )
        processed = match_dynamics(processed, sr, profile, options.dynamics_strength)
        processed = apply_manual_tone(processed, sr, options)
        seed = int(target_hash[:8], 16)
        processed, wet = add_reference_room(
            processed,
            sr,
            profile,
            options.room_strength,
            seed,
            options.early_reflection_strength,
            options.room_decay_scale,
            options.room_pre_delay_ms,
            options.room_damping,
        )
        processed, noise_added = add_reference_noise(
            processed, sr, profile, options.noise_strength, seed
        )
        intermediate = temporary_path / "intermediate.wav"
        encode_wav(intermediate, sr, processed)
        loudness_normalize(intermediate, output, sr, profile, options)

    _, final = decode_audio(output, sample_rate=sr)
    after_loudness = measure_loudness(output)
    return {
        "input": target.name,
        "output": output.name,
        "status": "processed",
        "before_lufs": before_loudness["integrated_lufs"],
        "after_lufs": after_loudness["integrated_lufs"],
        "target_lufs": (
            options.target_lufs
            if options.target_lufs is not None
            else profile["loudness"]["integrated_lufs"]
        ),
        "before_spectral_distance_db": round(before_spectral, 3),
        "after_spectral_distance_db": round(spectral_distance(final, sr, profile), 3),
        "eq_mean_correction_db": round(eq_correction, 3),
        "applied_dereverb_strength": round(options.dereverb_strength, 3),
        "applied_denoise_strength": round(options.denoise_strength, 3),
        "applied_dynamics_strength": round(options.dynamics_strength, 3),
        "applied_wet_mix": round(wet, 4),
        "applied_early_reflections": round(options.early_reflection_strength, 3),
        "applied_room_decay_scale": round(options.room_decay_scale, 3),
        "applied_room_pre_delay_ms": round(options.room_pre_delay_ms, 2),
        "applied_room_damping": round(options.room_damping, 3),
        "added_noise_dbfs": round(noise_added, 2),
        "manual_low_tone_db": round(options.low_tone_db, 2),
        "manual_presence_db": round(options.presence_db, 2),
        "manual_high_tone_db": round(options.high_tone_db, 2),
    }


def iter_inputs(directory: Path) -> Iterable[Path]:
    for path in sorted(directory.iterdir()):
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield path


def write_reports(output_dir: Path, profile: dict, rows: list[dict]) -> None:
    (output_dir / "acoustic_profile.json").write_text(
        json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "report.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if rows:
        with (output_dir / "report.csv").open("w", newline="", encoding="utf-8-sig") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)


def process_batch(
    reference: Path,
    input_dir: Path,
    output_dir: Path,
    options: ProcessingOptions | None = None,
) -> tuple[dict, list[dict]]:
    options = options or ProcessingOptions()
    require_ffmpeg()
    reference = reference.resolve()
    input_dir = input_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    profile = create_profile(reference)
    profile["processing_options"] = asdict(options)
    rows: list[dict] = []
    for index, target in enumerate(iter_inputs(input_dir), 1):
        output = output_dir / f"matched_{index:03d}_{target.stem}.wav"
        try:
            rows.append(process_one(reference, target, output, profile, options))
        except Exception as error:
            rows.append({
                "input": target.name,
                "output": output.name,
                "status": "failed",
                "error": f"{type(error).__name__}: {error}",
            })
    write_reports(output_dir, profile, rows)
    return profile, rows


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Batch-match dialogue recordings to one acoustic reference."
    )
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--dereverb-strength", type=float, default=0.0)
    parser.add_argument("--denoise-strength", type=float, default=0.0)
    parser.add_argument("--eq-strength", type=float, default=0.30)
    parser.add_argument("--dynamics-strength", type=float, default=0.25)
    parser.add_argument("--room-strength", type=float, default=0.0)
    parser.add_argument("--early-reflection-strength", type=float, default=0.0)
    parser.add_argument("--room-decay-scale", type=float, default=1.0)
    parser.add_argument("--room-pre-delay-ms", type=float, default=18.0)
    parser.add_argument("--room-damping", type=float, default=0.55)
    parser.add_argument("--noise-strength", type=float, default=0.0)
    parser.add_argument("--max-eq-db", type=float, default=3.0)
    parser.add_argument("--low-tone-db", type=float, default=0.0)
    parser.add_argument("--presence-db", type=float, default=0.0)
    parser.add_argument("--high-tone-db", type=float, default=0.0)
    parser.add_argument("--target-lufs", type=float)
    parser.add_argument("--target-lra-lu", type=float)
    parser.add_argument("--target-true-peak-dbfs", type=float)
    parser.add_argument("--process-duplicates", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    options = ProcessingOptions(
        dereverb_strength=float(np.clip(args.dereverb_strength, 0.0, 0.85)),
        denoise_strength=float(np.clip(args.denoise_strength, 0.0, 1.5)),
        eq_strength=float(np.clip(args.eq_strength, 0.0, 1.25)),
        dynamics_strength=float(np.clip(args.dynamics_strength, 0.0, 1.0)),
        room_strength=float(np.clip(args.room_strength, 0.0, 1.5)),
        early_reflection_strength=float(np.clip(args.early_reflection_strength, 0.0, 1.0)),
        room_decay_scale=float(np.clip(args.room_decay_scale, 0.5, 1.8)),
        room_pre_delay_ms=float(np.clip(args.room_pre_delay_ms, 0.0, 120.0)),
        room_damping=float(np.clip(args.room_damping, 0.0, 1.0)),
        noise_strength=float(np.clip(args.noise_strength, 0.0, 1.5)),
        max_eq_db=float(np.clip(args.max_eq_db, 1.0, 15.0)),
        low_tone_db=float(np.clip(args.low_tone_db, -9.0, 9.0)),
        presence_db=float(np.clip(args.presence_db, -9.0, 9.0)),
        high_tone_db=float(np.clip(args.high_tone_db, -9.0, 9.0)),
        target_lufs=args.target_lufs,
        target_lra_lu=args.target_lra_lu,
        target_true_peak_dbfs=args.target_true_peak_dbfs,
        duplicate_passthrough=not args.process_duplicates,
    )
    _, rows = process_batch(args.reference, args.input_dir, args.output_dir, options)
    failures = sum(row.get("status") == "failed" for row in rows)
    print(json.dumps({"processed": len(rows) - failures, "failed": failures}, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
