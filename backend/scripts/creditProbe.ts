/** Is live generation available? One call. No secret printed. */
import { callSonnet } from '../src/lib/aiPlatform';
async function main(){
  try {
    const out = await callSonnet('Reply with the single word: ok', 'ok?', {
      action: 'governed_content_generation', promptId: 'probe',
      founderId: 'probe', actorType: 'founder' } as never);
    console.log('GENERATION AVAILABLE | reply:', JSON.stringify(String(out).slice(0,30)));
  } catch (e) {
    const m = String((e as Error).message);
    console.log('GENERATION UNAVAILABLE:', m.slice(0, 160));
  }
}
main().then(()=>process.exit(0));
