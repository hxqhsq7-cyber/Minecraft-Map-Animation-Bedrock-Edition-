"""Independently inspect and decode the actual UI exports using installed FFmpeg."""
from pathlib import Path
import json
import math
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    report = json.loads((ROOT / 'logs/reverse-smoke-results.json').read_bytes())
    verified = []
    for case in report['cases']:
        file = Path(report['outputDirectory']) / case['fileName']
        data = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)]))
        video = next(s for s in data['streams'] if s['codec_type'] == 'video')
        audio = next(s for s in data['streams'] if s['codec_type'] == 'audio')
        assert video['codec_name'] == 'h264' and (video['width'], video['height']) == (256, 256)
        assert video['avg_frame_rate'] == '10/1' and abs(float(video['duration']) - .6) < .001
        assert audio['codec_name'] == 'aac' and audio['sample_rate'] == '24000' and audio['channels'] == 1
        # AAC frame padding may appear in a player's reported container duration.
        assert .6 <= float(data['format']['duration']) < .69
        rgb = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(file), '-map', '0:v:0', '-threads', '1', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
        assert len(rgb) == 6 * 256 * 256 * 3
        for frame in range(6):
            for tile in range(4):
                expected = [[230, 20, 30], [20, 220, 30], [20, 30, 220], [220, 200, 40]][tile]
                if frame >= 4:
                    expected = [50 + tile * 40, 80, 160]
                elif frame >= 2 and tile == 0:
                    expected = [120, 30, 150]
                offset = (frame * 256 * 256 + (tile // 2 * 128 + 64) * 256 + tile % 2 * 128 + 64) * 3
                actual = list(rgb[offset:offset + 3])
                assert max(abs(a - b) for a, b in zip(actual, expected)) <= 8, (frame, tile, expected, actual)
        pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(file), '-map', '0:a:0', '-threads', '1', '-f', 's16le', '-'])
        samples = struct.unpack('<' + 'h' * (len(pcm) // 2), pcm)
        rms = math.sqrt(sum((n / 32768) ** 2 for n in samples) / len(samples))
        assert 14400 <= len(samples) <= 17408 and rms > .1
        verified.append({'file': case['fileName'], 'sixFramesDecoded': True, 'tileOrderAndHoldTiming': True, 'h264': True, 'aac': True, 'videoSeconds': .6, 'audioDecodedRms': round(rms, 4)})
    (ROOT / 'logs/reverse-independent-verification.json').write_text(json.dumps(verified, indent=2), encoding='utf-8')
    print('PASS: independent FFprobe/FFmpeg inspection, full H.264/AAC decode, tile colors/order, and duplicate-frame timing.')

if __name__ == '__main__':
    main()
