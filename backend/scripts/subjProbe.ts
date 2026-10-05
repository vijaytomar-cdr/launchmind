import { buildProductCapabilityContract, findCapabilityViolations }
  from '../src/services/content/productCapabilityContract';
import type { ProductContentContext } from '../src/services/content/productContentContext';
const DESC = 'Connect with trusted, vetted home service professionals in your neighborhood — quickly, safely, and conveniently.';
const ctx = { application: { name: 'AllignX', category: null, markets: ['usa'], description: DESC },
  brand: { fields: {}, missing: [] } } as unknown as ProductContentContext;
const C = buildProductCapabilityContract(ctx);
const SAFE = [
  'If your search for help starts with hold music...',
  'If finding help feels harder than it should...',
  'Still trying to figure out who to call?',
  'Does getting help for a home project have to feel this complicated?',
];
const UNSAFE = [
  'AllignX searches for professionals.','Search for professionals with AllignX.',
  'You can search for professionals.','AllignX lets you find professionals.',
  'Find professionals with AllignX.','Browse professionals in AllignX.',
  'Compare professionals in AllignX.','Book a professional with AllignX.',
  'Your booking is confirmed instantly.','Your payment is processed instantly.',
  'Your quote arrives instantly.','Your appointment is scheduled automatically.',
  'Your request is matched automatically.','Your professional is selected automatically.',
  'What if your booking were confirmed instantly?','Imagine your quote arriving instantly.',
  "Wouldn't it be easier if AllignX matched you automatically?",
];
console.log('--- SAFE (must have 0 violations) ---');
for (const t of SAFE) {
  const v = findCapabilityViolations(t, C);
  console.log((v.length===0?'ok  ':'FAIL').padEnd(5), JSON.stringify(t).slice(0,62), v.map(x=>x.verb).join(','));
}
console.log('--- UNSAFE (must have >=1 violation) ---');
for (const t of UNSAFE) {
  const v = findCapabilityViolations(t, C);
  console.log((v.length>0?'ok  ':'HOLE').padEnd(5), JSON.stringify(t).slice(0,62), v.map(x=>x.verb).join(','));
}
