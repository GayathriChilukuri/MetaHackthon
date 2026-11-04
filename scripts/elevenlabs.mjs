import {readFile,mkdir,writeFile} from 'node:fs/promises';
const key=process.env.ELEVENLABS_API_KEY,voice=process.env.ELEVENLABS_VOICE_ID;
if(!key||!voice)throw new Error('Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID locally.');
const scenes=JSON.parse(await readFile(new URL('../docs/video-storyboard.json',import.meta.url),'utf8'));
const output=new URL('../output/video/',import.meta.url);await mkdir(output,{recursive:true});
for(let i=0;i<scenes.length;i++){
 const response=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,{method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({text:scenes[i].text,model_id:'eleven_multilingual_v2'}),signal:AbortSignal.timeout(90000)});
 if(!response.ok){let detail;try{detail=await response.json();}catch{}const status=String(detail?.detail?.status||'unknown');throw new Error(`ElevenLabs returned HTTP ${response.status} (${status}); generated segments remain in output/video.`);}
 await writeFile(new URL(`voice-${String(i).padStart(2,'0')}.mp3`,output),Buffer.from(await response.arrayBuffer()));
 console.log(`Narration segment ${i+1}/${scenes.length} saved.`);
}
