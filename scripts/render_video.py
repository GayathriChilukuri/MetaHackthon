"""Render the 180-second narrated app walkthrough from actual UI screenshots.

Requires Pillow and FFmpeg. Pass --ffmpeg or install imageio-ffmpeg in .tools.
Local WAV narration: powershell.exe -NoProfile -File scripts/narrate.ps1
ElevenLabs MP3 narration: node --env-file=.env scripts/elevenlabs.mjs
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'video'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--ffmpeg')
parser.add_argument('--voice-format', choices=['wav','mp3'], default='wav')
args = parser.parse_args()
ffmpeg = args.ffmpeg or shutil.which('ffmpeg')
if not ffmpeg:
    sys.path.insert(0, str(ROOT / '.tools'))
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
scenes = json.loads((ROOT/'docs/video-storyboard.json').read_text(encoding='utf-8'))
assert sum(s['seconds'] for s in scenes) == 180
fonts = Path('C:/Windows/Fonts')
font = lambda size, bold=False: ImageFont.truetype(str(fonts / ('segoeuib.ttf' if bold else 'segoeui.ttf')),size)
def run(command):
    result = subprocess.run([str(x) for x in command], capture_output=True, text=True, encoding='utf-8',errors='replace')
    if result.returncode:
        raise RuntimeError(result.stderr[-3500:])
    return result
def stamp(seconds):
    ms=round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

captions=[]
elapsed=0
for index,scene in enumerate(scenes):
    canvas=Image.new('RGB',(1920,1080),'#f1f5ec')
    draw=ImageDraw.Draw(canvas)
    draw.text((72,32),'stockwise.',font=font(32,True),fill='#1e684e')
    draw.text((1370,44),'WORKING PROTOTYPE  /  SYNTHETIC DATA',font=font(15),fill='#778b6c')
    screenshot=Image.open(ROOT/'docs/screenshots'/scene['image']).convert('RGB')
    # Use the top of tall captured pages so app text stays readable in a landscape frame.
    if screenshot.height > 1060:
        screenshot=screenshot.crop((0,0,screenshot.width,1060))
    screenshot=ImageOps.contain(screenshot,(1756,772),Image.Resampling.LANCZOS)
    x=(1920-screenshot.width)//2
    y=100+(772-screenshot.height)//2
    draw.rounded_rectangle((x-2,y-2,x+screenshot.width+2,y+screenshot.height+2),radius=10,fill='#dfe7d8')
    canvas.paste(screenshot,(x,y))
    draw.text((82,904),scene['title'],font=font(42,True),fill='#1b503c')
    draw.text((84,968),scene['subtitle'],font=font(23),fill='#718363')
    voice_label = 'ElevenLabs voice' if args.voice_format == 'mp3' else 'Local synthetic voice'
    draw.text((84,1033),f'Narrated app walkthrough • {voice_label} • Verified live Meta tool calling',font=font(16),fill='#90a080')
    draw.text((1710,1028),f'{index+1:02} / 08',font=font(21),fill='#6b865c')
    frame=OUT/f'scene-{index:02}.png'
    canvas.save(frame)
    voice=OUT/f'voice-{index:02}.{args.voice_format}'
    if not voice.exists():
        raise FileNotFoundError(f'Generate narration first: {voice}')
    info=subprocess.run([ffmpeg,'-i',str(voice)],capture_output=True,text=True,encoding='utf-8',errors='replace').stderr
    match=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',info)
    if not match:
        raise RuntimeError('Cannot read narration duration')
    audio_seconds=int(match[1])*3600+int(match[2])*60+float(match[3])
    tempo=max(1,audio_seconds/(scene['seconds']-0.5))
    if tempo>2:
        raise ValueError('Narration is too long for the scene')
    clip=OUT/f'clip-{index:02}.mp4'
    run([ffmpeg,'-y','-loglevel','error','-loop','1','-framerate','24','-i',frame,'-i',voice,
         '-t',scene['seconds'],'-vf',f"fade=t=in:st=0:d=0.35,fade=t=out:st={scene['seconds']-0.35}:d=0.35,format=yuv420p",
         '-af',f'atempo={tempo:.5f},apad','-c:v','libx264','-preset','veryfast','-crf','20','-threads','4',
         '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',clip])
    sentences=re.split(r'(?<=[.!?])\s+',scene['text'])
    total=sum(len(s) for s in sentences)
    cursor=elapsed
    for sentence in sentences:
        length=(scene['seconds']-.5)*len(sentence)/total
        captions.append(f'{len(captions)+1}\n{stamp(cursor)} --> {stamp(cursor+length)}\n{sentence}\n')
        cursor+=length
    elapsed+=scene['seconds']
    print(f'Scene {index+1}/8 rendered ({scene["seconds"]} seconds)',flush=True)

(OUT/'captions.srt').write_text('\n'.join(captions),encoding='utf-8')
(OUT/'concat.txt').write_text('\n'.join(f"file 'clip-{i:02}.mp4'" for i in range(len(scenes))),encoding='utf-8')
final=OUT/'Stockwise-3-minute-demo.mp4'
run([ffmpeg,'-y','-loglevel','error','-f','concat','-safe','0','-i',OUT/'concat.txt','-i',OUT/'captions.srt',
     '-map','0:v','-map','0:a','-map','1:0','-vf','setpts=PTS-STARTPTS','-af','asetpts=PTS-STARTPTS,loudnorm=I=-18:TP=-1.5:LRA=11',
     '-c:v','libx264','-preset','veryfast','-crf','20','-threads','4','-c:a','aac','-b:a','128k',
     '-c:s','mov_text','-metadata:s:s:0','language=eng',
     '-t','179.9','-movflags','+faststart',final])
print(final,flush=True)
